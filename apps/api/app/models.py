from datetime import datetime
from typing import List, Optional
from sqlalchemy import String, Integer, Text, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .db import Base

class PolicyDocument(Base):
    __tablename__ = "policy_documents"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    org_id: Mapped[Optional[int]] = mapped_column(nullable=True)
    template_key: Mapped[str] = mapped_column(String(100))
    title: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(20), default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    versions: Mapped[List["PolicyVersion"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )

class PolicyVersion(Base):
    __tablename__ = "policy_versions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("policy_documents.id", ondelete="CASCADE"))
    version: Mapped[int] = mapped_column(Integer)
    html: Mapped[str] = mapped_column(Text)
    params_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    document: Mapped[PolicyDocument] = relationship(back_populates="versions")
