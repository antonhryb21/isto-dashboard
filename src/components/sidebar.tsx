"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BarChart3, Filter, Images, LayoutGrid, Megaphone, Settings, Users } from "lucide-react";
import { IstoLogo } from "@/components/logo";

const NAV = [
  { href: "/", label: "Огляд", icon: LayoutGrid },
  { href: "/ads", label: "Реклама", icon: Megaphone },
  { href: "/creatives", label: "Креативи", icon: BarChart3 },
  { href: "/social", label: "Соцмережі", icon: Images },
  { href: "/funnel", label: "Воронка", icon: Filter },
  { href: "/crm", label: "CRM · ліди", icon: Users },
];

/** Keeps the period/region filters when moving between sections. */
const KEEP = ["p", "from", "to", "region"];

export function Sidebar({ isAdmin, email }: { isAdmin: boolean; email: string }) {
  const path = usePathname();
  const sp = useSearchParams();
  const qs = new URLSearchParams();
  for (const k of KEEP) {
    const v = sp.get(k);
    if (v) qs.set(k, v);
  }
  const suffix = qs.toString() ? `?${qs}` : "";
  const items = isAdmin ? [...NAV, { href: "/admin", label: "Адмін", icon: Settings }] : NAV;

  return (
    <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-line bg-panel-2 px-3 py-6">
      <Link href={`/${suffix}`} className="px-3">
        <IstoLogo width={120} className="text-text" />
        <div className="serif mt-2 text-[13px] text-muted">marketing</div>
      </Link>
      <nav className="mt-7 flex flex-col gap-0.5">
        {items.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href + (href === "/admin" ? "" : suffix)}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                active ? "bg-panel text-text shadow-[inset_2px_0_0_var(--accent)]" : "text-muted hover:text-text"
              }`}
            >
              <Icon size={15} strokeWidth={1.7} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto px-3 text-[11.5px] text-faint">
        <div className="truncate">{email}</div>
        <form action="/api/auth/logout" method="post">
          <button className="mt-1 text-muted hover:text-text">Вийти</button>
        </form>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const path = usePathname();
  return (
    <nav className="md:hidden flex gap-1 overflow-x-auto border-b border-line px-3 py-2">
      {NAV.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className="chip whitespace-nowrap"
          data-active={href === "/" ? path === "/" : path.startsWith(href)}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
