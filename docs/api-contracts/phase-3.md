# Phase 3 API contracts — Discovery & fundamentals

## GET /api/fundamentals/:symbol

Single response with everything the stock detail tabs need.

Response 200:
```json
{
  "overview": { "name": "Reliance Industries Ltd", "sector": "Energy", "industry": "Refineries", "description": "...", "mcap": 1.98e13, "pe": 24.5, "pb": 2.1, "eps": 102.3, "divYield": 0.4, "low52": 2230, "high52": 3100, "beta": 0.92, "bookValue": 1240 },
  "financials": { "quarterly": [{ "period": "Q1 FY26", "revenue": 0, "ebitda": 0, "pat": 0 }], "annual": [{ "period": "FY25", "revenue": 0, "ebitda": 0, "pat": 0 }] },
  "ratios": { "roe": 0, "roce": 0, "debtEquity": 0, "currentRatio": 0, "interestCoverage": 0 },
  "shareholding": [{ "period": "Q1 FY26", "promoter": 50.1, "fii": 23.4, "dii": 14.2, "public": 12.3 }],
  "peers": [{ "symbol": "ONGC", "mcap": 0, "pe": 0, "roe": 0 }],
  "actions": [{ "date": "2025-08-10", "type": "split", "details": "1:5 split" }],
  "dividends": [{ "exDate": "2025-09-12", "amount": 8, "type": "interim" }]
}
```

## GET /api/screens

Saved screens for the screener.

Response 200:
```json
{ "screens": [{ "id": "abc", "name": "High ROCE small caps", "filters": [{ "field": "roce", "op": ">", "value": 25 }] }] }
```

`POST /api/screens` body: `{ name, filters }` → `{ id }`
`DELETE /api/screens/:id`
