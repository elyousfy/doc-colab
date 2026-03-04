from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import CORS_ORIGINS
from app.routers import auth, upload, export, images, comments, documents

app = FastAPI(title="Colab Doc API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(upload.router)
app.include_router(export.router)
app.include_router(images.router)
app.include_router(comments.router)
app.include_router(documents.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
