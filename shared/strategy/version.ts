/**
 * Strategy engine version constants.
 * All persisted strategy versions must include these to enable reproducibility.
 * The indicator engine version is INDICATOR_ENGINE_VERSION in shared/indicators/canonical.ts.
 */

/** 4.0.0: exit rules fill before intrabar stops/targets, ON_CLOSE honoured, entry-bar stops, prior-bar sizing. */
export const STRATEGY_ENGINE_VERSION = "4.0.0";
export const STRATEGY_SCHEMA_VERSION = 1;

/** 4.0.0: cash-funded portfolio positions, single-counted costs, Sharpe/Sortino on excess returns. */
export const BACKTEST_ENGINE_VERSION = "4.0.0";

/** Version of the execution fee model. 2.0.0: VOLUME_AWARE uses the shared statutory charge schedule per leg. */
export const FEE_MODEL_VERSION = "2.0.0";

/** Version of intrabar policy semantics */
export const INTRABAR_POLICY_VERSION = "1.0.0";
