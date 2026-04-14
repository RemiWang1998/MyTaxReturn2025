import json
import logging
from fastapi import APIRouter, Depends, HTTPException

logger = logging.getLogger(__name__)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.extracted_data import ExtractedData
from app.models.tax_return import TaxReturn
from app.services.tax_aggregator import aggregate_tax_data, _val
from app.services import mcp_client
from app.schemas.tax_return import (
    TaxReturnResponse,
    TaxReturnUpdate,
    CalculateRequest,
    CompareStatusRequest,
    CheckCreditsRequest,
    FilingStatus,
)

_VALID_FILING_STATUSES = set(FilingStatus.__args__)  # type: ignore[attr-defined]


def _validate_filing_status(filing_status: str) -> None:
    if filing_status not in _VALID_FILING_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid filing_status '{filing_status}'. Must be one of: {', '.join(sorted(_VALID_FILING_STATUSES))}",
        )

router = APIRouter(prefix="/api/return", tags=["tax_return"])


async def _get_or_aggregate(db: AsyncSession) -> TaxReturn:
    result = await db.execute(select(TaxReturn).order_by(TaxReturn.id.desc()))
    tr = result.scalars().first()
    if tr is None:
        tr = await aggregate_tax_data(db)
    return tr


@router.get("", response_model=TaxReturnResponse)
async def get_tax_return(db: AsyncSession = Depends(get_db)):
    """Return the aggregated tax return, refreshing from extracted data."""
    tax_return = await aggregate_tax_data(db)
    return tax_return


@router.get("/summary")
async def get_summary(db: AsyncSession = Depends(get_db)):
    """High-level income and withholding summary."""
    tr = await _get_or_aggregate(db)
    data = json.loads(tr.data_json) if tr.data_json else {}
    overrides = data.get("overrides", {})

    def effective(key: str) -> float:
        return float(overrides.get(key, data.get(key, 0.0)))

    total_income = effective("total_income")
    federal_withheld = effective("federal_tax_withheld")

    return {
        "tax_year": tr.tax_year,
        "filing_status": tr.filing_status,
        "total_income": total_income,
        "wages": effective("wages"),
        "interest_income": effective("interest_income"),
        "ordinary_dividends": effective("ordinary_dividends"),
        "qualified_dividends": effective("qualified_dividends"),
        "nonemployee_compensation": effective("nonemployee_compensation"),
        "capital_gains": effective("capital_gains"),
        "other_income": effective("other_income"),
        "federal_tax_withheld": federal_withheld,
        "state_wages": data.get("state_wages", {}),
        "state_tax_withheld": data.get("state_tax_withheld", {}),
    }


@router.put("", response_model=TaxReturnResponse)
async def update_tax_return(payload: TaxReturnUpdate, db: AsyncSession = Depends(get_db)):
    """Override filing status, tax year, or individual income fields."""
    tr = await _get_or_aggregate(db)

    if payload.filing_status is not None:
        tr.filing_status = payload.filing_status
    if payload.tax_year is not None:
        tr.tax_year = payload.tax_year
    if payload.overrides is not None:
        data = json.loads(tr.data_json) if tr.data_json else {}
        data["overrides"] = {**data.get("overrides", {}), **payload.overrides}
        tr.data_json = json.dumps(data)

    await db.commit()
    await db.refresh(tr)
    return tr


@router.post("/calculate")
async def calculate_taxes(req: CalculateRequest, db: AsyncSession = Depends(get_db)):
    """Run MCP federal (and optionally state) tax calculations."""
    tr = await aggregate_tax_data(db)
    data = json.loads(tr.data_json) if tr.data_json else {}
    overrides = data.get("overrides", {})
    total_income = float(overrides.get("total_income", data.get("total_income", 0.0)))
    filing_status = tr.filing_status or req.filing_status
    _validate_filing_status(filing_status)

    def eff(key: str) -> float:
        return float(overrides.get(key, data.get(key, 0.0)))

    try:
        federal = await mcp_client.calculate_federal_tax(
            income=total_income,
            filing_status=filing_status,
            tax_year=req.tax_year,
            w2_income=eff("wages"),
            self_employment_income=eff("nonemployee_compensation"),
            capital_gains=eff("capital_gains"),
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"MCP error (federal): {exc}")

    # Auto-detect states from W-2 state_wages; fall back to req.state if provided
    state_wages: dict = data.get("state_wages", {})
    state_withheld: dict = data.get("state_tax_withheld", {})
    states_to_calc = list(state_wages.keys()) or ([req.state] if req.state else [])

    state_results: dict[str, dict] = {}
    for state_code in states_to_calc:
        try:
            income_for_state = float(state_wages.get(state_code, eff("wages") + eff("nonemployee_compensation")))
            result = await mcp_client.estimate_state_tax(state_code, income_for_state, filing_status)
            withheld_for_state = float(state_withheld.get(state_code, 0.0))
            result["state_tax_withheld"] = withheld_for_state
            result["refund"] = withheld_for_state - result.get("state_tax", 0.0)
            state_results[state_code] = result
        except Exception as exc:
            logger.warning("MCP state tax error for %s: %s", state_code, exc)

    federal_withheld = eff("federal_tax_withheld")
    calc_results = {
        "federal": federal,
        "states": state_results,
        "filing_status": filing_status,
        "tax_year": req.tax_year,
        "total_income": total_income,
        "wages": eff("wages"),
        "capital_gains": eff("capital_gains"),
        "federal_tax_withheld": federal_withheld,
        "refund": federal_withheld - federal.get("federal_tax", 0.0),
    }
    tr.calc_results_json = json.dumps(calc_results)
    if filing_status:
        tr.filing_status = filing_status
    if req.tax_year:
        tr.tax_year = req.tax_year
    await db.commit()

    return calc_results


@router.post("/compare-status")
async def compare_filing_statuses(req: CompareStatusRequest, db: AsyncSession = Depends(get_db)):
    """Compare all filing statuses via MCP to find the optimal one."""
    tr = await aggregate_tax_data(db)
    data = json.loads(tr.data_json) if tr.data_json else {}
    overrides = data.get("overrides", {})
    total_income = float(overrides.get("total_income", data.get("total_income", 0.0)))

    federal_withheld = float(overrides.get("federal_tax_withheld", data.get("federal_tax_withheld", 0.0)))
    try:
        result = await mcp_client.compare_filing_statuses(total_income, req.tax_year, federal_withheld)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"MCP error: {exc}")

    return result


@router.post("/check-credits")
async def check_credits(req: CheckCreditsRequest, db: AsyncSession = Depends(get_db)):
    """Check credit eligibility via MCP."""
    tr = await aggregate_tax_data(db)
    data = json.loads(tr.data_json) if tr.data_json else {}
    overrides = data.get("overrides", {})
    total_income = float(overrides.get("total_income", data.get("total_income", 0.0)))
    filing_status = tr.filing_status or req.filing_status
    _validate_filing_status(filing_status)

    try:
        result = await mcp_client.check_credit_eligibility(
            total_income, filing_status, req.dependents, req.tax_year
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"MCP error: {exc}")

    return result


def _str_val(field) -> str | None:
    if field is None:
        return None
    if isinstance(field, dict):
        v = field.get("value")
    else:
        v = field
    return str(v).strip() if v else None


@router.get("/forms")
async def get_forms(db: AsyncSession = Depends(get_db)):
    """Return per-form detail for the filing guide: each W-2, 1099, etc. with payer/employer info."""
    result = await db.execute(select(ExtractedData))
    rows = result.scalars().all()

    w2s, int1099, div1099, nec1099, misc1099, b1099, r1099, g1099, da1099, s1099 = ([] for _ in range(10))

    for row in rows:
        data = json.loads(row.data_json)
        ft = row.form_type.upper()

        if ft == "W2":
            w2s.append({
                "employer": _str_val(data.get("employer_name")),
                "employer_ein": _str_val(data.get("employer_ein")),
                "wages": _val(data.get("wages_tips")),
                "federal_withheld": _val(data.get("federal_tax_withheld")),
                "social_security_wages": _val(data.get("social_security_wages")),
                "social_security_withheld": _val(data.get("social_security_tax_withheld")),
                "medicare_wages": _val(data.get("medicare_wages")),
                "medicare_withheld": _val(data.get("medicare_tax_withheld")),
                "state": _str_val(data.get("state")),
                "state_wages": _val(data.get("state_wages")),
                "state_withheld": _val(data.get("state_tax_withheld")),
            })

        elif ft == "1099-INT":
            int1099.append({
                "payer": _str_val(data.get("payer_name")),
                "interest": _val(data.get("interest_income")),
                "early_withdrawal_penalty": _val(data.get("early_withdrawal_penalty")),
                "federal_withheld": _val(data.get("federal_tax_withheld")),
                "us_bond_interest": _val(data.get("us_savings_bond_interest")),
            })

        elif ft == "1099-DIV":
            div1099.append({
                "payer": _str_val(data.get("payer_name")),
                "ordinary_dividends": _val(data.get("ordinary_dividends")),
                "qualified_dividends": _val(data.get("qualified_dividends")),
                "total_capital_gain": _val(data.get("total_capital_gain")),
                "federal_withheld": _val(data.get("federal_tax_withheld")),
                "exempt_interest_dividends": _val(data.get("exempt_interest_dividends")),
            })

        elif ft == "1099-NEC":
            nec1099.append({
                "payer": _str_val(data.get("payer_name")),
                "amount": _val(data.get("nonemployee_compensation")),
                "federal_withheld": _val(data.get("federal_tax_withheld")),
            })

        elif ft == "1099-MISC":
            misc1099.append({
                "payer": _str_val(data.get("payer_name")),
                "rents": _val(data.get("rents")),
                "royalties": _val(data.get("royalties")),
                "other_income": _val(data.get("other_income")),
                "federal_withheld": _val(data.get("federal_tax_withheld")),
            })

        elif ft == "1099-B":
            proceeds = _val(data.get("total_proceeds"))
            cost = _val(data.get("total_cost_basis"))
            gain_loss = _val(data.get("total_gain_loss")) if data.get("total_gain_loss") is not None else (proceeds - cost)
            txns = data.get("transactions", {})
            txn_list = txns.get("value", []) if isinstance(txns, dict) else txns or []
            b1099.append({
                "payer": _str_val(data.get("payer_name")),
                "proceeds": proceeds,
                "cost_basis": cost,
                "gain_loss": gain_loss,
                "federal_withheld": _val(data.get("federal_tax_withheld")),
                "transaction_count": len(txn_list),
            })

        elif ft == "1099-R":
            r1099.append({
                "payer": _str_val(data.get("payer_name")),
                "gross_distribution": _val(data.get("gross_distribution")),
                "taxable_amount": _val(data.get("taxable_amount")),
                "federal_withheld": _val(data.get("federal_tax_withheld")),
                "distribution_code": _str_val(data.get("distribution_code")),
            })

        elif ft == "1099-G":
            g1099.append({
                "payer": _str_val(data.get("payer_name")),
                "unemployment_compensation": _val(data.get("unemployment_compensation")),
                "state_local_refund": _val(data.get("state_local_tax_refund")),
                "federal_withheld": _val(data.get("federal_tax_withheld")),
            })

        elif ft == "1099-DA":
            txns = data.get("transactions", {})
            txn_list = txns.get("value", []) if isinstance(txns, dict) else txns or []
            gain_loss = _val(data.get("total_gain_loss")) if data.get("total_gain_loss") is not None else sum(
                float(t.get("gain_or_loss") or 0) for t in txn_list if isinstance(t, dict)
            )
            da1099.append({
                "payer": _str_val(data.get("payer_name")),
                "gain_loss": gain_loss,
                "federal_withheld": _val(data.get("federal_tax_withheld")),
                "transaction_count": len(txn_list),
            })

        elif ft == "1099-S":
            s1099.append({
                "payer": _str_val(data.get("transferor_name") or data.get("payer_name")),
                "proceeds": _val(data.get("gross_proceeds") or data.get("total_proceeds")),
                "cost_basis": _val(data.get("total_cost_basis")),
                "gain_loss": _val(data.get("total_gain_loss")),
            })

    return {
        "w2": w2s,
        "1099_int": int1099,
        "1099_div": div1099,
        "1099_nec": nec1099,
        "1099_misc": misc1099,
        "1099_b": b1099,
        "1099_r": r1099,
        "1099_g": g1099,
        "1099_da": da1099,
        "1099_s": s1099,
    }
