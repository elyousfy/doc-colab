import requests

file_path = r"Bradford_TECHNO_COMMERCIAL PROPOSAL.docx"
url = "http://localhost:8003/api/documents/upload?parser=auto"
headers = {"X-User-Id": "alice"}

with open(file_path, "rb") as f:
    files = {"file": (file_path, f, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
    response = requests.post(url, files=files, headers=headers)
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")
