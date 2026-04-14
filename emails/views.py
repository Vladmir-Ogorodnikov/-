from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from .models import Email
from .serializers import EmailSerializer
from .services.gmail_service import GmailService
from .services.ai_service import AIEmailAnalyzer

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def parse_emails(request):
    try:
        gmail_service = GmailService(request.user)
        emails_data = gmail_service.fetch_emails(max_results=50)
        saved_count = gmail_service.save_emails_to_db(emails_data)
        
        return Response({
            'message': f'Successfully parsed {saved_count} emails',
            'count': saved_count
        })
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def analyze_emails(request):
    try:
        emails = Email.objects.filter(
            user=request.user,
            importance_score__isnull=True
        )[:20]
        
        ai_analyzer = AIEmailAnalyzer()
        results = ai_analyzer.batch_analyze(emails)
        
        return Response({
            'message': f'Analyzed {len(results)} emails',
            'count': len(results)
        })
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_emails(request):
    key_only = request.GET.get('key_only', 'false').lower() == 'true'
    
    emails = Email.objects.filter(user=request.user)
    if key_only:
        emails = emails.filter(is_key=True)
    
    serializer = EmailSerializer(emails, many=True)
    return Response(serializer.data)

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_email_detail(request, email_id):
    try:
        email = Email.objects.get(id=email_id, user=request.user)
        serializer = EmailSerializer(email)
        return Response(serializer.data)
    except Email.DoesNotExist:
        return Response({'error': 'Email not found'}, status=status.HTTP_404_NOT_FOUND)