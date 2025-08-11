"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Card from "@/components/Card";
import { api } from "@/lib/api";

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

function getFilenameFromDisposition(disposition?: string, fallback = "policy.html") {
  if (!disposition) return fallback;
  const m = disposition.match(/filename="(.+?)"/i);
  return m?.[1] ?? fallback;
}

export default function DocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const docId = Number(params.id);
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [current, setCurrent] = useState<VersionDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // load document metadata + versions
  useEffect(() => {
    if (!docId) return;
    api.get<DocumentDetail>(`/v1/documents/${docId}`)
      .then(r => {
        setDoc(r.data);
        const latest = r.data.latest_version || (r.data.versions.at(-1)?.version ?? 1);
        return api.get<VersionDetail>(`/v1/documents/${docId}/versions/${latest}`);
      })
      .then(r => setCurrent(r.data))
      .catch(e => setErr(e.message));
  }, [docId]);

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
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
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
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
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
                Doc #{doc.id} • Template: {doc.template_key} • Updated {new Date(doc.updated_at).toLocaleString()}
              </p>
            </div>
            <Link href="/documents" className="rounded border px-3 py-1 text-sm">Back to Documents</Link>
          </div>

          <div className="grid gap-6 md:grid-cols-[260px_1fr]">
            <Card title="Versions">
              <div className="space-y-2">
                {doc.versions.map(v => (
                  <button
                    key={v.id}
                    onClick={() => loadVersion(v.version)}
                    className={`w-full rounded border px-3 py-2 text-left text-sm ${
                      current?.version === v.version ? "border-black" : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    v{v.version} • {new Date(v.created_at).toLocaleString()}
                  </button>
                ))}
              </div>
            </Card>

            <Card title={`Preview ${current ? `(v${current.version})` : ""}`}>
              {err && <p className="mb-3 text-sm text-red-600">{err}</p>}
              {!current ? (
                <p className="text-sm text-gray-700">Select a version to preview.</p>
              ) : (
                <>
                  <div className="mb-3 flex gap-2">
                    <button
                      onClick={onDownloadHtml}
                      disabled={loading}
                      className="rounded border border-black px-3 py-1.5 text-sm"
                    >
                      Download HTML
                    </button>
                    <button
                      onClick={onDownloadPdf}
                      disabled={loading}
                      className="rounded border border-black px-3 py-1.5 text-sm"
                    >
                      Download PDF
                    </button>
                  </div>
                  <div
                    className="prose max-w-none"
                    dangerouslySetInnerHTML={{ __html: current.html }}
                  />
                </>
              )}
            </Card>
          </div>
        </>
      )}
    </AppShell>
  );
}
