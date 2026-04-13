from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.database import get_db
from app.models.api_key import ApiKey
from app.schemas.api_key import ApiKeyCreate, ApiKeyResponse
from app.security import encrypt

router = APIRouter(prefix="/api/keys", tags=["api-keys"])


@router.get("", response_model=list[ApiKeyResponse])
async def list_keys(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ApiKey))
    return result.scalars().all()


@router.post("", response_model=ApiKeyResponse)
async def create_or_update_key(body: ApiKeyCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ApiKey).where(ApiKey.provider == body.provider))
    row = result.scalars().first()
    if row:
        row.encrypted_key = encrypt(body.api_key)
        row.model_name = body.model_name
    else:
        row = ApiKey(
            provider=body.provider,
            encrypted_key=encrypt(body.api_key),
            model_name=body.model_name,
        )
        db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.delete("/{provider}", status_code=204)
async def delete_key(provider: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ApiKey).where(ApiKey.provider == provider))
    row = result.scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Key not found")
    await db.execute(delete(ApiKey).where(ApiKey.provider == provider))
    await db.commit()


@router.post("/test")
async def test_key(body: ApiKeyCreate) -> dict:
    """Validate the API key by making a minimal call to the provider."""
    try:
        if body.provider == "anthropic":
            from langchain_anthropic import ChatAnthropic
            llm = ChatAnthropic(api_key=body.api_key, model=body.model_name)  # type: ignore[call-arg]
        elif body.provider == "openai":
            from langchain_openai import ChatOpenAI
            llm = ChatOpenAI(api_key=body.api_key, model=body.model_name)
        elif body.provider == "gemini":
            from langchain_google_genai import ChatGoogleGenerativeAI
            llm = ChatGoogleGenerativeAI(google_api_key=body.api_key, model=body.model_name)
        else:
            return {"ok": False, "error": f"Unsupported provider: {body.provider}"}
        await llm.ainvoke("hi")
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}
