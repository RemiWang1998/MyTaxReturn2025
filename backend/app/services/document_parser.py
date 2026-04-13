import json
import base64
from pathlib import Path
from typing import Any
from sqlalchemy import select, delete
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
    FORM_1099_MISC_PROMPT,
    FORM_1099_B_PROMPT,
    FORM_1099_DA_PROMPT,
    FORM_1099_G_PROMPT,
)

PROMPT_MAP: dict[str, str] = {
    "w2": W2_EXTRACTION_PROMPT,
    "1099-nec": FORM_1099_NEC_PROMPT,
    "1099-int": FORM_1099_INT_PROMPT,
    "1099-div": FORM_1099_DIV_PROMPT,
    "1099-misc": FORM_1099_MISC_PROMPT,
    "1099-b": FORM_1099_B_PROMPT,
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
  1099-misc
  1099-b
  1099-da
  1099-g
  1099-consolidated
  other
"""

CONSOLIDATED_SUBFORMS_PROMPT = """\
This is a consolidated 1099 tax statement. Look through all pages and identify which \
1099 sub-forms are present.

Return a JSON array containing ONLY the form types found. Use these exact strings:
  "1099-div"
  "1099-int"
  "1099-misc"
  "1099-b"
  "1099-nec"
  "1099-da"
  "1099-g"

Example: ["1099-div", "1099-int", "1099-b"]
Return ONLY the JSON array, no other text.
"""

CONSOLIDATED_EXTRACTION_PREFIX = """\
This is a consolidated 1099 tax statement containing multiple sub-forms across \
several pages. Focus ONLY on the {form_name} section and extract those fields. \
Ignore data from other sections.

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


def _image_message(prompt: str, images: list[tuple[str, str]]) -> HumanMessage:
    """Create a message with prompt text and one or more base64-encoded images."""
    content: list[dict] = [{"type": "text", "text": prompt}]
    for b64_data, media_type in images:
        content.append({"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{b64_data}"}})
    return HumanMessage(content=content)


def _strip_fences(text: str) -> str:
    """Remove markdown code fences if the LLM wraps JSON in them."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        start = 1
        end = len(lines) - 1 if lines[-1].strip() == "```" else len(lines)
        text = "\n".join(lines[start:end])
    return text


def _compute_overall_confidence(field_confidences: dict[str, float]) -> float:
    if not field_confidences:
        return 0.0
    return sum(field_confidences.values()) / len(field_confidences)


def _parse_raw_fields(raw_data: dict) -> tuple[dict[str, Any], dict[str, float], float]:
    """Split {field: {value, confidence}} into clean data, field confidences, overall."""
    field_confidences: dict[str, float] = {}
    clean_data: dict[str, Any] = {}
    for field, val in raw_data.items():
        if isinstance(val, dict) and "confidence" in val:
            field_confidences[field] = float(val.get("confidence", 0.0))
            clean_data[field] = val.get("value")
        else:
            clean_data[field] = val
    return clean_data, field_confidences, _compute_overall_confidence(field_confidences)


# ── LLM calls ─────────────────────────────────────────────────────────────

async def _detect_form_type(llm: Any, images: list[tuple[str, str]]) -> str:
    response = await llm.ainvoke([_image_message(FORM_DETECTION_PROMPT, images)])
    return response.content.strip().lower()


async def _detect_subforms(llm: Any, images: list[tuple[str, str]]) -> list[str]:
    response = await llm.ainvoke([_image_message(CONSOLIDATED_SUBFORMS_PROMPT, images)])
    result = json.loads(_strip_fences(response.content))
    return [f for f in result if f in PROMPT_MAP]


async def _extract_fields(
    llm: Any,
    images: list[tuple[str, str]],
    form_type: str,
    consolidated: bool = False,
) -> dict:
    prompt = PROMPT_MAP.get(form_type, PROMPT_MAP["w2"])
    if consolidated:
        form_name = form_type.upper()
        prompt = CONSOLIDATED_EXTRACTION_PREFIX.format(form_name=form_name) + prompt
    response = await llm.ainvoke([_image_message(prompt, images)])
    return json.loads(_strip_fences(response.content))


# ── Main entry point ──────────────────────────────────────────────────────

async def parse_document(doc: Document, db: AsyncSession) -> list[ExtractedData]:
    """Run LLM vision extraction on a document. Returns one or more ExtractedData rows.

    For consolidated 1099 statements the parser detects sub-forms and extracts each
    one separately, storing a distinct ExtractedData row per sub-form.
    """
    llm = await get_llm(db)
    file_path = Path(doc.file_path)

    # Build image list
    if doc.file_type == "pdf":
        page_images = _pdf_to_images(file_path)
        media_type = "image/png"
    else:
        page_images = [file_path.read_bytes()]
        media_type = f"image/{doc.file_type}"

    images = [(_b64(img), media_type) for img in page_images]

    # Detect form type using all pages (form type label may appear on any page)
    form_type = doc.doc_type
    if not form_type:
        detected = await _detect_form_type(llm, images)
        if detected in PROMPT_MAP or detected == "1099-consolidated":
            form_type = detected
        else:
            form_type = "other"
        doc.doc_type = form_type

    # Delete previous extraction results for this document (clean slate on re-extract)
    await db.execute(delete(ExtractedData).where(ExtractedData.document_id == doc.id))

    results: list[ExtractedData] = []

    if form_type == "1099-consolidated":
        # Detect which sub-forms are present (send all pages)
        subforms = await _detect_subforms(llm, images)
        if not subforms:
            # LLM couldn't identify sub-forms — fall back to common ones
            subforms = ["1099-div", "1099-int", "1099-b"]

        for sf in subforms:
            raw_data = await _extract_fields(llm, images, sf, consolidated=True)
            clean_data, field_confs, overall = _parse_raw_fields(raw_data)
            row = ExtractedData(
                document_id=doc.id,
                form_type=sf,
                data_json=json.dumps(clean_data),
                confidence=overall,
                field_confidences=json.dumps(field_confs),
            )
            db.add(row)
            results.append(row)
    else:
        # Transaction-heavy forms need all pages; others only need the first
        all_pages_forms = {"1099-b", "1099-da"}
        pages = images if form_type in all_pages_forms else images[:1]
        raw_data = await _extract_fields(llm, pages, form_type)
        clean_data, field_confs, overall = _parse_raw_fields(raw_data)
        row = ExtractedData(
            document_id=doc.id,
            form_type=form_type,
            data_json=json.dumps(clean_data),
            confidence=overall,
            field_confidences=json.dumps(field_confs),
        )
        db.add(row)
        results.append(row)

    doc.status = "extracted"
    await db.commit()
    for r in results:
        await db.refresh(r)
    return results
