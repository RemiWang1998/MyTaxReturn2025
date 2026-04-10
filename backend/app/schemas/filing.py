from datetime import datetime
from pydantic import BaseModel


class FilingStartRequest(BaseModel):
    olt_username: str
    olt_password: str
    tax_return_id: int


class FilingSessionResponse(BaseModel):
    id: int
    tax_return_id: int | None
    status: str
    current_step: str | None
    steps_log: str | None
    error_msg: str | None
    started_at: datetime | None
    completed_at: datetime | None

    model_config = {"from_attributes": True}
