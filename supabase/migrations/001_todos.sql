-- Run this in Supabase SQL Editor or via CLI migrations

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  categories text[] not null default '{}',
  notes text,
  due_date date,
  for_today boolean not null default false,
  completed_at timestamptz,
  sort_key bigint not null default (extract(epoch from now()) * 1000)::bigint,
  created_at timestamptz not null default now()
);

create index if not exists todos_user_id_idx on public.todos (user_id);
create index if not exists todos_completed_at_idx on public.todos (completed_at);

alter table public.todos enable row level security;

create policy "Users read own todos"
  on public.todos for select
  using (auth.uid() = user_id);

create policy "Users insert own todos"
  on public.todos for insert
  with check (auth.uid() = user_id);

create policy "Users update own todos"
  on public.todos for update
  using (auth.uid() = user_id);

create policy "Users delete own todos"
  on public.todos for delete
  using (auth.uid() = user_id);
