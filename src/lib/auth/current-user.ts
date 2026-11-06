import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type Role } from "@/db/schema";
import { SESSION_COOKIE, verifySession, type Session } from "./session";

/**
 * The signed-in user, re-checked against the database on every request so that
 * removing someone in Admin takes effect immediately, not when their cookie expires.
 */
export async function getCurrentUser(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return null;
  const [row] = await db.select().from(users).where(eq(users.email, session.email)).limit(1);
  if (!row) return null;
  return { email: row.email, name: row.name, role: row.role };
}

export async function requireUser(minRole: Role = "viewer"): Promise<Session> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasRole(user.role, minRole)) redirect("/?denied=1");
  return user;
}

const RANK: Record<Role, number> = { viewer: 0, marketing: 1, admin: 2 };

export function hasRole(role: Role, min: Role) {
  return RANK[role] >= RANK[min];
}
