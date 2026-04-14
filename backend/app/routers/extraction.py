import json
import logging
import re
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks

logger = logging.getLogger(__name__)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.database import get_db, AsyncSessionLocal
from app.models.document import Document
from app.models.extracted_data import ExtractedData
from app.services.document_parser import parse_document

router = APIRouter(prefix="/api/extraction", tags=["extraction"])


def _friendly_error(exc: Exception) -> str:
    """Convert a raw LLM provider exception into a short, human-readable message."""
    msg = str(exc)

    # --- 503 / service unavailable / high demand (Google, Anthropic, OpenAI) ---
    if re.search(r"503|UNAVAILABLE|unavailable|high demand|overloaded|Service Unavailable", msg, re.I):
        return "LLM model unavailable due to high usage. Please try again later."

    # --- 429 / rate limit ---
    if re.search(r"429|rate.?limit|quota|RESOURCE_EXHAUSTED", msg, re.I):
        return "LLM rate limit reached. Please wait a moment and try again."

    # --- 401 / 403 / invalid API key ---
    if re.search(r"401|403|invalid.api.key|invalid_api_key|UNAUTHENTICATED|PermissionDenied|Unauthorized|Forbidden", msg, re.I):
        return "LLM API key is invalid or expired. Please check your API key in Settings."

    # --- 404 / model not found ---
    if re.search(r"404|model.not.found|no such model|does not exist", msg, re.I):
        return "LLM model not found. Please check your model name in Settings."

    # --- context window / token limit ---
    if re.search(r"context.length|context.window|maximum.context|token.limit|too.many.tokens|string too long", msg, re.I):
        return "Document is too large for the model's context window. Try a smaller file."

    # --- network / connection errors ---
    if re.search(r"ConnectionError|ConnectTimeout|ReadTimeout|connection.refused|Network", msg, re.I):
        return "Could not reach the LLM provider. Check your internet connection and try again."

    # --- 500 / internal server error from provider ---
    if re.search(r"\b500\b|InternalServerError|internal.error", msg, re.I):
        return "LLM provider returned an internal error. Please try again later."

    # --- fallback: keep original but cap length ---
    return msg[:200] if len(msg) > 200 else msg


def _result_to_dict(row: ExtractedData) -> dict:
    return {
        "id": row.id,
        "document_id": row.document_id,
        "form_type": row.form_type,
        "data": json.loads(row.data_json),
        "confidence": row.confidence,
        "field_confidences": json.loads(row.field_confidences) if row.field_confidences else {},
        "user_verified": row.user_verified,
        "created_at": getattr(row, "created_at", None),
        "updated_at": getattr(row, "updated_at", None),
    }


async def _run_extraction(doc_id: int) -> None:
    async with AsyncSessionLocal() as db:
        doc = await db.get(Document, doc_id)
        if not doc:
            logger.warning("Extraction requested for unknown doc_id=%d", doc_id)
            return
        try:
            await parse_document(doc, db)
        except Exception as exc:
            friendly = _friendly_error(exc)
            logger.error("Extraction failed for doc_id=%d: %s | raw: %s", doc_id, friendly, exc)
            doc.status = "error"
            doc.error_msg = friendly
            await db.commit()


@router.post("/{doc_id}/run", status_code=202)
async def run_extraction(
    doc_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.status == "extracting":
        raise HTTPException(status_code=409, detail="Extraction already in progress")

    doc.status = "extracting"
    doc.error_msg = None
    await db.commit()

    logger.info("Queued extraction for doc_id=%d", doc_id)
    background_tasks.add_task(_run_extraction, doc_id)
    return {"message": "Extraction started", "doc_id": doc_id}


@router.get("/{doc_id}/result")
async def get_extraction_results(doc_id: int, db: AsyncSession = Depends(get_db)):
    """Return all extraction results for a document (one for simple forms, multiple for consolidated)."""
    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    result = await db.execute(
        select(ExtractedData)
        .where(ExtractedData.document_id == doc_id)
        .order_by(ExtractedData.id)
    )
    rows = result.scalars().all()
    return [_result_to_dict(r) for r in rows]


@router.delete("/results/{result_id}", status_code=204)
async def delete_extraction_result(
    result_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a specific extraction result (e.g. remove a sub-form from a consolidated 1099)."""
    extracted = await db.get(ExtractedData, result_id)
    if not extracted:
        raise HTTPException(status_code=404, detail="Extraction result not found")
    await db.execute(delete(ExtractedData).where(ExtractedData.id == result_id))
    await db.commit()


@router.put("/results/{result_id}")
async def update_extraction_result(
    result_id: int,
    payload: dict,
    db: AsyncSession = Depends(get_db),
):
    """Update a specific extraction result by its ID."""
    extracted = await db.get(ExtractedData, result_id)
    if not extracted:
        raise HTTPException(status_code=404, detail="Extraction result not found")

    extracted.data_json = json.dumps(payload)
    extracted.user_verified = True

    # Recompute confidence: drop scores for removed fields, recalculate average
    old_confs: dict = json.loads(extracted.field_confidences) if extracted.field_confidences else {}
    new_confs = {k: v for k, v in old_confs.items() if k in payload}
    extracted.field_confidences = json.dumps(new_confs)
    extracted.confidence = (sum(new_confs.values()) / len(new_confs)) if new_confs else 0.0

    await db.commit()
    await db.refresh(extracted)
    return _result_to_dict(extracted)
