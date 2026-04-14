const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const imaps = require('imap-simple');
// mailparser оставляем про запас для будущей фичи чтения полного текста писем
const simpleParser = require('mailparser').simpleParser; 

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public')); 

// Подключение к Supabase
const SUPABASE_URL = 'https://mjnnipkwxywrxoamgxcd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_EQYwaEpQxhJoSeX4UaOYjw_fPJjwfot';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- ДИНАМИЧЕСКИЙ ПАРСИНГ ПОЧТЫ (МАКСИМАЛЬНАЯ ОПТИМИЗАЦИЯ) ---
app.get('/api/emails', async (req, res) => {
    const userEmail = req.headers['x-user-email'];

    if (!userEmail) return res.status(401).json({ message: 'Не авторизован' });

    try {
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

        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        // Запрашиваем только заголовки
        const fetchOptions = { 
            bodies: ['HEADER'], 
            markSeen: false
        };
        // Берем последние 5 писем с конца (по UID), чтобы не скачивать всю базу
        const searchCriteria = ['ALL'];
        const messages = await connection.search(searchCriteria, fetchOptions);
        
        // Берем 5 самых свежих писем
        const lastMessages = messages.slice(-5).reverse();
        const parsedEmails = [];

        for (let item of lastMessages) {
            try {
                // Находим часть с заголовками
                const headerPart = item.parts.find(part => part.which === 'HEADER');
                
                if (headerPart && headerPart.body) {
                    // imap-simple УЖЕ превратил заголовки в объект, берем данные напрямую!
                    const headers = headerPart.body;
                    
                    parsedEmails.push({
                        id: item.attributes.uid,
                        // imap-simple возвращает данные в виде массивов, поэтому берем нулевой элемент [0]
                        sender: headers.from ? headers.from[0] : 'Неизвестный отправитель',
                        subject: headers.subject ? headers.subject[0] : '(Без темы)',
                        date: headers.date ? headers.date[0] : '',
                        body: 'Нажмите, чтобы загрузить текст письма...' 
                    });
                }
            } catch (innerErr) {
                console.error(`Ошибка при обработке письма UID ${item.attributes.uid}:`, innerErr.message);
                continue; 
            }
        }

        connection.end();
        res.json(parsedEmails);
    } catch (error) {
        console.error('Ошибка IMAP:', error.message);
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