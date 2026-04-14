class AuthService {
    constructor() {
        this.baseURL = 'http://localhost:8000/api';
    }

    async login() {
        try {
            const response = await fetch(`${this.baseURL}/auth/google/login/`);
            const data = await response.json();
            window.location.href = data.authorization_url;
        } catch (error) {
            console.error('Login error:', error);
            alert('Ошибка при входе');
        }
    }

    async getCurrentUser() {
        try {
            const response = await fetch(`${this.baseURL}/auth/me/`, {
                credentials: 'include'
            });
            
            if (response.ok) {
                return await response.json();
            }
            return null;
        } catch (error) {
            console.error('Get user error:', error);
            return null;
        }
    }

    logout() {
        fetch(`${this.baseURL}/auth/logout/`, {
            method: 'POST',
            credentials: 'include'
        }).then(() => {
            window.location.reload();
        });
    }
}