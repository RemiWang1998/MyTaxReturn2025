import json
from datetime import datetime
from pydantic import BaseModel, field_validator


class FilingStartRequest(BaseModel):
    olt_username: str
    olt_password: str


class FilingSessionResponse(BaseModel):
    id: int
    tax_return_id: int | None
    status: str
    current_step: str | None
    steps_log: list[str] = []
    error_msg: str | None
    started_at: datetime | None
    completed_at: datetime | None

    model_config = {"from_attributes": True}

    @field_validator("steps_log", mode="before")
    @classmethod
    def parse_steps_log(cls, v: object) -> list[str]:
        if v is None:
            return []
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
                return parsed if isinstance(parsed, list) else []
            except Exception:
                return []
        if isinstance(v, list):
            return v
        return []
