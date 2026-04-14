import asyncio
import json
import logging
import random
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

logger = logging.getLogger(__name__)

_MAX_RETRIES = 3
_BASE_DELAY = 1.0       # seconds between retry attempts
_IMAGE_INTERVAL = 3.0   # minimum seconds between image LLM requests

_last_image_call_at: float = 0.0


async def _invoke_with_backoff(llm: Any, messages: list) -> Any:
    """Call llm.ainvoke with a minimum inter-request interval and exponential backoff."""
    global _last_image_call_at
    now = asyncio.get_event_loop().time()
    wait = _IMAGE_INTERVAL - (now - _last_image_call_at)
    if wait > 0:
        logger.debug("Image request throttle: sleeping %.1fs", wait)
        await asyncio.sleep(wait)
    _last_image_call_at = asyncio.get_event_loop().time()

    for attempt in range(_MAX_RETRIES + 1):
        try:
            return await llm.ainvoke(messages)
        except Exception as exc:
            if attempt == _MAX_RETRIES:
                raise
            exc_str = str(exc).lower()
            retryable = any(tok in exc_str for tok in ("429", "rate limit", "529", "overloaded", "503", "500", "timeout"))
            if not retryable:
                raise
            delay = _BASE_DELAY * (2 ** attempt) + random.uniform(0, 1)
            logger.warning("LLM call failed (attempt %d/%d): %s — retrying in %.1fs", attempt + 1, _MAX_RETRIES, exc, delay)
            await asyncio.sleep(delay)
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

CONSOLIDATED_SUBFORMS_AND_PAGES_PROMPT = """\
This is a consolidated 1099 tax statement. The images provided are pages 1 through {total_pages} \
(in order). Identify which 1099 sub-forms are present and which page numbers (1-indexed) contain \
data for each sub-form. A sub-form may span multiple pages.

Only use these exact form type strings:
  "1099-div"
  "1099-int"
  "1099-misc"
  "1099-b"
  "1099-nec"
  "1099-da"
  "1099-g"

Return a JSON object mapping each found form type to a list of 1-indexed page numbers.
Example: {{"1099-div": [1, 2], "1099-int": [3], "1099-b": [4, 5, 6]}}

Rules:
- Only include form types that are actually present in the document.
- Only include page numbers that actually contain data for that form.
- If a page contains data for multiple forms, include it in each relevant form's list.

Return ONLY the JSON object, no other text.
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


def _extract_text(content: str | list) -> str:
    """Extract plain text from an LLM response content that may be a string or a list of blocks.

    Thinking models (e.g. Gemini 2.5) return content as a list such as:
      [{"type": "thinking", "thinking": "..."}, {"type": "text", "text": "..."}]
    """
    if isinstance(content, list):
        return next(
            (block.get("text", "") for block in content if block.get("type") == "text"),
            "",
        )
    return content


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
    response = await _invoke_with_backoff(llm, [_image_message(FORM_DETECTION_PROMPT, images)])
    return _extract_text(response.content).strip().lower()


async def _detect_subforms_and_pages(
    llm: Any,
    images: list[tuple[str, str]],
) -> dict[str, list[tuple[str, str]]]:
    """Single LLM call: detect sub-forms present and map each to its relevant pages.

    Returns a dict of subform → sliced image list.
    Falls back to all pages for any sub-form with empty/invalid page numbers.
    """
    total_pages = len(images)
    prompt = CONSOLIDATED_SUBFORMS_AND_PAGES_PROMPT.format(total_pages=total_pages)
    response = await _invoke_with_backoff(llm, [_image_message(prompt, images)])
    try:
        mapping: dict[str, list[int]] = json.loads(_strip_fences(_extract_text(response.content)))
    except (json.JSONDecodeError, ValueError):
        mapping = {}

    result: dict[str, list[tuple[str, str]]] = {}
    for sf, page_nums in mapping.items():
        if sf not in PROMPT_MAP:
            continue
        valid = [p for p in page_nums if isinstance(p, int) and 1 <= p <= total_pages]
        result[sf] = [images[p - 1] for p in valid] if valid else images
    return result


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
    response = await _invoke_with_backoff(llm, [_image_message(prompt, images)])
    return json.loads(_strip_fences(_extract_text(response.content)))


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
        # Single call: detect sub-forms and map each to its relevant pages
        subform_images = await _detect_subforms_and_pages(llm, images)
        if not subform_images:
            # LLM couldn't identify sub-forms — fall back to common ones with all pages
            subform_images = {sf: images for sf in ["1099-div", "1099-int", "1099-b"]}

        for sf, sf_pages in subform_images.items():
            try:
                raw_data = await _extract_fields(llm, sf_pages, sf, consolidated=True)
                clean_data, field_confs, overall = _parse_raw_fields(raw_data)
            except Exception as exc:
                logger.warning("Skipping sub-form %s after extraction error: %s", sf, exc)
                continue
            row = ExtractedData(
                document_id=doc.id,
                form_type=sf,
                data_json=json.dumps(clean_data),
                confidence=overall,
                field_confidences=json.dumps(field_confs),
            )
            db.add(row)
            # Commit immediately so the frontend can display this sub-form
            # while remaining sub-forms are still being extracted.
            await db.commit()
            await db.refresh(row)
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
