"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import AppShell from "@/components/AppShell";
import Card from "@/components/Card";
import { api } from "@/lib/api";
import { diffWords } from "diff";

type VersionRow = { id: number; version: number; created_at: string };
type DocumentDetail = {
  id: number;
  title: string;
  template_key: string;
  status: string;
  created_at: string;
  updated_at: string;
  latest_version: number;
  versions: VersionRow[];
};

type DraftParams = {
  template_key: string;
  org_name: string;
  password_min_length: number;
  mfa_required_roles: string[];
  log_retention_days: number;
};

type VersionDetail = {
  id: number;
  version: number;
  created_at: string;
  html: string;
  params: DraftParams;
};

type Comment = {
  id: number;
  document_id: number;
  version: number | null;
  author: string;
  body: string;
  created_at: string;
};

type Approval = {
  id: number;
  document_id: number;
  version: number | null;
  reviewer: string;
  status: "pending" | "approved" | "rejected";
  note: string | null;
  requested_at: string;
  decided_at: string | null;
};

function getFilenameFromDisposition(disposition?: string, fallback = "policy.html") {
  if (!disposition) return fallback;
  const m = disposition.match(/filename="(.+?)"/i);
  return m?.[1] ?? fallback;
}

const STATUS_OPTS = ["draft", "in_review", "approved", "published", "rejected"] as const;

// --- helpers for diff ---
const stripHtml = (html: string) => html.replace(/<[^>]+>/g, " ");
const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));

function renderContentDiff(aHtml: string, bHtml: string) {
  const parts = diffWords(stripHtml(aHtml), stripHtml(bHtml));
  const html = parts
    .map((p) => {
      const val = escapeHtml(p.value);
      if (p.added) return `<ins style="text-decoration: underline; background: #ecfeff">${val}</ins>`;
      if (p.removed) return `<del style="text-decoration: line-through; background: #fee2e2">${val}</del>`;
      return val;
    })
    .join("");
  return html;
}

function diffParams(a: DraftParams, b: DraftParams) {
  const toStr = (v: any) => (Array.isArray(v) ? v.join(", ") : String(v));
  const keys: (keyof DraftParams)[] = [
    "template_key",
    "org_name",
    "password_min_length",
    "mfa_required_roles",
    "log_retention_days",
  ];
  return keys
    .map((k) => ({ key: k, before: a[k], after: b[k] }))
    .filter((r) => JSON.stringify(r.before) !== JSON.stringify(r.after))
    .map((r) => ({ key: r.key, before: toStr(r.before), after: toStr(r.after) }));
}

export default function DocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const docId = Number(params.id);
  const router = useRouter();

  const { data: session } = useSession();
  const isAuthed = Boolean(session?.user);

  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [current, setCurrent] = useState<VersionDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // editable meta
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<typeof STATUS_OPTS[number]>("draft");

  // compare state
  const [compareA, setCompareA] = useState<number | "">("");
  const [compareB, setCompareB] = useState<number | "">("");
  const [paramChanges, setParamChanges] = useState<Array<{ key: string; before: string; after: string }>>([]);
  const [contentDiffHtml, setContentDiffHtml] = useState<string | null>(null);

  // comments state
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [commentAuthor, setCommentAuthor] = useState("You");
  const [commentOnlyCurrent, setCommentOnlyCurrent] = useState(true);

  // approvals state
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [onlyCurrentApprovals, setOnlyCurrentApprovals] = useState(true);
  const [newReviewer, setNewReviewer] = useState("");
  const [newApprovalNote, setNewApprovalNote] = useState("");

  const latestVersion = useMemo(() => doc?.latest_version ?? null, [doc]);

  // load document + latest version
  useEffect(() => {
    if (!docId) return;
    api
      .get<DocumentDetail>(`/v1/documents/${docId}`)
      .then((r) => {
        setDoc(r.data);
        setTitle(r.data.title);
        setStatus((r.data.status as any) || "draft");
        const latest = r.data.latest_version || (r.data.versions.at(-1)?.version ?? 1);
        return api.get<VersionDetail>(`/v1/documents/${docId}/versions/${latest}`);
      })
      .then((r) => setCurrent(r.data))
      .catch((e) => setErr(e.message));
  }, [docId]);

  // load comments
  useEffect(() => {
    if (!docId) return;
    const query =
      commentOnlyCurrent && current?.version
        ? `/v1/documents/${docId}/comments?version=${current.version}`
        : `/v1/documents/${docId}/comments`;
    api
      .get<Comment[]>(query)
      .then((r) => setComments(r.data))
      .catch(() => setComments([]));
  }, [docId, current?.version, commentOnlyCurrent]);

  // load approvals
  useEffect(() => {
    if (!docId) return;
    const query =
      onlyCurrentApprovals && current?.version
        ? `/v1/documents/${docId}/approvals?version=${current.version}`
        : `/v1/documents/${docId}/approvals`;
    api
      .get<Approval[]>(query)
      .then((r) => setApprovals(r.data))
      .catch(() => setApprovals([]));
  }, [docId, current?.version, onlyCurrentApprovals]);

  const loadVersion = async (v: number) => {
    setErr(null);
    setLoading(true);
    try {
      const res = await api.get<VersionDetail>(`/v1/documents/${docId}/versions/${v}`);
      setCurrent(res.data);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  const onDownloadHtml = async () => {
    if (!current) return;
    setErr(null);
    setLoading(true);
    try {
      const res = await api.post("/v1/policies/export/html", current.params, { responseType: "blob" });
      const blob = new Blob([res.data], { type: "text/html;charset=utf-8" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      const filename = getFilenameFromDisposition(res.headers["content-disposition"], `${doc?.title}.html`);
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  const onDownloadPdf = async () => {
    if (!current) return;
    setErr(null);
    setLoading(true);
    try {
      const res = await api.post("/v1/policies/export/pdf", current.params, { responseType: "blob" });
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      const filename = getFilenameFromDisposition(res.headers["content-disposition"], `${doc?.title}.pdf`);
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  const onDownloadDocx = async () => {
    if (!current) return;
    setErr(null);
    setLoading(true);
    try {
      const res = await api.post("/v1/policies/export/docx", current.params, { responseType: "blob" });
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      const filename = getFilenameFromDisposition(res.headers["content-disposition"], `${doc?.title}.docx`);
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  const onSaveMeta = async () => {
    if (!doc) return;
    setErr(null);
    setLoading(true);
    try {
      await api.patch<DocumentDetail>(`/v1/documents/${doc.id}`, { title, status });
      const meta = await api.get<DocumentDetail>(`/v1/documents/${docId}`);
      setDoc(meta.data);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  const onDeleteDoc = async () => {
    if (!doc) return;
    if (!confirm("Delete this document and all versions?")) return;
    setErr(null);
    setLoading(true);
    try {
      await api.delete(`/v1/documents/${doc.id}`);
      router.push("/documents");
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e.message);
      setLoading(false);
    }
  };

  const onDeleteVersion = async (v: number) => {
    if (!confirm(`Delete version v${v}?`)) return;
    setErr(null);
    setLoading(true);
    try {
      await api.delete(`/v1/documents/${docId}/versions/${v}`);
      const meta = await api.get<DocumentDetail>(`/v1/documents/${docId}`);
      setDoc(meta.data);
      const latest = meta.data.latest_version || (meta.data.versions.at(-1)?.version ?? 0);
      if (latest > 0) {
        const vres = await api.get<VersionDetail>(`/v1/documents/${docId}/versions/${latest}`);
        setCurrent(vres.data);
      } else {
        setCurrent(null);
      }
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  const onRollback = async (v: number) => {
    if (!confirm(`Create a new version from v${v}?`)) return;
    setErr(null);
    setLoading(true);
    try {
      const res = await api.post<{ version: number }>(`/v1/documents/${docId}/versions/${v}/rollback`, {});
      const vres = await api.get<VersionDetail>(`/v1/documents/${docId}/versions/${res.data.version}`);
      setCurrent(vres.data);
      const meta = await api.get<DocumentDetail>(`/v1/documents/${docId}`);
      setDoc(meta.data);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  const onOpenInEditor = (v?: number) => {
    const version = v ?? current?.version ?? latestVersion ?? 1;
    router.push(`/policies?doc=${docId}&v=${version}`);
  };

  const runCompare = async () => {
    setErr(null);
    setParamChanges([]);
    setContentDiffHtml(null);
    if (compareA === "" || compareB === "" || compareA === compareB) {
      setErr("Pick two different versions to compare.");
      return;
    }
    setLoading(true);
    try {
      const [aRes, bRes] = await Promise.all([
        api.get<VersionDetail>(`/v1/documents/${docId}/versions/${compareA}`),
        api.get<VersionDetail>(`/v1/documents/${docId}/versions/${compareB}`),
      ]);
      setParamChanges(diffParams(aRes.data.params, bRes.data.params));
      setContentDiffHtml(renderContentDiff(aRes.data.html, bRes.data.html));
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  // --- Approvals ---
  const refreshApprovals = async () => {
    if (!docId) return;
    const query =
      onlyCurrentApprovals && current?.version
        ? `/v1/documents/${docId}/approvals?version=${current.version}`
        : `/v1/documents/${docId}/approvals`;
    const r = await api.get<Approval[]>(query);
    setApprovals(r.data);
  };

  const onCreateApproval = async () => {
    if (!newReviewer.trim()) return;
    setErr(null);
    setLoading(true);
    try {
      const payload = {
        reviewer: newReviewer.trim(),
        version: onlyCurrentApprovals ? current?.version ?? null : null,
        note: newApprovalNote || undefined,
      };
      await api.post<Approval>(`/v1/documents/${docId}/approvals`, payload);
      setNewReviewer("");
      setNewApprovalNote("");
      await refreshApprovals();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  const onDecideApproval = async (approvalId: number, status: "approved" | "rejected") => {
    const note = window.prompt(status === "approved" ? "Approval note (optional)" : "Rejection reason (optional)") || "";
    setErr(null);
    setLoading(true);
    try {
      await api.patch<Approval>(`/v1/documents/${docId}/approvals/${approvalId}`, { status, note });
      await refreshApprovals();
      if (status === "approved") setStatus("approved");
      if (status === "rejected") setStatus("rejected");
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell>
      {!doc ? (
        <p className="text-sm text-gray-700">Loading…</p>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold">{doc.title}</h1>
              <p className="text-xs text-gray-600">
                Doc #{doc.id} • Template: {doc.template_key} • Updated{" "}
                {new Date(doc.updated_at).toLocaleString()}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/documents" className="rounded border px-3 py-1 text-sm">
                Back to Documents
              </Link>
              <button
                onClick={onDeleteDoc}
                className="rounded border border-red-600 px-3 py-1 text-sm text-red-700"
                disabled={!isAuthed || loading}
              >
                Delete
              </button>
            </div>
          </div>

          <div className="mb-4 grid gap-3 md:grid-cols-[1fr_200px]">
            <input
              className="rounded border px-3 py-2"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              disabled={!isAuthed}
            />
            <select
              className="rounded border px-3 py-2"
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
              disabled={!isAuthed}
            >
              {STATUS_OPTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <div className="md:col-span-2">
              <button
                onClick={onSaveMeta}
                disabled={!isAuthed || loading}
                className="rounded bg-black px-4 py-2 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save Changes
              </button>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-[260px_1fr]">
            {/* LEFT: Versions + Compare + Request Approval */}
            <div className="space-y-6">
              <Card title="Versions">
                <div className="space-y-2">
                  {doc.versions.map((v) => (
                    <div key={v.id} className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => loadVersion(v.version)}
                        className={`flex-1 rounded border px-3 py-2 text-left text-sm ${
                          current?.version === v.version ? "border-black" : "border-gray-200 hover:border-gray-300"
                        }`}
                        title={`Open v${v.version}`}
                      >
                        v{v.version} • {new Date(v.created_at).toLocaleString()}
                      </button>
                      <button
                        onClick={() => onRollback(v.version)}
                        className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                        title="Create new version from this"
                        disabled={!isAuthed || loading}
                      >
                        Rollback
                      </button>
                      <button
                        onClick={() => onDeleteVersion(v.version)}
                        className="rounded border border-red-600 px-2 py-1 text-xs text-red-700 disabled:opacity-50"
                        title="Delete version"
                        disabled={!isAuthed || loading}
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>

                {/* Compare picker */}
                {doc.versions.length >= 2 && (
                  <div className="mt-4 rounded-lg border p-3">
                    <div className="mb-2 text-sm font-semibold">Compare Versions</div>
                    <div className="flex items-center gap-2">
                      <select
                        className="w-full rounded border px-2 py-1 text-sm"
                        value={compareA}
                        onChange={(e) => setCompareA(e.target.value === "" ? "" : Number(e.target.value))}
                      >
                        <option value="">From…</option>
                        {doc.versions.map((v) => (
                          <option key={`a-${v.id}`} value={v.version}>
                            v{v.version}
                          </option>
                        ))}
                      </select>
                      <span className="text-sm text-gray-500">→</span>
                      <select
                        className="w-full rounded border px-2 py-1 text-sm"
                        value={compareB}
                        onChange={(e) => setCompareB(e.target.value === "" ? "" : Number(e.target.value))}
                      >
                        <option value="">To…</option>
                        {doc.versions.map((v) => (
                          <option key={`b-${v.id}`} value={v.version}>
                            v{v.version}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button onClick={runCompare} className="mt-2 w-full rounded border px-2 py-1 text-sm">
                      Compare
                    </button>
                  </div>
                )}

                {/* Request approval */}
                <div className="mt-4 rounded-lg border p-3">
                  <div className="mb-2 text-sm font-semibold">Request Approval</div>
                  <label className="mb-2 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={onlyCurrentApprovals}
                      onChange={(e) => setOnlyCurrentApprovals(e.target.checked)}
                      disabled={!isAuthed}
                    />
                    Only for current version {current ? `(v${current.version})` : ""}
                  </label>
                  <input
                    className="mb-2 w-full rounded border px-2 py-1 text-sm"
                    placeholder="Reviewer (name or email)"
                    value={newReviewer}
                    onChange={(e) => setNewReviewer(e.target.value)}
                    disabled={!isAuthed}
                  />
                  <textarea
                    className="mb-2 h-20 w-full rounded border px-2 py-1 text-sm"
                    placeholder="Optional note"
                    value={newApprovalNote}
                    onChange={(e) => setNewApprovalNote(e.target.value)}
                    disabled={!isAuthed}
                  />
                  <button
                    onClick={onCreateApproval}
                    disabled={!isAuthed || !newReviewer.trim() || loading}
                    className="w-full rounded border px-2 py-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Send Request
                  </button>
                </div>
              </Card>
            </div>

            {/* RIGHT: Preview + Comparison + Comments + Approvals List */}
            <div className="space-y-6">
              <Card title={`Preview ${current ? `(v${current.version})` : ""}`}>
                {err && <p className="mb-3 text-sm text-red-600">{err}</p>}
                {!current ? (
                  <p className="text-sm text-gray-700">Select a version to preview.</p>
                ) : (
                  <>
                    <div className="mb-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => onOpenInEditor()}
                        className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
                        disabled={!isAuthed}
                      >
                        Open in Editor
                      </button>
                      <button onClick={onDownloadHtml} disabled={loading} className="rounded border px-3 py-1.5 text-sm">
                        Download HTML
                      </button>
                      <button onClick={onDownloadPdf} disabled={loading} className="rounded border px-3 py-1.5 text-sm">
                        Download PDF
                      </button>
                      <button onClick={onDownloadDocx} disabled={loading} className="rounded border px-3 py-1.5 text-sm">
                        Download DOCX
                      </button>
                    </div>
                    <div
                      className="prose max-w-none prose-headings:text-gray-900 prose-p:text-gray-900"
                      dangerouslySetInnerHTML={{ __html: current.html }}
                    />
                  </>
                )}
              </Card>

              {(paramChanges.length > 0 || contentDiffHtml) && (
                <Card title="Comparison">
                  {paramChanges.length > 0 ? (
                    <>
                      <h3 className="mb-2 text-sm font-semibold">Parameter changes</h3>
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr className="text-left text-gray-600">
                              <th className="py-1 pr-4">Field</th>
                              <th className="py-1 pr-4">From</th>
                              <th className="py-1">To</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {paramChanges.map((c) => (
                              <tr key={c.key}>
                                <td className="py-1 pr-4 font-medium">{c.key.replace(/_/g, " ")}</td>
                                <td className="py-1 pr-4 text-gray-700">{c.before || "—"}</td>
                                <td className="py-1 text-gray-900">{c.after || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-gray-700">No parameter changes.</p>
                  )}

                  {contentDiffHtml && (
                    <>
                      <h3 className="mt-4 text-sm font-semibold">Content diff</h3>
                      <div
                        className="prose max-w-none whitespace-pre-wrap"
                        dangerouslySetInnerHTML={{ __html: contentDiffHtml }}
                      />
                    </>
                  )}
                </Card>
              )}

              <Card title="Comments">
                <div className="mb-3 flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={commentOnlyCurrent}
                      onChange={(e) => setCommentOnlyCurrent(e.target.checked)}
                    />
                    Only show for current version {current ? `(v${current.version})` : ""}
                  </label>
                </div>

                {comments.length === 0 ? (
                  <p className="text-sm text-gray-700">No comments yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {comments.map((c) => (
                      <li key={c.id} className="rounded border p-2">
                        <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
                          <span>
                            {c.author} {c.version ? `• v${c.version}` : "• all versions"}
                          </span>
                          <span>{new Date(c.created_at).toLocaleString()}</span>
                        </div>
                        <div className="whitespace-pre-wrap text-sm text-gray-900">{c.body}</div>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-4 space-y-2">
                  <input
                    className="w-full rounded border px-3 py-2 text-sm"
                    placeholder="Your name (optional)"
                    value={commentAuthor}
                    onChange={(e) => setCommentAuthor(e.target.value)}
                    disabled={!isAuthed}
                  />
                  <textarea
                    className="h-24 w-full rounded border px-3 py-2 text-sm"
                    placeholder="Add a comment…"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    disabled={!isAuthed}
                  />
                  <button
                    onClick={async () => {
                      if (!newComment.trim()) return;
                      setErr(null);
                      setLoading(true);
                      try {
                        const payload = {
                          author: commentAuthor || "You",
                          body: newComment,
                          version: commentOnlyCurrent ? current?.version ?? null : null,
                        };
                        const res = await api.post<Comment>(`/v1/documents/${docId}/comments`, payload);
                        setComments((prev) => [...prev, res.data]);
                        setNewComment("");
                      } catch (e: any) {
                        setErr(e?.response?.data?.detail || e.message);
                      } finally {
                        setLoading(false);
                      }
                    }}
                    disabled={!isAuthed || loading || !newComment.trim()}
                    className="rounded border px-3 py-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Add Comment
                  </button>
                </div>
              </Card>

              {/* Approvals */}
              <Card title="Approvals">
                <div className="mb-3 flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={onlyCurrentApprovals}
                      onChange={(e) => setOnlyCurrentApprovals(e.target.checked)}
                    />
                    Only show for current version {current ? `(v${current.version})` : ""}
                  </label>
                </div>

                {approvals.length === 0 ? (
                  <p className="text-sm text-gray-700">No approvals yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {approvals.map((a) => (
                      <li key={a.id} className="rounded border p-2">
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{a.reviewer}</span>
                            <span className="text-gray-600">{a.version ? `v${a.version}` : "all versions"}</span>
                          </div>
                          <div>
                            <span
                              className={`rounded px-2 py-0.5 ${
                                a.status === "approved"
                                  ? "bg-green-100 text-green-700"
                                  : a.status === "rejected"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-yellow-100 text-yellow-700"
                              }`}
                            >
                              {a.status}
                            </span>
                          </div>
                        </div>
                        {a.note && <div className="mb-1 text-sm text-gray-900">{a.note}</div>}
                        <div className="flex flex-wrap items-center justify-between text-xs text-gray-600">
                          <span>Requested {new Date(a.requested_at).toLocaleString()}</span>
                          <span>
                            {a.decided_at ? `Decided ${new Date(a.decided_at).toLocaleString()}` : "Awaiting decision"}
                          </span>
                        </div>
                        {a.status === "pending" && (
                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={() => onDecideApproval(a.id, "approved")}
                              className="rounded border px-2 py-1 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                              disabled={!isAuthed || loading}
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => onDecideApproval(a.id, "rejected")}
                              className="rounded border px-2 py-1 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                              disabled={!isAuthed || loading}
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
