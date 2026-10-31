-- Run once in the SQL editor of your Supabase project.
-- Only the Python server uses the service-role key. No public policies are created.
create table if not exists public.mesa_characters (
  room text not null,
  slot integer not null check (slot between 1 and 5),
  version integer not null check (version > 0),
  token_hash text not null,
  document jsonb not null,
  primary key (room, slot)
);
alter table public.mesa_characters enable row level security;
revoke all on table public.mesa_characters from anon, authenticated;
grant all on table public.mesa_characters to service_role;
