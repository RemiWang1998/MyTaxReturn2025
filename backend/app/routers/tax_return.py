import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.tax_return import TaxReturn
from app.services.tax_aggregator import aggregate_tax_data
from app.services import mcp_client
from app.schemas.tax_return import (
    TaxReturnResponse,
    TaxReturnUpdate,
    CalculateRequest,
    CompareStatusRequest,
    CheckCreditsRequest,
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
    tr = await _get_or_aggregate(db)
    data = json.loads(tr.data_json) if tr.data_json else {}
    overrides = data.get("overrides", {})
    total_income = float(overrides.get("total_income", data.get("total_income", 0.0)))
    filing_status = tr.filing_status or req.filing_status

    try:
        federal = await mcp_client.calculate_federal_tax(total_income, filing_status, req.tax_year)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"MCP error (federal): {exc}")

    state_result = None
    if req.state:
        try:
            state_income = float(
                overrides.get("wages", data.get("wages", 0.0))
                + overrides.get("nonemployee_compensation", data.get("nonemployee_compensation", 0.0))
            )
            state_result = await mcp_client.estimate_state_tax(req.state, state_income, filing_status, req.tax_year)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"MCP error (state): {exc}")

    calc_results = {
        "federal": federal,
        "state": state_result,
        "filing_status": filing_status,
        "tax_year": req.tax_year,
        "total_income": total_income,
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
    tr = await _get_or_aggregate(db)
    data = json.loads(tr.data_json) if tr.data_json else {}
    overrides = data.get("overrides", {})
    total_income = float(overrides.get("total_income", data.get("total_income", 0.0)))

    try:
        result = await mcp_client.compare_filing_statuses(total_income, req.tax_year)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"MCP error: {exc}")

    return result


@router.post("/check-credits")
async def check_credits(req: CheckCreditsRequest, db: AsyncSession = Depends(get_db)):
    """Check credit eligibility via MCP."""
    tr = await _get_or_aggregate(db)
    data = json.loads(tr.data_json) if tr.data_json else {}
    overrides = data.get("overrides", {})
    total_income = float(overrides.get("total_income", data.get("total_income", 0.0)))
    filing_status = tr.filing_status or req.filing_status

    try:
        result = await mcp_client.check_credit_eligibility(
            total_income, filing_status, req.dependents, req.tax_year
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"MCP error: {exc}")

    return result
