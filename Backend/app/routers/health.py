from fastapi import APIRouter, HTTPException

from app.core.database import ping_database


router = APIRouter(tags=["Health"])


@router.get("/api/ping")
def ping() -> dict[str, str]:
    try:
        connected = ping_database()
    except Exception as error:
        raise HTTPException(status_code=503, detail="Database connection failed") from error
    if not connected:
        raise HTTPException(status_code=503, detail="Database ping failed")
    return {"status": "ok", "database": "connected"}
