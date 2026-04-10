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

// --- ДИНАМИЧЕСКИЙ ПАРСИНГ ПОЧТЫ ---
app.get('/api/emails', async (req, res) => {
    // Получаем email пользователя из заголовков (передадим с фронтенда)
    const userEmail = req.headers['x-user-email'];

    if (!userEmail) return res.status(401).json({ message: 'Не авторизован' });

    try {
        // 1. Ищем настройки почты этого пользователя в базе
        const { data: user, error } = await supabase
            .from('users')
            .select('mail_user, mail_pass, mail_host')
            .eq('email', userEmail)
            .single();

        if (error || !user.mail_pass) {
            return res.status(400).json({ message: 'Настройки почты не найдены' });
        }

        const config = {
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

        // 2. Подключаемся к его почте
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        const fetchOptions = {
            bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)', 'TEXT'],
            markSeen: false
        };
        const searchCriteria = ['ALL'];
        const messages = await connection.search(searchCriteria, fetchOptions);
        
        const lastMessages = messages.slice(-5).reverse();
        const parsedEmails = [];

        for (let item of lastMessages) {
            const all = item.parts.find(part => part.which === '');
            const mail = await simpleParser(all.body);
            
            parsedEmails.push({
                id: item.attributes.uid,
                sender: mail.from.text,
                subject: mail.subject || '(Без темы)',
                date: mail.date ? mail.date.toLocaleString('ru-RU') : '',
                body: mail.text ? mail.text.substring(0, 200) + '...' : ''
            });
        }

        connection.end();
        res.json(parsedEmails);
    } catch (error) {
        console.error('Ошибка IMAP:', error);
        res.status(500).json({ message: 'Ошибка доступа к почтовому ящику' });
    }
});

// --- РЕГИСТРАЦИЯ С ДАННЫМИ ПОЧТЫ ---
app.post('/api/register', async (req, res) => {
    const { email, password, mail_user, mail_pass, mail_host } = req.body;
    
    const { error } = await supabase.from('users').insert([{ 
        email, 
        password, 
        mail_user, 
        mail_pass, 
        mail_host 
    }]);

    if (error) return res.status(400).json({ message: 'Ошибка регистрации или email занят' });
    res.status(201).json({ message: 'Аккаунт создан успешно!' });
});

// --- ВХОД ---
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const { data: users } = await supabase.from('users').select('*').eq('email', email).eq('password', password);
    
    if (users && users.length > 0) {
        res.status(200).json({ email: users[0].email });
    } else {
        res.status(401).json({ message: 'Неверный логин или пароль' });
    }
});

app.listen(PORT, () => console.log(`🚀 Сервер на порту ${PORT}`));