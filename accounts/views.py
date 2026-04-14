from django.shortcuts import redirect
from django.http import JsonResponse, HttpResponseBadRequest
from rest_framework.decorators import api_view
from rest_framework.response import Response
import os
import logging
import traceback

logger = logging.getLogger(__name__)

@api_view(['GET'])
def google_login(request):
    """Генерирует URL авторизации Google"""
    
    try:
        logger.info("🚀 Запрос google_login получен")
        
        from accounts.services import GoogleAuthService
        
        authorization_url, state = GoogleAuthService.get_authorization_url()
        request.session['oauth_state'] = state
        
        return JsonResponse({'authorization_url': authorization_url})
        
    except Exception as e:
        logger.exception(f"❌ Ошибка в google_login: {traceback.format_exc()}")
        return JsonResponse({
            'error': f'Failed to generate auth URL: {str(e)}',
            'debug': str(traceback.format_exc())
        }, status=500)


@api_view(['GET'])
def google_callback(request):
    """Обработка обратного вызова от Google"""
    
    try:
        logger.info("🔄 Callback запрос получен")
        logger.info(f"Method: {request.method}")
        logger.info(f"Path: {request.path}")
        logger.info(f"Query params count: {len(request.GET)}")
        
        for key in request.GET.keys():
            value = request.GET.get(key)
            if key == 'code':
                logger.info(f"  {key}: {value[:30]}...")
            elif key == 'error':
                logger.warning(f"  {key}: {value}")
            else:
                logger.info(f"  {key}: {value}")
        
        code = request.GET.get('code')
        error = request.GET.get('error')
        
        # Если Google вернул ошибку
        if error:
            error_desc = request.GET.get('error_description', '')
            logger.error(f"❌ Google OAuth Error: {error} - {error_desc}")
            
            return JsonResponse({
                'error': error,
                'description': error_desc,
                'status': 'google_error'
            }, status=400)
        
        if not code:
            logger.warning("⚠️ Код подтверждения отсутствует")
            return JsonResponse({
                'error': 'No authorization code received',
                'status': 'missing_code'
            }, status=400)
        
        logger.info(f"✅ Код получен, обрабатываем...")
        
        # Обмен кода на токен
        from accounts.services import GoogleAuthService
        token_data = GoogleAuthService.exchange_code_for_token(code)
        
        # Получение профиля пользователя
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
        
        creds = Credentials(
            token=token_data['token'],
            refresh_token=token_data['refresh_token'],
            token_uri=token_data['token_uri'],
            client_id=token_data['client_id'],
            client_secret=token_data['client_secret'],
            scopes=token_data['scopes']
        )
        
        service = build('gmail', 'v1', credentials=creds)
        profile = service.users().getProfile(userId='me').execute()
        
        logger.info(f"👤 Пользователь: {profile['emailAddress']}")
        
        # Создание/обновление пользователя
        from .models import User
        from django.contrib.auth import login
        from datetime import datetime, timedelta
        
        user, created = User.objects.update_or_create(
            email=profile['emailAddress'],
            defaults={
                'username': profile['emailAddress'].split('@')[0],
                'google_token': token_data['token'],
                'google_refresh_token': token_data['refresh_token'],
                'token_expires_at': datetime.now() + timedelta(hours=1)
            }
        )
        
        login(request, user)
        logger.info(f"✅ Авторизация успешна: {user.email}")
        
        return redirect('http://localhost:8000/')
        
    except Exception as e:
        logger.exception(f"❌ Критическая ошибка в callback: {traceback.format_exc()}")
        
        return JsonResponse({
            'error': str(e),
            'type': type(e).__name__,
            'traceback': traceback.format_exc(),
            'status': 'server_error'
        }, status=500)


@api_view(['GET'])
def get_current_user(request):
    """Получение информации о текущем пользователе"""
    if request.user.is_authenticated:
        return Response({
            'id': request.user.id,
            'email': request.user.email,
            'username': request.user.username,
            'status': 'authenticated'
        })
    return Response({
        'error': 'Not authenticated',
        'status': 'not_authenticated'
    }, status=401)