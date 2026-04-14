import hashlib
import shutil
import zipfile
from pathlib import Path
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.document import Document
from app.schemas.document import DocumentResponse, DocumentUpdate
from app.config import settings

router = APIRouter(prefix="/api/documents", tags=["documents"])

_ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg"}
_MAX_FILE_BYTES = 50 * 1024 * 1024        # 50 MB per file
_ZIP_MAX_UNCOMPRESSED = 200 * 1024 * 1024  # 200 MB total uncompressed (ZIP bomb guard)


def _file_type(filename: str) -> str:
    return {"pdf": "pdf", "png": "png", "jpg": "jpg", "jpeg": "jpg"}.get(
        Path(filename).suffix.lower().lstrip("."), "unknown"
    )


async def _save_upload(file: UploadFile, dest: Path) -> str:
    """Save upload to dest, return SHA-256 hex digest."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    h = hashlib.sha256()
    with dest.open("wb") as f:
        while chunk := await file.read(65536):
            size += len(chunk)
            if size > _MAX_FILE_BYTES:
                dest.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="File exceeds 50 MB limit")
            h.update(chunk)
            f.write(chunk)
    return h.hexdigest()


def _hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


async def _check_duplicate(db: AsyncSession, content_hash: str) -> Document | None:
    result = await db.execute(select(Document).where(Document.content_hash == content_hash))
    return result.scalars().first()


def _unique_path(base: Path) -> Path:
    """Return a non-colliding path by appending a counter suffix."""
    if not base.exists():
        return base
    stem, suffix = base.stem, base.suffix
    for i in range(1, 10_000):
        candidate = base.with_name(f"{stem}_{i}{suffix}")
        if not candidate.exists():
            return candidate
    raise RuntimeError("Could not find a unique filename")


async def _handle_zip(zip_path: Path, upload_dir: Path, db: AsyncSession) -> list[Document]:
    with zipfile.ZipFile(zip_path) as zf:
        total_uncompressed = sum(info.file_size for info in zf.infolist())
        if total_uncompressed > _ZIP_MAX_UNCOMPRESSED:
            raise HTTPException(status_code=400, detail="ZIP uncompressed size exceeds 200 MB limit")

        docs: list[Document] = []
        extract_dir = upload_dir / zip_path.stem
        extract_dir.mkdir(parents=True, exist_ok=True)

        for info in zf.infolist():
            if info.is_dir():
                continue
            name = Path(info.filename).name
            if name.startswith(".") or Path(info.filename).suffix.lower() not in _ALLOWED_EXTENSIONS:
                continue

            file_bytes = zf.read(info.filename)
            content_hash = _hash_bytes(file_bytes)
            existing = await _check_duplicate(db, content_hash)
            if existing:
                continue  # Skip duplicate silently inside ZIPs

            dest = _unique_path(extract_dir / name)
            dest.write_bytes(file_bytes)

            doc = Document(filename=name, file_path=str(dest), file_type=_file_type(name), status="uploaded", content_hash=content_hash)
            db.add(doc)
            await db.flush()
            docs.append(doc)

    return docs


@router.post("/upload", response_model=list[DocumentResponse], status_code=status.HTTP_201_CREATED)
async def upload_documents(
    files: Annotated[list[UploadFile], File()],
    db: AsyncSession = Depends(get_db),
):
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    created: list[Document] = []

    for file in files:
        filename = file.filename or "upload"
        ext = Path(filename).suffix.lower()

        if ext == ".zip":
            tmp = upload_dir / "tmp"
            tmp.mkdir(exist_ok=True)
            tmp_path = _unique_path(tmp / filename)
            try:
                await _save_upload(file, tmp_path)
                docs = await _handle_zip(tmp_path, upload_dir, db)
                created.extend(docs)
            finally:
                tmp_path.unlink(missing_ok=True)

        elif ext in _ALLOWED_EXTENSIONS:
            dest = _unique_path(upload_dir / filename)
            content_hash = await _save_upload(file, dest)
            existing = await _check_duplicate(db, content_hash)
            if existing:
                dest.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=409,
                    detail=f"Duplicate file: '{existing.filename}' (id={existing.id}) was already uploaded.",
                )
            doc = Document(filename=filename, file_path=str(dest), file_type=_file_type(filename), status="uploaded", content_hash=content_hash)
            db.add(doc)
            await db.flush()
            created.append(doc)

        else:
            raise HTTPException(status_code=415, detail=f"Unsupported file type: {ext or '(none)'}")

    await db.commit()
    for doc in created:
        await db.refresh(doc)
    return created


@router.get("", response_model=list[DocumentResponse])
async def list_documents(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Document).order_by(Document.created_at.desc()))
    return result.scalars().all()


@router.get("/{doc_id}", response_model=DocumentResponse)
async def get_document(doc_id: int, db: AsyncSession = Depends(get_db)):
    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.patch("/{doc_id}", response_model=DocumentResponse)
async def update_document(doc_id: int, body: DocumentUpdate, db: AsyncSession = Depends(get_db)):
    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    type_changed = body.doc_type != doc.doc_type
    doc.doc_type = body.doc_type
    if type_changed and doc.status in ("extracted", "error"):
        doc.status = "uploaded"
        doc.error_msg = None
    await db.commit()
    await db.refresh(doc)
    return doc


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(doc_id: int, db: AsyncSession = Depends(get_db)):
    doc = await db.get(Document, doc_id)
    if not doc:
        return
    Path(doc.file_path).unlink(missing_ok=True)
    await db.delete(doc)
    await db.commit()


@router.get("/{doc_id}/preview")
async def preview_document(doc_id: int, db: AsyncSession = Depends(get_db)):
    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    fp = Path(doc.file_path)
    if not fp.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(str(fp))
