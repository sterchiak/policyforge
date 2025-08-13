"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FileText, Folder, Settings, Users, Boxes } from "lucide-react";

type Item = {
  href: string;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
};

const NAV: Item[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/policies",  label: "Policies",  icon: FileText },
  { href: "/documents", label: "Documents", icon: Folder },
  { href: "/frameworks", label: "Frameworks", icon: Boxes },
  { href: "/team",      label: "Team",      icon: Users },
  { href: "/settings",  label: "Settings",  icon: Settings },
];

function NavItem({ href, label, icon: Icon }: Item) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  const base =
    "group flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors";
  const linkClass = active
    ? `${base} bg-gray-900 text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-300`
    : `${base} text-gray-900 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200`;

  const iconClass = active ? "h-4 w-4 text-white" : "h-4 w-4 text-gray-700 group-hover:text-gray-900";
  const labelClass = active ? "font-medium text-white" : "font-medium text-gray-900";

  return (
    <Link href={href} className={linkClass} aria-current={active ? "page" : undefined}>
      <Icon className={iconClass} />
      <span className={labelClass}>{label}</span>
    </Link>
  );
}

export default function Sidebar() {
  return (
    // Sticky + full viewport height + independent scroll if needed
    <aside
      className="
        sticky top-0 z-20
        w-56 shrink-0
        border-r bg-white text-gray-900
        h-[100dvh]
      "
      aria-label="Primary"
    >
      <div className="flex h-full flex-col p-3">
        <nav className="space-y-1">
          {NAV.map((item) => (
            <NavItem key={item.href} {...item} />
          ))}
        </nav>

        <div className="mt-auto p-2 text-xs text-gray-500">v0.1.0</div>
      </div>
    </aside>
  );
}
