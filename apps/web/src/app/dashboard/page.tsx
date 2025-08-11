"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import Card from "@/components/Card";
import { api } from "@/lib/api";
import { ArrowRight, PlusCircle, FileText, Activity } from "lucide-react";

function HealthBadge({ status }: { status: string }) {
  const ok = status?.toLowerCase() === "ok";
  const cls = ok
    ? "bg-green-100 text-green-700 border-green-200"
    : "bg-amber-100 text-amber-800 border-amber-200";
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status || "unknown"}
    </span>
  );
}

export default function Dashboard() {
  const [health, setHealth] = useState<string>("checking...");
  const [templateCount, setTemplateCount] = useState<number>(0);

  useEffect(() => {
    api.get("/health")
      .then((r) => setHealth(r.data.status))
      .catch((e) => setHealth(`error: ${e.message}`));
    api.get("/v1/policies/templates")
      .then((r) => setTemplateCount(Array.isArray(r.data) ? r.data.length : 0))
      .catch(() => setTemplateCount(0));
  }, []);

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Policy Hub</h1>
          <p className="text-sm text-gray-800">
            Create, manage, and export policies. History and approvals coming soon.
          </p>
        </div>

        <Link
          href="/policies"
          className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-white"
        >
          <PlusCircle size={18} />
          New Policy
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card title="System Health">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-gray-900">
              <Activity size={18} />
              <span>API</span>
            </div>
            <HealthBadge status={health} />
          </div>
        </Card>

        <Card title="Templates">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-gray-900">
              <FileText size={18} />
              <span>Available</span>
            </div>
            <span className="text-2xl font-bold text-gray-900">{templateCount}</span>
          </div>
          <div className="mt-3 text-right">
            <Link
              href="/policies"
              className="inline-flex items-center gap-1 text-sm text-gray-900 hover:underline"
            >
              Browse templates <ArrowRight size={16} />
            </Link>
          </div>
        </Card>

        <Card title="Coming Soon">
          <ul className="list-inside list-disc text-sm text-gray-900">
            <li>Version History & Approvals</li>
            <li>DOCX Export</li>
            <li>Framework Coverage (NIST, CIS, SOC 2)</li>
          </ul>
        </Card>
      </div>
    </AppShell>
  );
}
