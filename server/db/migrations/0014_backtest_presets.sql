-- Migration 0014: Add Backtest Presets Table
CREATE TABLE IF NOT EXISTS public.backtest_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  strategy varchar(50) NOT NULL,
  parameters jsonb NOT NULL,
  risk_config jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_backtest_presets_user_id ON public.backtest_presets(user_id);
CREATE INDEX IF NOT EXISTS idx_backtest_presets_created_at ON public.backtest_presets(created_at);
