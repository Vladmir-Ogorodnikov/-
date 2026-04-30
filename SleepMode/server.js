const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser; 

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
// Лимит 10мб защищает от падений при парсинге тяжелых писем
app.use(express.json({ limit: '10mb' })); 
app.use(express.static('public')); 

const SUPABASE_URL = 'https://mjnnipkwxywrxoamgxcd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_EQYwaEpQxhJoSeX4UaOYjw_fPJjwfot';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function getImapConfig(userEmail, accountId) {
    if (!accountId) throw new Error('Не указан ID ящика');
    const { data: account, error } = await supabase
        .from('connected_accounts')
        .select('*')
        .eq('id', accountId)
        .eq('user_email', userEmail)
        .single();
    if (error || !account) throw new Error('Настройки почты не найдены в базе данных');
    return {
        imap: {
            user: account.mail_user, password: account.mail_pass, host: account.mail_host,
            port: 993, tls: true, authTimeout: 10000, tlsOptions: { rejectUnauthorized: false }
        }
    };
}

function cleanTextForAI(text) {
    if (!text) return '';
    let cleaned = text.replace(/https?:\/\/[^\s]+/g, '').replace(/\s+/g, ' ');
    return cleaned.substring(0, 2000); 
}

function extractTextFromMail(parsedMail) {
    let rawText = parsedMail.text || '';
    if (!rawText && parsedMail.html) {
        rawText = parsedMail.html.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ');
    }
    return rawText;
}

// УПРАВЛЕНИЕ ЯЩИКАМИ
app.get('/api/accounts', async (req, res) => {
    const userEmail = req.headers['x-user-email'];
    if (!userEmail) return res.status(401).json({ message: 'Не авторизован' });
    const { data, error } = await supabase.from('connected_accounts').select('*').eq('user_email', userEmail);
    if (error) return res.status(500).json({ message: error.message });
    res.json(data || []);
});

app.post('/api/accounts', async (req, res) => {
    const userEmail = req.headers['x-user-email'];
    const { mail_user, mail_pass, mail_host, title } = req.body;
    if (!userEmail) return res.status(401).json({ message: 'Не авторизован' });
    const { error } = await supabase.from('connected_accounts').insert([{ user_email: userEmail, mail_user, mail_pass, mail_host, title }]);
    if (error) return res.status(400).json({ message: error.message }); 
    res.json({ message: 'Ящик успешно добавлен!' });
});

// 1. СПИСОК ПИСЕМ
app.get('/api/emails', async (req, res) => {
    const userEmail = req.headers['x-user-email'];
    const accountId = req.headers['x-account-id'];
    if (!userEmail) return res.status(401).json({ message: 'Не авторизован' });

    try {
        const config = await getImapConfig(userEmail, accountId);
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        const messages = await connection.search(['ALL'], { bodies: ['HEADER'], markSeen: false });
        const lastMessages = messages.slice(-10).reverse(); 
        const parsedEmails = [];

        for (let item of lastMessages) {
            try {
                const headerPart = item.parts.find(part => part.which === 'HEADER');
                if (headerPart && headerPart.body) {
                    const headers = headerPart.body;
                    parsedEmails.push({
                        id: item.attributes.uid,
                        sender: headers.from ? headers.from[0] : 'Неизвестный',
                        subject: headers.subject ? headers.subject[0] : '(Без темы)',
                        date: headers.date ? headers.date[0] : '',
                        body: 'Нажмите для чтения...' 
                    });
                }
            } catch (innerErr) {}
        }
        connection.end();
        res.json(parsedEmails);
    } catch (error) {
        res.status(500).json({ message: `Отказ почтового сервера: ${error.message}` });
    }
});

// 2. ОТКРЫТИЕ ПИСЬМА (ТОЛЬКО ТЕКСТ)
app.get('/api/emails/:uid', async (req, res) => {
    const userEmail = req.headers['x-user-email'];
    const accountId = req.headers['x-account-id'];
    const uid = req.params.uid; 
    if (!userEmail) return res.status(401).json({ message: 'Не авторизован' });

    try {
        const { data: cached } = await supabase.from('email_cache').select('body_text').eq('account_id', accountId).eq('uid', uid).single();
        if (cached && cached.body_text) return res.json({ id: uid, text: cached.body_text });

        const config = await getImapConfig(userEmail, accountId);
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        const messages = await connection.search([['UID', uid]], { bodies: [''], markSeen: true });
        if (messages.length === 0) {
            connection.end();
            return res.status(404).json({ message: 'Письмо не найдено' });
        }

        const parsedMail = await simpleParser(messages[0].parts.find(part => part.which === '').body);
        connection.end();

        const rawText = extractTextFromMail(parsedMail);
        const bodyTextToSave = rawText || 'Нет текста.';

        const { data: existing } = await supabase.from('email_cache').select('uid').eq('account_id', accountId).eq('uid', uid).single();
        if (existing) {
            await supabase.from('email_cache').update({ body_text: bodyTextToSave }).eq('account_id', accountId).eq('uid', uid);
        } else {
            await supabase.from('email_cache').insert([{ account_id: accountId, uid: uid, body_text: bodyTextToSave }]);
        }

        res.json({ id: uid, text: bodyTextToSave });
    } catch (error) {
        res.status(500).json({ message: `Отказ почтового сервера: ${error.message}` });
    }
});

// 3. ГЕНЕРАЦИЯ САММАРИ (ЗАЩИЩЕНО ОТ ПАДЕНИЙ)
app.post('/api/emails/:uid/summary', async (req, res) => {
    const userEmail = req.headers['x-user-email'];
    const accountId = req.headers['x-account-id'];
    const uid = req.params.uid;
    
    // БЕЗОПАСНОСТЬ: задаем значения по умолчанию, если клиент прислал пустой запрос
    const { text = '', sender = 'Неизвестный', subject = '(Без темы)' } = req.body || {};

    if (!userEmail) return res.status(401).json({ message: 'Не авторизован' });

    try {
        const { data: cached } = await supabase.from('email_cache').select('summary').eq('account_id', accountId).eq('uid', uid).single();
        if (cached && cached.summary) return res.json({ summary: cached.summary });

        let aiSummary = "ИИ не смог сгенерировать выжимку.";
        let aiSuccess = false;

        // БЕЗОПАСНОСТЬ: проверяем, что текст есть и он длиннее 10 символов
        if (text && text.trim().length > 10) {
            try {
                const textForAi = cleanTextForAI(text); 
                const aiResponse = await fetch('https://text.pollinations.ai/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messages: [
                            { role: 'system', content: 'Ты умный ассистент. Напиши краткую суть письма (1-2 предложения).' },
                            { role: 'user', content: `Отправитель: ${sender}\nТема: ${subject}\nПисьмо:\n${textForAi}` }
                        ]
                    })
                });

                if (aiResponse.ok) {
                    aiSummary = await aiResponse.text();
                    aiSuccess = true;
                } else {
                    throw new Error(`Нейросеть ответила статусом ${aiResponse.status}`);
                }
            } catch (aiError) {
                console.error("Сбой ИИ (Саммари):", aiError.message);
                throw new Error("Сбой на стороне сервера нейросети"); 
            }
        } else {
            aiSummary = "Текст письма слишком короткий для выжимки.";
            aiSuccess = true; // Это не ошибка, просто текста нет
        }

        if (aiSuccess) {
            const { data: existing } = await supabase.from('email_cache').select('uid').eq('account_id', accountId).eq('uid', uid).single();
            if (existing) {
                await supabase.from('email_cache').update({ summary: aiSummary }).eq('account_id', accountId).eq('uid', uid);
            } else {
                await supabase.from('email_cache').insert([{ account_id: accountId, uid: uid, summary: aiSummary }]);
            }
        }

        res.json({ summary: aiSummary });
    } catch (error) {
        console.error("Ошибка маршрута /summary:", error.message);
        res.status(500).json({ message: error.message || 'Ошибка сервера при обработке' });
    }
});

// 4. ФОНОВАЯ КЛАССИФИКАЦИЯ
app.get('/api/emails/:uid/analyze', async (req, res) => {
    const userEmail = req.headers['x-user-email'];
    const accountId = req.headers['x-account-id'];
    const uid = req.params.uid; 
    if (!userEmail) return res.status(401).json({ message: 'Не авторизован' });

    try {
        const { data: cached } = await supabase.from('email_cache').select('category').eq('account_id', accountId).eq('uid', uid).single();
        if (cached && cached.category) return res.json({ category: cached.category, cached: true });

        const config = await getImapConfig(userEmail, accountId);
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        const messages = await connection.search([['UID', uid]], { bodies: [''], markSeen: false });
        if (messages.length === 0) {
            connection.end();
            return res.json({ category: 'ОБЫЧНО', cached: false });
        }

        const parsedMail = await simpleParser(messages[0].parts.find(part => part.which === '').body);
        connection.end();

        const rawText = extractTextFromMail(parsedMail);
        const sender = parsedMail.from && parsedMail.from.text ? parsedMail.from.text : 'Неизвестный';
        const subject = parsedMail.subject || '(Без темы)';
        
        let finalCategory = 'ОБЫЧНО'; 
        let aiSuccess = false; 

        if (rawText.trim().length > 10) {
            try {
                const textForAi = cleanTextForAI(rawText); 
                const aiResponse = await fetch('https://text.pollinations.ai/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messages: [
                            { 
                                role: 'system', 
                                content: `Определи категорию письма. Выбери строго ОДНО слово из списка:
- ВАЖНО (коды авторизации, 2FA, пароли от EA/Steam/Google, чеки, билеты, официальные письма от сервисов)
- СПАМ (откровенные мошенники, казино, шантаж)
- РЕКЛАМА (скидки, маркетинг, рассылки магазинов)
- РАБОТА (задачи, проекты, коллеги, учеба, курсы, Stepik)
- ЛИЧНОЕ (переписка)
- ОБЫЧНО (всё остальное)
Ответь только одним словом, без точек.` 
                            },
                            { role: 'user', content: `Отправитель: ${sender}\nТема: ${subject}\nТекст письма:\n${textForAi}` }
                        ]
                    })
                });

                if (aiResponse.ok) {
                    let aiDecision = await aiResponse.text();
                    aiDecision = aiDecision.toUpperCase();
                    if (aiDecision.includes('ВАЖНО')) finalCategory = 'ВАЖНО';
                    else if (aiDecision.includes('СПАМ')) finalCategory = 'СПАМ';
                    else if (aiDecision.includes('РЕКЛАМА')) finalCategory = 'РЕКЛАМА';
                    else if (aiDecision.includes('РАБОТА')) finalCategory = 'РАБОТА';
                    else if (aiDecision.includes('ЛИЧНОЕ')) finalCategory = 'ЛИЧНОЕ';
                    aiSuccess = true; 
                }
            } catch (aiError) {}
        } else {
            aiSuccess = true; 
        }

        if (aiSuccess) {
            const bodyTextToSave = rawText || 'Нет текста.';
            const { data: existing } = await supabase.from('email_cache').select('uid').eq('account_id', accountId).eq('uid', uid).single();
            if (existing) {
                await supabase.from('email_cache').update({ category: finalCategory, body_text: bodyTextToSave }).eq('account_id', accountId).eq('uid', uid);
            } else {
                await supabase.from('email_cache').insert([{ account_id: accountId, uid: uid, category: finalCategory, body_text: bodyTextToSave }]);
            }
        }

        res.json({ category: finalCategory, cached: false });
    } catch (error) {
        res.json({ category: 'ОБЫЧНО', cached: false }); 
    }
});

app.post('/api/register', async (req, res) => {
    const { email, password, mail_user, mail_pass, mail_host } = req.body;
    const { error: userError } = await supabase.from('users').insert([{ email, password }]);
    if (userError) return res.status(400).json({ message: 'Ошибка регистрации аккаунта' });
    await supabase.from('connected_accounts').insert([{ user_email: email, mail_user, mail_pass, mail_host, title: 'Основной ящик' }]);
    res.status(201).json({ message: 'Аккаунт создан!' });
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const { data: users } = await supabase.from('users').select('*').eq('email', email).eq('password', password);
    if (users && users.length > 0) res.status(200).json({ email: users[0].email });
    else res.status(401).json({ message: 'Неверный логин' });
});

app.listen(PORT, () => console.log(`🚀 Сервер запущен`));