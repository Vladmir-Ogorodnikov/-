const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

let db;

// Настройка и запуск базы данных
async function setupDatabase() {
    db = await open({
        filename: './database.sqlite', 
        driver: sqlite3.Database
    });

    // Создаем табличку для пользователей, если её еще нет
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE,
            password TEXT
        )
    `);
    console.log('✅ База данных SQLite готова к работе!');
}
setupDatabase();

// --- МАРШРУТЫ СЕРВЕРА ---

// 1. Регистрация
app.post('/api/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: 'Заполните все поля' });
        }

        // Записываем пользователя в базу
        await db.run('INSERT INTO users (email, password) VALUES (?, ?)', [email, password]);
        console.log('Новый пользователь:', email);
        res.status(201).json({ message: 'Регистрация успешна! Теперь вы можете войти.' });

    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT') {
            return res.status(400).json({ message: 'Пользователь с таким email уже существует' });
        }
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// 2. Вход
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Ищем пользователя
        const user = await db.get('SELECT * FROM users WHERE email = ? AND password = ?', [email, password]);

        if (user) {
            res.status(200).json({ message: 'Вход выполнен', email: user.email });
        } else {
            res.status(401).json({ message: 'Неверный email или пароль' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
});