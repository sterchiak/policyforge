import axios from "axios";

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE,
  withCredentials: true,
});

let cachedToken: string | null = null;
let fetchedAt = 0;

// fetch /api/token at most every 9 minutes
async function ensureToken() {
  const now = Date.now();
  if (cachedToken && now - fetchedAt < 9 * 60 * 1000) return cachedToken;

  try {
    const res = await fetch("/api/token", { credentials: "include" });
    if (!res.ok) throw new Error("no token");
    const data = await res.json();
    cachedToken = data.token as string;
    fetchedAt = now;
    return cachedToken;
  } catch {
    cachedToken = null;
    return null;
  }
}

// attach Bearer for browser requests
api.interceptors.request.use(async (config) => {
  if (typeof window !== "undefined" && !config.headers?.Authorization) {
    const t = await ensureToken();
    if (t) {
      config.headers = { ...(config.headers || {}), Authorization: `Bearer ${t}` };
    }
  }
  return config;
});
