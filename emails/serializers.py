from rest_framework import serializers
from .models import Email, EmailCategory

class EmailSerializer(serializers.ModelSerializer):
    tags = serializers.SerializerMethodField()
    
    class Meta:
        model = Email
        fields = ['id', 'gmail_id', 'sender', 'subject', 'body', 
                  'received_date', 'is_key', 'importance_score', 
                  'ai_summary', 'tags']
    
    def get_tags(self, obj):
        return [
            {'category': tag.category.name, 'confidence': tag.confidence}
            for tag in obj.tags.all()
        ]