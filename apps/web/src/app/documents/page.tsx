"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Card from "@/components/Card";
import { api } from "@/lib/api";

type DocumentOut = {
  id: number;
  title: string;
  template_key: string;
  status: string;
  created_at: string;
  updated_at: string;
  latest_version: number;
};

type DocApprovalSummary = {
  document_id: number;
  pending: number;
  approved: number;
  rejected: number;
};

type ApprovalFilter = "any" | "needs_review" | "approved" | "rejected" | "no_activity";
type SortKey = "updated_at" | "title";
type SortDir = "desc" | "asc";

export default function DocumentsPage() {
  const [docs, setDocs] = useState<DocumentOut[]>([]);
  const [byDoc, setByDoc] = useState<Record<number, DocApprovalSummary>>({});
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // filters
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("any"); // any | draft | in_review | approved | published | rejected
  const [approval, setApproval] = useState<ApprovalFilter>("any");
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<DocumentOut[]>("/v1/documents"),
      api.get<DocApprovalSummary[]>("/v1/documents/approvals/summary_by_doc"),
    ])
      .then(([dDocs, dSum]) => {
        setDocs(dDocs.data || []);
        const map: Record<number, DocApprovalSummary> = {};
        (dSum.data || []).forEach((r) => (map[r.document_id] = r));
        setByDoc(map);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const qNorm = q.trim().toLowerCase();
    const matchSearch = (d: DocumentOut) =>
      !qNorm ||
      d.title.toLowerCase().includes(qNorm) ||
      String(d.id).includes(qNorm) ||
      d.template_key.toLowerCase().includes(qNorm);

    const matchStatus = (d: DocumentOut) => status === "any" || d.status === status;

    const matchApproval = (d: DocumentOut) => {
      const a = byDoc[d.id] || { pending: 0, approved: 0, rejected: 0 };
      switch (approval) {
        case "any":
          return true;
        case "needs_review":
          return a.pending > 0;
        case "approved":
          return a.approved > 0 && a.pending === 0;
        case "rejected":
          return a.rejected > 0 && a.pending === 0;
        case "no_activity":
          return a.pending === 0 && a.approved === 0 && a.rejected === 0;
        default:
          return true;
      }
    };

    const rows = docs.filter((d) => matchSearch(d) && matchStatus(d) && matchApproval(d));

    rows.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "updated_at") {
        cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      } else if (sortKey === "title") {
        cmp = a.title.localeCompare(b.title);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return rows;
  }, [docs, byDoc, q, status, approval, sortKey, sortDir]);

  const resetFilters = () => {
    setQ("");
    setStatus("any");
    setApproval("any");
    setSortKey("updated_at");
    setSortDir("desc");
  };

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between text-gray-900">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Documents</h1>
          <p className="text-sm text-gray-700">All policy documents with latest version and approvals status.</p>
        </div>
        <Link href="/policies" className="rounded bg-black px-4 py-2 text-white">
          New Policy
        </Link>
      </div>

      {/* Filters */}
      <Card>
        <div className="grid gap-3 md:grid-cols-5">
          <input
            className="rounded border px-3 py-2 text-sm md:col-span-2"
            placeholder="Search title, ID, or template…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <select
            className="rounded border px-3 py-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            title="Document status"
          >
            <option value="any">Status: Any</option>
            <option value="draft">Status: draft</option>
            <option value="in_review">Status: in_review</option>
            <option value="approved">Status: approved</option>
            <option value="published">Status: published</option>
            <option value="rejected">Status: rejected</option>
          </select>

          <select
            className="rounded border px-3 py-2 text-sm"
            value={approval}
            onChange={(e) => setApproval(e.target.value as ApprovalFilter)}
            title="Approvals filter"
          >
            <option value="any">Approvals: Any</option>
            <option value="needs_review">Approvals: Needs review (pending &gt; 0)</option>
            <option value="approved">Approvals: Approved (no pending)</option>
            <option value="rejected">Approvals: Rejected (no pending)</option>
            <option value="no_activity">Approvals: No activity</option>
          </select>

          <div className="flex items-center gap-2">
            <select
              className="w-full rounded border px-3 py-2 text-sm"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              title="Sort by"
            >
              <option value="updated_at">Sort: Updated</option>
              <option value="title">Sort: Title</option>
            </select>
            <select
              className="w-full rounded border px-3 py-2 text-sm"
              value={sortDir}
              onChange={(e) => setSortDir(e.target.value as SortDir)}
              title="Direction"
            >
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </select>
          </div>

          <div className="md:col-span-5 text-right">
            <button onClick={resetFilters} className="rounded border px-3 py-1.5 text-sm">
              Reset
            </button>
          </div>
        </div>
      </Card>

      {/* Table */}
      <div className="mt-4">
        <Card>
          {err && <p className="mb-3 text-sm text-red-600">{err}</p>}
          {loading ? (
            <p className="text-sm text-gray-700">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-700">No matching documents.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="py-2 pr-4">Title</th>
                    <th className="py-2 pr-4">Template</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Latest</th>
                    <th className="py-2 pr-4">Updated</th>
                    <th className="py-2 pr-4">Approvals</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((d) => {
                    const a = byDoc[d.id] || { document_id: d.id, pending: 0, approved: 0, rejected: 0 };
                    return (
                      <tr key={d.id}>
                        <td className="py-2 pr-4">
                          <div className="font-medium">{d.title}</div>
                          <div className="text-xs text-gray-500">#{d.id}</div>
                        </td>
                        <td className="py-2 pr-4">{d.template_key}</td>
                        <td className="py-2 pr-4">
                          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">{d.status}</span>
                        </td>
                        <td className="py-2 pr-4">v{d.latest_version}</td>
                        <td className="py-2 pr-4">{new Date(d.updated_at).toLocaleString()}</td>
                        <td className="py-2 pr-4">
                          <div className="flex flex-wrap gap-1">
                            <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">
                              pending: {a.pending}
                            </span>
                            <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">
                              approved: {a.approved}
                            </span>
                            <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">
                              rejected: {a.rejected}
                            </span>
                          </div>
                        </td>
                        <td className="py-2">
                          <div className="flex gap-2">
                            <Link href={`/documents/${d.id}`} className="rounded border px-2 py-1">
                              Open
                            </Link>
                            <Link
                              href={`/policies?doc=${d.id}&v=${d.latest_version}`}
                              className="rounded border px-2 py-1"
                            >
                              Edit
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
