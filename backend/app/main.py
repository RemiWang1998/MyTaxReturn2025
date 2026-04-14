import logging
import logging.config
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.database import init_db
from app.routers import api_keys, documents, extraction, tax_return

logging.config.dictConfig({
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {
            "format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            "datefmt": "%Y-%m-%d %H:%M:%S",
        }
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "default",
        }
    },
    "root": {"level": "DEBUG", "handlers": ["console"]},
    # Quiet noisy third-party libs
    "loggers": {
        "httpx": {"level": "WARNING"},
        "httpcore": {"level": "WARNING"},
        "anthropic": {"level": "WARNING"},
        "openai": {"level": "WARNING"},
        "langchain": {"level": "WARNING"},
        "pymupdf": {"level": "WARNING"},
        "mcp": {"level": "WARNING"},
    },
})

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
    Path("data").mkdir(parents=True, exist_ok=True)
    logger.info("Starting US Tax Return Agent backend")
    await init_db()
    logger.info("Database initialised")
    yield
    logger.info("Shutting down")


app = FastAPI(title="US Tax Return Agent", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_keys.router)
app.include_router(documents.router)
app.include_router(extraction.router)
app.include_router(tax_return.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
