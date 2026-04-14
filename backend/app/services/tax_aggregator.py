import json
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.extracted_data import ExtractedData
from app.models.tax_return import TaxReturn

logger = logging.getLogger(__name__)


def _val(field: dict | None) -> float:
    """Extract numeric value from a FieldWithConfidence dict."""
    if field is None:
        return 0.0
    v = field.get("value")
    if v is None:
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


async def aggregate_tax_data(db: AsyncSession) -> TaxReturn:
    """Aggregate all verified/extracted data into a single TaxReturn row."""
    result = await db.execute(select(ExtractedData))
    all_extracted = result.scalars().all()
    logger.info("Aggregating %d extracted rows", len(all_extracted))

    wages = 0.0
    federal_withheld = 0.0
    state_wages: dict[str, float] = {}
    state_withheld: dict[str, float] = {}
    interest_income = 0.0
    ordinary_dividends = 0.0
    qualified_dividends = 0.0
    nonemployee_comp = 0.0
    capital_gains = 0.0
    other_income = 0.0

    for row in all_extracted:
        data = json.loads(row.data_json)
        ft = row.form_type.upper()

        if ft == "W2":
            wages += _val(data.get("wages_tips"))
            federal_withheld += _val(data.get("federal_tax_withheld"))
            state = (data.get("state") or {}).get("value")
            if state:
                state_wages[state] = state_wages.get(state, 0.0) + _val(data.get("state_wages"))
                state_withheld[state] = state_withheld.get(state, 0.0) + _val(data.get("state_tax_withheld"))

        elif ft == "1099-INT":
            interest_income += _val(data.get("interest_income"))
            federal_withheld += _val(data.get("federal_tax_withheld"))

        elif ft == "1099-DIV":
            ordinary_dividends += _val(data.get("ordinary_dividends"))
            qualified_dividends += _val(data.get("qualified_dividends"))
            capital_gains += _val(data.get("total_capital_gain"))
            federal_withheld += _val(data.get("federal_tax_withheld"))

        elif ft == "1099-NEC":
            nonemployee_comp += _val(data.get("nonemployee_compensation"))
            federal_withheld += _val(data.get("federal_tax_withheld"))

        elif ft == "1099-MISC":
            other_income += _val(data.get("other_income"))
            federal_withheld += _val(data.get("federal_tax_withheld"))

        elif ft == "1099-G":
            other_income += _val(data.get("unemployment_compensation")) + _val(data.get("state_local_tax_refund"))
            federal_withheld += _val(data.get("federal_tax_withheld"))

        elif ft in ("1099-B", "1099-S"):
            gain = _val(data.get("proceeds")) - _val(data.get("cost_basis"))
            logger.debug("  %s: proceeds=%.2f cost_basis=%.2f gain=%.2f", ft, _val(data.get("proceeds")), _val(data.get("cost_basis")), gain)
            capital_gains += gain

        elif ft == "1099-R":
            other_income += _val(data.get("gross_distribution"))
            federal_withheld += _val(data.get("federal_tax_withheld"))

        elif ft == "1099-DA":
            capital_gains += _val(data.get("proceeds")) - _val(data.get("cost_basis"))
            federal_withheld += _val(data.get("federal_tax_withheld"))

    total_income = wages + interest_income + ordinary_dividends + nonemployee_comp + capital_gains + other_income
    logger.info(
        "Aggregation result: wages=%.2f interest=%.2f dividends=%.2f nec=%.2f "
        "cap_gains=%.2f other=%.2f total=%.2f fed_withheld=%.2f",
        wages, interest_income, ordinary_dividends, nonemployee_comp,
        capital_gains, other_income, total_income, federal_withheld,
    )

    aggregated = {
        "wages": wages,
        "interest_income": interest_income,
        "ordinary_dividends": ordinary_dividends,
        "qualified_dividends": qualified_dividends,
        "nonemployee_compensation": nonemployee_comp,
        "capital_gains": capital_gains,
        "other_income": other_income,
        "total_income": total_income,
        "federal_tax_withheld": federal_withheld,
        "state_wages": state_wages,
        "state_tax_withheld": state_withheld,
    }

    tr_result = await db.execute(select(TaxReturn).order_by(TaxReturn.id.desc()))
    tax_return = tr_result.scalars().first()

    if tax_return is None:
        tax_return = TaxReturn(tax_year=2024, status="draft", data_json=json.dumps(aggregated))
        db.add(tax_return)
    else:
        existing = json.loads(tax_return.data_json) if tax_return.data_json else {}
        # Preserve user overrides (manual edits applied via PUT /api/return)
        aggregated["overrides"] = existing.get("overrides", {})
        tax_return.data_json = json.dumps(aggregated)

    await db.commit()
    await db.refresh(tax_return)
    return tax_return
