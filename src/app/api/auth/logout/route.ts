import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

export function POST(request: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", request.nextUrl.origin), { status: 303 });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
