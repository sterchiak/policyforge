"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import Card from "@/components/Card";
import { api } from "@/lib/api";
import {
  Activity,
  FileText,
  Bell,
  Users,
  Clock,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";

// DnD Kit
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import SortableItem from "@/components/SortableItem";

type ApprovalsSummary = { pending: number; approved: number; rejected: number };

type NotificationItem = {
  id: number;
  type: "approval_requested" | "approval_decided" | string;
  message: string;
  created_at: string;
  read: boolean;
};

type UserOut = {
  id: number;
  email: string;
  name?: string | null;
  role: "owner" | "admin" | "editor" | "viewer" | "approver";
};

type DocumentOut = {
  id: number;
  title: string;
  template_key: string;
  status: string;
  created_at: string;
  updated_at: string;
  latest_version: number;
};

type MyApproval = {
  id: number;
  document_id: number;
  document_title: string;
  version: number | null;
  reviewer: string;
  status: "pending" | "approved" | "rejected";
  note: string | null;
  requested_at: string;
  decided_at: string | null;
};

type CoverageDoc = { document_id: number; title: string; updated_at: string };
type OwnershipCoverage = {
  no_owner: CoverageDoc[];
  no_approver: CoverageDoc[];
  totals: { no_owner: number; no_approver: number };
};

// Stable IDs for widgets (used for drag ordering + persistence)
const WIDGET_IDS = [
  "kpi-health",
  "kpi-templates",
  "kpi-docs",
  "kpi-approvals",
  "unread",
  "team",
  "my-approvals",
  "ownership",
  "recent",
  "roadmap",
] as const;
type WidgetId = (typeof WIDGET_IDS)[number];

export default function DashboardPage() {
  const [health, setHealth] =
    useState<"ok" | "error" | "checking...">("checking...");
  const [templateCount, setTemplateCount] = useState<number>(0);
  const [docCount, setDocCount] = useState<number>(0);
  const [approvals, setApprovals] = useState<ApprovalsSummary>({
    pending: 0,
    approved: 0,
    rejected: 0,
  });

  // Notifications (top 5 unread)
  const [unread, setUnread] = useState<NotificationItem[]>([]);
  // Team snapshot
  const [users, setUsers] = useState<UserOut[]>([]);
  // Recently updated
  const [docs, setDocs] = useState<DocumentOut[]>([]);
  const recentDocs = useMemo(
    () =>
      [...docs]
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        )
        .slice(0, 5),
    [docs]
  );

  // My approvals (pending)
  const [myApprovals, setMyApprovals] = useState<MyApproval[]>([]);
  const [busyApprovalId, setBusyApprovalId] = useState<number | null>(null);

  // Ownership coverage
  const [coverage, setCoverage] = useState<OwnershipCoverage | null>(null);

  // ---- data fetch ----
  useEffect(() => {
    api
      .get("/health")
      .then((r) => setHealth(r.data.status === "ok" ? "ok" : "error"))
      .catch(() => setHealth("error"));

    api
      .get("/v1/policies/templates")
      .then((r) => setTemplateCount(Array.isArray(r.data) ? r.data.length : 0))
      .catch(() => setTemplateCount(0));

    api
      .get<DocumentOut[]>("/v1/documents")
      .then((r) => {
        setDocCount(Array.isArray(r.data) ? r.data.length : 0);
        setDocs(r.data || []);
      })
      .catch(() => {
        setDocCount(0);
        setDocs([]);
      });

    api
      .get<ApprovalsSummary>("/v1/documents/approvals/summary_all", {
        params: { scope: "latest" },
      })
      .then((r) => setApprovals(r.data))
      .catch(() => setApprovals({ pending: 0, approved: 0, rejected: 0 }));

    api
      .get<NotificationItem[]>("/v1/notifications", {
        params: { status: "unread", limit: 5 },
      })
      .then((r) => setUnread(Array.isArray(r.data) ? r.data : []))
      .catch(() => setUnread([]));

    api
      .get<UserOut[]>("/v1/users")
      .then((r) => setUsers(Array.isArray(r.data) ? r.data : []))
      .catch(() => setUsers([]));

    api
      .get<MyApproval[]>("/v1/documents/approvals/mine", {
        params: { status: "pending", limit: 5 },
      })
      .then((r) => setMyApprovals(Array.isArray(r.data) ? r.data : []))
      .catch(() => setMyApprovals([]));

    api
      .get<OwnershipCoverage>("/v1/documents/ownership_coverage", {
        params: { limit: 5 },
      })
      .then((r) => setCoverage(r.data))
      .catch(() =>
        setCoverage({
          no_owner: [],
          no_approver: [],
          totals: { no_owner: 0, no_approver: 0 },
        })
      );
  }, []);

  // Team breakdown
  const teamTotal = users.length;
  const byRole = users.reduce<Record<UserOut["role"], number>>(
    (acc, u) => {
      acc[u.role] = (acc[u.role] || 0) + 1;
      return acc;
    },
    { owner: 0, admin: 0, editor: 0, viewer: 0, approver: 0 } as any
  );

  // Inline approve/reject
  const decide = async (a: MyApproval, status: "approved" | "rejected") => {
    const note =
      window.prompt(
        status === "approved"
          ? "Approval note (optional)"
          : "Rejection reason (optional)"
      ) || "";
    setBusyApprovalId(a.id);
    try {
      await api.patch(
        `/v1/documents/${a.document_id}/approvals/${a.id}`,
        { status, note }
      );
      const [mineRes, kpiRes] = await Promise.all([
        api.get<MyApproval[]>("/v1/documents/approvals/mine", {
          params: { status: "pending", limit: 5 },
        }),
        api.get<ApprovalsSummary>("/v1/documents/approvals/summary_all", {
          params: { scope: "latest" },
        }),
      ]);
      setMyApprovals(mineRes.data || []);
      setApprovals(kpiRes.data);
    } finally {
      setBusyApprovalId(null);
    }
  };

  // ---- Drag + drop ordering ----
  const STORAGE_KEY = "pf.dashboard.layout.v1";
  const [order, setOrder] = useState<WidgetId[]>(WIDGET_IDS as WidgetId[]);

  // Load persisted order
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed: string[] = JSON.parse(raw);
      const valid = parsed.filter((x) => (WIDGET_IDS as readonly string[]).includes(x));
      // Keep unknowns out; append any new widgets that aren’t saved yet
      const missing = (WIDGET_IDS as readonly string[]).filter((id) => !valid.includes(id));
      setOrder([...(valid as WidgetId[]), ...(missing as WidgetId[])]);
    } catch {
      // ignore
    }
  }, []);

  // Save order
  const persist = (next: WidgetId[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(active.id as WidgetId);
    const newIndex = order.indexOf(over.id as WidgetId);
    const next = arrayMove(order, oldIndex, newIndex);
    setOrder(next);
    persist(next);
  };

  // Render a widget by ID
  const renderWidget = (id: WidgetId) => {
    switch (id) {
      case "kpi-health":
        return (
          <Card title="System Health">
            <div className="flex items-center justify-between text-gray-900">
              <div className="flex items-center gap-2">
                <Activity size={18} />
                <span>API</span>
              </div>
              <span
                className={`rounded px-2 py-0.5 text-sm ${
                  health === "ok"
                    ? "bg-green-100 text-green-700"
                    : health === "error"
                    ? "bg-red-100 text-red-700"
                    : "bg-gray-100 text-gray-700"
                }`}
              >
                {health}
              </span>
            </div>
          </Card>
        );

      case "kpi-templates":
        return (
          <Card title="Templates">
            <div className="flex items-center justify-between text-gray-900">
              <div className="flex items-center gap-2">
                <FileText size={18} />
                <span>Available</span>
              </div>
              <span className="text-xl font-semibold">{templateCount}</span>
            </div>
            <div className="mt-3 text-right">
              <Link
                href="/policies"
                className="inline-flex items-center gap-1 text-sm text-gray-900 hover:underline"
              >
                Browse templates →
              </Link>
            </div>
          </Card>
        );

      case "kpi-docs":
        return (
          <Card title="Documents">
            <div className="flex items-center justify-between text-gray-900">
              <span>Total</span>
              <span className="text-xl font-semibold">{docCount}</span>
            </div>
            <div className="mt-3 text-right">
              <Link
                href="/documents"
                className="inline-flex items-center gap-1 text-sm text-gray-900 hover:underline"
              >
                Open documents →
              </Link>
            </div>
          </Card>
        );

      case "kpi-approvals":
        return (
          <Card title="Approvals (latest version)">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border bg-white p-4 text-center">
                <div className="text-sm text-gray-600">Pending</div>
                <div className="text-2xl font-semibold text-gray-900">
                  {approvals.pending}
                </div>
              </div>
              <div className="rounded-lg border bg-white p-4 text-center">
                <div className="text-sm text-gray-600">Approved</div>
                <div className="text-2xl font-semibold text-gray-900">
                  {approvals.approved}
                </div>
              </div>
              <div className="rounded-lg border bg-white p-4 text-center">
                <div className="text-sm text-gray-600">Rejected</div>
                <div className="text-2xl font-semibold text-gray-900">
                  {approvals.rejected}
                </div>
              </div>
            </div>
            <div className="mt-3 text-right">
              <Link
                href="/documents"
                className="inline-flex items-center gap-1 text-sm text-gray-900 hover:underline"
              >
                Review requests →
              </Link>
            </div>
          </Card>
        );

      case "unread":
        return (
          <Card title="Unread notifications">
            {unread.length === 0 ? (
              <p className="text-sm text-gray-700">No unread alerts.</p>
            ) : (
              <ul className="space-y-2">
                {unread.map((n) => (
                  <li
                    key={n.id}
                    className="flex items-start gap-2 rounded border p-2"
                  >
                    <Bell className="mt-0.5 h-4 w-4 text-gray-700" />
                    <div className="flex-1">
                      <div className="text-sm text-gray-900">{n.message}</div>
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <Clock className="h-3 w-3" />
                        {new Date(n.created_at).toLocaleString()}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 text-right">
              <span className="text-xs text-gray-500">Open the bell to view all</span>
            </div>
          </Card>
        );

      case "team":
        const teamTotal = users.length;
        const byRole = users.reduce<Record<UserOut["role"], number>>(
          (acc, u) => {
            acc[u.role] = (acc[u.role] || 0) + 1;
            return acc;
          },
          { owner: 0, admin: 0, editor: 0, viewer: 0, approver: 0 } as any
        );
        return (
          <Card title="Team snapshot">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-gray-900">
                <Users size={18} />
                <span>Total</span>
              </div>
              <span className="text-xl font-semibold text-gray-900">
                {teamTotal}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded border bg-white p-2">
                Owners: <b>{byRole.owner || 0}</b>
              </div>
              <div className="rounded border bg-white p-2">
                Approvers: <b>{byRole.approver || 0}</b>
              </div>
              <div className="rounded border bg-white p-2">
                Editors: <b>{byRole.editor || 0}</b>
              </div>
              <div className="rounded border bg-white p-2">
                Viewers: <b>{byRole.viewer || 0}</b>
              </div>
              <div className="col-span-2 rounded border bg-white p-2">
                Admins: <b>{byRole.admin || 0}</b>
              </div>
            </div>
            <div className="mt-3 text-right">
              <Link
                href="/team"
                className="inline-flex items-center gap-1 text-sm text-gray-900 hover:underline"
              >
                Manage team →
              </Link>
            </div>
          </Card>
        );

      case "my-approvals":
        return (
          <Card title="My approvals (pending)">
            {myApprovals.length === 0 ? (
              <p className="text-sm text-gray-700">Nothing waiting on you 🎉</p>
            ) : (
              <ul className="space-y-2">
                {myApprovals.map((a) => (
                  <li key={a.id} className="rounded border p-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {a.document_title} {a.version ? `• v${a.version}` : ""}
                        </div>
                        <div className="text-xs text-gray-500">
                          Requested {new Date(a.requested_at).toLocaleString()}
                        </div>
                        {a.note && (
                          <div className="mt-1 text-sm text-gray-900">
                            {a.note}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => decide(a, "approved")}
                          disabled={busyApprovalId === a.id}
                          className="rounded border border-green-700 px-2 py-1 text-xs text-green-700 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => decide(a, "rejected")}
                          disabled={busyApprovalId === a.id}
                          className="rounded border border-red-700 px-2 py-1 text-xs text-red-700 disabled:opacity-50"
                        >
                          Reject
                        </button>
                        <Link
                          href={`/documents/${a.document_id}`}
                          className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                        >
                          Open
                        </Link>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );

      case "ownership":
        return (
          <Card title="Ownership coverage">
            {!coverage ? (
              <p className="text-sm text-gray-700">Loading…</p>
            ) : (
              <>
                <div className="mb-3 grid grid-cols-2 gap-3">
                  <div className="rounded-lg border bg-white p-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-sm text-gray-700">
                      <ShieldCheck className="h-4 w-4" />
                      Missing owner
                    </div>
                    <div className="text-xl font-semibold text-gray-900">
                      {coverage.totals.no_owner}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-white p-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-sm text-gray-700">
                      <AlertTriangle className="h-4 w-4" />
                      Missing approver
                    </div>
                    <div className="text-xl font-semibold text-gray-900">
                      {coverage.totals.no_approver}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-semibold text-gray-700">
                      Top missing owner
                    </div>
                    {coverage.no_owner.length === 0 ? (
                      <p className="text-sm text-gray-700">
                        All docs have an owner.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {coverage.no_owner.map((d) => (
                          <li
                            key={`noowner-${d.document_id}`}
                            className="flex items-center justify-between rounded border p-2"
                          >
                            <div>
                              <div className="text-sm text-gray-900">
                                {d.title}
                              </div>
                              <div className="text-xs text-gray-500">
                                {new Date(d.updated_at).toLocaleString()}
                              </div>
                            </div>
                            <Link
                              href={`/documents/${d.document_id}`}
                              className="rounded border px-2 py-1 text-xs"
                            >
                              Fix
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-semibold text-gray-700">
                      Top missing approver
                    </div>
                    {coverage.no_approver.length === 0 ? (
                      <p className="text-sm text-gray-700">
                        All docs have an approver.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {coverage.no_approver.map((d) => (
                          <li
                            key={`noapprover-${d.document_id}`}
                            className="flex items-center justify-between rounded border p-2"
                          >
                            <div>
                              <div className="text-sm text-gray-900">
                                {d.title}
                              </div>
                              <div className="text-xs text-gray-500">
                                {new Date(d.updated_at).toLocaleString()}
                              </div>
                            </div>
                            <Link
                              href={`/documents/${d.document_id}`}
                              className="rounded border px-2 py-1 text-xs"
                            >
                              Fix
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </>
            )}
          </Card>
        );

      case "recent":
        return (
          <Card title="Recently updated">
            {recentDocs.length === 0 ? (
              <p className="text-sm text-gray-700">No documents yet.</p>
            ) : (
              <ul className="space-y-2">
                {recentDocs.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between rounded border p-2"
                  >
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {d.title}
                      </div>
                      <div className="text-xs text-gray-500">
                        #{d.id} • v{d.latest_version} •{" "}
                        {new Date(d.updated_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${
                          d.status === "approved"
                            ? "bg-green-100 text-green-700"
                            : d.status === "rejected"
                            ? "bg-red-100 text-red-700"
                            : d.status === "in_review"
                            ? "bg-yellow-100 text-yellow-700"
                            : d.status === "published"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {d.status}
                      </span>
                      <Link
                        href={`/documents/${d.id}`}
                        className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                      >
                        Open
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );

      case "roadmap":
        return (
          <Card title="Roadmap">
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between">
                <span className="text-gray-900">Versioning & Compare</span>
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-700">
                  Shipped
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-gray-900">Comments</span>
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-700">
                  Shipped
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-gray-900">DOCX/PDF/HTML Export</span>
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-700">
                  Shipped
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-gray-900">In-app notifications</span>
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-700">
                  Shipped
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-gray-900">Team & roles</span>
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-700">
                  Shipped
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-gray-900">Document ownership</span>
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-700">
                  Shipped
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-gray-900">
                  Per-doc approval permissions
                </span>
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-700">
                  Shipped
                </span>
              </li>

              {/* Next up (local-first) */}
              <li className="flex items-center justify-between">
                <span className="text-gray-900">Reviewer picker (search team)</span>
                <span className="rounded bg-indigo-100 px-2 py-0.5 text-indigo-700">
                  Next
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-gray-900">
                  Publishing & acknowledgments dashboard
                </span>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-700">
                  Planned
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-gray-900">Stale docs & owner nudges</span>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-700">
                  Planned
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-gray-900">Search, tags & filters</span>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-700">
                  Planned
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-gray-900">SSO (Google OAuth)</span>
                <span className="rounded bg-yellow-100 px-2 py-0.5 text-yellow-700">
                  Deferred
                </span>
              </li>
            </ul>
          </Card>
        );

      default:
        return null;
    }
  };

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Policy Hub</h1>
          <p className="text-sm text-gray-700">
            Local-first policy management with versioning, comments, and
            approvals.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/policies"
            className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm text-gray-900 shadow-sm hover:bg-gray-50"
            title="Start a new policy"
          >
            + New Policy
          </Link>
          <Link
            href="/documents"
            className="inline-flex items-center rounded-xl border px-4 py-2 text-sm text-gray-900 hover:bg-gray-100"
          >
            Documents
          </Link>

          {/* Reset layout */}
          <button
            onClick={() => {
              setOrder(WIDGET_IDS as WidgetId[]);
              try {
                localStorage.removeItem(STORAGE_KEY);
              } catch {}
            }}
            className="ml-2 inline-flex items-center rounded-xl border px-3 py-2 text-xs text-gray-900 hover:bg-gray-100"
            title="Reset dashboard layout"
          >
            Reset layout
          </button>
        </div>
      </div>

      {/* Reorderable 3-column grid */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={order} strategy={rectSortingStrategy}>
          <div className="grid gap-6 md:grid-cols-3">
            {order.map((id) => (
              <SortableItem key={id} id={id}>
                {renderWidget(id)}
              </SortableItem>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </AppShell>
  );
}
