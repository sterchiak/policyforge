"use client";

import Sidebar from "@/components/Sidebar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Mobile: simple top bar */}
      <header className="flex h-14 items-center border-b bg-white px-4 md:hidden">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between">
          <span className="text-base font-semibold">PolicyForge</span>
          <nav className="text-sm">
            <a className="mr-4 hover:underline" href="/dashboard">Dashboard</a>
            <a className="hover:underline" href="/policies">Policies</a>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid min-h-[calc(100vh-56px)] max-w-6xl md:grid-cols-[240px_1fr]">
        {/* Desktop sidebar */}
        <aside className="hidden border-r bg-white md:block">
          <Sidebar />
        </aside>

        {/* Main content */}
        <main className="px-4 py-6">{children}</main>
      </div>
    </div>
  );
}
