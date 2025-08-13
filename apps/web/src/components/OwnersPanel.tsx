"use client";

import { useEffect, useMemo, useState } from "react";
import Card from "@/components/Card";
import { api } from "@/lib/api";

type DocOwner = {
  id: number;
  user_id: number;
  email: string;
  name?: string | null;
  role: "owner" | "editor" | "viewer" | "approver";
};

const ROLE_OPTIONS: DocOwner["role"][] = ["owner", "editor", "viewer", "approver"];

export default function OwnersPanel({ docId }: { docId: number }) {
  const [owners, setOwners] = useState<DocOwner[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // add form
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<DocOwner["role"]>("owner");

  const load = async () => {
    setErr(null);
    try {
      const { data } = await api.get<DocOwner[]>(`/v1/documents/${docId}/owners`);
      setOwners(data ?? []);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || "Failed to load owners");
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  async function addOwner() {
    setErr(null);
    const e = email.trim();
    if (!e) return setErr("Email is required");

    setLoading(true);
    try {
      await api.post(`/v1/documents/${docId}/owners`, { email: e, role });
      setEmail(""); setRole("owner");
      await load();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || "Failed to add owner";
      setErr(String(msg));
    } finally {
      setLoading(false);
    }
  }

  async function changeRole(o: DocOwner, newRole: DocOwner["role"]) {
    if (o.role === newRole) return;
    setLoading(true);
    setErr(null);
    try {
      // backend POST will upsert/update role when email already mapped
      await api.post(`/v1/documents/${docId}/owners`, { email: o.email, role: newRole });
      await load();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || "Failed to update role";
      setErr(String(msg));
    } finally {
      setLoading(false);
    }
  }

    async function removeOwner(o: DocOwner) {
        setLoading(true);
        setErr(null);
        try {
            // FIX: use mapping id (o.id), not user_id
            await api.delete(`/v1/documents/${docId}/owners/${o.id}`);
            await load();
        } catch (e: any) {
            const msg = e?.response?.data?.detail || e?.message || "Failed to remove owner";
            setErr(String(msg));
        } finally {
            setLoading(false);
        }
        }


  const youBadgeFor = useMemo(() => {
    // if you store current user email in session on client, you can mark "You"
    // keeping it simple for now; omit badge or wire your session email here
    return (email: string) => null as any;
  }, []);

  return (
    <Card title="Owners">
      {err && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      {/* List */}
      {owners.length === 0 ? (
        <p className="text-sm text-gray-600">No owners yet. Add one below.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600">
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {owners.map((o) => (
                <tr key={o.id}>
                  <td className="py-2 pr-4">{o.email}</td>
                  <td className="py-2 pr-4">{o.name || "—"}</td>
                  <td className="py-2 pr-4">
                    <select
                      className="rounded border px-2 py-1 text-sm"
                      value={o.role}
                      onChange={(e) => changeRole(o, e.target.value as DocOwner["role"])}
                      disabled={loading}
                      title="Change role"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2">
                    <button
                      onClick={() => removeOwner(o)}
                      className="rounded border px-2 py-1 text-sm hover:bg-gray-50"
                      disabled={loading}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add form */}
      <div className="mt-4 grid gap-2 md:grid-cols-[1fr_auto_auto]">
        <input
          type="email"
          className="rounded border px-3 py-2 text-sm"
          placeholder="email@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
        />
        <select
          className="rounded border px-3 py-2 text-sm"
          value={role}
          onChange={(e) => setRole(e.target.value as DocOwner["role"])}
          disabled={loading}
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <button
          onClick={addOwner}
          disabled={loading}
          className="rounded-xl border bg-white px-3 py-2 text-sm shadow-sm hover:bg-gray-50"
        >
          Add owner
        </button>
      </div>

      <p className="mt-2 text-xs text-gray-500">
        Owners and approvers receive notifications for this document.
      </p>
    </Card>
  );
}
