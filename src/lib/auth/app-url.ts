import type { NextRequest } from "next/server";

export function appUrl(request: NextRequest) {
  return process.env.APP_URL ?? request.nextUrl.origin;
}
