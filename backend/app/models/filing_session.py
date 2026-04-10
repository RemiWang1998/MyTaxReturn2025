from datetime import datetime
from sqlalchemy import ForeignKey, String, Text, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class FilingSession(Base):
    __tablename__ = "filing_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    tax_return_id: Mapped[int | None] = mapped_column(ForeignKey("tax_returns.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    current_step: Mapped[str | None] = mapped_column(String(256), nullable=True)
    steps_log: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_msg: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
