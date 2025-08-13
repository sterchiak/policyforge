// apps/web/src/app/frameworks/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Card from "@/components/Card";
import { api } from "@/lib/api";

type FrameworkSummary = {
  key: string;
  name: string;
  version: string;
  description: string;
  controls: number;
  tags: string[];
};

export default function FrameworksPage() {
  const [rows, setRows] = useState<FrameworkSummary[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get<FrameworkSummary[]>("/v1/frameworks")
      .then(r => setRows(Array.isArray(r.data) ? r.data : []))
      .catch(e => setErr(e?.response?.data?.detail || e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Frameworks</h1>
          <p className="text-sm text-gray-700">Browse supported frameworks and export control lists.</p>
        </div>
      </div>

      <Card>
        {err && <p className="mb-2 text-sm text-red-600">{err}</p>}
        {loading ? (
          <p className="text-sm text-gray-700">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-700">No frameworks available.</p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {rows.map(fw => (
              <li key={fw.key} className="rounded border p-3">
                <div className="mb-1 flex items-center justify-between">
                  <div className="font-medium text-gray-900">{fw.name}</div>
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">v{fw.version}</span>
                </div>
                <p className="text-sm text-gray-700">{fw.description}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded border bg-white px-2 py-0.5">{fw.controls} controls</span>
                  {fw.tags.map(t => (
                    <span key={t} className="rounded bg-gray-100 px-2 py-0.5">{t}</span>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Link href={`/frameworks/${fw.key}`} className="rounded border px-3 py-1.5 text-sm">
                    View controls
                  </Link>
                  <a
                    className="rounded border px-3 py-1.5 text-sm"
                    href={`${process.env.NEXT_PUBLIC_API_BASE || ""}/v1/frameworks/${fw.key}/export/csv`}
                  >
                    Export CSV
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}
