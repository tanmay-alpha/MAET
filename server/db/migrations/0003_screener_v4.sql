alter table companies add column if not exists bse_code text;
alter table companies add column if not exists yahoo_symbol text;
alter table companies add column if not exists exchange_primary text not null default 'NSE';
alter table companies add column if not exists market_cap_bucket text not null default 'unknown';
create index if not exists companies_isin_idx on companies(isin);
create index if not exists companies_market_cap_bucket_idx on companies(market_cap_bucket);

create table if not exists company_identifiers (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references companies(id) on delete cascade,
  identifier_type text not null,
  identifier_value text not null,
  source text not null,
  verified_at timestamptz not null default now(),
  unique(identifier_type, identifier_value)
);
create index if not exists company_identifiers_company_idx on company_identifiers(company_id);

create table if not exists quote_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references companies(id) on delete cascade,
  price numeric(18,4) not null,
  change_pct numeric(10,4),
  volume bigint,
  market_cap numeric(24,2),
  as_of timestamptz not null,
  source text not null,
  unique(company_id, as_of)
);
create index if not exists quote_snapshots_company_as_of_idx on quote_snapshots(company_id, as_of desc);

alter table financial_statements add column if not exists statement_type text not null default 'combined';
alter table financial_statements add column if not exists as_of timestamptz not null default now();
alter table financial_statements drop constraint if exists financial_statements_company_id_period_date_period_type_key;
drop index if exists financial_statements_company_period_unique;
create unique index if not exists financial_statements_company_period_unique
  on financial_statements(company_id, period_date, period_type, statement_type);

alter table fundamentals add column if not exists forward_pe numeric(10,4);
alter table fundamentals add column if not exists book_value_per_share numeric(18,4);
alter table fundamentals add column if not exists roce numeric(10,4);
alter table fundamentals add column if not exists fifty_two_week_high numeric(18,4);
alter table fundamentals add column if not exists fifty_two_week_low numeric(18,4);
alter table fundamentals add column if not exists average_20_day_volume bigint;
alter table fundamentals add column if not exists relative_volume numeric(12,4);
alter table fundamentals add column if not exists source_flags jsonb;
alter table fundamentals add column if not exists is_stale boolean not null default false;

create table if not exists market_cap_classifications (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references companies(id) on delete cascade,
  classification_version text not null,
  bucket text not null check (bucket in ('large', 'mid', 'small', 'micro', 'unknown')),
  methodology text not null,
  effective_from timestamptz not null,
  effective_to timestamptz,
  source text not null,
  unique(company_id, classification_version)
);
create index if not exists market_cap_classification_bucket_idx
  on market_cap_classifications(bucket, effective_from desc);

alter table company_identifiers enable row level security;
alter table quote_snapshots enable row level security;
alter table market_cap_classifications enable row level security;

drop policy if exists "public company identifiers read" on company_identifiers;
create policy "public company identifiers read" on company_identifiers for select using (true);
drop policy if exists "public quote snapshots read" on quote_snapshots;
create policy "public quote snapshots read" on quote_snapshots for select using (true);
drop policy if exists "public market cap classifications read" on market_cap_classifications;
create policy "public market cap classifications read" on market_cap_classifications for select using (true);
