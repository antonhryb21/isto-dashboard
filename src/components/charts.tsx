"use client";

import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const AXIS = { stroke: "#6b6962", fontSize: 11, tickLine: false, axisLine: false } as const;
const fmtDay = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

/** Spend as bars (left axis) with leads and qualified leads as lines (right axis). */
export function SpendLeadsChart({
  data,
  currency,
}: {
  data: { date: string; spend: number; leads: number; qualified: number }[];
  currency: string;
}) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
          <CartesianGrid stroke="#2a2926" vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDay} {...AXIS} minTickGap={24} />
          <YAxis yAxisId="spend" {...AXIS} width={48} />
          <YAxis yAxisId="leads" orientation="right" {...AXIS} width={32} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: "#1d1d1a", border: "1px solid #2a2926", borderRadius: 10, fontSize: 12 }}
            labelFormatter={(d) => fmtDay(String(d))}
            formatter={(v, name) => [name === "Витрати" ? `${Number(v).toFixed(0)} ${currency}` : v, name]}
          />
          <Bar yAxisId="spend" dataKey="spend" name="Витрати" fill="#c9a979" fillOpacity={0.35} radius={[3, 3, 0, 0]} />
          <Line yAxisId="leads" dataKey="leads" name="Ліди" stroke="#ecebe6" strokeWidth={1.8} dot={false} />
          <Line yAxisId="leads" dataKey="qualified" name="Якісні" stroke="#6fbf8b" strokeWidth={1.8} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Sparkline({ data, dataKey }: { data: Record<string, number | string>[]; dataKey: string }) {
  return (
    <div className="h-10">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data}>
          <Area dataKey={dataKey} stroke="#c9a979" fill="#c9a979" fillOpacity={0.12} strokeWidth={1.5} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
