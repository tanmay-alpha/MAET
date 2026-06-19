import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MAET — Scan the market. Chart it. Paper-trade before you risk it.",
  description:
    "MAET is a research and scanner terminal for Indian markets — NSE/BSE coverage, live charts, paper trading, and strategy prototyping.",
  openGraph: {
    title: "MAET — Research & scanner terminal",
    description: "Scan, chart, and paper-trade Indian markets.",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Instrument+Serif:ital@0;1&display=swap"
        />
      </head>
      <body className="dark bg-background text-foreground">{children}</body>
    </html>
  );
}
