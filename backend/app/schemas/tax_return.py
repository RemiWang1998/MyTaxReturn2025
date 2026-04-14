from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field

FilingStatus = Literal[
    "single",
    "married_filing_jointly",
    "married_filing_separately",
    "head_of_household",
    "qualifying_surviving_spouse",
]


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


class TaxReturnUpdate(BaseModel):
    filing_status: str | None = None
    tax_year: int | None = None
    overrides: dict | None = None  # field-level manual overrides merged into data_json


class CalculateRequest(BaseModel):
    filing_status: FilingStatus = Field(default="single")
    tax_year: int = Field(default=2025)
    state: str | None = Field(default=None, description="Two-letter state code for state tax estimate")


class CompareStatusRequest(BaseModel):
    tax_year: int = Field(default=2025)


class CheckCreditsRequest(BaseModel):
    filing_status: FilingStatus = Field(default="single")
    dependents: int = Field(default=0, ge=0)
    tax_year: int = Field(default=2025)
