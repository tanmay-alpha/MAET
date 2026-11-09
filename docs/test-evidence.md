# Test evidence

Every number here was produced by the command shown, on Windows 11 with Bun 1.3.14,
against disposable Docker containers (`postgres:16` on `127.0.0.1:58432`, `redis:7` on
`127.0.0.1:59379`). No production data, accounts or broker endpoints were used.

## Baseline at `49dcad5` (before changes)

| Command | Result |
|---|---|
| `bun run typecheck` | clean (frontend + server) |
| `bun run lint` | clean |
| `bun run check:test-wiring` | 209 tracked test files wired |
| `bun run test:unit` | 1147 pass, 0 fail, 164 files |
| `bun run test:integration` (`TEST_DATABASE_URL=…58432/maet_test`) | 64 pass, 0 fail, 9 files |
| `bun run test:concurrency` | 7 pass, 0 fail |
| `bun run test:advanced` | 286 pass, 0 fail across 27 suites (incl. migrations 0013–0028 and the migration runner) |

Gaps in the baseline suite:
- CI runs the server only under Bun; production runs it under Node. `Promise.withResolvers`
  (Node ≥ 22) passed every test and crashed `/api/paper/stream` on Render's Node 20.
- No test exercised readiness, deployed revisions or the frontend/backend version pairing.
- Playwright ran Chromium only, against a mock API, with no sign-in flow (none existed).

## After changes

Recorded per pull request below as each lands.
