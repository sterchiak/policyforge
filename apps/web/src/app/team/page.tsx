"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import Card from "@/components/Card";
import { api } from "@/lib/api";

type User = { id:number; email:string; name?:string; role:string; created_at:string };

export default function TeamPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState(""); const [name, setName] = useState("");
  const [role, setRole] = useState("viewer"); const [loading, setLoading] = useState(false);

  const load = () => api.get<User[]>("/v1/users").then(r=>setUsers(r.data||[]));

  useEffect(() => { load(); }, []);

  async function addUser() {
   setLoading(true);
   try {
     const e = email.trim();
     if (!e) throw new Error("Email is required");
     await api.post("/v1/users", { email: e, name: name.trim() || null, role });
      setEmail(""); setName(""); setRole("viewer"); await load();
   } finally { setLoading(false); }
 }

  async function removeUser(id:number) {
    await api.delete(`/v1/users/${id}`); await load();
  }

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Team</h1>
      </div>

      <Card title="Add teammate">
        <div className="grid gap-3 md:grid-cols-4">
          <input className="rounded border px-3 py-2 text-sm" placeholder="email@company.com" value={email} onChange={e=>setEmail(e.target.value)} />
          <input className="rounded border px-3 py-2 text-sm" placeholder="Full name (optional)" value={name} onChange={e=>setName(e.target.value)} />
          <select className="rounded border px-3 py-2 text-sm" value={role} onChange={e=>setRole(e.target.value)}>
            {["owner","admin","editor","viewer","approver"].map(r=>(<option key={r} value={r}>{r}</option>))}
          </select>
          <button disabled={loading} onClick={addUser} className="rounded-xl border bg-white px-3 py-2 text-sm shadow-sm hover:bg-gray-50">Add</button>
        </div>
      </Card>

      <div className="mt-4">
        <Card title="Members">
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-gray-600"><th className="py-2 pr-4">Email</th><th className="py-2 pr-4">Name</th><th className="py-2 pr-4">Role</th><th className="py-2">Actions</th></tr></thead>
            <tbody className="divide-y">
              {users.map(u=>(
                <tr key={u.id}>
                  <td className="py-2 pr-4">{u.email}</td>
                  <td className="py-2 pr-4">{u.name||"—"}</td>
                  <td className="py-2 pr-4">{u.role}</td>
                  <td className="py-2"><button onClick={()=>removeUser(u.id)} className="rounded border px-2 py-1">Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </AppShell>
  );
}
