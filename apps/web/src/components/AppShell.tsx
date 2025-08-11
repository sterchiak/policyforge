"use client";

import Link from "next/link";
import Sidebar from "./Sidebar";
import { useSession, signIn, signOut } from "next-auth/react";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 text-gray-900">{/* <-- ensure strong text here */}
        <header className="sticky top-0 z-10 border-b bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-semibold text-gray-900">{/* <-- force dark */}
              PolicyForge
            </Link>
            <div className="flex items-center gap-2">
              {status === "loading" ? (
                <span className="text-xs text-gray-500">…</span>
              ) : session?.user ? (
                <>
                  <span className="hidden text-sm text-gray-600 md:inline">
                    {(session.user as any).email || "Signed in"}
                  </span>
                  <button onClick={() => signOut()} className="rounded border px-2 py-1 text-sm">
                    Sign out
                  </button>
                </>
              ) : (
                <button onClick={() => signIn()} className="rounded border px-2 py-1 text-sm">
                  Sign in
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-6xl p-4">{children}</div>
      </main>
    </div>
  );
}
