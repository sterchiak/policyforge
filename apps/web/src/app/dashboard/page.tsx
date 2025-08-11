"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import Card from "@/components/Card";
import { api } from "@/lib/api";
import { Activity, FileText } from "lucide-react";

type ApprovalsSummary = { pending: number; approved: number; rejected: number };

export default function Dashboard() {
  const [health, setHealth] = useState<"ok" | "error" | "checking...">("checking...");
  const [templateCount, setTemplateCount] = useState<number>(0);
  const [docCount, setDocCount] = useState<number>(0);
  const [approvals, setApprovals] = useState<ApprovalsSummary>({ pending: 0, approved: 0, rejected: 0 });

  useEffect(() => {
    // API health
    api
      .get("/health")
      .then((r) => setHealth(r.data.status === "ok" ? "ok" : "error"))
      .catch(() => setHealth("error"));

    // Template count
    api
      .get("/v1/policies/templates")
      .then((r) => setTemplateCount(Array.isArray(r.data) ? r.data.length : 0))
      .catch(() => setTemplateCount(0));

    // Documents count
    api
      .get("/v1/documents")
      .then((r) => setDocCount(Array.isArray(r.data) ? r.data.length : 0))
      .catch(() => setDocCount(0));

    // Approvals summary (latest-version aware)
    api
      .get<ApprovalsSummary>("/v1/documents/approvals/summary_all", { params: { scope: "latest" } })
      .then((r) => setApprovals(r.data))
      .catch(() => setApprovals({ pending: 0, approved: 0, rejected: 0 }));
  }, []);

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Policy Hub</h1>
          <p className="text-sm text-gray-700">
            Create, manage, and export policies. History and approvals coming soon.
          </p>
        </div>

        <div className="flex gap-2">
          <Link
            href="/policies"
            className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-white"
          >
            + New Policy
          </Link>
          <Link
            href="/documents"
            className="inline-flex items-center rounded-lg border px-4 py-2 text-sm text-gray-900 hover:bg-gray-100"
          >
            Documents
          </Link>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* System Health */}
        <Card title="System Health">
          <div className="flex items-center justify-between text-gray-900">
            <div className="flex items-center gap-2">
              <Activity size={18} />
              <span>API</span>
            </div>
            <span
              className={`rounded px-2 py-0.5 text-sm ${
                health === "ok"
                  ? "bg-green-100 text-green-700"
                  : health === "error"
                  ? "bg-red-100 text-red-700"
                  : "bg-gray-100 text-gray-700"
              }`}
            >
              {health}
            </span>
          </div>
        </Card>

        {/* Templates */}
        <Card title="Templates">
          <div className="flex items-center justify-between text-gray-900">
            <div className="flex items-center gap-2">
              <FileText size={18} />
              <span>Available</span>
            </div>
            <span className="text-xl font-semibold">{templateCount}</span>
          </div>
          <div className="mt-3 text-right">
            <Link href="/policies" className="inline-flex items-center gap-1 text-sm text-gray-900 hover:underline">
              Browse templates →
            </Link>
          </div>
        </Card>

        {/* Documents */}
        <Card title="Documents">
          <div className="flex items-center justify-between text-gray-900">
            <span>Total</span>
            <span className="text-xl font-semibold">{docCount}</span>
          </div>
          <div className="mt-3 text-right">
            <Link href="/documents" className="inline-flex items-center gap-1 text-sm text-gray-900 hover:underline">
              Open documents →
            </Link>
          </div>
        </Card>
      </div>

      {/* Approvals + Roadmap */}
      <div className="mt-6 grid gap-6 md:grid-cols-3">
        <Card title="Approvals (latest version)">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border bg-white p-4 text-center">
              <div className="text-sm text-gray-600">Pending</div>
              <div className="text-2xl font-semibold text-gray-900">{approvals.pending}</div>
            </div>
            <div className="rounded-lg border bg-white p-4 text-center">
              <div className="text-sm text-gray-600">Approved</div>
              <div className="text-2xl font-semibold text-gray-900">{approvals.approved}</div>
            </div>
            <div className="rounded-lg border bg-white p-4 text-center">
              <div className="text-sm text-gray-600">Rejected</div>
              <div className="text-2xl font-semibold text-gray-900">{approvals.rejected}</div>
            </div>
          </div>
          <div className="mt-3 text-right">
            <Link href="/documents" className="inline-flex items-center gap-1 text-sm text-gray-900 hover:underline">
              Review requests →
            </Link>
          </div>
        </Card>

        <Card title="Roadmap">
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between">
              <span className="text-gray-900">Versioning & Compare</span>
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-700">Shipped</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-gray-900">Comments</span>
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-700">Shipped</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-gray-900">DOCX Export</span>
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-700">Shipped</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-gray-900">Approvals workflow</span>
              <span className="rounded bg-indigo-100 px-2 py-0.5 text-indigo-700">Live</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-gray-900">Auth (Google) + org scoping</span>
              <span className="rounded bg-indigo-100 px-2 py-0.5 text-indigo-700">Next</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-gray-900">Search, tags & filters</span>
              <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-700">Planned</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-gray-900">Framework mappings (SOC 2, NIST, CIS)</span>
              <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-700">Planned</span>
            </li>
          </ul>
        </Card>

        <div />
      </div>
    </AppShell>
  );
}
