"use client";

import { useEffect, useState } from "react";
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

export default function DocumentsPage() {
  const [docs, setDocs] = useState<DocumentOut[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<DocumentOut[]>("/v1/documents")
      .then(r => setDocs(r.data))
      .catch(e => setErr(e.message));
  }, []);

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Documents</h1>
        <Link href="/policies" className="rounded bg-black px-4 py-2 text-white">New Policy</Link>
      </div>

      <Card>
        {err && <p className="text-sm text-red-600">{err}</p>}
        {docs.length === 0 ? (
          <p className="text-sm text-gray-700">No documents yet. Create one from the Policies page.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600">
                  <th className="py-2">Title</th>
                  <th className="py-2">Template</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Latest</th>
                  <th className="py-2">Updated</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {docs.map(d => (
                  <tr key={d.id}>
                    <td className="py-2">{d.title}</td>
                    <td className="py-2">{d.template_key}</td>
                    <td className="py-2">{d.status}</td>
                    <td className="py-2">{d.latest_version}</td>
                    <td className="py-2">{new Date(d.updated_at).toLocaleString()}</td>
                    <td className="py-2">
                      <Link href="/policies" className="rounded border px-2 py-1">Open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AppShell>
  );
}
