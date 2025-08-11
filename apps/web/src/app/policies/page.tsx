"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Card from "@/components/Card";
import { api } from "@/lib/api";

type Template = { key: string; title: string };

type DraftParams = {
  template_key: string;
  org_name: string;
  password_min_length: number;
  mfa_required_roles: string[];
  log_retention_days: number;
};

type DraftResponse = { title: string; html: string };

function getFilenameFromDisposition(disposition?: string, fallback = "policy.html") {
  if (!disposition) return fallback;
  const m = disposition.match(/filename="(.+?)"/i);
  return m?.[1] ?? fallback;
}

export default function PoliciesPage() {
  const router = useRouter();
  const qp = useSearchParams();
  const docId = qp.get("doc"); // when opened from "Open in editor" on a document
  const versionParam = qp.get("v");

  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateKey, setTemplateKey] = useState("");
  const [orgName, setOrgName] = useState("Acme Corp");
  const [pwdLen, setPwdLen] = useState(14);
  const [mfaRolesText, setMfaRolesText] = useState("Admin");
  const [retention, setRetention] = useState(90);

  const [preview, setPreview] = useState<DraftResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const mfaRoles = useMemo(
    () =>
      mfaRolesText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    [mfaRolesText]
  );

  // Load templates and set default
  useEffect(() => {
    api
      .get<Template[]>("/v1/policies/templates")
      .then((r) => {
        setTemplates(r.data);
        if (!templateKey && r.data.length) setTemplateKey(r.data[0].key);
      })
      .catch(() => setTemplates([]));
  }, []);

  const makeParams = (): DraftParams => ({
    template_key: templateKey,
    org_name: orgName,
    password_min_length: Number(pwdLen) || 14,
    mfa_required_roles: mfaRoles,
    log_retention_days: Number(retention) || 90,
  });

  const refreshPreview = async () => {
    setErr(null);
    setLoading(true);
    try {
      const r = await api.post<DraftResponse>("/v1/policies/draft", makeParams());
      setPreview(r.data);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  const onDownload = async (kind: "html" | "pdf" | "docx") => {
    if (!preview) await refreshPreview();
    setErr(null);
    setLoading(true);
    try {
      const endpoint =
        kind === "html"
          ? "/v1/policies/export/html"
          : kind === "pdf"
          ? "/v1/policies/export/pdf"
          : "/v1/policies/export/docx";
      const res = await api.post(endpoint, makeParams(), { responseType: "blob" });
      const blob =
        kind === "pdf"
          ? new Blob([res.data], { type: "application/pdf" })
          : kind === "docx"
          ? new Blob([res.data], {
              type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            })
          : new Blob([res.data], { type: "text/html;charset=utf-8" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      const fallback =
        (preview?.title || "Policy") + (kind === "pdf" ? ".pdf" : kind === "docx" ? ".docx" : ".html");
      a.href = url;
      a.download = getFilenameFromDisposition(res.headers["content-disposition"], fallback);
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

  // Save: if we have ?doc=ID → new version on that doc; else create a new document then first version
  const onSave = async () => {
    setErr(null);
    setLoading(true);
    try {
      const params = makeParams();
      if (docId) {
        await api.post(`/v1/documents/${docId}/versions`, params);
        router.push(`/documents/${docId}`);
      } else {
        // create doc, then first version
        const create = await api.post<{ id: number }>(`/v1/documents`, {
          template_key: params.template_key,
          title: preview?.title || params.template_key.replace(/_/g, " ").toUpperCase(),
        });
        const id = create.data.id;
        await api.post(`/v1/documents/${id}/versions`, params);
        router.push(`/documents/${id}`);
      }
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  // Ensure we have an initial preview when template list loads
  useEffect(() => {
    if (templateKey) refreshPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateKey]);

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Policies</h1>
          <p className="text-sm text-gray-700">Start from a template, tweak parameters, then save or export.</p>
        </div>
        <Link href="/documents" className="rounded border px-4 py-2 text-sm text-gray-900 hover:bg-gray-100">
          Documents
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-[320px_1fr]">
        {/* Left: form */}
        <Card title="Template & Parameters">
          <div className="space-y-3 text-gray-900">
            <label className="block text-sm">
              <span className="mb-1 block text-gray-700">Template</span>
              <select
                className="w-full rounded border px-3 py-2"
                value={templateKey}
                onChange={(e) => setTemplateKey(e.target.value)}
              >
                {templates.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-gray-700">Organization</span>
              <input
                className="w-full rounded border px-3 py-2"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-gray-700">Password length</span>
                <input
                  type="number"
                  className="w-full rounded border px-3 py-2"
                  value={pwdLen}
                  onChange={(e) => setPwdLen(Number(e.target.value))}
                  min={8}
                  max={128}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-gray-700">Log retention (days)</span>
                <input
                  type="number"
                  className="w-full rounded border px-3 py-2"
                  value={retention}
                  onChange={(e) => setRetention(Number(e.target.value))}
                  min={7}
                  max={3650}
                />
              </label>
            </div>

            <label className="block text-sm">
              <span className="mb-1 block text-gray-700">MFA required roles (comma-separated)</span>
              <input
                className="w-full rounded border px-3 py-2"
                value={mfaRolesText}
                onChange={(e) => setMfaRolesText(e.target.value)}
                placeholder="Admin, Finance, ..."
              />
            </label>

            {err && <p className="text-sm text-red-600">{err}</p>}

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                onClick={refreshPreview}
                disabled={loading}
                className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Update Preview
              </button>
              <button onClick={onSave} disabled={loading} className="rounded bg-black px-3 py-1.5 text-sm text-white">
                {docId ? "Save Version" : "Save Document"}
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <button onClick={() => onDownload("html")} className="rounded border px-3 py-1.5 text-sm">
                Download HTML
              </button>
              <button onClick={() => onDownload("pdf")} className="rounded border px-3 py-1.5 text-sm">
                Download PDF
              </button>
              <button onClick={() => onDownload("docx")} className="rounded border px-3 py-1.5 text-sm">
                Download DOCX
              </button>
            </div>
          </div>
        </Card>

        {/* Right: preview */}
        <Card title="Preview">
          {!preview ? (
            <p className="text-sm text-gray-700">No preview yet.</p>
          ) : (
            <div
              className="prose max-w-none prose-headings:text-gray-900 prose-p:text-gray-900"
              dangerouslySetInnerHTML={{ __html: preview.html }}
            />
          )}
        </Card>
      </div>
    </AppShell>
  );
}
