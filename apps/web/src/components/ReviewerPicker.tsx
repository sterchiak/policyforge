// apps/web/src/components/ReviewerPicker.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";

type TeamUser = { id: number; email: string; name?: string | null; role: string };

type Props = {
  value: string[];                 // selected reviewer emails
  onChange: (emails: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  // optional: override max chip area height (e.g. "max-h-20")
  chipAreaMaxHClass?: string;
};

export default function ReviewerPicker({
  value,
  onChange,
  disabled,
  placeholder = "Add reviewers…",
  className = "",
  chipAreaMaxHClass = "max-h-24", // ~6rem
}: Props) {
  const [team, setTeam] = useState<TeamUser[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .get<TeamUser[]>("/v1/users")
      .then((r) => setTeam(Array.isArray(r.data) ? r.data : []))
      .catch(() => setTeam([]));
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return team;
    return team.filter(
      (u) =>
        u.email.toLowerCase().includes(s) ||
        (u.name || "").toLowerCase().includes(s) ||
        u.role.toLowerCase().includes(s)
    );
  }, [team, q]);

  const toggle = (email: string) => {
    const e = email.trim().toLowerCase();
    if (!e) return;
    const next = value.includes(e) ? value.filter((x) => x !== e) : [...value, e];
    onChange(next);
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const remove = (email: string) => onChange(value.filter((e) => e !== email));

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      {/* chips + input */}
      <div
        className={[
          "w-full rounded border bg-white",
          disabled ? "opacity-60" : "focus-within:ring-1 focus-within:ring-gray-300",
        ].join(" ")}
        onClick={() => !disabled && setOpen(true)}
      >
        <div
          className={[
            "flex w-full flex-wrap items-center gap-2 px-2 py-1",
            "min-h-10",            // keeps a nice minimum touch area
            chipAreaMaxHClass,     // cap the height
            "overflow-y-auto",     // scroll inside when lots of chips
          ].join(" ")}
        >
          {value.length === 0 ? (
            <span className="text-sm text-gray-500">{placeholder}</span>
          ) : (
            value.map((email) => {
              const u = team.find((t) => t.email.toLowerCase() === email);
              return (
                <span
                  key={email}
                  className="inline-flex max-w-[220px] items-center gap-1 rounded-full border bg-gray-50 px-2 py-0.5 text-xs"
                  title={u?.name ? `${u.name} (${email})` : email}
                >
                  <span className="truncate font-medium text-gray-900">{u?.name || email}</span>
                  {u?.name && (
                    <span className="truncate text-gray-600">({email})</span>
                  )}
                  {u?.role && (
                    <span className="ml-1 shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-700">
                      {u.role}
                    </span>
                  )}
                  {!disabled && (
                    <button
                      className="ml-1 shrink-0 text-gray-500 hover:text-gray-900"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(email);
                      }}
                      title="Remove"
                    >
                      ×
                    </button>
                  )}
                </span>
              );
            })
          )}

          {!disabled && (
            <input
              ref={inputRef}
              className="min-w-[8rem] flex-1 border-0 p-1 text-sm outline-none"
              placeholder={value.length ? "Search team…" : ""}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && q === "" && value.length > 0) {
                  // quick UX: backspace with empty query removes last chip
                  remove(value[value.length - 1]);
                }
              }}
            />
          )}
        </div>
      </div>

      {/* dropdown */}
      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full rounded border bg-white shadow-lg">
          {team.length === 0 ? (
            <div className="p-3 text-sm text-gray-600">
              No team members yet. <a className="underline" href="/team">Add users</a>.
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-3 text-sm text-gray-600">No matches.</div>
          ) : (
            <ul className="max-h-64 overflow-auto p-1">
              {filtered.map((u) => {
                const selected = value.includes(u.email.toLowerCase());
                return (
                  <li
                    key={u.id}
                    className={`flex cursor-pointer items-center justify-between rounded px-2 py-2 text-sm hover:bg-gray-50 ${
                      selected ? "bg-gray-50" : ""
                    }`}
                    onClick={() => toggle(u.email)}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-gray-900">{u.name || u.email}</div>
                      {u.name && <div className="truncate text-xs text-gray-600">{u.email}</div>}
                    </div>
                    <div className="ml-3 shrink-0 text-[10px] uppercase text-gray-700">{u.role}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
