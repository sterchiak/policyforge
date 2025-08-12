import api from "@/lib/api";

export type Notification = {
  id: number;
  type: string;
  message: string;
  document_id?: number | null;
  version?: number | null;
  approval_id?: number | null;
  created_at: string;
  read_at?: string | null;
};

export async function fetchUnread(limit = 50): Promise<Notification[]> {
  const { data } = await api.get<Notification[]>("/v1/notifications", {
    params: { status: "unread", limit },
  });
  return data;
}

export async function fetchAll(limit = 100): Promise<Notification[]> {
  const { data } = await api.get<Notification[]>("/v1/notifications", {
    params: { status: "all", limit },
  });
  return data;
}

export async function markRead(ids: number[]): Promise<void> {
  if (!ids?.length) return;
  await api.post("/v1/notifications/mark_read", { ids });
}

export async function markAllRead(): Promise<void> {
  await api.post("/v1/notifications/mark_all_read");
}
