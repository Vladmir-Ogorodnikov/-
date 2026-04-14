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

// --- ФУНКЦИЯ ДЛЯ ПОЛУЧЕНИЯ НАСТРОЕК IMAP ---
// Вынес в отдельную функцию, так как она нужна теперь в двух местах
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

// --- 1. МАРШРУТ: ПОЛУЧИТЬ СПИСОК ПИСЕМ (ТОЛЬКО ЗАГОЛОВКИ) ---
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
                        id: item.attributes.uid, // Это уникальный ID письма на сервере
                        sender: headers.from ? headers.from[0] : 'Неизвестный',
                        subject: headers.subject ? headers.subject[0] : '(Без темы)',
                        date: headers.date ? headers.date[0] : '',
                        body: 'Нажмите, чтобы прочитать...' // Заглушка
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

// --- 2. НОВЫЙ МАРШРУТ: ПОЛУЧИТЬ ПОЛНЫЙ ТЕКСТ ПИСЬМА ПО ЕГО UID ---
app.get('/api/emails/:uid', async (req, res) => {
    const userEmail = req.headers['x-user-email'];
    const uid = req.params.uid; // Получаем ID письма из URL

    if (!userEmail) return res.status(401).json({ message: 'Не авторизован' });

    try {
        const config = await getImapConfig(userEmail);
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        // Ищем конкретное письмо по UID
        const searchCriteria = [['UID', uid]];
        // Скачиваем его ЦЕЛИКОМ ('')
        const fetchOptions = { bodies: [''], markSeen: true }; // markSeen: true пометит письмо как прочитанное на Mail.ru
        
        const messages = await connection.search(searchCriteria, fetchOptions);
        
        if (messages.length === 0) {
            connection.end();
            return res.status(404).json({ message: 'Письмо не найдено' });
        }

        const emailData = messages[0];
        const allPart = emailData.parts.find(part => part.which === '');
        
        // Вот теперь используем mailparser для разбора всего текста
        const parsedMail = await simpleParser(allPart.body);

        connection.end();

        // Отправляем на фронтенд только нужный текст
        res.json({
            id: uid,
            text: parsedMail.text || 'В письме нет текстового содержания (возможно, только картинки).',
            html: parsedMail.html // На будущее, если захотим показывать красивые письма с версткой
        });

    } catch (error) {
        console.error('Ошибка загрузки письма:', error.message);
        res.status(500).json({ message: 'Не удалось загрузить текст письма' });
    }
});

// --- РЕГИСТРАЦИЯ И ВХОД (Без изменений) ---
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