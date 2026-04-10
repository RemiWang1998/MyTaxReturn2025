from pydantic import BaseModel, Field


class FieldWithConfidence(BaseModel):
    value: str | float | int | None = None
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class W2Data(BaseModel):
    employer_name: FieldWithConfidence | None = None
    employer_ein: FieldWithConfidence | None = None
    employee_ssn: FieldWithConfidence | None = None
    employee_name: FieldWithConfidence | None = None
    wages_tips: FieldWithConfidence | None = None                    # box 1
    federal_tax_withheld: FieldWithConfidence | None = None         # box 2
    social_security_wages: FieldWithConfidence | None = None        # box 3
    social_security_tax_withheld: FieldWithConfidence | None = None # box 4
    medicare_wages: FieldWithConfidence | None = None               # box 5
    medicare_tax_withheld: FieldWithConfidence | None = None        # box 6
    state: FieldWithConfidence | None = None
    state_wages: FieldWithConfidence | None = None                  # box 16
    state_tax_withheld: FieldWithConfidence | None = None           # box 17


class Form1099NECData(BaseModel):
    payer_name: FieldWithConfidence | None = None
    payer_tin: FieldWithConfidence | None = None
    recipient_tin: FieldWithConfidence | None = None
    recipient_name: FieldWithConfidence | None = None
    nonemployee_compensation: FieldWithConfidence | None = None     # box 1
    federal_tax_withheld: FieldWithConfidence | None = None         # box 4


class Form1099INTData(BaseModel):
    payer_name: FieldWithConfidence | None = None
    recipient_tin: FieldWithConfidence | None = None
    interest_income: FieldWithConfidence | None = None              # box 1
    early_withdrawal_penalty: FieldWithConfidence | None = None     # box 2
    us_savings_bonds_interest: FieldWithConfidence | None = None    # box 3
    federal_tax_withheld: FieldWithConfidence | None = None         # box 4


class Form1099DIVData(BaseModel):
    payer_name: FieldWithConfidence | None = None
    recipient_tin: FieldWithConfidence | None = None
    ordinary_dividends: FieldWithConfidence | None = None           # box 1a
    qualified_dividends: FieldWithConfidence | None = None          # box 1b
    total_capital_gain: FieldWithConfidence | None = None           # box 2a
    federal_tax_withheld: FieldWithConfidence | None = None         # box 4
