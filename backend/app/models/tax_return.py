from datetime import datetime
from sqlalchemy import String, Text, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class TaxReturn(Base):
    __tablename__ = "tax_returns"

    id: Mapped[int] = mapped_column(primary_key=True)
    tax_year: Mapped[int | None] = mapped_column(nullable=True)
    filing_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    data_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    calc_results_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
