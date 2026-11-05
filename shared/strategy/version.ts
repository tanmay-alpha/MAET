/**
 * Strategy engine version constants.
 * All persisted strategy versions must include these to enable reproducibility.
 */

export const STRATEGY_ENGINE_VERSION = "3.0.0";
export const INDICATOR_ENGINE_VERSION = "1.0.0";
export const STRATEGY_SCHEMA_VERSION = 1;

export const BACKTEST_ENGINE_VERSION = "3.0.0";

/** Version of the execution fee model. 2.0.0: VOLUME_AWARE uses the shared statutory charge schedule per leg. */
export const FEE_MODEL_VERSION = "2.0.0";

/** Version of intrabar policy semantics */
export const INTRABAR_POLICY_VERSION = "1.0.0";
