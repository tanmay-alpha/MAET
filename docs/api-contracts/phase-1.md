# Phase 1 API contracts — Data foundation

All endpoints rooted at `VITE_API_URL`. Auth via `Authorization: Bearer <token>` from `localStorage.auth_token`.

## GET /api/search

Symbol search for the global Cmd-K palette.

Query: `q` (string, ≥1), `limit` (number, default 20).

Response 200:
```json
{
  "results": [
    { "symbol": "RELIANCE", "name": "Reliance Industries Ltd", "exchange": "NSE", "segment": "EQ", "isin": "INE002A01018", "token": "2885" }
  ]
}
```

## GET /api/instruments

Server-paginated universe.

Query: `exchange` (`NSE`|`BSE`), `segment` (`EQ`|`INDEX`|`FUT`|`OPT`), `cursor` (opaque string), `limit` (default 100).

Response 200:
```json
{
  "items": [{ "symbol": "RELIANCE", "name": "Reliance Industries Ltd", "exchange": "NSE", "segment": "EQ", "isin": "INE002A01018", "token": "2885", "mcap": 19834500000000 }],
  "nextCursor": "eyJvIjoxMDB9"
}
```

## GET /api/index/:symbol

Index constituents + weights + intraday contribution.

Response 200:
```json
{
  "symbol": "NIFTY",
  "ltp": 23456.78,
  "chg": 0.42,
  "constituents": [{ "symbol": "RELIANCE", "weight": 9.85, "contribution": 0.12 }]
}
```

## /api/watchlists

`GET` → `{ lists: [{ id, name, symbols: SymbolRef[] }] }`
`POST` `{ name }` → `{ id }`
`PUT /:id` `{ name?, symbols? }`
`DELETE /:id`

## POST /api/screener/run

Request:
```json
{ "filters": [{ "field": "mcap", "op": ">", "value": 1e11 }], "sort": { "field": "chgPct", "dir": "desc" }, "limit": 100 }
```

Response 200: `{ "rows": [{ "symbol": "...", "ltp": 0, "chgPct": 0, "mcap": 0, "pe": 0 }], "total": 0 }`

## Error shape (all endpoints)

```json
{ "code": "rate_limited", "message": "Try again in 5s." }
```
HTTP status is the truth; body is for hint text.
