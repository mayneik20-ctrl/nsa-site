-- ============================================================================
-- NSA — National Sports Association
-- Schéma complet de la base de données Supabase
-- ----------------------------------------------------------------------------
-- À exécuter une seule fois dans : Supabase Dashboard > SQL Editor > New query
-- (copier-coller tout ce fichier, puis "Run").
-- Le script est idempotent : le relancer ne casse rien.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------------

-- Équipes. `competition` sépare les deux compétitions ('HIGH_SCHOOL' / 'UNIVERSITY').
create table if not exists public.teams (
  id            text primary key,
  competition   text not null check (competition in ('HIGH_SCHOOL','UNIVERSITY')),
  name          text not null,
  institution   text not null default '',
  abbreviation  text,
  logo_url      text,
  sort_order    int  not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists teams_competition_idx on public.teams (competition, sort_order);

-- Joueurs. Supprimer une équipe supprime ses joueurs (cascade).
create table if not exists public.players (
  id          text primary key,
  team_id     text not null references public.teams(id) on delete cascade,
  first_name  text not null default '',
  last_name   text not null default '',
  number      int  not null default 0,
  position    text not null default 'Forward',
  goals       int  not null default 0,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists players_team_idx on public.players (team_id, sort_order);

-- Confrontations du tableau final (round of 16, quarts, demies, finale).
-- Une ligne = une confrontation. `idx` est la position dans le tour.
create table if not exists public.ties (
  id              text primary key,
  competition     text not null check (competition in ('HIGH_SCHOOL','UNIVERSITY')),
  round           text not null check (round in ('round16','qf','sf','final')),
  idx             int  not null,
  team_a_id       text references public.teams(id) on delete set null,
  team_b_id       text references public.teams(id) on delete set null,
  leg1_a          int,
  leg1_b          int,
  leg2_a          int,
  leg2_b          int,
  pen_a           int,
  pen_b           int,
  is_single_match boolean not null default false,
  updated_at      timestamptz not null default now(),
  unique (competition, round, idx)
);

-- Images du carrousel de la page d'accueil (5 max par compétition, contrôlé côté app).
create table if not exists public.sliders (
  id          text primary key,
  competition text not null check (competition in ('HIGH_SCHOOL','UNIVERSITY')),
  url         text not null,
  caption     text default '',
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists sliders_competition_idx on public.sliders (competition, sort_order);

-- Réglages globaux (logo, icône de but, noms d'édition, adresse, réseaux sociaux,
-- trophée par compétition). Un simple magasin clé / valeur.
create table if not exists public.settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. ROW LEVEL SECURITY
--    Lecture : tout le monde (visiteurs non connectés inclus).
--    Écriture : uniquement un utilisateur authentifié (le compte admin).
-- ---------------------------------------------------------------------------
alter table public.teams    enable row level security;
alter table public.players  enable row level security;
alter table public.ties     enable row level security;
alter table public.sliders  enable row level security;
alter table public.settings enable row level security;

do $$
declare t text;
begin
  foreach t in array array['teams','players','ties','sliders','settings'] loop
    execute format('drop policy if exists "%s_public_read" on public.%I', t, t);
    execute format('drop policy if exists "%s_admin_write" on public.%I', t, t);

    -- Lecture publique
    execute format(
      'create policy "%s_public_read" on public.%I for select to anon, authenticated using (true)', t, t);

    -- Écriture réservée aux comptes connectés
    execute format(
      'create policy "%s_admin_write" on public.%I for all to authenticated using (true) with check (true)', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. STOCKAGE DES IMAGES (logos, trophées, carrousel, icône de but)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;

drop policy if exists "media_public_read"  on storage.objects;
drop policy if exists "media_admin_write"  on storage.objects;
drop policy if exists "media_admin_update" on storage.objects;
drop policy if exists "media_admin_delete" on storage.objects;

create policy "media_public_read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'media');
create policy "media_admin_write" on storage.objects
  for insert to authenticated with check (bucket_id = 'media');
create policy "media_admin_update" on storage.objects
  for update to authenticated using (bucket_id = 'media');
create policy "media_admin_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'media');

-- ---------------------------------------------------------------------------
-- 4. CRÉATION DES CONFRONTATIONS VIDES DU TABLEAU
--    8 huitièmes + 4 quarts + 2 demies + 1 finale, pour chaque compétition.
--    La finale se joue en match sec ; les autres tours en aller / retour.
-- ---------------------------------------------------------------------------
do $$
declare
  comp text;
  prefix text;
begin
  foreach comp in array array['HIGH_SCHOOL','UNIVERSITY'] loop
    prefix := case when comp = 'HIGH_SCHOOL' then 'hs' else 'uni' end;

    insert into public.ties (id, competition, round, idx, is_single_match)
    select prefix || '-r16-' || i, comp, 'round16', i, false from generate_series(0,7) i
    on conflict (id) do nothing;

    insert into public.ties (id, competition, round, idx, is_single_match)
    select prefix || '-qf-' || i, comp, 'qf', i, false from generate_series(0,3) i
    on conflict (id) do nothing;

    insert into public.ties (id, competition, round, idx, is_single_match)
    select prefix || '-sf-' || i, comp, 'sf', i, false from generate_series(0,1) i
    on conflict (id) do nothing;

    insert into public.ties (id, competition, round, idx, is_single_match)
    values (prefix || '-final-0', comp, 'final', 0, true)
    on conflict (id) do nothing;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. RÉGLAGES PAR DÉFAUT (identiques au prototype)
-- ---------------------------------------------------------------------------
insert into public.settings (key, value) values
  ('edition_HIGH_SCHOOL', '2026 Championship'),
  ('edition_UNIVERSITY',  '2026 Championship'),
  ('footer_address',      'Stade Municipal, 12 Avenue des Sports, Paris'),
  ('social_instagram',    ''),
  ('social_tiktok',       ''),
  ('social_youtube',      ''),
  ('org_logo',            ''),
  ('ball_icon',           ''),
  ('trophy_HIGH_SCHOOL',  ''),
  ('trophy_UNIVERSITY',   '')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 6. TEMPS RÉEL (les visiteurs voient les changements sans recharger la page)
-- ---------------------------------------------------------------------------
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.teams';    exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.players';  exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.ties';     exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.sliders';  exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.settings'; exception when others then null; end;
end $$;
