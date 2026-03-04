import requests
import json

r = requests.get('http://localhost:8003/api/documents/ea0b97e7-d57d-42b4-be8d-b6b03904eeca', 
                 headers={'X-User-Id': 'user-alice'})
doc = r.json()

print('Keys in doc:', list(doc.keys()))
print('Title:', doc.get('title'))

# Get the content
content = doc.get('content', {})
nodes = content.get('content', [])
print('Total nodes:', len(nodes))

print('\nFirst 30 node types and content preview:')
for i, node in enumerate(nodes[:30]):
    node_type = node.get('type', 'unknown')
    preview = ''
    if node_type == 'paragraph':
        text_content = node.get('content', [])
        if text_content:
            first_text = text_content[0]
            if first_text.get('type') == 'text':
                preview = first_text.get('text', '')[:50]
    elif node_type == 'heading':
        text_content = node.get('content', [])
        if text_content:
            first_text = text_content[0]
            if first_text.get('type') == 'text':
                preview = first_text.get('text', '')[:50]
    elif node_type == 'image':
        attrs = node.get('attrs', {})
        preview = attrs.get('src', '')[:50]
    
    print(f'{i}: {node_type:15} {preview}')
