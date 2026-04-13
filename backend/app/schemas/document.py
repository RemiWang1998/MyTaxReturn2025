from datetime import datetime
from typing import Literal
from pydantic import BaseModel

_DOC_TYPES = Literal[
    "w2", "1099-nec", "1099-int", "1099-div", "1099-misc",
    "1099-b", "1099-da", "1099-g", "1099-consolidated", "other"
]


class DocumentUpdate(BaseModel):
    doc_type: _DOC_TYPES | None = None


class DocumentResponse(BaseModel):
    id: int
    filename: str
    file_type: str
    doc_type: str | None
    status: str
    error_msg: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
