# Phase 5 API contracts — Broker surfaces, alerts, news (paper-only)

> Paper mode is enforced in code (`src/lib/paper-mode.ts`). No endpoint here
> places, modifies, or cancels a real broker order. Broker surfaces are
> read-only in this build.

## GET /api/broker/status

```json
{ "connected": false, "broker": null, "lastTokenRefresh": null, "sessionValidUntil": null }
```

## GET /api/broker/holdings
```json
{ "rows": [{ "symbol": "RELIANCE", "qty": 0, "avgPrice": 0, "ltp": 0, "dayPnl": 0, "totalPnl": 0, "allocationPct": 0 }] }
```

## GET /api/broker/orders
```json
{ "rows": [{ "id": "o1", "symbol": "RELIANCE", "side": "BUY", "qty": 1, "price": 0, "type": "LIMIT", "status": "OPEN", "ts": 0 }] }
```

## GET /api/broker/trades
```json
{ "rows": [{ "id": "t1", "orderId": "o1", "symbol": "RELIANCE", "side": "BUY", "qty": 1, "price": 0, "ts": 0 }] }
```

## GET /api/broker/positions
```json
{ "intraday": [{ "symbol": "RELIANCE", "qty": 0, "avgPrice": 0, "ltp": 0, "pnl": 0 }], "fno": [] }
```

## /api/alerts

`GET` → `{ alerts: [{ id, symbol, kind, op, value, channel, active }] }`
`POST` body `{ symbol, kind, op, value, channel }` → `{ id }`
`DELETE /:id`

`GET /api/alerts/history` → `{ events: [{ id, alertId, ts, message }] }`

Delivery channels: `in-app | push | email | webhook`.

## GET /api/news

Query: `symbol?`, `cursor?`, `limit?`.

```json
{ "items": [{ "id": "n1", "title": "...", "source": "Reuters", "url": "https://...", "publishedAt": 0, "symbols": ["RELIANCE"], "sentiment": "neutral" }], "nextCursor": null }
```

## GET /api/calendar

Query: `type` (`earnings` | `ipo` | `economic` | `rbi`), `from`, `to`.

```json
{ "events": [{ "id": "e1", "type": "earnings", "symbol": "TCS", "date": "2026-07-10", "importance": "high", "expected": null, "actual": null }] }
```
