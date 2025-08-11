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

export default function DocumentsPage() {
  const [docs, setDocs] = useState<DocumentOut[]>([]);
  const [byDoc, setByDoc] = useState<Record<number, DocApprovalSummary>>({});
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  const rows = useMemo(() => docs, [docs]);

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Documents</h1>
          <p className="text-sm text-gray-600">All policy documents with latest version and approvals status.</p>
        </div>
        <Link href="/policies" className="rounded bg-black px-4 py-2 text-white">
          New Policy
        </Link>
      </div>

      <Card>
        {err && <p className="mb-3 text-sm text-red-600">{err}</p>}
        {loading ? (
          <p className="text-sm text-gray-700">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-700">No documents yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600">
                  <th className="py-2 pr-4">Title</th>
                  <th className="py-2 pr-4">Template</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Latest</th>
                  <th className="py-2 pr-4">Approvals</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((d) => {
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
                          <Link href={`/policies?doc=${d.id}&v=${d.latest_version}`} className="rounded border px-2 py-1">
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
    </AppShell>
  );
}
