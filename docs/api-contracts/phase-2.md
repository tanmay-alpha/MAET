# Phase 2 API contracts — Charting & analysis

## GET /api/layouts

Saved chart layouts per user.

Response 200:
```json
{ "layouts": [{ "id": "abc", "name": "Day setup", "symbol": "RELIANCE", "tf": "15m", "indicators": ["EMA(20)", "VWAP"], "drawings": [] }] }
```

`POST /api/layouts` body: `{ name, symbol, tf, indicators, drawings }` → `{ id }`
`DELETE /api/layouts/:id`

## GET /api/sectors

Sector heatmap tree.

Response 200:
```json
{
  "sectors": [
    { "name": "Banks", "mcap": 1.2e13, "chgPct": 0.4,
      "industries": [{ "name": "Private Banks", "mcap": 8e12, "chgPct": 0.6,
        "stocks": [{ "symbol": "HDFCBANK", "mcap": 1.2e13, "chgPct": 0.2, "ltp": 1620.5 }] }] }
  ]
}
```

## Reused live endpoints

- `/api/market/candles?symbol=&tf=&range=` — OHLCV for chart render.
- `/api/market/stream?symbols=` — SSE last-bar stream for live updating chart.
