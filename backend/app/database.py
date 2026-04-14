from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.config import settings

engine = create_async_engine(settings.database_url, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db() -> None:
    from app.models import api_key, document, extracted_data, tax_return, filing_session  # noqa: F401
    from sqlalchemy import text
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Add columns introduced after initial schema — safe to retry, SQLite raises on duplicates
    _migrations = [
        "ALTER TABLE documents ADD COLUMN content_hash TEXT",
    ]
    for stmt in _migrations:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(stmt))
        except Exception:
            pass  # Column already exists


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
