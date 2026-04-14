from google_auth_oauthlib.flow import Flow
import os
import logging

logger = logging.getLogger(__name__)

class GoogleAuthService:
    SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']
    
    @staticmethod
    def get_authorization_url():
        """Генерирует URL авторизации для Google"""
        
        client_id = os.getenv('GOOGLE_CLIENT_ID')
        client_secret = os.getenv('GOOGLE_CLIENT_SECRET')
        redirect_uri = os.getenv('GOOGLE_REDIRECT_URI')
        
        logger.info(f"🔑 CLIENT_ID: {client_id[:30] if client_id else 'MISSING'}...")
        logger.info(f"🔄 REDIRECT_URI: {redirect_uri}")
        
        if not all([client_id, client_secret, redirect_uri]):
            raise ValueError("Missing Google credentials in .env")
        
        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [redirect_uri]
                }
            },
            scopes=GoogleAuthService.SCOPES,
            redirect_uri=redirect_uri
        )
        
        # Явно задаем redirect_uri
        flow.redirect_uri = redirect_uri
        
        authorization_url, state = flow.authorization_url(
            access_type='offline',
            include_granted_scopes='true',
            prompt='consent',  # Требовать подтверждения каждый раз
            scope=' '.join(GoogleAuthService.SCOPES),
            enable_ssl=True
        )
        
        logger.info(f"✅ Authorization URL generated successfully")
        return authorization_url, state
    
    @staticmethod
    def exchange_code_for_token(code):
        """Обменивает код подтверждения на токен"""
        
        client_id = os.getenv('GOOGLE_CLIENT_ID')
        client_secret = os.getenv('GOOGLE_CLIENT_SECRET')
        redirect_uri = os.getenv('GOOGLE_REDIRECT_URI')
        
        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [redirect_uri]
                }
            },
            scopes=GoogleAuthService.SCOPES,
            redirect_uri=redirect_uri
        )
        
        flow.redirect_uri = redirect_uri
        
        try:
            flow.fetch_token(code=code)
            credentials = flow.credentials
            
            logger.info(f"✅ Token exchanged successfully")
            
            return {
                'token': credentials.token,
                'refresh_token': credentials.refresh_token,
                'token_uri': credentials.token_uri,
                'client_id': credentials.client_id,
                'client_secret': credentials.client_secret,
                'scopes': credentials.scopes
            }
        except Exception as e:
            logger.error(f"❌ Token exchange failed: {e}")
            raise