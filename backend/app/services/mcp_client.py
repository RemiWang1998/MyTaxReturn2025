"""MCP client for irs-taxpayer-mcp (stdio transport).

Spawns `npx -y irs-taxpayer-mcp` as a subprocess on each call.
Each public function opens a fresh session, calls one tool, and closes.
"""

import logging
from typing import Any
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

logger = logging.getLogger(__name__)


_SERVER_PARAMS = StdioServerParameters(
    command="npx",
    args=["-y", "irs-taxpayer-mcp"],
)


async def _call_tool(tool_name: str, arguments: dict[str, Any]) -> Any:
    logger.debug("MCP call: tool=%s args=%s", tool_name, arguments)
    async with stdio_client(_SERVER_PARAMS) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(tool_name, arguments=arguments)
            # result.content is a list of content items; extract text from first
            if result.content:
                first = result.content[0]
                if hasattr(first, "text"):
                    import json
                    try:
                        parsed = json.loads(first.text)
                        logger.debug("MCP result: tool=%s -> %s", tool_name, parsed)
                        return parsed
                    except (json.JSONDecodeError, ValueError):
                        logger.debug("MCP result (non-JSON): tool=%s -> %s", tool_name, first.text)
                        return first.text
            return result.content


async def calculate_federal_tax(income: float, filing_status: str, tax_year: int = 2024) -> dict:
    return await _call_tool(
        "calculate_federal_tax",
        {"income": income, "filingStatus": filing_status, "taxYear": tax_year},
    )


async def estimate_state_tax(
    state: str, income: float, filing_status: str, tax_year: int = 2024
) -> dict:
    return await _call_tool(
        "estimate_state_tax",
        {"state": state, "income": income, "filingStatus": filing_status, "taxYear": tax_year},
    )


async def compare_filing_statuses(income: float, tax_year: int = 2024) -> dict:
    return await _call_tool(
        "compare_filing_statuses",
        {"income": income, "taxYear": tax_year},
    )


async def check_credit_eligibility(
    income: float,
    filing_status: str,
    dependents: int = 0,
    tax_year: int = 2024,
) -> dict:
    return await _call_tool(
        "check_credit_eligibility",
        {
            "income": income,
            "filingStatus": filing_status,
            "dependents": dependents,
            "taxYear": tax_year,
        },
    )


async def list_available_tools() -> list[str]:
    """Return all tool names exposed by irs-taxpayer-mcp."""
    async with stdio_client(_SERVER_PARAMS) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            return [t.name for t in tools.tools]
