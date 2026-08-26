-- =============================================================================
-- Migration 0017: Options Market Data
-- Canonical NFO contracts and append-only provider quote and Greek history.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.option_contracts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        text NOT NULL DEFAULT 'angelone',
  exchange        text NOT NULL DEFAULT 'NFO',
  token           text NOT NULL,
  trading_symbol  text NOT NULL,
  underlying      text NOT NULL,
  expiry_date     date NOT NULL,
  strike_price    numeric(18, 4) NOT NULL,
  option_type     text NOT NULL,
  lot_size        integer NOT NULL,
  instrument_type text NOT NULL,
  is_active       boolean NOT NULL,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT option_contracts_identity_unique UNIQUE (provider, exchange, trading_symbol),
  CONSTRAINT option_contracts_provider_nonempty CHECK (btrim(provider) <> ''),
  CONSTRAINT option_contracts_exchange_nonempty CHECK (btrim(exchange) <> ''),
  CONSTRAINT option_contracts_token_nonempty CHECK (btrim(token) <> ''),
  CONSTRAINT option_contracts_symbol_nonempty CHECK (btrim(trading_symbol) <> ''),
  CONSTRAINT option_contracts_underlying_nonempty CHECK (btrim(underlying) <> ''),
  CONSTRAINT option_contracts_strike_positive CHECK (strike_price > 0),
  CONSTRAINT option_contracts_option_type CHECK (option_type IN ('CE', 'PE')),
  CONSTRAINT option_contracts_lot_size_positive CHECK (lot_size > 0)
);

CREATE INDEX IF NOT EXISTS option_contracts_provider_exchange_token_idx
  ON public.option_contracts(provider, exchange, token);

CREATE INDEX IF NOT EXISTS option_contracts_chain_lookup_idx
  ON public.option_contracts(underlying, expiry_date, strike_price, option_type);

CREATE TABLE IF NOT EXISTS public.option_quote_snapshots (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id             uuid NOT NULL REFERENCES public.option_contracts(id),
  ltp                     numeric(18, 4),
  open                    numeric(18, 4),
  high                    numeric(18, 4),
  low                     numeric(18, 4),
  close                   numeric(18, 4),
  volume                  bigint,
  open_interest           bigint,
  net_change              numeric(18, 4),
  percent_change          numeric(18, 4),
  average_price           numeric(18, 4),
  total_buy_quantity      bigint,
  total_sell_quantity     bigint,
  best_bid_price          numeric(18, 4),
  best_bid_quantity       bigint,
  best_ask_price          numeric(18, 4),
  best_ask_quantity       bigint,
  exchange_feed_at        timestamptz NOT NULL,
  exchange_trade_at       timestamptz,
  received_at             timestamptz NOT NULL DEFAULT now(),
  source                  text NOT NULL,
  CONSTRAINT option_quote_snapshots_contract_feed_unique UNIQUE (contract_id, exchange_feed_at)
);

CREATE INDEX IF NOT EXISTS option_quote_snapshots_contract_feed_idx
  ON public.option_quote_snapshots(contract_id, exchange_feed_at DESC);

CREATE TABLE IF NOT EXISTS public.option_greek_snapshots (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id         uuid NOT NULL REFERENCES public.option_contracts(id),
  delta               numeric(18, 8),
  gamma               numeric(18, 8),
  theta               numeric(18, 8),
  vega                numeric(18, 8),
  implied_volatility  numeric(18, 8),
  trade_volume        bigint,
  observed_at         timestamptz NOT NULL,
  source              text NOT NULL
);

CREATE INDEX IF NOT EXISTS option_greek_snapshots_contract_observed_idx
  ON public.option_greek_snapshots(contract_id, observed_at DESC);

CREATE OR REPLACE FUNCTION public.reject_option_snapshot_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'option snapshots are append-only';
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'option_quote_snapshots_append_only'
      AND tgrelid = 'public.option_quote_snapshots'::regclass
  ) THEN
    CREATE TRIGGER option_quote_snapshots_append_only
      BEFORE UPDATE OR DELETE ON public.option_quote_snapshots
      FOR EACH ROW EXECUTE FUNCTION public.reject_option_snapshot_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'option_greek_snapshots_append_only'
      AND tgrelid = 'public.option_greek_snapshots'::regclass
  ) THEN
    CREATE TRIGGER option_greek_snapshots_append_only
      BEFORE UPDATE OR DELETE ON public.option_greek_snapshots
      FOR EACH ROW EXECUTE FUNCTION public.reject_option_snapshot_mutation();
  END IF;
END $$;

ALTER TABLE public.option_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.option_quote_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.option_greek_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.option_contracts FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE public.option_quote_snapshots FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE public.option_greek_snapshots FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.option_contracts FROM authenticated';
    EXECUTE 'REVOKE ALL ON TABLE public.option_quote_snapshots FROM authenticated';
    EXECUTE 'REVOKE ALL ON TABLE public.option_greek_snapshots FROM authenticated';
  END IF;
END $$;
