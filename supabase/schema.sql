-- ============================================================
-- MAFIA GAME - Supabase Database Schema
-- Run this in Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- USERS (extends Supabase auth.users)
-- ============================================================
create table public.profiles (
  id           uuid references auth.users(id) on delete cascade primary key,
  username     text unique not null,
  avatar       text default '🦁',
  gems         integer default 500 not null,
  wins         integer default 0 not null,
  losses       integer default 0 not null,
  games_played integer default 0 not null,
  level        integer default 1 not null,
  xp           integer default 0 not null,
  owned_items  jsonb default '[]'::jsonb,
  created_at   timestamptz default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, username, avatar)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'avatar', '🦁')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- ROOMS
-- ============================================================
create table public.rooms (
  id          uuid default uuid_generate_v4() primary key,
  code        text unique not null,
  host_id     uuid references public.profiles(id) on delete cascade not null,
  status      text default 'waiting' check (status in ('waiting','starting','playing','ended')),
  max_players integer default 10,
  settings    jsonb default '{
    "mafia_count": 2,
    "has_doctor": true,
    "has_sheriff": true,
    "has_bodyguard": false,
    "has_mayor": false,
    "has_medium": false,
    "has_jester": false,
    "has_sk": false,
    "has_executioner": false,
    "has_witch": false,
    "has_framer": false,
    "has_consigliere": false,
    "day_duration": 120,
    "night_duration": 45,
    "vote_duration": 30
  }'::jsonb,
  created_at  timestamptz default now()
);

-- Generate random room code
create or replace function generate_room_code()
returns text language plpgsql as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i integer;
begin
  for i in 1..5 loop
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  end loop;
  return result;
end;
$$;

-- ============================================================
-- ROOM PLAYERS (lobby)
-- ============================================================
create table public.room_players (
  id        uuid default uuid_generate_v4() primary key,
  room_id   uuid references public.rooms(id) on delete cascade not null,
  player_id uuid references public.profiles(id) on delete cascade not null,
  seat      integer not null,
  is_ready  boolean default false,
  joined_at timestamptz default now(),
  unique(room_id, player_id),
  unique(room_id, seat)
);

-- ============================================================
-- GAMES
-- ============================================================
create table public.games (
  id          uuid default uuid_generate_v4() primary key,
  room_id     uuid references public.rooms(id) on delete cascade not null,
  phase       text default 'day' check (phase in ('day','voting','night','ended')),
  day_number  integer default 1,
  winner_team text check (winner_team in ('town','mafia','jester','sk','executioner') or winner_team is null),
  phase_ends_at timestamptz,
  started_at  timestamptz default now(),
  ended_at    timestamptz
);

-- ============================================================
-- GAME PLAYERS
-- ============================================================
create table public.game_players (
  id          uuid default uuid_generate_v4() primary key,
  game_id     uuid references public.games(id) on delete cascade not null,
  player_id   uuid references public.profiles(id) on delete cascade not null,
  role        text not null,
  team        text not null check (team in ('town','mafia','neutral')),
  is_alive    boolean default true,
  death_phase text,
  death_day   integer,
  -- role-specific state
  was_saved   boolean default false,
  was_guarded boolean default false,
  is_framed   boolean default false,
  executioner_target uuid references public.profiles(id),
  unique(game_id, player_id)
);

-- ============================================================
-- NIGHT ACTIONS
-- ============================================================
create table public.night_actions (
  id          uuid default uuid_generate_v4() primary key,
  game_id     uuid references public.games(id) on delete cascade not null,
  player_id   uuid references public.profiles(id) on delete cascade not null,
  action_type text not null, -- 'kill','save','investigate','guard','redirect','frame','scout','sk_kill'
  target_id   uuid references public.profiles(id),
  night_num   integer not null,
  created_at  timestamptz default now(),
  unique(game_id, player_id, night_num)
);

-- ============================================================
-- VOTES
-- ============================================================
create table public.votes (
  id        uuid default uuid_generate_v4() primary key,
  game_id   uuid references public.games(id) on delete cascade not null,
  voter_id  uuid references public.profiles(id) on delete cascade not null,
  target_id uuid references public.profiles(id),
  day_num   integer not null,
  created_at timestamptz default now(),
  unique(game_id, voter_id, day_num)
);

-- ============================================================
-- CHAT MESSAGES
-- ============================================================
create table public.messages (
  id         uuid default uuid_generate_v4() primary key,
  game_id    uuid references public.games(id) on delete cascade not null,
  sender_id  uuid references public.profiles(id) on delete cascade not null,
  content    text not null,
  channel    text default 'public' check (channel in ('public','mafia','dead','system')),
  created_at timestamptz default now()
);

-- System message helper
create or replace function send_system_message(p_game_id uuid, p_content text)
returns void language plpgsql security definer as $$
begin
  insert into public.messages (game_id, sender_id, content, channel)
  select p_game_id, host_id, p_content, 'system'
  from public.rooms r
  join public.games g on g.room_id = r.id
  where g.id = p_game_id
  limit 1;
end;
$$;

-- ============================================================
-- GAME STATE VIEW (safe for clients — hides roles of others)
-- ============================================================
create or replace view public.game_state as
select
  g.id as game_id,
  g.room_id,
  g.phase,
  g.day_number,
  g.winner_team,
  g.phase_ends_at,
  gp.player_id,
  gp.role,
  gp.team,
  gp.is_alive,
  gp.death_phase,
  gp.death_day,
  p.username,
  p.avatar,
  p.level
from public.games g
join public.game_players gp on gp.game_id = g.id
join public.profiles p on p.id = gp.player_id;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Profiles
alter table public.profiles enable row level security;
create policy "Public profiles" on public.profiles for select using (true);
create policy "Own profile" on public.profiles for update using (auth.uid() = id);

-- Rooms
alter table public.rooms enable row level security;
create policy "Public rooms" on public.rooms for select using (true);
create policy "Create room" on public.rooms for insert with check (auth.uid() = host_id);
create policy "Host update" on public.rooms for update using (auth.uid() = host_id);
create policy "Host delete" on public.rooms for delete using (auth.uid() = host_id);

-- Room Players
alter table public.room_players enable row level security;
create policy "Public room_players" on public.room_players for select using (true);
create policy "Join room" on public.room_players for insert with check (auth.uid() = player_id);
create policy "Leave room" on public.room_players for delete using (auth.uid() = player_id);
create policy "Ready toggle" on public.room_players for update using (auth.uid() = player_id);

-- Games
alter table public.games enable row level security;
create policy "Public games" on public.games for select using (true);

-- Game Players
alter table public.game_players enable row level security;
create policy "Own role" on public.game_players for select using (
  auth.uid() = player_id
  or exists (
    select 1 from public.game_players gp2
    where gp2.game_id = game_id and gp2.player_id = auth.uid()
    and gp2.team = 'mafia' and team = 'mafia'
  )
  or exists (
    select 1 from public.games g where g.id = game_id and g.winner_team is not null
  )
);

-- Night Actions
alter table public.night_actions enable row level security;
create policy "Submit action" on public.night_actions for insert with check (auth.uid() = player_id);
create policy "See own action" on public.night_actions for select using (auth.uid() = player_id);

-- Votes
alter table public.votes enable row level security;
create policy "Public votes" on public.votes for select using (true);
create policy "Submit vote" on public.votes for insert with check (auth.uid() = voter_id);
create policy "Change vote" on public.votes for update using (auth.uid() = voter_id);

-- Messages
alter table public.messages enable row level security;
create policy "Public messages" on public.messages for select using (
  channel = 'public'
  or channel = 'system'
  or sender_id = auth.uid()
  or (channel = 'mafia' and exists (
    select 1 from public.game_players gp
    where gp.game_id = game_id and gp.player_id = auth.uid() and gp.team = 'mafia'
  ))
  or (channel = 'dead' and exists (
    select 1 from public.game_players gp
    where gp.game_id = game_id and gp.player_id = auth.uid() and gp.is_alive = false
  ))
);
create policy "Send message" on public.messages for insert with check (auth.uid() = sender_id);

-- ============================================================
-- REALTIME
-- ============================================================
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.room_players;
alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.game_players;
alter publication supabase_realtime add table public.night_actions;
alter publication supabase_realtime add table public.votes;
alter publication supabase_realtime add table public.messages;

-- ============================================================
-- INDEXES for performance
-- ============================================================
create index on public.rooms(code);
create index on public.rooms(status);
create index on public.room_players(room_id);
create index on public.game_players(game_id);
create index on public.night_actions(game_id, night_num);
create index on public.votes(game_id, day_num);
create index on public.messages(game_id, created_at);
