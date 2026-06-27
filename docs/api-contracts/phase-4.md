# Phase 4 API contracts — Derivatives

## GET /api/options/:underlying

Query: `expiry` (ISO date) — optional; defaults to nearest expiry.

Response 200:
```json
{
  "underlying": "NIFTY",
  "spot": 23456.78,
  "expiries": ["2026-07-03", "2026-07-10", "2026-07-31"],
  "expiry": "2026-07-03",
  "atm": 23450,
  "strikes": [
    {
      "strike": 23400,
      "ce": { "ltp": 0, "bid": 0, "ask": 0, "oi": 0, "oiChg": 0, "vol": 0, "iv": 0, "delta": 0, "gamma": 0, "theta": 0, "vega": 0, "rho": 0 },
      "pe": { "ltp": 0, "bid": 0, "ask": 0, "oi": 0, "oiChg": 0, "vol": 0, "iv": 0, "delta": 0, "gamma": 0, "theta": 0, "vega": 0, "rho": 0 }
    }
  ],
  "summary": { "maxPain": 23450, "pcrOi": 0.92, "pcrVol": 1.04 }
}
```

## GET /api/futures

Query: `segment` (`NFO` | `MCX`).

Response 200:
```json
{ "rows": [{ "symbol": "RELIANCE25JULFUT", "underlying": "RELIANCE", "expiry": "2026-07-31", "ltp": 0, "basis": 0, "oi": 0, "oiChg": 0, "rolloverPct": 0 }] }
```

## POST /api/margin/estimate

Request:
```json
{ "legs": [{ "symbol": "NIFTY25JUL23500CE", "qty": 50, "side": "BUY" }] }
```

Response 200:
```json
{ "span": 0, "exposure": 0, "total": 0, "breakdown": [] }
```

## Safety

All option/futures surfaces are research-only. The strategy builder computes
client-side payoffs once chain LTPs are real, but **never places orders**.
