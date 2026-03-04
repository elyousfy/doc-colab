from fastapi import APIRouter, HTTPException, Request

from app import storage

router = APIRouter(prefix="/api", tags=["auth"])


def get_current_user(request: Request) -> dict:
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing X-User-Id header")
    user = storage.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=401, detail=f"Unknown user: {user_id}")
    return user


@router.get("/users")
async def list_users():
    return storage.get_users()


@router.get("/users/me")
async def get_me(request: Request):
    return get_current_user(request)
