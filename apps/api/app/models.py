# apps/api/app/models.py
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
    Index,  # <- needed for FrameworkControlAssessment
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

    approvals = relationship(
        "PolicyApproval",
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


class PolicyApproval(Base):
    __tablename__ = "policy_approvals"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(
        Integer,
        ForeignKey("policy_documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version = Column(Integer, nullable=True)
    reviewer = Column(String(120), nullable=False)  # name or email
    status = Column(String(20), nullable=False, default="pending", index=True)  # pending/approved/rejected
    note = Column(Text, nullable=True)
    requested_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    decided_at = Column(DateTime, nullable=True)

    document = relationship("PolicyDocument", back_populates="approvals")


class PolicyNotification(Base):
    __tablename__ = "policy_notifications"

    id = Column(Integer, primary_key=True)
    target_email = Column(String(255), index=True, nullable=False)  # who should see this (maps to NextAuth email)

    type = Column(String(50), nullable=False)  # e.g., approval_requested, approval_decided
    message = Column(Text, nullable=False)

    document_id = Column(Integer, nullable=True)
    version = Column(Integer, nullable=True)
    approval_id = Column(Integer, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    read_at = Column(DateTime, nullable=True)


class PolicyUser(Base):
    __tablename__ = "policy_users"
    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    name = Column(String(255), nullable=True)
    org_id = Column(Integer, nullable=True)  # optional org scoping later
    role = Column(String(50), nullable=False, default="viewer")  # owner|admin|editor|viewer|approver
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class PolicyDocumentOwner(Base):
    __tablename__ = "policy_document_owners"
    id = Column(Integer, primary_key=True)
    document_id = Column(Integer, ForeignKey("policy_documents.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("policy_users.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(50), nullable=False, default="owner")  # owner|editor|viewer|approver

    __table_args__ = (UniqueConstraint("document_id", "user_id", name="uq_doc_user"),)

    user = relationship("PolicyUser")


# ==============================
# Framework Assessments (MVP)
# ==============================

class OrgControlAssessment(Base):
    """
    One row per org + framework key + control id.
    Stores the team's stance and metadata for that control.
    """
    __tablename__ = "org_control_assessments"

    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, index=True, nullable=True)  # optional until org scoping is enforced
    framework_key = Column(String(100), index=True, nullable=False)
    control_id = Column(String(100), index=True, nullable=False)

    # not_applicable | planned | in_progress | implemented
    status = Column(String(30), nullable=True)
    owner_user_id = Column(Integer, ForeignKey("policy_users.id", ondelete="SET NULL"), nullable=True, index=True)
    notes = Column(Text, nullable=True)
    evidence_links = Column(Text, nullable=True)  # JSON array as string
    last_reviewed_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    owner = relationship("PolicyUser", foreign_keys=[owner_user_id])

    __table_args__ = (
        UniqueConstraint("org_id", "framework_key", "control_id", name="uq_org_fw_ctrl"),
    )


class OrgControlLink(Base):
    """
    Optional link of a control to policy documents (and specific version).
    """
    __tablename__ = "org_control_links"

    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, index=True, nullable=True)
    framework_key = Column(String(100), index=True, nullable=False)
    control_id = Column(String(100), index=True, nullable=False)
    document_id = Column(Integer, ForeignKey("policy_documents.id", ondelete="CASCADE"), nullable=False, index=True)
    version = Column(Integer, nullable=True)

    __table_args__ = (
        UniqueConstraint("org_id", "framework_key", "control_id", "document_id", "version", name="uq_org_fw_ctrl_docver"),
    )


class FrameworkControlAssessment(Base):
    __tablename__ = "framework_control_assessments"

    id = Column(Integer, primary_key=True)
    framework_key = Column(String(64), index=True, nullable=False)
    control_id = Column(String(64), index=True, nullable=False)

    # points to policy_users.id
    owner_user_id = Column(
        Integer,
        ForeignKey("policy_users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # allowed: not_started | in_progress | implemented | not_applicable
    status = Column(String(32), nullable=False, default="not_started")

    note = Column(Text, nullable=True)
    evidence_url = Column(Text, nullable=True)

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    owner = relationship("PolicyUser", lazy="joined")

    __table_args__ = (
        UniqueConstraint("framework_key", "control_id", name="uq_framework_control"),
        Index("ix_fca_framework_control", "framework_key", "control_id"),
    )
