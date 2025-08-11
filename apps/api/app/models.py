from __future__ import annotations

from datetime import datetime
from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    DateTime,
    ForeignKey,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from apps.api.app.db import Base


class PolicyDocument(Base):
    __tablename__ = "policy_documents"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, nullable=True)
    template_key = Column(String(100), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    status = Column(String(50), nullable=False, default="draft", index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    versions = relationship(
        "PolicyVersion",
        back_populates="document",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="PolicyVersion.version.asc()",
    )

    comments = relationship(
        "PolicyComment",
        back_populates="document",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class PolicyVersion(Base):
    __tablename__ = "policy_versions"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(
        Integer,
        ForeignKey("policy_documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version = Column(Integer, nullable=False)
    html = Column(Text, nullable=False)
    params_json = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    document = relationship("PolicyDocument", back_populates="versions")

    __table_args__ = (UniqueConstraint("document_id", "version", name="uq_doc_version"),)


# --- NEW: Comments ---
class PolicyComment(Base):
    __tablename__ = "policy_comments"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(
        Integer,
        ForeignKey("policy_documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version = Column(Integer, nullable=True)  # optional: tie to a specific version
    author = Column(String(100), nullable=False, default="User")
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    document = relationship("PolicyDocument", back_populates="comments")
