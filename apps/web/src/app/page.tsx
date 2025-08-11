"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function Home() {
  const [status, setStatus] = useState("checking...");

  useEffect(() => {
    api.get("/health")
      .then((res) => setStatus(res.data.status))
      .catch((err) => setStatus(`error: ${err.message}`));
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="rounded-xl border p-6 shadow max-w-md">
        <h1 className="text-xl font-semibold">PolicyForge</h1>
        <p className="mt-2 text-sm text-gray-600">API Health: {status}</p>

        <Link
          href="/policies"
          className="mt-4 inline-block rounded bg-black px-4 py-2 text-white"
        >
          Go to Policies →
        </Link>
      </div>
    </main>
  );
}
