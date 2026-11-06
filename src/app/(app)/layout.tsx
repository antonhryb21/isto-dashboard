import { Suspense } from "react";
import { after } from "next/server";
import { hasRole, requireUser } from "@/lib/auth/current-user";
import { isStale, lastSync, runSync } from "@/lib/sync";
import { ago } from "@/lib/format";
import { MobileNav, Sidebar } from "@/components/sidebar";
import { RefreshButton } from "@/components/refresh-button";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STALE_MINUTES = 10;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const last = await lastSync("quick");
  const lastAny = await lastSync();

  // "Live" data without frequent cron jobs: if the last quick sync is older than 10 minutes,
  // refresh in the background after this page is sent. The next page view shows fresh numbers.
  if (isStale(last, STALE_MINUTES)) {
    after(async () => {
      try {
        await runSync("quick");
      } catch (e) {
        console.error("background sync failed", e);
      }
    });
  }

  return (
    <div className="flex min-h-screen">
      <Suspense>
        <Sidebar isAdmin={hasRole(user.role, "admin")} email={user.email} />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense>
          <MobileNav />
        </Suspense>
        <header className="flex items-center justify-end border-b border-line px-5 py-2.5 md:px-8">
          <RefreshButton lastSync={ago(lastAny?.finishedAt ?? lastAny?.startedAt)} />
        </header>
        <main className="flex-1 px-5 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
