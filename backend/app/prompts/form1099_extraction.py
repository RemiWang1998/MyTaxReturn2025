FORM_1099_NEC_PROMPT = """You are a tax document data extraction assistant. Extract all fields from the 1099-NEC form shown in the image.

Return a JSON object with exactly this structure:

{
  "payer_name": {"value": "Acme Corp", "confidence": 0.95},
  "payer_tin": {"value": "12-3456789", "confidence": 0.90},
  "recipient_tin": {"value": "123-45-6789", "confidence": 0.95},
  "recipient_name": {"value": "Jane Doe", "confidence": 0.95},
  "nonemployee_compensation": {"value": 12000.00, "confidence": 0.99},
  "federal_tax_withheld": {"value": 0.0, "confidence": 0.99}
}

Rules:
- Numeric fields must be numbers, not strings
- If a field is absent, use {"value": null, "confidence": 0.0}
- Return ONLY the JSON object, no markdown fences or other text
"""

FORM_1099_INT_PROMPT = """You are a tax document data extraction assistant. Extract all fields from the 1099-INT form shown in the image.

Return a JSON object with exactly this structure:

{
  "payer_name": {"value": "First National Bank", "confidence": 0.95},
  "recipient_tin": {"value": "123-45-6789", "confidence": 0.95},
  "interest_income": {"value": 450.12, "confidence": 0.99},
  "early_withdrawal_penalty": {"value": 0.0, "confidence": 0.99},
  "us_savings_bonds_interest": {"value": 0.0, "confidence": 0.99},
  "federal_tax_withheld": {"value": 0.0, "confidence": 0.99}
}

Rules:
- Numeric fields must be numbers, not strings
- If a field is absent, use {"value": null, "confidence": 0.0}
- Return ONLY the JSON object, no markdown fences or other text
"""

FORM_1099_DIV_PROMPT = """You are a tax document data extraction assistant. Extract all fields from the 1099-DIV form shown in the image.

Return a JSON object with exactly this structure:

{
  "payer_name": {"value": "Vanguard", "confidence": 0.95},
  "recipient_tin": {"value": "123-45-6789", "confidence": 0.95},
  "ordinary_dividends": {"value": 1250.00, "confidence": 0.99},
  "qualified_dividends": {"value": 1100.00, "confidence": 0.99},
  "total_capital_gain": {"value": 0.0, "confidence": 0.99},
  "federal_tax_withheld": {"value": 0.0, "confidence": 0.99}
}

Rules:
- Numeric fields must be numbers, not strings
- If a field is absent, use {"value": null, "confidence": 0.0}
- Return ONLY the JSON object, no markdown fences or other text
"""

FORM_1099_MISC_PROMPT = """You are a tax document data extraction assistant. Extract all fields from the 1099-MISC (Miscellaneous Information) form shown in the image.

Return a JSON object with exactly this structure:

{
  "payer_name": {"value": "Acme Corp", "confidence": 0.95},
  "payer_tin": {"value": "12-3456789", "confidence": 0.90},
  "recipient_tin": {"value": "123-45-6789", "confidence": 0.95},
  "recipient_name": {"value": "Jane Doe", "confidence": 0.95},
  "rents": {"value": 0.0, "confidence": 0.99},
  "royalties": {"value": 0.0, "confidence": 0.99},
  "other_income": {"value": 5000.00, "confidence": 0.99},
  "federal_tax_withheld": {"value": 0.0, "confidence": 0.99},
  "fishing_boat_proceeds": {"value": 0.0, "confidence": 0.99},
  "medical_health_care_payments": {"value": 0.0, "confidence": 0.99},
  "substitute_payments": {"value": 0.0, "confidence": 0.99},
  "crop_insurance_proceeds": {"value": 0.0, "confidence": 0.99},
  "gross_proceeds_attorney": {"value": 0.0, "confidence": 0.99},
  "excess_golden_parachute": {"value": 0.0, "confidence": 0.99},
  "nonqualified_deferred_compensation": {"value": 0.0, "confidence": 0.99},
  "state_tax_withheld": {"value": 0.0, "confidence": 0.99}
}

Rules:
- Numeric fields must be numbers, not strings
- If a field is absent, use {"value": null, "confidence": 0.0}
- The document may be in English or Chinese — extract values regardless of language
- Return ONLY the JSON object, no markdown fences or other text
"""

FORM_1099_B_PROMPT = """You are a tax document data extraction assistant. Extract summary totals from the 1099-B (Proceeds from Broker and Barter Exchange Transactions) section.

If the document contains a summary of transactions, extract the summary totals. If it lists individual transactions without a summary, aggregate them into totals.

Return a JSON object with exactly this structure:

{
  "payer_name": {"value": "Charles Schwab", "confidence": 0.95},
  "recipient_tin": {"value": "123-45-6789", "confidence": 0.95},
  "recipient_name": {"value": "Jane Doe", "confidence": 0.95},
  "short_term_proceeds": {"value": 15000.00, "confidence": 0.90},
  "short_term_cost_basis": {"value": 14000.00, "confidence": 0.90},
  "short_term_gain_loss": {"value": 1000.00, "confidence": 0.90},
  "long_term_proceeds": {"value": 25000.00, "confidence": 0.90},
  "long_term_cost_basis": {"value": 20000.00, "confidence": 0.90},
  "long_term_gain_loss": {"value": 5000.00, "confidence": 0.90},
  "total_proceeds": {"value": 40000.00, "confidence": 0.95},
  "total_cost_basis": {"value": 34000.00, "confidence": 0.95},
  "total_gain_loss": {"value": 6000.00, "confidence": 0.95},
  "federal_tax_withheld": {"value": 0.0, "confidence": 0.99}
}

Rules:
- Numeric fields must be numbers, not strings
- If a field is absent or not derivable from the document, use {"value": null, "confidence": 0.0}
- If only individual transactions are listed without summaries, compute the totals
- The document may be in English or Chinese — extract values regardless of language
- Return ONLY the JSON object, no markdown fences or other text
"""

FORM_1099_DA_PROMPT = """You are a tax document data extraction assistant. Extract all fields from the 1099-DA (Digital Asset Proceeds from Broker Transactions) form shown in the image.

Return a JSON object with exactly this structure:

{
  "payer_name": {"value": "Coinbase Inc.", "confidence": 0.95},
  "payer_tin": {"value": "12-3456789", "confidence": 0.90},
  "recipient_tin": {"value": "123-45-6789", "confidence": 0.95},
  "recipient_name": {"value": "Jane Doe", "confidence": 0.95},
  "asset_name": {"value": "Bitcoin", "confidence": 0.99},
  "token_id": {"value": "BTC", "confidence": 0.95},
  "date_acquired": {"value": "2024-03-15", "confidence": 0.90},
  "date_sold": {"value": "2025-01-10", "confidence": 0.90},
  "proceeds": {"value": 18500.00, "confidence": 0.99},
  "cost_or_other_basis": {"value": 12000.00, "confidence": 0.99},
  "accrued_market_discount": {"value": 0.0, "confidence": 0.99},
  "wash_sale_loss_disallowed": {"value": 0.0, "confidence": 0.99},
  "gain_or_loss": {"value": 6500.00, "confidence": 0.99},
  "term": {"value": "long-term", "confidence": 0.95},
  "covered": {"value": true, "confidence": 0.95},
  "federal_tax_withheld": {"value": 0.0, "confidence": 0.99}
}

Rules:
- Numeric fields must be numbers, not strings
- Dates should be formatted as YYYY-MM-DD strings; use null if absent
- "term" must be "short-term", "long-term", or null
- "covered" is a boolean (true = covered security, false = noncovered); use null if absent
- If a field is absent, use {"value": null, "confidence": 0.0}
- The document may be in English or Chinese — extract values regardless of language
- Return ONLY the JSON object, no markdown fences or other text
"""

FORM_1099_G_PROMPT = """You are a tax document data extraction assistant. Extract all fields from the 1099-G (Certain Government Payments) form shown in the image.

Return a JSON object with exactly this structure:

{
  "payer_name": {"value": "California EDD", "confidence": 0.95},
  "payer_tin": {"value": "12-3456789", "confidence": 0.90},
  "recipient_tin": {"value": "123-45-6789", "confidence": 0.95},
  "recipient_name": {"value": "Jane Doe", "confidence": 0.95},
  "unemployment_compensation": {"value": 8400.00, "confidence": 0.99},
  "state_local_income_tax_refunds": {"value": 0.0, "confidence": 0.99},
  "tax_year_of_refund": {"value": 2024, "confidence": 0.90},
  "federal_tax_withheld": {"value": 840.00, "confidence": 0.99},
  "rtaa_payments": {"value": 0.0, "confidence": 0.99},
  "taxable_grants": {"value": 0.0, "confidence": 0.99},
  "agriculture_payments": {"value": 0.0, "confidence": 0.99},
  "market_gain": {"value": 0.0, "confidence": 0.99},
  "state_tax_withheld": {"value": 0.0, "confidence": 0.99}
}

Rules:
- Numeric fields must be numbers, not strings
- "tax_year_of_refund" (box 3) is an integer year, or null if absent
- If a field is absent, use {"value": null, "confidence": 0.0}
- The document may be in English or Chinese — extract values regardless of language
- Return ONLY the JSON object, no markdown fences or other text
"""
