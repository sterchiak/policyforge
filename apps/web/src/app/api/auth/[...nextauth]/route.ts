// apps/web/src/app/api/auth/[...nextauth]/route.ts
export const dynamic = "force-dynamic";

import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";

const handler = NextAuth({
  providers: [
    //GoogleProvider({
    //  clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    //  clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    //}),
    // Dev login so you can proceed without Google set up
    CredentialsProvider({
      name: "Dev Login",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (credentials?.password === "dev" && credentials.email) {
          return { id: "1", email: credentials.email, name: "Dev User", role: "owner", orgId: 1 } as any;
        }
        return null;
      },
    }),
  ],
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role ?? "owner";
        token.orgId = (user as any).orgId ?? 1;
      }
      return token;
    },
    async session({ session, token }) {
      (session.user as any).role = (token as any).role ?? "owner";
      (session.user as any).orgId = (token as any).orgId ?? 1;
      return session;
    },
  },
});

export { handler as GET, handler as POST };
