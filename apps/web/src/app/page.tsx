export default function Home() {
  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-semibold mb-2">PolicyForge</h1>
      <p className="text-sm text-gray-600">Home should load without auth or redirects.</p>
      <div className="mt-4 flex gap-3">
        <a href="/dashboard" className="rounded border px-3 py-2">Dashboard</a>
        <a href="/documents" className="rounded border px-3 py-2">Documents</a>
        <a href="/policies" className="rounded border px-3 py-2">Policies</a>
        <a href="/api/auth/signin" className="rounded border px-3 py-2">Sign in</a>
      </div>
    </main>
  );
}
