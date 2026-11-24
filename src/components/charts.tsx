"use client";

import { useEffect, useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtPctValue } from "@/lib/format";

const fmtDay = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

type Palette = { text: string; faint: string; line: string; panel: string; accent: string; sand: string; good: string; data1: string; data2: string };

/** Reads the brand tokens from CSS so charts follow the light/dark theme. */
function usePalette(): Palette {
  const read = (): Palette => {
    if (typeof window === "undefined") {
      return { text: "#161616", faint: "#8a8476", line: "#e3dfd6", panel: "#ffffff", accent: "#393e49", sand: "#a39d8d", good: "#16a34a", data1: "#3b6ef6", data2: "#f97316" };
    }
    const s = getComputedStyle(document.documentElement);
    const v = (n: string) => s.getPropertyValue(n).trim();
    return {
      text: v("--text"),
      faint: v("--faint"),
      line: v("--line"),
      panel: v("--panel"),
      accent: v("--accent"),
      sand: v("--sand"),
      good: v("--good"),
      data1: v("--data-1"),
      data2: v("--data-2"),
    };
  };
  const [p, setP] = useState<Palette>(read);
  useEffect(() => {
    const update = () => setP(read());
    update();
    window.addEventListener("isto-theme", update);
    return () => window.removeEventListener("isto-theme", update);
  }, []);
  return p;
}

/** Spend as bars (left axis) with leads and qualified leads as lines (right axis). */
export function SpendLeadsChart({
  data,
  currency,
}: {
  data: { date: string; spend: number; leads: number; qualified: number }[];
  currency: string;
}) {
  const p = usePalette();
  const axis = { stroke: p.faint, fontSize: 11, tickLine: false, axisLine: false } as const;
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
          <CartesianGrid stroke={p.line} vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDay} {...axis} minTickGap={24} />
          <YAxis yAxisId="spend" {...axis} width={48} />
          <YAxis yAxisId="leads" orientation="right" {...axis} width={32} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: p.panel, border: `1px solid ${p.line}`, borderRadius: 4, fontSize: 12, color: p.text }}
            labelFormatter={(d) => fmtDay(String(d))}
            formatter={(v, name) => [name === "Витрати" ? `${Number(v).toFixed(0)} ${currency}` : v, name]}
          />
          <Bar yAxisId="spend" dataKey="spend" name="Витрати" fill={p.data1} fillOpacity={0.55} radius={[2, 2, 0, 0]} />
          <Line yAxisId="leads" dataKey="leads" name="Ліди" stroke={p.data2} strokeWidth={2.2} dot={false} />
          <Line yAxisId="leads" dataKey="qualified" name="Якісні" stroke={p.good} strokeWidth={2.2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Sparkline({ data, dataKey }: { data: Record<string, number | string>[]; dataKey: string }) {
  const p = usePalette();
  return (
    <div className="h-10">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data}>
          <Area dataKey={dataKey} stroke={p.data1} fill={p.data1} fillOpacity={0.15} strokeWidth={1.8} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Follower growth in % since the start of the period, one line per account (own account thicker).
 * Percent, because the accounts differ in size by orders of magnitude.
 */
export function FollowersChart({
  data,
  series,
}: {
  data: Record<string, number | string | null>[];
  series: { key: string; name: string; own: boolean }[];
}) {
  const p = usePalette();
  // Our account is drawn in the main data colour; competitors get distinct bright hues.
  const colors = ["#f97316", "#10b981", "#8b5cf6", "#ef4444", "#06b6d4", "#eab308", "#ec4899", "#64748b"];
  const axis = { stroke: p.faint, fontSize: 11, tickLine: false, axisLine: false } as const;
  let i = 0;
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={p.line} vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDay} {...axis} minTickGap={24} />
          <YAxis {...axis} width={62} domain={["auto", "auto"]} tickFormatter={(v) => fmtPctValue(Number(v))} />
          <Tooltip
            contentStyle={{ background: p.panel, border: `1px solid ${p.line}`, borderRadius: 4, fontSize: 12, color: p.text }}
            labelFormatter={(d) => fmtDay(String(d))}
            formatter={(v, name) => [`${Number(v) > 0 ? "+" : ""}${fmtPctValue(Number(v))}`, name]}
          />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: p.text, paddingTop: 8 }} />
          {series.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stroke={s.own ? p.data1 : colors[i++ % colors.length]}
              strokeWidth={s.own ? 2.6 : 1.5}
              dot={false}
              connectNulls
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Website sessions as bars, users and key events as lines, one point per day. */
export function SiteTrafficChart({ data }: { data: { date: string; sessions: number; users: number; keyEvents: number }[] }) {
  const p = usePalette();
  const axis = { stroke: p.faint, fontSize: 11, tickLine: false, axisLine: false } as const;
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
          <CartesianGrid stroke={p.line} vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDay} {...axis} minTickGap={24} />
          <YAxis yAxisId="traffic" {...axis} width={44} allowDecimals={false} />
          <YAxis yAxisId="events" orientation="right" {...axis} width={32} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: p.panel, border: `1px solid ${p.line}`, borderRadius: 4, fontSize: 12, color: p.text }}
            labelFormatter={(d) => fmtDay(String(d))}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="traffic" dataKey="sessions" name="Сеанси" fill={p.data1} fillOpacity={0.55} radius={[2, 2, 0, 0]} />
          <Line yAxisId="traffic" dataKey="users" name="Користувачі" stroke={p.sand} strokeWidth={2} dot={false} />
          <Line yAxisId="events" dataKey="keyEvents" name="Ключові події" stroke={p.data2} strokeWidth={2.2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

type SmmSeries = { key: string; name: string; color?: "data1" | "data2" | "good" | "sand" | "accent" | "bad"; stack?: string; right?: boolean };

/**
 * The SMM report's monthly charts: bars (optionally stacked) on the left axis, lines on the right one.
 * `unit` formats values in the tooltip and on the axes ("pct" for shares given as fractions).
 */
export function MonthlyChart({
  data,
  bars = [],
  lines = [],
  unit,
  rightUnit,
  height = 260,
}: {
  data: Record<string, number | string | null>[];
  bars?: SmmSeries[];
  lines?: SmmSeries[];
  unit?: "pct" | "aed";
  rightUnit?: "pct" | "aed";
  height?: number;
}) {
  const p = usePalette();
  const color = (c: SmmSeries["color"], i: number) =>
    ({ data1: p.data1, data2: p.data2, good: p.good, sand: p.sand, accent: p.accent, bad: "#e11d48" })[c ?? (i % 2 ? "data2" : "data1")];
  const axis = { stroke: p.faint, fontSize: 11, tickLine: false, axisLine: false } as const;
  const fmt = (u: "pct" | "aed" | undefined, v: number, short = false) => {
    if (u === "pct") return `${(v * 100).toFixed(short ? 1 : 2).replace(".", ",")}%`;
    const s =
      short && Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : short && Math.abs(v) >= 1e4 ? `${Math.round(v / 1e3)}k` : new Intl.NumberFormat("uk-UA").format(Math.round(v));
    return u === "aed" && !short ? `${s} AED` : s;
  };
  const rightKeys = new Set([...bars, ...lines].filter((s) => s.right).map((s) => s.key));
  const hasRight = rightKeys.size > 0;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={p.line} vertical={false} />
          <XAxis dataKey="label" {...axis} minTickGap={8} />
          <YAxis yAxisId="l" {...axis} width={52} tickFormatter={(v) => fmt(unit, Number(v), true)} />
          {hasRight && <YAxis yAxisId="r" orientation="right" {...axis} width={52} tickFormatter={(v) => fmt(rightUnit, Number(v), true)} />}
          <Tooltip
            contentStyle={{ background: p.panel, border: `1px solid ${p.line}`, borderRadius: 4, fontSize: 12, color: p.text }}
            formatter={(v, name, item) => [v === null || v === undefined ? "—" : fmt(rightKeys.has(String(item.dataKey)) ? rightUnit : unit, Number(v)), name]}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: p.text, paddingTop: 6 }} />
          {bars.map((s, i) => (
            <Bar
              key={s.key}
              yAxisId={s.right ? "r" : "l"}
              dataKey={s.key}
              name={s.name}
              stackId={s.stack}
              fill={color(s.color, i)}
              fillOpacity={0.75}
              radius={s.stack ? 0 : [2, 2, 0, 0]}
            />
          ))}
          {lines.map((s, i) => (
            <Line
              key={s.key}
              yAxisId={s.right ? "r" : "l"}
              dataKey={s.key}
              name={s.name}
              stroke={color(s.color, i + 1)}
              strokeWidth={2.2}
              dot={{ r: 2.5 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
