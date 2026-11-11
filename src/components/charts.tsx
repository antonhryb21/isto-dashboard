"use client";

import { useEffect, useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtPctValue } from "@/lib/format";

const fmtDay = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

type Palette = { text: string; faint: string; line: string; panel: string; accent: string; sand: string; good: string };

/** Reads the brand tokens from CSS so charts follow the light/dark theme. */
function usePalette(): Palette {
  const read = (): Palette => {
    if (typeof window === "undefined") {
      return { text: "#161616", faint: "#8a8476", line: "#e3dfd6", panel: "#ffffff", accent: "#393e49", sand: "#a39d8d", good: "#4f7a5e" };
    }
    const s = getComputedStyle(document.documentElement);
    const v = (n: string) => s.getPropertyValue(n).trim();
    return { text: v("--text"), faint: v("--faint"), line: v("--line"), panel: v("--panel"), accent: v("--accent"), sand: v("--sand"), good: v("--good") };
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
          <Bar yAxisId="spend" dataKey="spend" name="Витрати" fill={p.sand} fillOpacity={0.55} radius={[2, 2, 0, 0]} />
          <Line yAxisId="leads" dataKey="leads" name="Ліди" stroke={p.accent} strokeWidth={1.8} dot={false} />
          <Line yAxisId="leads" dataKey="qualified" name="Якісні" stroke={p.good} strokeWidth={1.8} dot={false} />
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
          <Area dataKey={dataKey} stroke={p.accent} fill={p.sand} fillOpacity={0.2} strokeWidth={1.5} />
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
  const colors = ["#a39d8d", "#5b7fa6", "#8a7fb0", "#c29a4b", "#b4704a", "#4f7a5e", "#a4513f", "#60584d"];
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
              stroke={s.own ? p.accent : colors[i++ % colors.length]}
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
