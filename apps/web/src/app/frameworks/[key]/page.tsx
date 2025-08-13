// apps/web/src/app/frameworks/[key]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
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
  function?: string; // supports NIST CSF (ID/PR/DE/RS/RC) when present
};

type Framework = {
  key: string;
  name: string;
  version?: string;
  description?: string;
  tags?: string[];
  controls?: RawControl[] | Record<string, RawControl>;
};

// normalize one control
function toControl(rc: any): Control {
  const id =
    rc?.id ?? rc?.control_id ?? rc?.number ?? rc?.ref ?? rc?.key ?? String(rc?.uid ?? "");
  const title = rc?.title ?? rc?.name ?? rc?.statement ?? rc?.summary ?? String(id || "");
  return {
    id: String(id || ""),
    title: String(title || ""),
    description: rc?.description ?? rc?.text ?? rc?.details ?? undefined,
    family: rc?.family ?? rc?.domain ?? rc?.group ?? undefined,
    category: rc?.category ?? rc?.subcategory ?? undefined,
    function: rc?.function ?? rc?.fn ?? undefined,
  };
}

// normalize array or object map → Control[]
function normalizeControls(raw: Framework["controls"]): Control[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(toControl).filter((c) => c.id);
  if (typeof raw === "object") return Object.values(raw).map(toControl).filter((c) => c.id);
  return [];
}

export default function FrameworkDetailPage() {
  const params = useParams<{ key: string }>();
  const key = params?.key;

  const [fw, setFw] = useState<Framework | null>(null);
  const [controls, setControls] = useState<Control[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [fn, setFn] = useState<string>("any"); // function filter, if data provides one

  useEffect(() => {
    if (!key) return;
    setLoading(true);
    setErr(null);
    api
      .get<Framework>(`/v1/frameworks/${key}`)
      .then((r) => {
        const f = r.data;
        setFw(f);
        setControls(normalizeControls(f.controls));
      })
      .catch((e: any) => setErr(e?.response?.data?.detail || e.message))
      .finally(() => setLoading(false));
  }, [key]);

  // discover available function values (e.g., ID/PR/DE/RS/RC for NIST CSF)
  const functionOptions = useMemo(() => {
    const set = new Set<string>();
    controls.forEach((c) => {
      if (c.function && c.function.trim()) set.add(c.function.trim());
    });
    return Array.from(set).sort();
  }, [controls]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return controls.filter((c) => {
      const hay = `${c.id} ${c.title} ${c.description || ""} ${c.family || ""} ${c.category || ""} ${c.function || ""}`.toLowerCase();
      const matchSearch = !needle || hay.includes(needle);
      const matchFn =
        functionOptions.length === 0 || fn === "any" || (c.function || "").toLowerCase() === fn.toLowerCase();
      return matchSearch && matchFn;
    });
  }, [controls, q, fn, functionOptions.length]);

  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {fw?.name || "Framework"}{" "}
            {fw?.version ? (
              <span className="align-middle text-sm font-normal text-gray-600">v{fw.version}</span>
            ) : null}
          </h1>
          {fw?.description ? (
            <p className="max-w-3xl text-sm text-gray-700">{fw.description}</p>
          ) : null}
          {(fw?.tags ?? []).length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {(fw?.tags ?? []).map((t) => (
                <span key={t} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {/* Use anchor to hit API directly; avoids Next.js 404 on /v1 route */}
          <a
            href={`${API_BASE}/v1/frameworks/${encodeURIComponent(String(key))}/export/csv`}
            className="rounded border px-3 py-1.5 text-sm"
          >
            Export CSV
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
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-gray-700">
                {controls.length} controls
                {filtered.length !== controls.length ? (
                  <span className="ml-1 text-gray-500">({filtered.length} shown)</span>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {functionOptions.length > 0 && (
                  <select
                    className="rounded border px-3 py-2 text-sm"
                    value={fn}
                    onChange={(e) => setFn(e.target.value)}
                    title="Filter by function"
                  >
                    <option value="any">Function: Any</option>
                    {functionOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  className="w-full max-w-xs rounded border px-3 py-2 text-sm"
                  placeholder="Search controls…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
            </div>

            {controls.length === 0 ? (
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
                      <th className="py-2 pr-4">Family</th>
                      <th className="py-2 pr-4">Category</th>
                      <th className="py-2">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filtered.map((ctrl) => (
                      <tr key={ctrl.id}>
                        <td className="py-2 pr-4 font-mono">{ctrl.id}</td>
                        <td className="py-2 pr-4 font-medium">{ctrl.title}</td>
                        {functionOptions.length > 0 && (
                          <td className="py-2 pr-4">{ctrl.function || "—"}</td>
                        )}
                        <td className="py-2 pr-4">{ctrl.family || "—"}</td>
                        <td className="py-2 pr-4">{ctrl.category || "—"}</td>
                        <td className="py-2">
                          <div className="max-w-3xl text-gray-900">{ctrl.description || "—"}</div>
                        </td>
                      </tr>
                    ))}
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
