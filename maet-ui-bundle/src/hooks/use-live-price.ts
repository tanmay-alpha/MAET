import { useEffect, useState, useRef } from "react";

export function useLivePrice(seed: number, opts: { volatility?: number; interval?: number } = {}) {
  const { volatility = 0.0015, interval = 1200 } = opts;
  const [price, setPrice] = useState(seed);
  const [dir, setDir] = useState<"up" | "down" | "flat">("flat");
  const [tick, setTick] = useState(0);
  const last = useRef(seed);

  useEffect(() => {
    const id = window.setInterval(() => {
      const drift = (Math.random() - 0.48) * 2 * volatility * last.current;
      const next = +(last.current + drift).toFixed(2);
      if (next === last.current) return;
      setDir(next > last.current ? "up" : "down");
      last.current = next;
      setPrice(next);
      setTick((t) => t + 1);
    }, interval);
    return () => window.clearInterval(id);
  }, [volatility, interval]);

  return { price, dir, tick, base: seed };
}

export function useLiveSeries(seed: number, length = 80, opts: { volatility?: number; interval?: number } = {}) {
  const { volatility = 0.003, interval = 900 } = opts;
  const [series, setSeries] = useState<number[]>(() => Array.from({ length }, () => seed));

  useEffect(() => {
    // Generate proper random walk on client to avoid SSR mismatch
    const arr = [seed];
    for (let i = 1; i < length; i++) {
      arr.push(+(arr[i - 1] + (Math.sin(i / 6) + (Math.random() - 0.5)) * seed * volatility).toFixed(2));
    }
    setSeries(arr);
    const id = window.setInterval(() => {
      setSeries((prev) => {
        const last = prev[prev.length - 1];
        const next = +(last + (Math.random() - 0.48) * 2 * volatility * last).toFixed(2);
        return [...prev.slice(1), next];
      });
    }, interval);
    return () => window.clearInterval(id);
  }, [seed, length, volatility, interval]);
  return series;
}
