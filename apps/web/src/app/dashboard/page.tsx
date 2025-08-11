"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import Card from "@/components/Card";
import { api } from "@/lib/api";
import { Activity, FileText, PlusCircle, ArrowRight, CheckCircle, Clock, XCircle } from "lucide-react";

type Template = { key: string; title: string };
type DocumentOut = {
  id: number;
  title: string;
  template_key: string;
  status: string;
  created_at: string;
  updated_at: string;
  latest_version: number;
};
type ApprovalTotals = { pending: number; approved: number; rejected: number };

export default function Dashboard() {
  const [health, setHealth] = useState<string>("checking...");
  const [templateCount, setTemplateCount] = useState<number>(0);
  const [docCount, setDocCount] = useState<number>(0);
  const [approvals, setApprovals] = useState<ApprovalTotals>({ pending: 0, approved: 0, rejected: 0 });

  useEffect(() => {
    api.get("/health").then((r) => setHealth(r.data.status)).catch((e) => setHealth(`error: ${e.message}`));
    api.get<Template[]>("/v1/policies/templates").then((r) => setTemplateCount(r.data?.length || 0)).catch(() => {});
    api.get<DocumentOut[]>("/v1/documents").then((r) => setDocCount(r.data?.length || 0)).catch(() => {});
    api.get<ApprovalTotals>("/v1/documents/approvals/summary_all").then((r) => setApprovals(r.data)).catch(() => {});
  }, []);

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Policy Hub</h1>
          <p className="text-sm text-gray-600">Create, manage, and export policies. History and approvals coming soon.</p>
        </div>

        <div className="flex gap-2">
          <Link href="/policies" className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-white">
            <PlusCircle size={18} />
            New Policy
          </Link>
          <Link href="/documents" className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm">
            Documents
          </Link>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* System Health */}
        <Card title="System Health">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-gray-900">
              <Activity size={18} />
              <span>API</span>
            </div>
            <span className="rounded bg-gray-100 px-2 py-1 text-sm">{health}</span>
          </div>
        </Card>

        {/* Templates */}
        <Card title="Templates">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-gray-900">
              <FileText size={18} />
              <span>Available</span>
            </div>
            <span className="text-xl font-semibold">{templateCount}</span>
          </div>
          <div className="mt-3 text-right">
            <Link href="/policies" className="inline-flex items-center gap-1 text-sm text-gray-700 hover:underline">
              Browse templates <ArrowRight size={16} />
            </Link>
          </div>
        </Card>

        {/* Documents */}
        <Card title="Documents">
          <div className="flex items-center justify-between">
            <span>Total</span>
            <span className="text-xl font-semibold">{docCount}</span>
          </div>
          <div className="mt-3 text-right">
            <Link href="/documents" className="text-sm text-gray-700 hover:underline">
              Open documents →
            </Link>
          </div>
        </Card>
      </div>

      {/* Approvals */}
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card title="Approvals">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border p-4 text-center">
              <div className="mb-1 flex items-center justify-center gap-2 text-sm">
                <Clock size={16} />
                Pending
              </div>
              <div className="text-2xl font-semibold">{approvals.pending}</div>
            </div>
            <div className="rounded-lg border p-4 text-center">
              <div className="mb-1 flex items-center justify-center gap-2 text-sm">
                <CheckCircle size={16} />
                Approved
              </div>
              <div className="text-2xl font-semibold">{approvals.approved}</div>
            </div>
            <div className="rounded-lg border p-4 text-center">
              <div className="mb-1 flex items-center justify-center gap-2 text-sm">
                <XCircle size={16} />
                Rejected
              </div>
              <div className="text-2xl font-semibold">{approvals.rejected}</div>
            </div>
          </div>
          <div className="mt-3 text-right">
            <Link href="/documents" className="text-sm text-gray-700 hover:underline">
              Review requests →
            </Link>
          </div>
        </Card>

        {/* Roadmap */}
        <Card title="Roadmap">
          <ul className="space-y-2 text-sm">
            {/* Shipped */}
            <li className="flex items-center justify-between">
              <span>Versioning & Compare</span>
              <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">Shipped</span>
            </li>
            <li className="flex items-center justify-between">
              <span>Comments</span>
              <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">Shipped</span>
            </li>
            <li className="flex items-center justify-between">
              <span>DOCX Export</span>
              <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">Shipped</span>
            </li>

            {/* Next */}
            <li className="mt-2 flex items-center justify-between">
              <span>Approvals workflow</span>
              <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">Next</span>
            </li>
            <li className="flex items-center justify-between">
              <span>Auth (Google) + org scoping</span>
              <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">Next</span>
            </li>

            {/* Planned */}
            <li className="mt-2 flex items-center justify-between">
              <span>Search, tags & filters</span>
              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">Planned</span>
            </li>
            <li className="flex items-center justify-between">
              <span>Framework mappings (SOC 2, NIST, CIS)</span>
              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">Planned</span>
            </li>
          </ul>
        </Card>
      </div>
    </AppShell>
  );
}
