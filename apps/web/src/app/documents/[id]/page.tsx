"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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

const STATUS_OPTS = ["draft", "in_review", "approved", "published"] as const;

export default function DocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const docId = Number(params.id);
  const router = useRouter();

  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [current, setCurrent] = useState<VersionDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // editable meta
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<typeof STATUS_OPTS[number]>("draft");

  const latestVersion = useMemo(() => doc?.latest_version ?? null, [doc]);

  // load document + latest version
  useEffect(() => {
    if (!docId) return;
    api.get<DocumentDetail>(`/v1/documents/${docId}`)
      .then(r => {
        setDoc(r.data);
        setTitle(r.data.title);
        setStatus((r.data.status as any) || "draft");
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

  const onDownloadDocx = async () => {
  if (!current) return;
  setErr(null);
  setLoading(true);
  try {
    const res = await api.post("/v1/policies/export/docx", current.params, { responseType: "blob" });
    const blob = new Blob(
      [res.data],
      { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }
    );
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    const filename = getFilenameFromDisposition(
      res.headers["content-disposition"],
      `${doc?.title}.docx`
    );
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
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
      const res = await api.patch<DocumentDetail>(`/v1/documents/${doc.id}`, { title, status });
      // quick refresh of doc meta
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
      // reload doc + maybe change current
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
      const res = await api.post(`/v1/documents/${docId}/versions/${v}/rollback`, {});
      // load the newly created latest version
      const vres = await api.get<VersionDetail>(`/v1/documents/${docId}/versions/${(res.data as any).version}`);
      setCurrent(vres.data);
      // refresh doc meta
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
            <div className="flex items-center gap-2">
              <Link href="/documents" className="rounded border px-3 py-1 text-sm">Back to Documents</Link>
              <button onClick={onDeleteDoc} className="rounded border border-red-600 px-3 py-1 text-sm text-red-700">
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
            />
            <select
              className="rounded border px-3 py-2"
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
            >
              {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="md:col-span-2">
              <button onClick={onSaveMeta} className="rounded bg-black px-4 py-2 text-white">Save Changes</button>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-[260px_1fr]">
            <Card title="Versions">
              <div className="space-y-2">
                {doc.versions.map(v => (
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
                      className="rounded border px-2 py-1 text-xs"
                      title="Create new version from this"
                    >
                      Rollback
                    </button>
                    <button
                      onClick={() => onDeleteVersion(v.version)}
                      className="rounded border border-red-600 px-2 py-1 text-xs text-red-700"
                      title="Delete version"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </Card>

            <Card title={`Preview ${current ? `(v${current.version})` : ""}`}>
              {err && <p className="mb-3 text-sm text-red-600">{err}</p>}
              {!current ? (
                <p className="text-sm text-gray-700">Select a version to preview.</p>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap gap-2">
                    <button onClick={() => onOpenInEditor()} className="rounded border px-3 py-1.5 text-sm">
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
