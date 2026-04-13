import json
import base64
from pathlib import Path
from typing import Any
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from langchain_core.messages import HumanMessage
from app.models.document import Document
from app.models.extracted_data import ExtractedData
from app.services.llm_factory import get_llm
from app.prompts.w2_extraction import W2_EXTRACTION_PROMPT
from app.prompts.form1099_extraction import (
    FORM_1099_NEC_PROMPT,
    FORM_1099_INT_PROMPT,
    FORM_1099_DIV_PROMPT,
    FORM_1099_DA_PROMPT,
    FORM_1099_G_PROMPT,
)

PROMPT_MAP: dict[str, str] = {
    "w2": W2_EXTRACTION_PROMPT,
    "1099-nec": FORM_1099_NEC_PROMPT,
    "1099-int": FORM_1099_INT_PROMPT,
    "1099-div": FORM_1099_DIV_PROMPT,
    "1099-da": FORM_1099_DA_PROMPT,
    "1099-g": FORM_1099_G_PROMPT,
}

FORM_DETECTION_PROMPT = """\
Look at this tax document image and identify its form type.
Return ONLY one of these exact strings (no other text):
  w2
  1099-nec
  1099-int
  1099-div
  1099-da
  1099-g
  other
"""


def _pdf_to_images(file_path: Path) -> list[bytes]:
    """Convert each PDF page to PNG bytes using PyMuPDF."""
    import pymupdf
    doc = pymupdf.open(str(file_path))
    images = []
    for page in doc:
        mat = pymupdf.Matrix(2.0, 2.0)  # 2× zoom for OCR quality
        pix = page.get_pixmap(matrix=mat)
        images.append(pix.tobytes("png"))
    doc.close()
    return images


def _b64(image_bytes: bytes) -> str:
    return base64.b64encode(image_bytes).decode()


def _image_message(prompt: str, image_b64: str, media_type: str) -> HumanMessage:
    return HumanMessage(content=[
        {"type": "text", "text": prompt},
        {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{image_b64}"}},
    ])


def _strip_fences(text: str) -> str:
    """Remove markdown code fences if the LLM wraps JSON in them."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        # drop first line (``` or ```json) and last ``` if present
        start = 1
        end = len(lines) - 1 if lines[-1].strip() == "```" else len(lines)
        text = "\n".join(lines[start:end])
    return text


def _compute_overall_confidence(field_confidences: dict[str, float]) -> float:
    if not field_confidences:
        return 0.0
    return sum(field_confidences.values()) / len(field_confidences)


async def _detect_form_type(llm: Any, image_b64: str, media_type: str) -> str:
    response = await llm.ainvoke([_image_message(FORM_DETECTION_PROMPT, image_b64, media_type)])
    return response.content.strip().lower()


async def _extract_fields(llm: Any, image_b64: str, media_type: str, form_type: str) -> dict:
    prompt = PROMPT_MAP.get(form_type, PROMPT_MAP.get("w2", next(iter(PROMPT_MAP.values()))))
    response = await llm.ainvoke([_image_message(prompt, image_b64, media_type)])
    return json.loads(_strip_fences(response.content))


async def parse_document(doc: Document, db: AsyncSession) -> ExtractedData:
    """Run LLM vision extraction on a document and upsert the result into extracted_data."""
    llm = await get_llm(db)
    file_path = Path(doc.file_path)

    if doc.file_type == "pdf":
        pages = _pdf_to_images(file_path)
        image_bytes = pages[0]
        media_type = "image/png"
    else:
        image_bytes = file_path.read_bytes()
        media_type = f"image/{doc.file_type}"

    image_b64 = _b64(image_bytes)

    # Detect form type if not already set
    form_type = doc.doc_type
    if not form_type:
        detected = await _detect_form_type(llm, image_b64, media_type)
        form_type = detected if detected in PROMPT_MAP else "other"
        doc.doc_type = form_type

    raw_data = await _extract_fields(llm, image_b64, media_type, form_type)

    # Split {"field": {"value": ..., "confidence": ...}} into separate dicts
    field_confidences: dict[str, float] = {}
    clean_data: dict[str, Any] = {}
    for field, val in raw_data.items():
        if isinstance(val, dict) and "confidence" in val:
            field_confidences[field] = float(val.get("confidence", 0.0))
            clean_data[field] = val.get("value")
        else:
            clean_data[field] = val

    overall_confidence = _compute_overall_confidence(field_confidences)

    # Upsert
    result = await db.execute(select(ExtractedData).where(ExtractedData.document_id == doc.id))
    extracted = result.scalars().first()

    if extracted:
        extracted.form_type = form_type
        extracted.data_json = json.dumps(clean_data)
        extracted.confidence = overall_confidence
        extracted.field_confidences = json.dumps(field_confidences)
        extracted.user_verified = False
    else:
        extracted = ExtractedData(
            document_id=doc.id,
            form_type=form_type,
            data_json=json.dumps(clean_data),
            confidence=overall_confidence,
            field_confidences=json.dumps(field_confidences),
        )
        db.add(extracted)

    doc.status = "extracted"
    await db.commit()
    await db.refresh(extracted)
    return extracted
