import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import jwt from "jsonwebtoken";

// Always run dynamic to avoid caching issues
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET!;
  const decoded = await getToken({ req, secret });
  if (!decoded) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // Build a clean payload for the API
  const payload = {
    sub: (decoded.sub as string) || (decoded.email as string) || "user",
    email: decoded.email as string | undefined,
    name: decoded.name as string | undefined,
    role: (decoded as any).role ?? "owner",
    orgId: (decoded as any).orgId ?? 1,
  };

  // Re-sign as HS256 for the FastAPI backend
  const token = jwt.sign(payload, secret, {
    algorithm: "HS256",
    expiresIn: "15m",
  });

  return NextResponse.json({ token });
}
