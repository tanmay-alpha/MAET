export type Symbol = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  volume: string;
};

export const WATCHLIST: Symbol[] = [
  { symbol: "RELIANCE", name: "Reliance Industries", price: 2945.30, change: 32.15, changePct: 1.10, volume: "4.2M" },
  { symbol: "TCS", name: "Tata Consultancy Svc", price: 4128.55, change: -18.40, changePct: -0.44, volume: "1.8M" },
  { symbol: "HDFCBANK", name: "HDFC Bank", price: 1672.90, change: 12.25, changePct: 0.74, volume: "6.1M" },
  { symbol: "INFY", name: "Infosys", price: 1845.10, change: 8.55, changePct: 0.47, volume: "3.4M" },
  { symbol: "ICICIBANK", name: "ICICI Bank", price: 1245.65, change: -4.10, changePct: -0.33, volume: "5.2M" },
  { symbol: "BHARTIARTL", name: "Bharti Airtel", price: 1532.40, change: 22.80, changePct: 1.51, volume: "2.9M" },
  { symbol: "ITC", name: "ITC Limited", price: 472.15, change: 1.05, changePct: 0.22, volume: "8.7M" },
  { symbol: "LT", name: "Larsen & Toubro", price: 3654.20, change: -28.55, changePct: -0.78, volume: "1.1M" },
  { symbol: "SBIN", name: "State Bank of India", price: 821.45, change: 6.30, changePct: 0.77, volume: "7.3M" },
  { symbol: "AXISBANK", name: "Axis Bank", price: 1158.90, change: -9.20, changePct: -0.79, volume: "3.6M" },
  { symbol: "MARUTI", name: "Maruti Suzuki", price: 12845.00, change: 142.50, changePct: 1.12, volume: "0.4M" },
  { symbol: "HINDUNILVR", name: "Hindustan Unilever", price: 2412.30, change: -5.85, changePct: -0.24, volume: "1.5M" },
];

export const INDICES = [
  { symbol: "NIFTY 50", price: 24812.05, change: 142.30, changePct: 0.58 },
  { symbol: "BANK NIFTY", price: 51245.80, change: -88.45, changePct: -0.17 },
  { symbol: "SENSEX", price: 81342.10, change: 412.65, changePct: 0.51 },
  { symbol: "NIFTY IT", price: 41250.30, change: 215.40, changePct: 0.52 },
  { symbol: "NIFTY FMCG", price: 58320.15, change: -125.80, changePct: -0.21 },
  { symbol: "INDIA VIX", price: 13.42, change: -0.28, changePct: -2.04 },
];

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export function generateCandles(count = 120, start = 2900): Candle[] {
  const data: Candle[] = [];
  let last = start;
  for (let i = 0; i < count; i++) {
    const drift = (Math.sin(i / 8) + (Math.random() - 0.5)) * 8;
    const o = last;
    const c = +(o + drift).toFixed(2);
    const h = +(Math.max(o, c) + Math.random() * 6).toFixed(2);
    const l = +(Math.min(o, c) - Math.random() * 6).toFixed(2);
    data.push({ t: Date.now() - (count - i) * 60_000, o, h, l, c, v: Math.floor(Math.random() * 1e6) });
    last = c;
  }
  return data;
}

export const STRATEGIES = [
  { id: "1", name: "Nifty Momentum Burst", type: "Intraday", asset: "NIFTY", status: "Live", pnl: 28450, winRate: 64, trades: 142, sharpe: 1.82 },
  { id: "2", name: "Bank Nifty Mean Reversion", type: "Intraday", asset: "BANKNIFTY", status: "Live", pnl: 14230, winRate: 58, trades: 89, sharpe: 1.35 },
  { id: "3", name: "Reliance Breakout v3", type: "Swing", asset: "RELIANCE", status: "Paused", pnl: -3420, winRate: 47, trades: 24, sharpe: 0.42 },
  { id: "4", name: "IT Sector Rotation", type: "Positional", asset: "Multi", status: "Live", pnl: 52810, winRate: 71, trades: 38, sharpe: 2.14 },
  { id: "5", name: "Options Iron Condor", type: "Weekly", asset: "NIFTY", status: "Backtest", pnl: 0, winRate: 68, trades: 0, sharpe: 1.91 },
  { id: "6", name: "Volatility Crush Theta", type: "Weekly", asset: "BANKNIFTY", status: "Live", pnl: 9120, winRate: 62, trades: 56, sharpe: 1.48 },
];

export const POSITIONS = [
  { symbol: "RELIANCE", qty: 50, avg: 2912.40, ltp: 2945.30, pnl: 1645.00 },
  { symbol: "INFY", qty: 100, avg: 1851.20, ltp: 1845.10, pnl: -610.00 },
  { symbol: "HDFCBANK", qty: 75, avg: 1658.15, ltp: 1672.90, pnl: 1106.25 },
  { symbol: "TCS", qty: 25, avg: 4145.00, ltp: 4128.55, pnl: -411.25 },
];

export const ORDERS = [
  { time: "10:42:15", symbol: "RELIANCE", side: "BUY", qty: 50, price: 2912.40, status: "Filled" },
  { time: "10:38:02", symbol: "BANKNIFTY", side: "SELL", qty: 25, price: 51280.00, status: "Filled" },
  { time: "10:31:48", symbol: "INFY", side: "BUY", qty: 100, price: 1851.20, status: "Filled" },
  { time: "10:24:30", symbol: "TCS", side: "BUY", qty: 25, price: 4145.00, status: "Filled" },
  { time: "10:18:11", symbol: "HDFC", side: "SELL", qty: 30, price: 1665.50, status: "Cancelled" },
];

export function equityCurve(points = 60) {
  const arr: { x: number; y: number }[] = [];
  let y = 100000;
  for (let i = 0; i < points; i++) {
    y += (Math.random() - 0.4) * 2500 + 800;
    arr.push({ x: i, y: Math.round(y) });
  }
  return arr;
}
