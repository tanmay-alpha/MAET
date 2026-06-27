create type order_side as enum ('BUY', 'SELL');
create type order_type as enum ('MARKET', 'LIMIT', 'SL', 'SL-M');
create type order_status as enum ('pending', 'partial', 'filled', 'cancelled', 'rejected');

create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table brokers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null default 'angelone',
  encrypted_credentials text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  symbol text not null,
  exchange text not null check (exchange in ('NSE', 'BSE')),
  side order_side not null,
  type order_type not null,
  qty integer not null check (qty > 0),
  limit_price numeric(18,4) check (limit_price is null or limit_price > 0),
  status order_status not null default 'pending',
  idempotency_key text not null,
  reject_reason text,
  placed_at timestamptz not null default now(),
  filled_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index orders_user_placed_idx on orders(user_id, placed_at desc);

create table fills (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  qty integer not null check (qty > 0),
  price numeric(18,4) not null check (price > 0),
  fee numeric(18,4) not null default 0 check (fee >= 0),
  filled_at timestamptz not null default now()
);
create index fills_order_idx on fills(order_id);

create table candles (
  symbol text not null,
  timeframe text not null,
  ts timestamptz not null,
  open numeric(18,4) not null check (open > 0),
  high numeric(18,4) not null check (high > 0),
  low numeric(18,4) not null check (low > 0),
  close numeric(18,4) not null check (close > 0),
  volume bigint not null default 0 check (volume >= 0),
  source text not null default 'yahoo',
  primary key (symbol, timeframe, ts)
);
create index candles_symbol_ts_idx on candles(symbol, ts desc);

create table screener_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  criteria jsonb not null,
  matches jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index screener_runs_user_idx on screener_runs(user_id, started_at desc);

create table backtest_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  symbol text not null,
  timeframe text not null,
  strategy text not null,
  parameters jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index backtest_runs_user_idx on backtest_runs(user_id, created_at desc);

create table watchlist (
  user_id uuid not null references users(id) on delete cascade,
  exchange text not null default 'NSE' check (exchange in ('NSE', 'BSE')),
  symbol text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, exchange, symbol)
);

create table idempotency (
  user_id uuid not null references users(id) on delete cascade,
  key text not null,
  response jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
create index idempotency_expiry_idx on idempotency(expires_at);

alter table users enable row level security;
alter table brokers enable row level security;
alter table orders enable row level security;
alter table fills enable row level security;
alter table screener_runs enable row level security;
alter table backtest_runs enable row level security;
alter table watchlist enable row level security;

create policy "users read own row" on users for select using (auth.uid() = id);
create policy "users update own row" on users for update using (auth.uid() = id);
create policy "brokers own rows" on brokers for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "orders own rows" on orders for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "fills through own orders" on fills for select using (
  exists (select 1 from orders where orders.id = fills.order_id and orders.user_id = auth.uid())
);
create policy "screener runs own rows" on screener_runs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "backtest runs own rows" on backtest_runs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "watchlist own rows" on watchlist for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
