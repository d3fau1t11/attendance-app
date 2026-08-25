create table if not exists attendance_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  employee_id text not null,
  event_type text not null check (event_type in ('check_in', 'check_out')),
  workplace_id text not null,
  occurred_at timestamptz not null,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_meters double precision not null,
  qr_token text not null,
  is_mock_location boolean not null default false,
  source text not null default 'online',
  created_at timestamptz not null default now()
);

create table if not exists attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null,
  workplace_name text not null,
  status text not null check (status in ('checked_in', 'checked_out', 'needs_review')),
  check_in_at timestamptz not null,
  check_out_at timestamptz,
  duration_minutes integer,
  created_at timestamptz not null default now()
);

create index if not exists attendance_events_employee_occurred_idx
  on attendance_events (employee_id, occurred_at desc);

create index if not exists attendance_sessions_employee_checkin_idx
  on attendance_sessions (employee_id, check_in_at desc);

alter table attendance_events enable row level security;
alter table attendance_sessions enable row level security;