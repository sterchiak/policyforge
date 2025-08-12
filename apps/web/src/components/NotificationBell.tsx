"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import {
  fetchUnread,
  markRead,
  markAllRead,
  type Notification,
} from "@/lib/notifications";

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const unreadCount = useMemo(() => items.length, [items]);

  async function load() {
    try {
      setLoading(true);
      const data = await fetchUnread();
      setItems(data);
    } catch {
      // ignore (keep UI silent in dev)
    } finally {
      setLoading(false);
    }
  }

  // Initial + poll every 30s
  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  // Close on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!open) return;
      const t = e.target as Node | null;
      if (panelRef.current && t && !panelRef.current.contains(t)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const toggleOpen = async () => {
    const next = !open;
    setOpen(next);
    if (next) await load();
  };

  const handleMarkAll = async () => {
    await markAllRead();
    await load();
  };

  const handleMarkOne = async (id: number) => {
    await markRead([id]);
    await load();
  };

  return (
    <div className="relative">
      <button
        onClick={toggleOpen}
        className="relative p-2 rounded-xl hover:bg-gray-100 transition"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 mt-2 w-96 bg-white border rounded-2xl shadow-xl p-2 z-50"
          role="dialog"
          aria-label="Notifications menu"
        >
          <div className="flex items-center justify-between px-2 py-1">
            <div className="text-sm font-semibold">Notifications</div>
            <div className="flex items-center gap-3">
              <button
                onClick={load}
                className="text-xs text-gray-600 hover:underline"
                disabled={loading}
              >
                {loading ? "Refreshing…" : "Refresh"}
              </button>
              <button
                onClick={handleMarkAll}
                className="text-xs text-blue-600 hover:underline"
              >
                Mark all read
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-auto">
            {items.length === 0 ? (
              <div className="p-4 text-sm text-gray-500">
                No new notifications
              </div>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className="px-3 py-2 hover:bg-gray-50 rounded-xl"
                >
                  <div className="text-sm">{n.message}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {new Date(n.created_at).toLocaleString()}
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    {typeof n.document_id === "number" && (
                      <Link
                        href={`/documents/${n.document_id}`}
                        className="text-xs text-blue-600 hover:underline"
                        onClick={() => setOpen(false)}
                      >
                        Open document
                      </Link>
                    )}
                    <button
                      onClick={() => handleMarkOne(n.id)}
                      className="text-xs text-gray-600 hover:underline"
                    >
                      Mark read
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
