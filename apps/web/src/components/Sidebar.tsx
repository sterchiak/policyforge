"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FileText, Settings } from "lucide-react";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/policies",  label: "Policies",  icon: FileText },
  { href: "/documents", label: "Documents", icon: Settings },
  { href: "/settings",  label: "Settings",  icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="flex h-screen flex-col">
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/" className="text-base font-semibold text-gray-900">
          PolicyForge
        </Link>
      </div>

      <nav className="flex-1 p-3">
        <ul className="space-y-1">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = pathname?.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                    active
                      ? "bg-gray-900 text-white"
                      : "text-gray-800 hover:bg-gray-100"
                  }`}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t p-3 text-xs text-gray-500">v0.1.0</div>
    </div>
  );
}
