from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    backend_port: int = 8000
    database_url: str = "sqlite+aiosqlite:///data/tax_return.db"
    cors_origins: str = "http://localhost:3000"
    encryption_key_path: str = "data/.encryption_key"
    upload_dir: str = "uploads"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]


settings = Settings()
