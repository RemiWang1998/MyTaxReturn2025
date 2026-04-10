from datetime import datetime
from pydantic import BaseModel


class DocumentResponse(BaseModel):
    id: int
    filename: str
    file_type: str
    doc_type: str | None
    status: str
    error_msg: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
