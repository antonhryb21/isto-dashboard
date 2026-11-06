import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { appUrl } from "@/lib/auth/app-url";

export function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: "GOOGLE_OAUTH_CLIENT_ID is not set" }, { status: 500 });

  const state = randomBytes(24).toString("hex");
  const redirectUri = new URL("/api/auth/callback/google", appUrl(request)).toString();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  }).toString();

  const res = NextResponse.redirect(url);
  res.cookies.set("oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}

