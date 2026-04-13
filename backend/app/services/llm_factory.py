from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.api_key import ApiKey
from app.security import decrypt


async def get_llm(db: AsyncSession, provider: str | None = None) -> Any:
    """Return a LangChain chat model using the stored (decrypted) API key.

    If provider is None, uses the first available key.
    """
    stmt = select(ApiKey)
    if provider:
        stmt = stmt.where(ApiKey.provider == provider)
    result = await db.execute(stmt)
    key_row = result.scalars().first()
    if key_row is None:
        raise ValueError(f"No API key found{' for provider ' + provider if provider else ''}. Add one in Settings.")

    api_key = decrypt(key_row.encrypted_key)
    model_name = key_row.model_name

    if key_row.provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(api_key=api_key, model=model_name)  # type: ignore[call-arg]
    elif key_row.provider == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(api_key=api_key, model=model_name)
    elif key_row.provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(google_api_key=api_key, model=model_name)
    else:
        raise ValueError(f"Unsupported provider: {key_row.provider}")
