from datetime import datetime
from pydantic import BaseModel


class ApiKeyCreate(BaseModel):
    provider: str
    api_key: str
    model_name: str


class ApiKeyResponse(BaseModel):
    id: int
    provider: str
    model_name: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
