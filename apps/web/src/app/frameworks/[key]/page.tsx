// apps/web/src/app/frameworks/[key]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import AppShell from "@/components/AppShell";
import Card from "@/components/Card";
import { api } from "@/lib/api";

type RawControl = any;

type Control = {
  id: string;
  title: string;
  description?: string;
  family?: string;
  category?: string;
  function?: string; // e.g., ID/PR/DE/RS/RC for NIST CSF when present
};

type FrameworkMeta = {
  key: string;
  name: string;
  publisher?: string;
  version?: string;        // optional — shown only if present
  description?: string;    // optional — shown only if present
  tags?: string[];         // optional — shown only if present
};

type Assessment = {
  control_id: string;
  status?: "not_applicable" | "planned" | "in_progress" | "implemented";
  owner_user_id?: number | null;
  owner_email?: string | null;
  notes?: string | null;
  evidence_links?: string[]; // URLs
  last_reviewed_at?: string | null;
  updated_at?: string | null;
};

type ControlWithAssessment = {
  id: string;
  title: string;
  function?: string;
  assessment?: Assessment | null;
  linked_docs?: Array<{ document_id: number; version?: number | null }>;
};

type UserRow = {
  id: number;
  email: string;
  name?: string | null;
  role: string;
};

const STATUS_OPTS = [
  { value: "", label: "— none —" },
  { value: "not_applicable", label: "Not applicable" },
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In progress" },
  { value: "implemented", label: "Implemented" },
] as const;

function toControl(rc: any): Control {
  const id =
    rc?.id ??
    rc?.control_id ??
    rc?.number ??
    rc?.ref ??
    rc?.key ??
    String(rc?.uid ?? "");
  const title =
    rc?.title ??
    rc?.name ??
    rc?.statement ??
    rc?.summary ??
    String(id || "");
  return {
    id: String(id || ""),
    title: String(title || ""),
    description: rc?.description ?? rc?.text ?? rc?.details ?? undefined,
    family: rc?.family ?? rc?.domain ?? rc?.group ?? undefined,
    category: rc?.category ?? rc?.subcategory ?? undefined,
    function: rc?.function ?? rc?.fn ?? undefined,
  };
}

function normalizeControls(raw: RawControl[] | Record<string, RawControl> | undefined): Control[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(toControl).filter((c) => c.id);
  if (typeof raw === "object") return Object.values(raw).map(toControl).filter((c) => c.id);
  return [];
}

export default function FrameworkDetailPage() {
  const params = useParams<{ key: string }>();
  const key = params?.key;
  const { data: session } = useSession();
  const myEmail = (session?.user as any)?.email as string | undefined;

  const [meta, setMeta] = useState<FrameworkMeta | null>(null);
  const [rows, setRows] = useState<ControlWithAssessment[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // filters
  const [q, setQ] = useState("");
  const [fn, setFn] = useState<string>("any"); // NIST function filter
  const [statusFilter, setStatusFilter] = useState<string>("any");
  const [mineOnly, setMineOnly] = useState(false);

  // local edits (notes, evidence) keyed by control id
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [draftEvidence, setDraftEvidence] = useState<Record<string, string>>({}); // comma/space separated

  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";

  // Load framework meta (name, publisher, etc)
  useEffect(() => {
    if (!key) return;
    setErr(null);
    api
      .get<{
        key: string;
        name: string;
        publisher?: string;
        controls: Array<{ id: string; title: string; function?: string }>;
      }>(`/v1/frameworks/${key}`)
      .then((r) => {
        setMeta({
          key: r.data.key,
          name: r.data.name,
          publisher: r.data.publisher,
        });
      })
      .catch((e: any) => setErr(e?.response?.data?.detail || e.message));
  }, [key]);

  // Load controls + assessments
  useEffect(() => {
    if (!key) return;
    setLoading(true);
    setErr(null);
    api
      .get<ControlWithAssessment[]>(`/v1/frameworks/${key}/assessments`)
      .then((r) => {
        setRows(Array.isArray(r.data) ? r.data : []);
        // initialize local drafts
        const n: Record<string, string> = {};
        const ev: Record<string, string> = {};
        (r.data || []).forEach((c) => {
          const a = c.assessment;
          if (a?.notes) n[c.id] = a.notes;
          if (a?.evidence_links?.length) ev[c.id] = a.evidence_links.join(", ");
        });
        setDraftNotes(n);
        setDraftEvidence(ev);
      })
      .catch((e: any) => setErr(e?.response?.data?.detail || e.message))
      .finally(() => setLoading(false));
  }, [key]);

  // Load users for owner picker
  useEffect(() => {
    api
      .get<UserRow[]>("/v1/users")
      .then((r) => setUsers(Array.isArray(r.data) ? r.data : []))
      .catch(() => setUsers([]));
  }, []);

  // NIST function options present in data
  const functionOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((c) => {
      if (c.function && c.function.trim()) set.add(c.function.trim());
    });
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();

    return rows.filter((row) => {
      const a = row.assessment;
      const hay = `${row.id} ${row.title} ${row.function || ""} ${a?.status || ""} ${a?.owner_email || ""} ${(a?.notes || "")}`.toLowerCase();

      const matchSearch = !needle || hay.includes(needle);
      const matchFn = functionOptions.length === 0 || fn === "any" || (row.function || "").toLowerCase() === fn.toLowerCase();
      const matchStatus = statusFilter === "any" || (a?.status || "") === statusFilter;
      const matchMine = !mineOnly || (!!myEmail && a?.owner_email === myEmail);

      return matchSearch && matchFn && matchStatus && matchMine;
    });
  }, [rows, q, fn, statusFilter, mineOnly, functionOptions.length, myEmail]);

  function userLabel(u?: UserRow | null) {
    if (!u) return "Unassigned";
    return u.name ? `${u.name} (${u.email})` : u.email;
    }

  function userById(id?: number | null): UserRow | undefined {
    if (!id) return undefined;
    return users.find((u) => u.id === id);
  }

  const quickSaveStatus = async (control_id: string, status: Assessment["status"]) => {
    try {
      await api.patch<Assessment>(`/v1/frameworks/${key}/controls/${encodeURIComponent(control_id)}/assessment`, {
        status: status || null,
      });
      // update local row
      setRows((prev) =>
        prev.map((r) =>
          r.id === control_id
            ? {
                ...r,
                assessment: {
                  ...(r.assessment || { control_id }),
                  status: status || undefined,
                },
              }
            : r
        )
      );
    } catch (e) {
      // ignore UI error toast for now; could add one later
    }
  };

  const quickAssignOwner = async (control_id: string, owner_user_id?: number | null) => {
    try {
      await api.patch<Assessment>(`/v1/frameworks/${key}/controls/${encodeURIComponent(control_id)}/assessment`, {
        owner_user_id: owner_user_id ?? null,
      });
      const owner = userById(owner_user_id ?? undefined);
      setRows((prev) =>
        prev.map((r) =>
          r.id === control_id
            ? {
                ...r,
                assessment: {
                  ...(r.assessment || { control_id }),
                  owner_user_id: owner_user_id ?? undefined,
                  owner_email: owner?.email ?? null,
                },
              }
            : r
        )
      );
    } catch (e) {
      // optional toast
    }
  };

  const saveNotesEvidence = async (control_id: string) => {
    const notes = draftNotes[control_id] ?? "";
    const ev = draftEvidence[control_id] ?? "";
    const links = ev
      .split(/[, \n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const res = await api.patch<Assessment>(`/v1/frameworks/${key}/controls/${encodeURIComponent(control_id)}/assessment`, {
        notes,
        evidence_links: links,
      });
      setRows((prev) =>
        prev.map((r) =>
          r.id === control_id
            ? {
                ...r,
                assessment: {
                  ...(r.assessment || { control_id }),
                  notes: res.data.notes ?? notes,
                  evidence_links: res.data.evidence_links ?? links,
                  last_reviewed_at: res.data.last_reviewed_at ?? r.assessment?.last_reviewed_at,
                  updated_at: res.data.updated_at ?? r.assessment?.updated_at,
                },
              }
            : r
        )
      );
    } catch (e) {
      // optional toast
    }
  };

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {meta?.name || "Framework"}
          </h1>
          {meta?.publisher ? (
            <p className="text-sm text-gray-600">Publisher: {meta.publisher}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {/* Export raw controls CSV */}
          <a
            href={`${API_BASE}/v1/frameworks/${encodeURIComponent(String(key))}/export/csv`}
            className="rounded border px-3 py-1.5 text-sm"
          >
            Export Controls CSV
          </a>
          {/* Export org-scoped assessment CSV */}
          <a
            href={`${API_BASE}/v1/frameworks/${encodeURIComponent(String(key))}/export/assessments.csv`}
            className="rounded border px-3 py-1.5 text-sm"
          >
            Export Assessments CSV
          </a>
          <Link href="/frameworks" className="rounded border px-3 py-1.5 text-sm">
            Back
          </Link>
        </div>
      </div>

      <Card>
        {err && <p className="mb-3 text-sm text-red-600">{err}</p>}
        {loading ? (
          <p className="text-sm text-gray-700">Loading…</p>
        ) : (
          <>
            {/* Filters */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {functionOptions.length > 0 && (
                <select
                  className="rounded border px-3 py-2 text-sm"
                  value={fn}
                  onChange={(e) => setFn(e.target.value)}
                >
                  <option value="any">Function: Any</option>
                  {functionOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              )}

              <select
                className="rounded border px-3 py-2 text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="any">Status: Any</option>
                {STATUS_OPTS.filter((s) => s.value).map((s) => (
                  <option key={s.value} value={s.value}>
                    Status: {s.label}
                  </option>
                ))}
              </select>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={mineOnly}
                  onChange={(e) => setMineOnly(e.target.checked)}
                />
                Assigned to me
              </label>

              <input
                className="w-full max-w-xs rounded border px-3 py-2 text-sm"
                placeholder="Search controls, owners, notes…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            {rows.length === 0 ? (
              <p className="text-sm text-gray-700">
                No controls found for this framework. If you recently added data, refresh the page.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-600">
                      <th className="py-2 pr-4">ID</th>
                      <th className="py-2 pr-4">Title</th>
                      {functionOptions.length > 0 && <th className="py-2 pr-4">Function</th>}
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Owner</th>
                      <th className="py-2 pr-4">Notes</th>
                      <th className="py-2 pr-4">Evidence links</th>
                      <th className="py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filtered.map((ctrl) => {
                      const a = ctrl.assessment || { control_id: ctrl.id };
                      const owner = userById(a.owner_user_id ?? undefined);

                      return (
                        <tr key={ctrl.id}>
                          <td className="py-2 pr-4 font-mono">{ctrl.id}</td>
                          <td className="py-2 pr-4 font-medium">{ctrl.title}</td>
                          {functionOptions.length > 0 && (
                            <td className="py-2 pr-4">{ctrl.function || "—"}</td>
                          )}
                          {/* Status quick save */}
                          <td className="py-2 pr-4">
                            <select
                              className="rounded border px-2 py-1"
                              value={a.status || ""}
                              onChange={(e) =>
                                quickSaveStatus(ctrl.id, (e.target.value || undefined) as Assessment["status"])
                              }
                            >
                              {STATUS_OPTS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          {/* Owner quick assign */}
                          <td className="py-2 pr-4">
                            <select
                              className="w-56 max-w-[18rem] truncate rounded border px-2 py-1"
                              value={a.owner_user_id ?? ""}
                              onChange={(e) =>
                                quickAssignOwner(
                                  ctrl.id,
                                  e.target.value === "" ? null : Number(e.target.value)
                                )
                              }
                            >
                              <option value="">Unassigned</option>
                              {users.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {userLabel(u)}
                                </option>
                              ))}
                            </select>
                          </td>
                          {/* Notes */}
                          <td className="py-2 pr-4">
                            <textarea
                              className="h-16 w-64 max-w-[28rem] rounded border px-2 py-1"
                              placeholder="Notes…"
                              value={draftNotes[ctrl.id] ?? ""}
                              onChange={(e) =>
                                setDraftNotes((d) => ({ ...d, [ctrl.id]: e.target.value }))
                              }
                            />
                          </td>
                          {/* Evidence */}
                          <td className="py-2 pr-4">
                            <input
                              className="w-64 max-w-[28rem] rounded border px-2 py-1"
                              placeholder="e.g. https://wiki/page, https://jira/PROJ-1"
                              value={draftEvidence[ctrl.id] ?? ""}
                              onChange={(e) =>
                                setDraftEvidence((d) => ({ ...d, [ctrl.id]: e.target.value }))
                              }
                            />
                            <div className="mt-1 text-[10px] text-gray-500">
                              Separate with commas or spaces
                            </div>
                          </td>
                          <td className="py-2">
                            <button
                              onClick={() => saveNotesEvidence(ctrl.id)}
                              className="rounded border px-2 py-1 text-xs"
                            >
                              Save
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>
    </AppShell>
  );
}
