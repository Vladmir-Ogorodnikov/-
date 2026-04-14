const authService = new AuthService();
const emailService = new EmailService();
let currentUser = null;

async function init() {
    currentUser = await authService.getCurrentUser();
    
    if (currentUser) {
        showMainSection();
        loadEmails();
    } else {
        showAuthSection();
    }
}

function showAuthSection() {
    document.getElementById('auth-section').style.display = 'block';
    document.getElementById('main-section').style.display = 'none';
}

function showMainSection() {
    document.getElementById('auth-section').style.display = 'none';
    document.getElementById('main-section').style.display = 'block';
    document.getElementById('user-email').textContent = currentUser.email;
}

function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'block' : 'none';
}

async function loadEmails() {
    try {
        showLoading(true);
        const keyOnly = document.getElementById('key-only-filter').checked;
        const emails = await emailService.getEmails(keyOnly);
        renderEmails(emails);
    } catch (error) {
        alert('Ошибка при загрузке писем');
    } finally {
        showLoading(false);
    }
}

function renderEmails(emails) {
    const container = document.getElementById('emails-container');
    
    if (emails.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">Нет писем для отображения</p>';
        return;
    }
    
    container.innerHTML = emails.map(email => `
        <div class="email-card ${email.is_key ? 'key-email' : ''}" onclick="showEmailDetail(${email.id})">
            <div class="email-header">
                <span class="email-sender">${escapeHtml(email.sender)}</span>
                <span class="email-date">${formatDate(email.received_date)}</span>
            </div>
            <div class="email-subject">
                ${escapeHtml(email.subject)}
                ${getImportanceBadge(email.importance_score)}
            </div>
            ${email.ai_summary ? `<div class="email-summary">${escapeHtml(email.ai_summary)}</div>` : ''}
            ${email.tags && email.tags.length > 0 ? `
                <div class="email-tags">
                    ${email.tags.map(tag => `<span class="tag">${tag.category}</span>`).join('')}
                </div>
            ` : ''}
        </div>
    `).join('');
}

function getImportanceBadge(score) {
    if (!score) return '';
    
    let className, text;
    if (score >= 0.7) { className = 'importance-high'; text = 'Высокая важность'; }
    else if (score >= 0.4) { className = 'importance-medium'; text = 'Средняя важность'; }
    else { className = 'importance-low'; text = 'Низкая важность'; }
    
    return `<span class="importance-badge ${className}">${text}</span>`;
}

async function showEmailDetail(emailId) {
    try {
        const email = await emailService.getEmailDetail(emailId);
        const modal = document.getElementById('email-modal');
        const detailContainer = document.getElementById('email-detail');
        
        detailContainer.innerHTML = `
            <h2>${escapeHtml(email.subject)}</h2>
            <p><strong>От:</strong> ${escapeHtml(email.sender)}</p>
            <p><strong>Дата:</strong> ${formatDate(email.received_date)}</p>
            ${email.importance_score ? `<p><strong>Оценка важности:</strong> ${(email.importance_score * 100).toFixed(0)}%</p>` : ''}
            ${email.ai_summary ? `
                <div style="margin: 20px 0; padding: 15px; background: #f7fafc; border-radius: 8px;">
                    <strong>AI Резюме:</strong><br>${escapeHtml(email.ai_summary)}
                </div>
            ` : ''}
            <div style="margin-top: 20px;">
                <strong>Текст письма:</strong>
                <div style="margin-top: 10px; white-space: pre-wrap; max-height: 400px; overflow-y: auto;">
                    ${escapeHtml(email.body)}
                </div>
            </div>
        `;
        
        modal.style.display = 'flex';
    } catch (error) {
        alert('Ошибка при загрузке деталей письма');
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('ru-RU', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

document.addEventListener('DOMContentLoaded', () => {
    init();
    
    document.getElementById('login-btn').addEventListener('click', () => authService.login());
    document.getElementById('logout-btn').addEventListener('click', () => authService.logout());
    
    document.getElementById('parse-btn').addEventListener('click', async () => {
        try {
            showLoading(true);
            const result = await emailService.parseEmails();
            alert(result.message);
            await loadEmails();
        } catch (error) {
            alert('Ошибка при парсинге писем');
        } finally {
            showLoading(false);
        }
    });
    
    document.getElementById('analyze-btn').addEventListener('click', async () => {
        try {
            showLoading(true);
            const result = await emailService.analyzeEmails();
            alert(result.message);
            await loadEmails();
        } catch (error) {
            alert('Ошибка при анализе писем');
        } finally {
            showLoading(false);
        }
    });
    
    document.getElementById('key-only-filter').addEventListener('change', () => loadEmails());
    
    document.querySelector('.close').addEventListener('click', () => {
        document.getElementById('email-modal').style.display = 'none';
    });
    
    window.addEventListener('click', (event) => {
        const modal = document.getElementById('email-modal');
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });
});