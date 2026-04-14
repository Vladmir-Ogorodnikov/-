from django.urls import path
from . import views

urlpatterns = [
    path('parse/', views.parse_emails, name='parse_emails'),
    path('analyze/', views.analyze_emails, name='analyze_emails'),
    path('list/', views.get_emails, name='get_emails'),
    path('<int:email_id>/', views.get_email_detail, name='email_detail'),
]