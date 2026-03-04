import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("DATA_DIR", "data"))
CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://localhost:5174,http://localhost:5175").split(",")
