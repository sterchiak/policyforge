export type RecentDraft = {
  id: string;
  title: string;
  templateKey: string;
  orgName: string;
  createdAt: string; // ISO
  params: {
    password_min_length: number;
    mfa_required_roles: string[];
    log_retention_days: number;
  };
};

const KEY = "pf:recentDrafts";

export function getRecents(): RecentDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RecentDraft[]) : [];
  } catch {
    return [];
  }
}

export function addRecent(d: RecentDraft) {
  if (typeof window === "undefined") return;
  const list = getRecents();
  // de-dup by id, put newest first, cap to 10
  const next = [d, ...list.filter((x) => x.id !== d.id)].slice(0, 10);
  localStorage.setItem(KEY, JSON.stringify(next));
}
