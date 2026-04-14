"""MCP client for irs-taxpayer-mcp (stdio transport).

Spawns `npx -y irs-taxpayer-mcp` as a subprocess on each call.
Each public function opens a fresh session, calls one tool, and closes.
All tools return markdown text — helpers below parse it into structured dicts.
"""

import logging
import re
from typing import Any
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

logger = logging.getLogger(__name__)


_SERVER_PARAMS = StdioServerParameters(
    command="npx",
    args=["-y", "irs-taxpayer-mcp"],
)


async def _call_tool(tool_name: str, arguments: dict[str, Any]) -> str:
    logger.debug("MCP call: tool=%s args=%s", tool_name, arguments)
    async with stdio_client(_SERVER_PARAMS) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(tool_name, arguments=arguments)
            if result.content:
                first = result.content[0]
                if hasattr(first, "text"):
                    logger.debug("MCP result: tool=%s -> %s", tool_name, first.text[:200])
                    return first.text
            return ""


def _parse_federal_tax(text: str) -> dict:
    """Parse markdown from calculate_federal_tax into CalcResult-compatible dict."""
    m = re.search(r"\*\*Total Federal Tax\*\*\s*\|\s*\*\*\$([0-9,]+)\*\*", text)
    federal_tax = float(m.group(1).replace(",", "")) if m else 0.0

    m = re.search(r"\*\*Effective Tax Rate\*\*:\s*([\d.]+)%", text)
    effective_rate = float(m.group(1)) / 100 if m else 0.0

    # Bracket rows: | XX% | $X,XXX | $X,XXX |
    brackets = []
    for m in re.finditer(r"\|\s*(\d+)%\s*\|\s*\$([0-9,]+)\s*\|\s*\$([0-9,]+)\s*\|", text):
        brackets.append({
            "rate": float(m.group(1)) / 100,
            "amount": float(m.group(3).replace(",", "")),
        })

    # Credit rows: | Credit Name | -$X,XXX |  (skip deduction and header rows)
    _SKIP = {"component", "item", "deduction (standard)", "deduction (itemized)"}
    credits: dict[str, float] = {}
    for m in re.finditer(r"\|\s*([^|*]+?)\s*\|\s*-\$([0-9,]+)\s*\|", text):
        name = m.group(1).strip()
        if name and name.lower() not in _SKIP and "deduction" not in name.lower():
            credits[name] = float(m.group(2).replace(",", ""))

    return {
        "federal_tax": federal_tax,
        "effective_rate": effective_rate,
        "brackets": brackets,
        "credits": credits,
    }


def _parse_compare_statuses(text: str, withheld: float = 0.0) -> dict:
    """Parse markdown from compare_filing_statuses."""
    statuses = []
    # Table rows: | filing status | $deduction | $taxable | $federal_tax | X.XX% |
    for m in re.finditer(
        r"\|\s*([a-z][a-z _]+?)\s*\|\s*\$([0-9,]+)\s*\|\s*\$([0-9,]+)\s*\|\s*\$([0-9,]+)\s*\|\s*([\d.]+)%\s*\|",
        text,
    ):
        status = m.group(1).strip().replace(" ", "_")
        tax = float(m.group(4).replace(",", ""))
        statuses.append({"status": status, "tax": tax, "refund": max(0.0, withheld - tax)})

    m = re.search(r"Lowest tax\*\*:\s*([\w ]+?)\s+at\s+\$", text)
    recommended = m.group(1).strip().replace(" ", "_") if m else (statuses[0]["status"] if statuses else "")

    return {"statuses": statuses, "recommended": recommended}


def _parse_credits(text: str) -> dict:
    """Parse markdown from check_credit_eligibility."""
    eligible = []
    for m in re.finditer(r"✅\s+\*\*([^*]+)\*\*:\s*(.+)", text):
        name = m.group(1).strip()
        description = m.group(2).strip()
        amt_match = re.search(r"\$([0-9,]+)", description)
        amount = float(amt_match.group(1).replace(",", "")) if amt_match else 0.0
        eligible.append({"name": name, "amount": amount})
    total = sum(c["amount"] for c in eligible)
    return {"eligible": eligible, "total": total}


async def calculate_federal_tax(
    income: float,
    filing_status: str,
    tax_year: int = 2025,
    w2_income: float = 0.0,
    self_employment_income: float = 0.0,
    capital_gains: float = 0.0,
) -> dict:
    args: dict[str, Any] = {
        "grossIncome": income,
        "filingStatus": filing_status,
        "taxYear": tax_year,
    }
    if w2_income:
        args["w2Income"] = w2_income
    if self_employment_income:
        args["selfEmploymentIncome"] = self_employment_income
    if capital_gains:
        args["capitalGains"] = capital_gains
        # IRS allows up to $3,000 of net capital loss to offset ordinary income
        if capital_gains < 0:
            args["aboveTheLineDeductions"] = min(3000.0, abs(capital_gains))
    text = await _call_tool("calculate_federal_tax", args)
    return _parse_federal_tax(text)


def _parse_state_tax(text: str) -> dict:
    """Parse markdown from estimate_state_tax."""
    # No state income tax
    if "No State Income Tax" in text:
        return {"state_tax": 0.0, "effective_rate": 0.0, "no_income_tax": True}

    m = re.search(r"\*\*Estimated State Tax\*\*\s*\|\s*\*\*\$([0-9,]+)\*\*", text)
    state_tax = float(m.group(1).replace(",", "")) if m else 0.0

    m = re.search(r"Effective State Rate\s*\|\s*([\d.]+)%", text)
    effective_rate = float(m.group(1)) / 100 if m else 0.0

    return {"state_tax": state_tax, "effective_rate": effective_rate, "no_income_tax": False}


def _map_filing_status(filing_status: str) -> str:
    """Map IRS filing status to the two values estimate_state_tax accepts."""
    return "married" if filing_status in ("married_filing_jointly", "qualifying_surviving_spouse") else "single"


async def estimate_state_tax(
    state: str, income: float, filing_status: str
) -> dict:
    text = await _call_tool(
        "estimate_state_tax",
        {
            "stateCode": state.upper(),
            "taxableIncome": income,
            "filingStatus": _map_filing_status(filing_status),
        },
    )
    return _parse_state_tax(text)


async def compare_filing_statuses(income: float, tax_year: int = 2025, withheld: float = 0.0) -> dict:
    text = await _call_tool(
        "compare_filing_statuses",
        {"grossIncome": income, "taxYear": tax_year},
    )
    return _parse_compare_statuses(text, withheld)


async def check_credit_eligibility(
    income: float,
    filing_status: str,
    dependents: int = 0,
    tax_year: int = 2025,
) -> dict:
    text = await _call_tool(
        "check_credit_eligibility",
        {
            "agi": income,
            "filingStatus": filing_status,
            "hasChildren": dependents > 0,
            "numChildren": dependents,
            "hasEarnedIncome": income > 0,
        },
    )
    return _parse_credits(text)


async def list_available_tools() -> list[str]:
    """Return all tool names exposed by irs-taxpayer-mcp."""
    async with stdio_client(_SERVER_PARAMS) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            return [t.name for t in tools.tools]
