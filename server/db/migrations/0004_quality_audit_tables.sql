-- =============================================================================
-- Migration 0004: source_audit and anomaly_flags tables
--
-- Adds data quality tracking tables for ingestion auditing and anomaly
-- flagging across all data sources (NSE, Angel One, Yahoo).
-- =============================================================================

create table if not exists source_audit (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references companies(id) on delete cascade,
  data_source text not null,
  data_type text not null,
  operation text not null,
  success boolean not null,
  message text,
  duration_ms integer,
  records_processed integer,
  records_inserted integer,
  records_updated integer,
  errors jsonb,
  retry_count integer default 0,
  priority text not null default 'normal',
  batch_id text,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists source_audit_company_idx on source_audit(company_id);
create index if not exists source_audit_source_type_idx on source_audit(data_source, data_type);
create index if not exists source_audit_operation_idx on source_audit(operation);
create index if not exists source_audit_created_idx on source_audit(created_at);
create index if not exists source_audit_completed_idx on source_audit(completed_at);

create table if not exists anomaly_flags (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references companies(id) on delete cascade,
  data_type text not null,
  check_type text not null,
  severity text not null,
  description text not null,
  details jsonb,
  value_expected numeric,
  value_actual numeric,
  threshold numeric,
  is_resolved boolean default false,
  resolved_at timestamptz,
  resolved_by text,
  resolution_note text,
  detected_at timestamptz not null default now(),
  last_notified timestamptz,
  notification_count integer default 0,
  frequency text,
  suppression_until timestamptz,
  source text not null,
  batch_id text,
  created_at timestamptz not null default now()
);
create index if not exists anomaly_flags_company_idx on anomaly_flags(company_id);
create index if not exists anomaly_flags_type_severity_idx on anomaly_flags(data_type, severity);
create index if not exists anomaly_flags_check_type_idx on anomaly_flags(check_type);
create index if not exists anomaly_flags_resolved_idx on anomaly_flags(is_resolved, detected_at);
create index if not exists anomaly_flags_detected_idx on anomaly_flags(detected_at);
