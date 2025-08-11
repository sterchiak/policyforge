"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";

type Template = { key: string; title: string };
type DraftResponse = { title: string; html: string };

type DocumentOut = {
  id: number;
  title: string;
  template_key: string;
  status: string;
  created_at: string;
  updated_at: string;
  latest_version: number;
};

type VersionOut = { id: number; version: number; created_at: string };

function getFilenameFromDisposition(disposition?: string, fallback = "policy.html") {
  if (!disposition) return fallback;
  const m = disposition.match(/filename="(.+?)"/i);
  return m?.[1] ?? fallback;
}

export default function PoliciesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);

  // form state
  const [templateKey, setTemplateKey] = useState("access_control_policy");
  const [orgName, setOrgName] = useState("Acme Corp");
  const [pwdLen, setPwdLen] = useState(14);
  const [mfaRoles, setMfaRoles] = useState("Admin");
  const [logDays, setLogDays] = useState(90);

  // ui state
  const [preview, setPreview] = useState<DraftResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // persistence state
  const [docId, setDocId] = useState<number | null>(null);
  const [latestVersion, setLatestVersion] = useState<number | null>(null);

  const isEditing = docId !== null;
  const search = useSearchParams();

  // load template list
  useEffect(() => {
    api
      .get<Template[]>("/v1/policies/templates")
      .then((r) => setTemplates(r.data))
      .catch((e) => setErr(e.message));
  }, []);

  // if opened with ?doc=ID&v=N, preload that saved version into the editor
  useEffect(() => {
    const doc = search.get("doc");
    const v = search.get("v");
    if (!doc) return;

    (async () => {
      try {
        const endpoint = v
          ? `/v1/documents/${doc}/versions/${v}`
          : `/v1/documents/${doc}/versions/latest`;
        const res = await api.get(endpoint);
        const data = res.data as any;

        // set form from saved params
        setTemplateKey(data.params.template_key);
        setOrgName(data.params.org_name);
        setPwdLen(data.params.password_min_length);
        setMfaRoles((data.params.mfa_required_roles || []).join(", "));
        setLogDays(data.params.log_retention_days);

        // preview from saved html
        setPreview({ title: `v${data.version}`, html: data.html });

        // persistence state
        setDocId(Number(doc));
        setLatestVersion(Number(data.version));
      } catch (e: any) {
        setErr(e?.response?.data?.detail || e.message);
      }
    })();
  }, [search]);

  const currentPayload = () => ({
    template_key: templateKey,
    org_name: orgName,
    password_min_length: pwdLen,
    mfa_required_roles: mfaRoles.split(",").map((s) => s.trim()).filter(Boolean),
    log_retention_days: logDays,
  });

  // generate preview (stub)
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const res = await api.post<DraftResponse>("/v1/policies/draft", currentPayload());
      setPreview(res.data);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  // download HTML
  const onDownloadHtml = async () => {
    setErr(null);
    setLoading(true);
    try {
      const res = await api.post("/v1/policies/export/html", currentPayload(), {
        responseType: "blob",
      });
      const blob = new Blob([res.data], { type: "text/html;charset=utf-8" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      const filename = getFilenameFromDisposition(
        res.headers["content-disposition"],
        `${templateKey}.html`
      );
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  // download PDF
  const onDownloadPdf = async () => {
    setErr(null);
    setLoading(true);
    try {
      const res = await api.post("/v1/policies/export/pdf", currentPayload(), {
        responseType: "blob",
      });
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      const filename = getFilenameFromDisposition(
        res.headers["content-disposition"],
        `${templateKey}.pdf`
      );
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  const onDownloadDocx = async () => {
  setErr(null);
  setLoading(true);
  try {
    const res = await api.post("/v1/policies/export/docx", currentPayload(), {
      responseType: "blob",
    });
    const blob = new Blob(
      [res.data],
      { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }
    );
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    const filename = getFilenameFromDisposition(
      res.headers["content-disposition"],
      `${templateKey}.docx`
    );
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    window.URL.revokeObjectURL(url);
  } catch (e: any) {
    setErr(e?.response?.data?.detail || e.message);
  } finally {
    setLoading(false);
  }
};

  // create document (v1) or, if editing, redirect to new version
  const onSaveDraft = async () => {
    if (isEditing) return onSaveNewVersion(); // safety net: treat Save as new version in edit mode
    setErr(null);
    setLoading(true);
    try {
      const res = await api.post<DocumentOut>("/v1/documents", currentPayload());
      setDocId(res.data.id);
      setLatestVersion(res.data.latest_version || 1);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  // add new version (v+1)
  const onSaveNewVersion = async () => {
    if (!docId) return;
    setErr(null);
    setLoading(true);
    try {
      const res = await api.post<VersionOut>(`/v1/documents/${docId}/versions`, currentPayload());
      setLatestVersion(res.data.version);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  // duplicate as a brand-new document (v1) even while in edit mode
  const onDuplicateAsNew = async () => {
    setErr(null);
    setLoading(true);
    try {
      const res = await api.post<DocumentOut>("/v1/documents", currentPayload());
      setDocId(res.data.id);
      setLatestVersion(res.data.latest_version || 1);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {isEditing ? "Edit Policy" : "Policies"}
          </h1>
          <p className="text-sm text-gray-800">
            {isEditing
              ? "You’re editing an existing document. Saving will create a new version."
              : "Fill parameters, preview the draft, and save versions."}
          </p>
        </div>
        {isEditing && (
          <span className="rounded-md border border-green-200 bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
            Doc #{docId}{typeof latestVersion === "number" ? ` • v${latestVersion}` : ""}
          </span>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Draft a Policy</h2>

          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium">Template</label>
              <select
                className="mt-1 w-full rounded border px-3 py-2 disabled:bg-gray-100 disabled:text-gray-500"
                value={templateKey}
                onChange={(e) => setTemplateKey(e.target.value)}
                disabled={isEditing}
              >
                {templates.map((t) => (
                  <option key={t.key} value={t.key}>{t.title}</option>
                ))}
              </select>
              {isEditing && (
                <p className="mt-1 text-xs text-gray-500">
                  Template is fixed for an existing document. Change requires duplicating.
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium">Organization Name</label>
              <input
                className="mt-1 w-full rounded border px-3 py-2"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium">Password Min Length</label>
                <input
                  type="number" min={8} max={128}
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={pwdLen}
                  onChange={(e) => setPwdLen(Number(e.target.value))}
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium">MFA Roles (comma-separated)</label>
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={mfaRoles}
                  onChange={(e) => setMfaRoles(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium">Log Retention (days)</label>
              <input
                type="number" min={7} max={3650}
                className="mt-1 w-full rounded border px-3 py-2"
                value={logDays}
                onChange={(e) => setLogDays(Number(e.target.value))}
              />
            </div>

            {err && <p className="text-sm text-red-600">{err}</p>}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={loading}
                className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
              >
                {loading ? "Generating…" : "Generate Draft"}
              </button>

              {isEditing ? (
                <>
                  <button
                    type="button"
                    onClick={onSaveNewVersion}
                    disabled={loading}
                    className="rounded border border-black px-4 py-2 text-black disabled:opacity-50"
                    title="Save a new version for this document"
                  >
                    Save New Version
                  </button>

                  <button
                    type="button"
                    onClick={onDuplicateAsNew}
                    disabled={loading}
                    className="rounded border px-4 py-2 text-black disabled:opacity-50"
                    title="Duplicate as a new document (v1)"
                  >
                    Duplicate as New Document
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onSaveDraft}
                  disabled={loading}
                  className="rounded border border-black px-4 py-2 text-black disabled:opacity-50"
                  title="Create a new document (version 1) in storage"
                >
                  Save Draft
                </button>
              )}

              <button
                type="button"
                onClick={onDownloadHtml}
                disabled={loading}
                className="rounded border border-black px-4 py-2 text-black disabled:opacity-50"
              >
                Download HTML
              </button>

              <button
                type="button"
                onClick={onDownloadPdf}
                disabled={loading}
                className="rounded border border-black px-4 py-2 text-black disabled:opacity-50"
              >
                Download PDF
              </button>
              <button
                type="button"
                onClick={onDownloadDocx}
                disabled={loading}
                className="rounded border border-black px-4 py-2 text-black disabled:opacity-50"
              >
                Download DOCX
              </button>

            </div>
          </form>
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Preview</h2>
          {!preview ? (
            <p className="mt-2 text-sm text-gray-700">No draft yet. Submit the form to see a preview.</p>
          ) : (
            <div className="prose mt-3 max-w-none" dangerouslySetInnerHTML={{ __html: preview.html }} />
          )}
        </section>
      </div>
    </AppShell>
  );
}
