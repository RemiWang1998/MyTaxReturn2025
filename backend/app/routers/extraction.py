import json
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db, AsyncSessionLocal
from app.models.document import Document
from app.models.extracted_data import ExtractedData
from app.services.document_parser import parse_document

router = APIRouter(prefix="/api/extraction", tags=["extraction"])


async def _run_extraction(doc_id: int) -> None:
    async with AsyncSessionLocal() as db:
        doc = await db.get(Document, doc_id)
        if not doc:
            return
        try:
            await parse_document(doc, db)
        except Exception as exc:
            doc.status = "error"
            doc.error_msg = str(exc)
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
    await db.commit()

    background_tasks.add_task(_run_extraction, doc_id)
    return {"message": "Extraction started", "doc_id": doc_id}


@router.get("/{doc_id}/result")
async def get_extraction_result(doc_id: int, db: AsyncSession = Depends(get_db)):
    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    result = await db.execute(select(ExtractedData).where(ExtractedData.document_id == doc_id))
    extracted = result.scalars().first()
    if not extracted:
        raise HTTPException(status_code=404, detail="No extraction result yet")

    return {
        "id": extracted.id,
        "document_id": extracted.document_id,
        "form_type": extracted.form_type,
        "data": json.loads(extracted.data_json),
        "confidence": extracted.confidence,
        "field_confidences": json.loads(extracted.field_confidences) if extracted.field_confidences else {},
        "user_verified": extracted.user_verified,
        "created_at": extracted.created_at,
        "updated_at": extracted.updated_at,
    }


@router.put("/{doc_id}/result")
async def update_extraction_result(
    doc_id: int,
    payload: dict,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ExtractedData).where(ExtractedData.document_id == doc_id))
    extracted = result.scalars().first()
    if not extracted:
        raise HTTPException(status_code=404, detail="No extraction result found")

    if "data" in payload:
        extracted.data_json = json.dumps(payload["data"])
    extracted.user_verified = True
    await db.commit()
    await db.refresh(extracted)

    return {
        "id": extracted.id,
        "document_id": extracted.document_id,
        "form_type": extracted.form_type,
        "data": json.loads(extracted.data_json),
        "confidence": extracted.confidence,
        "field_confidences": json.loads(extracted.field_confidences) if extracted.field_confidences else {},
        "user_verified": extracted.user_verified,
        "updated_at": extracted.updated_at,
    }
