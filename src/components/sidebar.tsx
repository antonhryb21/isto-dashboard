"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { BarChart3, ChevronDown, Filter, Images, LayoutGrid, Megaphone, Settings, Sparkles, Table2, Telescope, Users, Globe } from "lucide-react";
import { IstoLogo } from "@/components/logo";

const NAV = [
  { href: "/", label: "Огляд", icon: LayoutGrid },
  { href: "/ads", label: "Реклама", icon: Megaphone },
  { href: "/creatives", label: "Креативи", icon: BarChart3 },
  { href: "/social", label: "Соцмережі", icon: Images },
  { href: "/funnel", label: "Воронка", icon: Filter },
  { href: "/site", label: "Сайт", icon: Globe },
  { href: "/crm", label: "CRM · ліди", icon: Users },
  { href: "/insights", label: "AI-інсайти", icon: Sparkles },
  { href: "/competitors", label: "Конкуренти", icon: Telescope },
  { href: "/reports", label: "Звіти", icon: Table2 },
];

/** Reports open as a sub-menu under "Звіти". */
const REPORT_ITEMS = [
  { href: "/reports", label: "Звіт по рекламі" },
  { href: "/reports/smm", label: "SMM-звіт" },
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
          if (href === "/reports") return <ReportsMenu key={href} active={active} path={path} suffix={suffix} />;
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

export function MobileNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const path = usePathname();
  const base = NAV.flatMap((n) => (n.href === "/reports" ? REPORT_ITEMS.map((r) => ({ ...n, ...r })) : [n]));
  const items = isAdmin ? [...base, { href: "/admin", label: "Адмін", icon: Settings }] : base;
  return (
    <nav className="md:hidden flex gap-1 overflow-x-auto border-b border-line px-3 py-2">
      {items.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className="chip whitespace-nowrap"
          data-active={href === "/" || href === "/reports" ? path === href : path.startsWith(href)}
        >
          {label}
        </Link>
      ))}
      <form action="/api/auth/logout" method="post" className="ml-auto shrink-0">
        <button className="chip whitespace-nowrap text-muted">Вийти</button>
      </form>
    </nav>
  );
}

function ReportsMenu({ active, path, suffix }: { active: boolean; path: string; suffix: string }) {
  const [open, setOpen] = useState(active);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
          active ? "text-text" : "text-muted hover:text-text"
        }`}
      >
        <Table2 size={15} strokeWidth={1.7} />
        Звіти
        <ChevronDown size={14} className={`ml-auto transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="ml-[22px] mt-0.5 flex flex-col gap-0.5 border-l border-line pl-2">
          {REPORT_ITEMS.map((r) => {
            const on = path === r.href;
            return (
              <Link
                key={r.href}
                href={r.href + (r.href === "/reports" ? suffix : "")}
                className={`rounded-lg px-3 py-1.5 text-[13px] transition-colors ${
                  on ? "bg-panel text-text shadow-[inset_2px_0_0_var(--accent)]" : "text-muted hover:text-text"
                }`}
              >
                {r.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
