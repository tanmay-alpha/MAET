import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type CompareChartMode = "pct" | "indexed" | "price";

export interface CompareLineChartProps {
  /** One row per date: `date` label plus one value per symbol. */
  data: Record<string, string | number>[];
  symbols: string[];
  colors: string[];
  mode: CompareChartMode;
}

export function CompareLineChart({ data, symbols, colors, mode }: CompareLineChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 14, right: 28, bottom: 6, left: 4 }}>
        <CartesianGrid stroke="var(--color-grid)" strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="date" stroke="var(--color-muted-foreground)" tick={{ fontSize: 10 }} minTickGap={34} />
        <YAxis
          stroke="var(--color-muted-foreground)"
          tick={{ fontSize: 10 }}
          tickFormatter={(value) =>
            mode === "pct"
              ? `${Number(value).toFixed(0)}%`
              : mode === "indexed"
                ? Number(value).toFixed(0)
                : `₹${Number(value).toFixed(0)}`
          }
          width={52}
        />
        <Tooltip
          contentStyle={{
            background: "var(--color-panel-elevated)",
            border: "1px solid var(--color-border)",
            borderRadius: 4,
          }}
          formatter={(value) => [
            mode === "pct"
              ? `${Number(value).toFixed(2)}%`
              : mode === "indexed"
                ? Number(value).toFixed(2)
                : `₹${Number(value).toFixed(2)}`,
            "",
          ]}
        />
        <Legend />
        {symbols.map((symbol, index) => (
          <Line key={symbol} dataKey={symbol} stroke={colors[index]} dot={false} strokeWidth={1.8} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
