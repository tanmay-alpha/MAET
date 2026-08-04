import { createRouter } from "./core";
import { marketRouter } from "./routers/market";
import { ordersRouter } from "./routers/orders";
import { alertsRouter } from "./routers/alerts";
import { screenerRouter } from "./routers/screener";
import { portfolioRouter } from "./routers/portfolio";
import { companiesRouter } from "./routers/companies";
import { analysisRouter } from "./routers/analysis";
import { ingestionRouter } from "./routers/ingestion";
import { paperTradingRouter } from "./routers/paper-trading";
import { capabilitiesRouter } from "./routers/capabilities";
import { workspaceRouter } from "./routers/workspace";
import { alertsEngineRouter } from "./routers/alerts-engine";
import { dataQualityRouter } from "./routers/data-quality";
import { marketBreadthRouter } from "./routers/market-breadth";
import { screenerDslRouter } from "./routers/screener-dsl";
import { backtestV2Router } from "./routers/backtest-v2";
import { chartWorkspacesRouter } from "./routers/chart-workspaces";
import { tradeThesesRouter } from "./routers/trade-theses";
import { strategyDefinitionsRouter } from "./routers/strategy-definitions";
import { strategyBacktestsRouter } from "./routers/strategy-backtests";
import { strategyOptimisationRouter } from "./routers/strategy-optimisation";
import { strategyReplayRouter } from "./routers/strategy-replay";
import { strategyDeploymentsRouter } from "./routers/strategy-deployments";

export const appRouter = createRouter({
  market: marketRouter,
  orders: ordersRouter,
  alerts: alertsRouter,
  screener: screenerRouter,
  portfolio: portfolioRouter,
  companies: companiesRouter,
  analysis: analysisRouter,
  ingestion: ingestionRouter,
  paperTrading: paperTradingRouter,
  capabilities: capabilitiesRouter,
  workspace: workspaceRouter,
  alertsEngine: alertsEngineRouter,
  dataQuality: dataQualityRouter,
  marketBreadth: marketBreadthRouter,
  screenerDsl: screenerDslRouter,
  backtestV2: backtestV2Router,
  chartWorkspaces: chartWorkspacesRouter,
  tradeTheses: tradeThesesRouter,
  // Phase 3 — Strategy Lab
  strategyDefinitions: strategyDefinitionsRouter,
  strategyBacktests: strategyBacktestsRouter,
  strategyOptimisation: strategyOptimisationRouter,
  strategyReplay: strategyReplayRouter,
  strategyDeployments: strategyDeploymentsRouter,
});

export const router = appRouter;
export type AppRouter = typeof appRouter;
export { publicProcedure, protectedProcedure } from "./core";
export type { Context } from "./core";
