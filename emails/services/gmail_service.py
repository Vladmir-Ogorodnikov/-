from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
import base64
from datetime import datetime
from emails.models import Email
import os

class GmailService:
    def __init__(self, user):
        self.user = user
        self.credentials = Credentials(
            token=user.google_token,
            refresh_token=user.google_refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=os.getenv('GOOGLE_CLIENT_ID'),
            client_secret=os.getenv('GOOGLE_CLIENT_SECRET'),
            scopes=['https://www.googleapis.com/auth/gmail.readonly']
        )
        self.service = build('gmail', 'v1', credentials=self.credentials)
    
    def fetch_emails(self, max_results=100):
        try:
            results = self.service.users().messages().list(
                userId='me', maxResults=max_results
            ).execute()
            
            messages = results.get('messages', [])
            emails_data = []
            
            for message in messages:
                email_data = self.get_email_details(message['id'])
                if email_data:
                    emails_data.append(email_data)
            
            return emails_data
            
        except Exception as e:
            print(f"Error fetching emails: {e}")
            return []
    
    def get_email_details(self, message_id):
        try:
            message = self.service.users().messages().get(
                userId='me', id=message_id, format='full'
            ).execute()
            
            headers = message['payload']['headers']
            subject = next((h['value'] for h in headers if h['name'] == 'Subject'), 'No Subject')
            sender = next((h['value'] for h in headers if h['name'] == 'From'), 'Unknown')
            date_str = next((h['value'] for h in headers if h['name'] == 'Date'), None)
            
            body = self.get_email_body(message['payload'])
            received_date = self.parse_date(date_str)
            
            return {
                'gmail_id': message_id,
                'sender': sender,
                'subject': subject,
                'body': body,
                'received_date': received_date
            }
            
        except Exception as e:
            print(f"Error getting email details: {e}")
            return None
    
    def get_email_body(self, payload):
        body = ""
        
        if 'parts' in payload:
            for part in payload['parts']:
                if part['mimeType'] == 'text/plain':
                    if 'data' in part['body']:
                        body = base64.urlsafe_b64decode(part['body']['data']).decode('utf-8')
                        break
        else:
            if 'body' in payload and 'data' in payload['body']:
                body = base64.urlsafe_b64decode(payload['body']['data']).decode('utf-8')
        
        return body
    
    def parse_date(self, date_str):
        from email.utils import parsedate_to_datetime
        try:
            return parsedate_to_datetime(date_str)
        except:
            return datetime.now()
    
    def save_emails_to_db(self, emails_data):
        saved_count = 0
        
        for email_data in emails_data:
            email, created = Email.objects.update_or_create(
                gmail_id=email_data['gmail_id'],
                user=self.user,
                defaults=email_data
            )
            if created:
                saved_count += 1
        
        return saved_count