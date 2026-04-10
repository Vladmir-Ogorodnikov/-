const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Раздаем папку с сайтом

// --- НАСТРОЙКИ SUPABASE ---
const SUPABASE_URL = 'https://mjnnipkwxywrxoamgxcd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_EQYwaEpQxhJoSeX4UaOYjw_fPJjwfot'; // <-- Вставь свой скопированный ключ сюда

// Подключаемся к облачной базе
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log('✅ Облачная база Supabase подключена!');

// --- МАРШРУТЫ СЕРВЕРА ---

// 1. Регистрация
app.post('/api/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: 'Заполните все поля' });
        }

        // Записываем пользователя в таблицу users в Supabase
        const { error } = await supabase
            .from('users')
            .insert([{ email, password }]);

        if (error) {
            // Код 23505 в PostgreSQL означает, что такой email уже есть
            if (error.code === '23505') {
                return res.status(400).json({ message: 'Пользователь с таким email уже существует' });
            }
            throw error; // Бросаем остальные ошибки в catch
        }

        console.log('Зарегистрирован новый пользователь:', email);
        res.status(201).json({ message: 'Регистрация успешна! Теперь вы можете войти.' });

    } catch (error) {
        console.error('Ошибка регистрации:', error.message);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// 2. Вход
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Ищем пользователя с таким email и паролем
        const { data: users, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .eq('password', password);

        if (error) throw error;

        // Если массив users не пустой, значит пользователь найден
        if (users && users.length > 0) {
            console.log('Пользователь вошел:', email);
            res.status(200).json({ 
                message: 'Вход выполнен', 
                email: users[0].email 
            });
        } else {
            res.status(401).json({ message: 'Неверный email или пароль' });
        }
    } catch (error) {
        console.error('Ошибка входа:', error.message);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
});