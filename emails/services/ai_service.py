import os
import json
import requests
from django.conf import settings
from emails.models import Email, EmailCategory, EmailTag
from urllib.parse import urljoin


class AIEmailAnalyzer:
    """Анализатор писем с использованием DeepSeek"""

    def __init__(self):
        self.api_key = os.getenv('DEEPSEEK_API_KEY')
        self.base_url = os.getenv('DEEPSEEK_BASE_URL', 'https://api.deepseek.com')
        self.chat_endpoint = f"{self.base_url}/v1/chat/completions"
        
        if not self.api_key:
            raise ValueError("DEEPSEEK_API_KEY не установлен в переменных окружения")

    def _create_headers(self):
        """Создать заголовки для API запроса"""
        return {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {self.api_key}',
            'Accept': 'application/json'
        }

    def analyze_email(self, email):
        """Анализировать письмо с помощью DeepSeek"""
        prompt = f"""Ты профессиональный помощник для анализа электронной почты.
Проанализируй следующее письмо и определи:
1. Является ли оно важным/ключевым (оценка от 0 до 1)
2. Краткое резюме (2-3 предложения)
3. Категорию письма

Важность определяется по критериям:
- Скорость ответа требуется
- Важность отправителя
- Финансовые аспекты
- Срочность задачи
- Потенциальные последствия бездействия

Тема: {email.subject}
Отправитель: {email.sender}
Дата: {email.received_date.strftime('%Y-%m-%d %H:%M') if email.received_date else 'Неизвестно'}
Текст (первые 1000 символов): {email.body[:1000]}

Ответь строго в формате JSON без дополнительного текста:
{{
    "importance_score": число_от_0_до_1,
    "summary": "краткое_резюме_на_русском_языке",
    "category": "одна_из_категорий: работа|личное|финансы|реклама|сообщения|другое"
}}"""

        try:
            response = requests.post(
                self.chat_endpoint,
                headers=self._create_headers(),
                json={
                    'model': 'deepseek-chat',
                    'messages': [
                        {
                            'role': 'system',
                            'content': 'Ты помощник для анализа электронной почты. Отвечай только валидным JSON.'
                        },
                        {
                            'role': 'user',
                            'content': prompt
                        }
                    ],
                    'temperature': 0.3,
                    'max_tokens': 500,
                    'top_p': 0.9
                },
                timeout=30
            )

            response.raise_for_status()
            data = response.json()

            # Получаем результат из ответа API
            ai_response = data.get('choices', [{}])[0].get('message', {}).get('content', '')
            result = json.loads(ai_response)

            # Обновляем данные письма
            email.importance_score = float(result['importance_score'])
            email.ai_summary = result['summary']
            email.is_key = email.importance_score > 0.7
            email.save()

            # Добавляем категорию
            category_name = result['category']
            category, created = EmailCategory.objects.get_or_create(name=category_name)
            
            # Создаем или обновляем тег
            tag, _ = EmailTag.objects.update_or_create(
                email=email,
                category=category,
                defaults={'confidence': email.importance_score}
            )

            log_info = {
                'email_id': email.id,
                'gmail_id': email.gmail_id,
                'subject': email.subject,
                'score': email.importance_score,
                'category': category_name,
                'is_key': email.is_key
            }
            print(f"✅ DeepSeek анализ завершен: {json.dumps(log_info, ensure_ascii=False)}")

            return result

        except requests.exceptions.RequestException as e:
            print(f"❌ Ошибка запроса к DeepSeek API: {e}")
            return None

        except json.JSONDecodeError as e:
            print(f"❌ Ошибка парсинга JSON ответа от DeepSeek: {e}, ответ: {ai_response if 'ai_response' in locals() else 'Нет ответа'}")
            return None

        except KeyError as e:
            print(f"❌ Ошибка ключа в ответе DeepSeek: {e}")
            return None

        except Exception as e:
            print(f"❌ Неизвестная ошибка при анализе: {e}")
            return None

    def batch_analyze(self, emails):
        """Пакетный анализ писем"""
        results = []
        errors = []
        
        for idx, email in enumerate(emails, 1):
            print(f"[{idx}/{len(emails)}] Анализ письма: {email.subject[:50]}...")
            
            result = self.analyze_email(email)
            if result:
                results.append(result)
            else:
                errors.append({
                    'email_id': email.id,
                    'subject': email.subject
                })
        
        summary = {
            'total': len(emails),
            'analyzed': len(results),
            'errors': len(errors),
            'results': results,
            'failed_emails': errors
        }
        print(f"\n📊 Пакетный анализ завершён:")
        print(f"   Всего: {summary['total']}")
        print(f"   Успешно: {summary['analyzed']}")
        print(f"   Ошибок: {summary['errors']}")
        
        return results

    def analyze_with_retry(self, email, max_retries=3):
        """Анализ с повторными попытками при ошибке"""
        last_error = None
        
        for attempt in range(max_retries):
            try:
                print(f"Попытка {attempt + 1}/{max_retries}: {email.subject[:50]}...")
                result = self.analyze_email(email)
                
                if result:
                    return result
                    
            except Exception as e:
                last_error = str(e)
                print(f"Попытка {attempt + 1} провалена: {e}")
                
                if attempt < max_retries - 1:
                    from time import sleep
                    sleep(2 ** attempt)  # Экспоненциальная задержка
            
        print(f"Все попытки исчерпаны для письма {email.id}. Ошибка: {last_error}")
        return None