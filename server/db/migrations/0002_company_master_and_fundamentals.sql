create table if not exists companies (
  id text primary key,
  symbol text not null unique,
  name text not null,
  exchange text not null,
  series text not null default 'EQ',
  isin text,
  listing_date timestamptz,
  market_lot integer,
  sector text,
  industry text,
  market_cap numeric(24,2),
  pe_ratio numeric(8,4),
  pb_ratio numeric(8,4),
  roe numeric(8,4),
  dividend_yield numeric(8,4),
  eps numeric(8,4),
  debt_to_equity numeric(8,4),
  face_value numeric(8,4),
  is_active boolean default true,
  data_source text not null default 'nse',
  last_master_update timestamptz,
  last_fundamentals_update timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists companies_symbol_idx on companies(symbol);
create index if not exists companies_sector_idx on companies(sector);
create index if not exists companies_exchange_idx on companies(exchange);

alter table companies add column if not exists series text not null default 'EQ';
alter table companies add column if not exists listing_date timestamptz;
alter table companies add column if not exists market_lot integer;
alter table companies add column if not exists data_source text not null default 'nse';
alter table companies add column if not exists last_master_update timestamptz;

create table if not exists financial_statements (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  period_date timestamptz not null,
  period_type text not null,
  fiscal_year integer not null,
  currency text not null default 'INR',
  revenue numeric(24,2),
  cost_of_revenue numeric(24,2),
  operating_income numeric(24,2),
  ebitda numeric(24,2),
  ebit numeric(24,2),
  interest_expense numeric(24,2),
  tax_expense numeric(24,2),
  net_income numeric(24,2),
  total_assets numeric(24,2),
  current_assets numeric(24,2),
  inventory numeric(24,2),
  cash_and_equivalents numeric(24,2),
  total_liabilities numeric(24,2),
  current_liabilities numeric(24,2),
  total_debt numeric(24,2),
  shareholders_equity numeric(24,2),
  operating_cash_flow numeric(24,2),
  capital_expenditure numeric(24,2),
  dividends_paid numeric(24,2),
  shares_outstanding numeric(24,2),
  source text not null,
  source_url text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, period_date, period_type)
);
create index if not exists financial_statements_company_idx on financial_statements(company_id, period_date desc);

create table if not exists fundamentals (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  period_date timestamptz not null,
  period_type text not null default 'quarterly',
  pe_ratio numeric(8,4), pb_ratio numeric(8,4), roe numeric(8,4),
  market_cap numeric(24,2), dividend_yield numeric(8,4), eps numeric(8,4),
  debt_to_equity numeric(8,4), revenue numeric(24,2), net_income numeric(24,2),
  source text not null default 'nse', raw jsonb, created_at timestamptz default now()
);
create index if not exists fundamentals_company_idx on fundamentals(company_id, period_date desc);

alter table fundamentals add column if not exists gross_margin numeric(10,4);
alter table fundamentals add column if not exists operating_margin numeric(10,4);
alter table fundamentals add column if not exists ebitda_margin numeric(10,4);
alter table fundamentals add column if not exists net_margin numeric(10,4);
alter table fundamentals add column if not exists return_on_assets numeric(10,4);
alter table fundamentals add column if not exists return_on_invested_capital numeric(10,4);
alter table fundamentals add column if not exists current_ratio numeric(10,4);
alter table fundamentals add column if not exists quick_ratio numeric(10,4);
alter table fundamentals add column if not exists interest_coverage numeric(10,4);
alter table fundamentals add column if not exists asset_turnover numeric(10,4);
alter table fundamentals add column if not exists free_cash_flow numeric(24,2);
alter table fundamentals add column if not exists free_cash_flow_margin numeric(10,4);
alter table fundamentals add column if not exists revenue_growth numeric(10,4);
alter table fundamentals add column if not exists net_income_growth numeric(10,4);
alter table fundamentals add column if not exists eps_growth numeric(10,4);
alter table fundamentals add column if not exists payout_ratio numeric(10,4);
alter table fundamentals add column if not exists earnings_yield numeric(10,4);
alter table fundamentals add column if not exists free_cash_flow_yield numeric(10,4);
alter table fundamentals add column if not exists enterprise_value_to_ebitda numeric(10,4);

alter table companies enable row level security;
alter table financial_statements enable row level security;
alter table fundamentals enable row level security;

create policy "public company master read" on companies for select using (true);
create policy "public financial statements read" on financial_statements for select using (true);
create policy "public fundamentals read" on fundamentals for select using (true);
