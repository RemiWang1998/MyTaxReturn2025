from datetime import datetime
from pydantic import BaseModel


class TaxReturnResponse(BaseModel):
    id: int
    tax_year: int | None
    filing_status: str | None
    data_json: str | None
    calc_results_json: str | None
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
