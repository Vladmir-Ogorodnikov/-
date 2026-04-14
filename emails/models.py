from django.db import models
from accounts.models import User

class Email(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='emails')
    gmail_id = models.CharField(max_length=255, unique=True)
    sender = models.EmailField()
    subject = models.TextField()
    body = models.TextField()
    received_date = models.DateTimeField()
    is_key = models.BooleanField(default=False)
    importance_score = models.FloatField(null=True, blank=True)
    ai_summary = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['-received_date']
        indexes = [
            models.Index(fields=['user', 'is_key']),
            models.Index(fields=['gmail_id']),
        ]
    
    def __str__(self):
        return f"{self.subject} - {self.sender}"

class EmailCategory(models.Model):
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    
    def __str__(self):
        return self.name

class EmailTag(models.Model):
    email = models.ForeignKey(Email, on_delete=models.CASCADE, related_name='tags')
    category = models.ForeignKey(EmailCategory, on_delete=models.CASCADE)
    confidence = models.FloatField()
    
    class Meta:
        unique_together = ['email', 'category']