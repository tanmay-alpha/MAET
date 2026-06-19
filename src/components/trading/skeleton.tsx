import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

export function Skel({
  className = "",
  w,
  h = 12,
  delay = 0,
}: {
  className?: string;
  w?: number | string;
  h?: number | string;
  delay?: number;
}) {
  const style: CSSProperties = {
    width: typeof w === "number" ? `${w}px` : w,
    height: typeof h === "number" ? `${h}px` : h,
    // staggered shimmer — feels continuous, not template-y
    ["--shimmer-delay" as never]: `${delay}ms`,
  };
  return <div className={`tv-skeleton ${className}`} style={style} />;
}

/** Wraps children — shows TradingView-style skeleton for `delay`ms, then fades content in. */
export function Loadable({
  delay = 600,
  skeleton,
  children,
}: {
  delay?: number;
  skeleton: ReactNode;
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), delay);
    return () => window.clearTimeout(id);
  }, [delay]);
  return (
    <div className="relative">
      <div
        className={`transition-opacity duration-[260ms] ease-out ${
          ready ? "opacity-100" : "pointer-events-none absolute inset-0 opacity-0"
        }`}
      >
        {children}
      </div>
      {!ready && <div className="animate-fade-in">{skeleton}</div>}
    </div>
  );
}

export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div className="space-y-2 p-3" style={{ height }}>
      <div className="flex items-center gap-2">
        <Skel w={60} h={10} delay={0} />
        <Skel w={40} h={10} delay={120} />
        <div className="ml-auto flex gap-1">
          <Skel w={20} h={10} delay={240} />
          <Skel w={20} h={10} delay={320} />
          <Skel w={20} h={10} delay={400} />
        </div>
      </div>
      <Skel w="100%" h={height - 60} delay={180} />
      <div className="flex justify-between">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skel key={i} w={28} h={8} delay={i * 90} />
        ))}
      </div>
    </div>
  );
}

export function RowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-1.5 p-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skel w={18} h={18} className="rounded-full" delay={i * 80} />
          <Skel w={70} h={10} delay={i * 80 + 40} />
          <Skel w={120} h={10} delay={i * 80 + 80} />
          <div className="ml-auto flex gap-3">
            <Skel w={50} h={10} delay={i * 80 + 120} />
            <Skel w={36} h={10} delay={i * 80 + 160} />
          </div>
        </div>
      ))}
    </div>
  );
}
