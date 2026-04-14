const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser; 

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public')); 

const SUPABASE_URL = 'https://mjnnipkwxywrxoamgxcd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_EQYwaEpQxhJoSeX4UaOYjw_fPJjwfot';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function getImapConfig(userEmail) {
    const { data: user, error } = await supabase
        .from('users')
        .select('mail_user, mail_pass, mail_host')
        .eq('email', userEmail)
        .single();

    if (error || !user.mail_pass) throw new Error('Настройки почты не найдены');

    return {
        imap: {
            user: user.mail_user,
            password: user.mail_pass,
            host: user.mail_host,
            port: 993,
            tls: true,
            authTimeout: 10000,
            tlsOptions: { rejectUnauthorized: false }
        }
    };
}

// Очистка текста: просто удаляем ссылки, чтобы они вообще не мозолили глаза ИИ
function cleanTextForAI(text) {
    if (!text) return '';
    // Вместо слова [ССЫЛКА] мы просто стираем урлы, оставляя только чистый смысл письма
    let cleaned = text.replace(/https?:\/\/[^\s]+/g, '');
    return cleaned.substring(0, 2000); 
}

// --- 1. СПИСОК ПИСЕМ ---
app.get('/api/emails', async (req, res) => {
    const userEmail = req.headers['x-user-email'];
    if (!userEmail) return res.status(401).json({ message: 'Не авторизован' });

    try {
        const config = await getImapConfig(userEmail);
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        const fetchOptions = { bodies: ['HEADER'], markSeen: false };
        const searchCriteria = ['ALL'];
        const messages = await connection.search(searchCriteria, fetchOptions);
        
        const lastMessages = messages.slice(-5).reverse();
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
            } catch (innerErr) {
                console.error(`Ошибка письма UID ${item.attributes.uid}:`, innerErr.message);
            }
        }
        connection.end();
        res.json(parsedEmails);
    } catch (error) {
        res.status(500).json({ message: 'Ошибка получения списка писем' });
    }
});

// --- 2. ПОЛНОЕ ПИСЬМО + САММАРИ ---
app.get('/api/emails/:uid', async (req, res) => {
    const userEmail = req.headers['x-user-email'];
    const uid = req.params.uid; 
    if (!userEmail) return res.status(401).json({ message: 'Не авторизован' });

    try {
        const config = await getImapConfig(userEmail);
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        const searchCriteria = [['UID', uid]];
        const fetchOptions = { bodies: [''], markSeen: true }; 
        const messages = await connection.search(searchCriteria, fetchOptions);
        
        if (messages.length === 0) {
            connection.end();
            return res.status(404).json({ message: 'Письмо не найдено' });
        }

        const emailData = messages[0];
        const allPart = emailData.parts.find(part => part.which === '');
        const parsedMail = await simpleParser(allPart.body);
        connection.end();

        const rawText = parsedMail.text || '';
        let aiSummary = "Саммари недоступно (в письме нет текста).";

        if (rawText.length > 10) {
            try {
                const textForAi = cleanTextForAI(rawText); 
                const aiResponse = await fetch('https://text.pollinations.ai/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messages: [
                            // НОВЫЙ ПРОМПТ: Учим ИИ доверять официальным кодам
                            { role: 'system', content: 'Ты умный ассистент. Напиши краткую суть письма (1-2 предложения). Учти: письма с кодами безопасности (EA, Steam, Google, банки) — это легитимные системные уведомления, не называй их фишингом.' },
                            { role: 'user', content: `Письмо:\n${textForAi}` }
                        ]
                    })
                });

                if (aiResponse.ok) aiSummary = await aiResponse.text();
            } catch (aiError) {
                console.error("Сбой ИИ:", aiError.message);
            }
        }

        res.json({ id: uid, text: rawText || 'Нет текста.', summary: aiSummary });
    } catch (error) {
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// --- 3. ФОНОВАЯ КЛАССИФИКАЦИЯ (УЛУЧШЕННАЯ) ---
app.get('/api/emails/:uid/analyze', async (req, res) => {
    const userEmail = req.headers['x-user-email'];
    const uid = req.params.uid; 
    if (!userEmail) return res.status(401).json({ message: 'Не авторизован' });

    try {
        const config = await getImapConfig(userEmail);
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        const searchCriteria = [['UID', uid]];
        const fetchOptions = { bodies: [''], markSeen: false }; 
        const messages = await connection.search(searchCriteria, fetchOptions);
        
        if (messages.length === 0) {
            connection.end();
            return res.json({ category: 'ОБЫЧНО' });
        }

        const emailData = messages[0];
        const allPart = emailData.parts.find(part => part.which === '');
        const parsedMail = await simpleParser(allPart.body);
        connection.end();

        const rawText = parsedMail.text || '';
        let finalCategory = 'ОБЫЧНО'; 

        if (rawText.length > 10) {
            try {
                const textForAi = cleanTextForAI(rawText); 
                const aiResponse = await fetch('https://text.pollinations.ai/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messages: [
                            // НОВЫЙ ПРОМПТ ДЛЯ КАТЕГОРИЙ: Явно указываем, куда кидать коды
                            { 
                                role: 'system', 
                                content: `Определи категорию письма. Выбери строго ОДНО слово из списка:
- ВАЖНО (коды авторизации, 2FA, пароли от EA/Steam/Google, чеки, билеты, официальные письма от сервисов)
- СПАМ (откровенные мошенники, казино, шантаж)
- РЕКЛАМА (скидки, маркетинг, рассылки магазинов)
- РАБОТА (задачи, проекты, коллеги)
- ЛИЧНОЕ (переписка)
- ОБЫЧНО (всё остальное)
Ответь только одним словом, без точек.` 
                            },
                            { role: 'user', content: `Текст письма:\n${textForAi}` }
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
                }
            } catch (aiError) {
                console.error("Сбой фонового ИИ:", aiError.message);
            }
        }

        res.json({ category: finalCategory });
    } catch (error) {
        res.json({ category: 'ОБЫЧНО' }); 
    }
});

app.post('/api/register', async (req, res) => {
    const { email, password, mail_user, mail_pass, mail_host } = req.body;
    const { error } = await supabase.from('users').insert([{ email, password, mail_user, mail_pass, mail_host }]);
    if (error) return res.status(400).json({ message: 'Ошибка регистрации' });
    res.status(201).json({ message: 'Аккаунт создан!' });
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const { data: users } = await supabase.from('users').select('*').eq('email', email).eq('password', password);
    if (users && users.length > 0) res.status(200).json({ email: users[0].email });
    else res.status(401).json({ message: 'Неверный логин' });
});

app.listen(PORT, () => console.log(`🚀 Сервер на порту ${PORT}`));