-- Migration: 0007_schema_expansion.sql
-- Description: Expand database schema to support Option Chains, Corporate Actions, Shareholding Patterns, Bulk/Block Deals, and Index Valuations. Add indexes on companies table for performance.

-- 1. Options Chain & Derivatives Data
CREATE TABLE IF NOT EXISTS public.option_chain (
    symbol TEXT NOT NULL,
    expiry_date TIMESTAMPTZ NOT NULL,
    strike_price NUMERIC(18, 2) NOT NULL,
    option_type TEXT NOT NULL,
    price NUMERIC(18, 4) NOT NULL,
    open_interest INTEGER NOT NULL DEFAULT 0,
    change_in_oi INTEGER NOT NULL DEFAULT 0,
    implied_volatility NUMERIC(8, 4),
    delta NUMERIC(6, 4),
    gamma NUMERIC(6, 4),
    theta NUMERIC(6, 4),
    vega NUMERIC(6, 4),
    as_of TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (symbol, expiry_date, strike_price, option_type, as_of)
);
CREATE INDEX IF NOT EXISTS option_chain_symbol_expiry_idx ON public.option_chain(symbol, expiry_date);

-- 2. Corporate Actions
CREATE TABLE IF NOT EXISTS public.corporate_actions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    symbol TEXT NOT NULL,
    action_type TEXT NOT NULL,
    announcement_date TIMESTAMPTZ,
    record_date TIMESTAMPTZ,
    ex_date TIMESTAMPTZ,
    details TEXT,
    ratio_numerator INTEGER,
    ratio_denominator INTEGER,
    amount NUMERIC(12, 4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS corp_actions_symbol_ex_date_idx ON public.corporate_actions(symbol, ex_date);

-- 3. Shareholding Patterns
CREATE TABLE IF NOT EXISTS public.shareholding_patterns (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    symbol TEXT NOT NULL,
    quarter_end_date TIMESTAMPTZ NOT NULL,
    promoter_pct NUMERIC(5, 2) NOT NULL,
    fii_pct NUMERIC(5, 2) NOT NULL,
    dii_pct NUMERIC(5, 2) NOT NULL,
    public_pct NUMERIC(5, 2) NOT NULL,
    pledged_pct NUMERIC(5, 2) DEFAULT 0.00,
    as_of TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shareholding_symbol_date_idx ON public.shareholding_patterns(symbol, quarter_end_date);

-- 4. Bulk & Block Deals (Institutional Deals)
CREATE TABLE IF NOT EXISTS public.institutional_deals (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    symbol TEXT NOT NULL,
    deal_date TIMESTAMPTZ NOT NULL,
    deal_type TEXT NOT NULL,
    client_name TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    price NUMERIC(18, 4) NOT NULL,
    value_in_crs NUMERIC(12, 2),
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deals_symbol_date_idx ON public.institutional_deals(symbol, deal_date);

-- 5. Sector and Index Valuations
CREATE TABLE IF NOT EXISTS public.index_valuations (
    index_name TEXT PRIMARY KEY,
    pe_ratio NUMERIC(8, 2),
    pb_ratio NUMERIC(8, 2),
    dividend_yield NUMERIC(5, 2),
    as_of TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Performance Indexing Optimization on Companies table
CREATE INDEX IF NOT EXISTS companies_symbol_idx ON public.companies(symbol);
CREATE INDEX IF NOT EXISTS companies_sector_idx ON public.companies(sector);
CREATE INDEX IF NOT EXISTS companies_exchange_idx ON public.companies(exchange);
