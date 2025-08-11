"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Template = { key: string; title: string };
type DraftResponse = { title: string; html: string };

export default function PoliciesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateKey, setTemplateKey] = useState("access_control_policy");
  const [orgName, setOrgName] = useState("Acme Corp");
  const [pwdLen, setPwdLen] = useState(14);
  const [mfaRoles, setMfaRoles] = useState("Admin");
  const [logDays, setLogDays] = useState(90);
  const [preview, setPreview] = useState<DraftResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<Template[]>("/v1/policies/templates")
      .then(r => setTemplates(r.data))
      .catch(e => setErr(e.message));
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const res = await api.post<DraftResponse>("/v1/policies/draft", {
        template_key: templateKey,
        org_name: orgName,
        password_min_length: pwdLen,
        mfa_required_roles: mfaRoles.split(",").map(s => s.trim()).filter(Boolean),
        log_retention_days: logDays,
      });
      setPreview(res.data);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-5xl grid gap-6 md:grid-cols-2">
        <section className="rounded-2xl border p-5 shadow-sm">
          <h1 className="text-xl font-semibold">Draft a Policy (MVP stub)</h1>
          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium">Template</label>
              <select
                className="mt-1 w-full rounded border px-3 py-2"
                value={templateKey}
                onChange={(e) => setTemplateKey(e.target.value)}
              >
                {templates.map(t => (
                  <option key={t.key} value={t.key}>{t.title}</option>
                ))}
              </select>
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

            <button
              type="submit"
              disabled={loading}
              className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
            >
              {loading ? "Generating…" : "Generate Draft"}
            </button>
          </form>
        </section>

        <section className="rounded-2xl border p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Preview</h2>
          {!preview ? (
            <p className="mt-2 text-sm text-gray-600">No draft yet. Submit the form to see a preview.</p>
          ) : (
            <div className="prose mt-3 max-w-none" dangerouslySetInnerHTML={{ __html: preview.html }} />
          )}
        </section>
      </div>
    </main>
  );
}
