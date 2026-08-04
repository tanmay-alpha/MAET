-- Migration 0015: TradingView Research Workspace & Intelligence Schema

CREATE TABLE IF NOT EXISTS "chart_workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" varchar(80) NOT NULL,
  "layout_type" varchar(20) NOT NULL DEFAULT 'SINGLE',
  "active_symbol" varchar(30) NOT NULL DEFAULT 'RELIANCE',
  "active_exchange" varchar(10) NOT NULL DEFAULT 'NSE',
  "is_default" boolean NOT NULL DEFAULT false,
  "schema_version" integer NOT NULL DEFAULT 1,
  "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_chart_workspaces_user_id" ON "chart_workspaces" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_chart_workspaces_updated_at" ON "chart_workspaces" ("updated_at");

CREATE TABLE IF NOT EXISTS "chart_panes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "chart_workspaces"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "pane_key" varchar(30) NOT NULL,
  "symbol" varchar(30) NOT NULL,
  "exchange" varchar(10) NOT NULL DEFAULT 'NSE',
  "timeframe" varchar(10) NOT NULL DEFAULT '5m',
  "chart_type" varchar(20) NOT NULL DEFAULT 'CANDLE',
  "position" integer NOT NULL DEFAULT 0,
  "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_chart_panes_workspace_id" ON "chart_panes" ("workspace_id");
CREATE INDEX IF NOT EXISTS "idx_chart_panes_user_id" ON "chart_panes" ("user_id");

CREATE TABLE IF NOT EXISTS "chart_drawings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "chart_workspaces"("id") ON DELETE CASCADE,
  "pane_id" uuid REFERENCES "chart_panes"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "symbol" varchar(30) NOT NULL,
  "exchange" varchar(10) NOT NULL DEFAULT 'NSE',
  "timeframe_scope" varchar(20),
  "drawing_type" varchar(40) NOT NULL,
  "points" jsonb NOT NULL,
  "style" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "label" text,
  "locked" boolean NOT NULL DEFAULT false,
  "visible" boolean NOT NULL DEFAULT true,
  "schema_version" integer NOT NULL DEFAULT 1,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_chart_drawings_workspace_id" ON "chart_drawings" ("workspace_id");
CREATE INDEX IF NOT EXISTS "idx_chart_drawings_user_symbol" ON "chart_drawings" ("user_id", "symbol");

CREATE TABLE IF NOT EXISTS "indicator_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" varchar(80) NOT NULL,
  "indicators" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "is_default" boolean NOT NULL DEFAULT false,
  "schema_version" integer NOT NULL DEFAULT 1,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_indicator_templates_user_id" ON "indicator_templates" ("user_id");

CREATE TABLE IF NOT EXISTS "trade_theses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "company_id" uuid,
  "symbol" varchar(30) NOT NULL,
  "exchange" varchar(10) NOT NULL DEFAULT 'NSE',
  "screener_run_id" varchar(100),
  "workspace_id" uuid REFERENCES "chart_workspaces"("id") ON DELETE SET NULL,
  "title" varchar(120) NOT NULL,
  "setup_type" varchar(50) NOT NULL,
  "direction" varchar(20) NOT NULL,
  "hypothesis" text NOT NULL,
  "entry_plan" text,
  "stop_price" numeric(12, 4),
  "target_price" numeric(12, 4),
  "risk_amount" numeric(12, 4),
  "risk_percent" numeric(6, 3),
  "status" varchar(20) NOT NULL DEFAULT 'DRAFT',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "closed_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "idx_trade_theses_user_id" ON "trade_theses" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_trade_theses_symbol" ON "trade_theses" ("symbol");

CREATE TABLE IF NOT EXISTS "thesis_signals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "thesis_id" uuid NOT NULL REFERENCES "trade_theses"("id") ON DELETE CASCADE,
  "signal_type" varchar(30) NOT NULL,
  "field" varchar(50) NOT NULL,
  "operator" varchar(20) NOT NULL,
  "observed_value" text NOT NULL,
  "target_value" text,
  "source" varchar(50) NOT NULL,
  "source_timestamp" timestamp with time zone,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_thesis_signals_thesis_id" ON "thesis_signals" ("thesis_id");

CREATE TABLE IF NOT EXISTS "thesis_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "thesis_id" uuid NOT NULL REFERENCES "trade_theses"("id") ON DELETE CASCADE,
  "quote_price" numeric(12, 4) NOT NULL,
  "quote_source" varchar(30) NOT NULL,
  "quote_quality" varchar(30) NOT NULL,
  "quote_timestamp" timestamp with time zone NOT NULL,
  "timeframe" varchar(10) NOT NULL,
  "indicator_values" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "fundamental_values" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "matched_filters" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "data_quality_flags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "chart_state" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_thesis_snapshots_thesis_id" ON "thesis_snapshots" ("thesis_id");

CREATE TABLE IF NOT EXISTS "thesis_order_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "thesis_id" uuid NOT NULL REFERENCES "trade_theses"("id") ON DELETE CASCADE,
  "paper_order_id" uuid NOT NULL REFERENCES "paper_orders"("id") ON DELETE CASCADE,
  "relationship" varchar(20) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_thesis_order_links_thesis" ON "thesis_order_links" ("thesis_id");
CREATE INDEX IF NOT EXISTS "idx_thesis_order_links_order" ON "thesis_order_links" ("paper_order_id");

CREATE TABLE IF NOT EXISTS "trade_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "thesis_id" uuid NOT NULL REFERENCES "trade_theses"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "outcome" varchar(20) NOT NULL,
  "review_text" text NOT NULL,
  "planned_entry" numeric(12, 4),
  "average_entry" numeric(12, 4),
  "planned_stop" numeric(12, 4),
  "planned_target" numeric(12, 4),
  "realized_pnl" numeric(14, 4) NOT NULL DEFAULT 0,
  "return_percent" numeric(8, 4) NOT NULL DEFAULT 0,
  "holding_duration_seconds" integer,
  "rule_followed" boolean NOT NULL DEFAULT true,
  "mistakes" text,
  "lessons" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_trade_reviews_thesis_id" ON "trade_reviews" ("thesis_id");
CREATE INDEX IF NOT EXISTS "idx_trade_reviews_user_id" ON "trade_reviews" ("user_id");

-- Enable Row Level Security
ALTER TABLE "chart_workspaces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chart_panes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chart_drawings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "indicator_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trade_theses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "thesis_signals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "thesis_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "thesis_order_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trade_reviews" ENABLE ROW LEVEL SECURITY;

-- Tenant Isolation Policies
DO $$ BEGIN
  CREATE POLICY "chart_workspaces_tenant_isolation" ON "chart_workspaces" FOR ALL USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "chart_panes_tenant_isolation" ON "chart_panes" FOR ALL USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "chart_drawings_tenant_isolation" ON "chart_drawings" FOR ALL USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "indicator_templates_tenant_isolation" ON "indicator_templates" FOR ALL USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "trade_theses_tenant_isolation" ON "trade_theses" FOR ALL USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "trade_reviews_tenant_isolation" ON "trade_reviews" FOR ALL USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
