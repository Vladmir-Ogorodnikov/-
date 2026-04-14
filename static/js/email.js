// Email Service для взаимодействия с Django backend
class EmailService {
    constructor() {
        this.baseURL = window.location.origin + '/api'; // Используем текущий домен
        
        console.log('📧 EmailService initialized:', this.baseURL);
    }

    /**
     * Парсинг писем из Gmail
     */
    async parseEmails() {
        try {
            console.log('🚀 Начало парсинга писем...');
            
            const response = await fetch(`${this.baseURL}/emails/parse/`, {
                method: 'POST',
                credentials: 'include',  // Передаём session cookies
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                redirect: 'follow'  // Следовать редиректам
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            console.log('✅ Парсинг завершён:', data);
            return data;

        } catch (error) {
            console.error('❌ Ошибка парсинга писем:', error);
            alert('Ошибка при загрузке писем: ' + error.message);
            throw error;
        }
    }

    /**
     * Анализ писем AI
     */
    async analyzeEmails() {
        try {
            console.log('🤖 Начало анализа писем...');
            
            const response = await fetch(`${this.baseURL}/emails/analyze/`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                redirect: 'follow'
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            console.log('✅ Анализ завершён:', data);
            return data;

        } catch (error) {
            console.error('❌ Ошибка анализа писем:', error);
            alert('Ошибка при анализе писем: ' + error.message);
            throw error;
        }
    }

    /**
     * Получение списка писем
     */
    async getEmails(keyOnly = false) {
        try {
            console.log('📥 Получение списка писем (key_only:', keyOnly, ')...');
            
            const url = `${this.baseURL}/emails/list/?key_only=${keyOnly}`;
            
            const response = await fetch(url, {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                redirect: 'follow'
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            console.log('✅ Получено писем:', data.length);
            return data;

        } catch (error) {
            console.error('❌ Ошибка получения писем:', error);
            alert('Ошибка при загрузке писем: ' + error.message);
            return [];
        }
    }

    /**
     * Получение деталей письма
     */
    async getEmailDetail(emailId) {
        try {
            console.log('🔍 Получение деталей письма ID:', emailId);
            
            const response = await fetch(`${this.baseURL}/emails/${emailId}/`, {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                redirect: 'follow'
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            console.log('✅ Детали письма получены:', data.id);
            return data;

        } catch (error) {
            console.error('❌ Ошибка получения деталей письма:', error);
            alert('Ошибка при загрузке деталей письма: ' + error.message);
            throw error;
        }
    }

    /**
     * Тестовый метод проверки подключения
     */
    async testConnection() {
        try {
            console.log('🧪 Тест подключения к API...');
            
            const response = await fetch(`${this.baseURL}/test-api/`, {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Accept': 'application/json'
                }
            });

            const data = await response.json();
            console.log('✅ Коннект OK:', data);
            return true;

        } catch (error) {
            console.error('❌ Тест коннекта провален:', error);
            return false;
        }
    }
}

// Экспорт класса (для использования в других скриптах)
window.EmailService = EmailService;
console.log('✅ EmailService class defined and exported');