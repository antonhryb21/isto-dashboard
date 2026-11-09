import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth/session";
import { appUrl } from "@/lib/auth/app-url";

export async function GET(request: NextRequest) {
  const base = appUrl(request);
  const fail = (code: string) => NextResponse.redirect(new URL(`/login?error=${code}`, base));
  try {
    return await handle(request, base, fail);
  } catch (e) {
    // Turn setup problems into a readable message on the login page instead of a blank 500.
    const msg = e instanceof Error ? e.message : String(e);
    console.error("google callback failed:", e);
    if (/AUTH_SECRET/.test(msg)) return fail("secret");
    if (/DATABASE_URL|ECONNREFUSED|ENOTFOUND|password authentication|connect/i.test(msg)) return fail("db");
    if (/relation .* does not exist/i.test(msg)) return fail("db_tables");
    return fail("server");
  }
}

async function handle(request: NextRequest, base: string, fail: (code: string) => NextResponse) {

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code || !state || state !== request.cookies.get("oauth_state")?.value) return fail("state");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      redirect_uri: new URL("/api/auth/callback/google", base).toString(),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return fail("token");
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) return fail("token");

  const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${access_token}` },
  });
  if (!infoRes.ok) return fail("profile");
  const info = (await infoRes.json()) as { email?: string; email_verified?: boolean; name?: string };
  const email = info.email?.toLowerCase();
  if (!email || !info.email_verified) return fail("profile");

  let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  // Bootstrap: emails listed in ADMIN_EMAILS become admins on first sign-in.
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!user && admins.includes(email)) {
    [user] = await db.insert(users).values({ email, name: info.name ?? null, role: "admin" }).returning();
  }
  if (!user) return fail("not_allowed");

  await db
    .update(users)
    .set({ lastLoginAt: new Date(), name: user.name ?? info.name ?? null })
    .where(eq(users.id, user.id));

  const token = await signSession({ email: user.email, name: user.name ?? info.name ?? null, role: user.role });
  const res = NextResponse.redirect(new URL("/", base));
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  res.cookies.delete("oauth_state");
  return res;
}
