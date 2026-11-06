import { useEffect, useRef, useState } from "react";
import { WorldPanel } from "./panel";

const SYMBOLS = [
  ["FOREXCOM:SPXUSD", "S&P 500"],
  ["NASDAQ:NDX", "Nasdaq 100"],
  ["FOREXCOM:UKXGBP", "FTSE 100"],
  ["INDEX:NKY", "Nikkei 225"],
  ["INDEX:HSI", "Hang Seng"],
  ["TVC:UKOIL", "Brent"],
  ["TVC:GOLD", "Gold"],
  ["FX_IDC:USDINR", "USD/INR"],
  ["TVC:US10Y", "US 10Y"],
] as const;

export function MarketStrip() {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let active = true;
    let script: HTMLScriptElement | null = null;
    const observer = new MutationObserver(() => {
      if (active && element.querySelector("iframe")) setReady(true);
    });
    observer.observe(element, { childList: true, subtree: true });
    const intersection = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || script) return;
      script = document.createElement("script");
      script.async = true;
      script.src = "https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js";
      script.textContent = JSON.stringify({
        symbols: SYMBOLS.map(([proName, title]) => ({ proName, title })),
        showSymbolLogo: false,
        isTransparent: true,
        displayMode: "adaptive",
        colorTheme: "dark",
        locale: "en",
      });
      element.appendChild(script);
      intersection.disconnect();
    });
    intersection.observe(element);
    return () => {
      active = false;
      observer.disconnect();
      intersection.disconnect();
      element.replaceChildren();
    };
  }, []);
  return (
    <WorldPanel
      title="Global markets"
      sources={[]}
      attribution={
        <a
          href="https://www.tradingview.com/markets/"
          target="_blank"
          rel="noreferrer"
          className="hover:underline"
        >
          TradingView · display only · provider timestamps in widget
        </a>
      }
    >
      <div className="tradingview-widget-container min-h-12" ref={host}>
        <div className="tradingview-widget-container__widget" />
        <div className="tradingview-widget-copyright">
          <a href="https://www.tradingview.com/markets/" target="_blank" rel="noreferrer">
            <span className="blue-text">Track all markets on TradingView</span>
          </a>
        </div>
      </div>
      {!ready && (
        <p className="px-3 pb-2 text-[11px] text-muted-foreground">
          Global ticker unavailable or loading. View{" "}
          <a
            href="https://www.tradingview.com/markets/"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            markets on TradingView
          </a>
          .
        </p>
      )}
    </WorldPanel>
  );
}
