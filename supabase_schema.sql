-- Trio Asset Management Schema v2
-- This SQL file defines the database schema for the Trio Asset Management
-- application, including organisations (companies), user profiles, assets,
-- and incident reports. It also contains row‑level security policies and
-- sample data for immediate testing. Copy the contents of this file into
-- the Supabase SQL editor and execute it to initialise your database.

-- Enable the UUID extension if it's not already present. UUIDs provide
-- globally unique identifiers for records without relying on numeric
-- sequences.
create extension if not exists "uuid-ossp";

-- ======================================================================
-- Organisations
-- Represents the different companies using the system. Each asset and
-- profile belongs to a single organisation.
-- ======================================================================
create table if not exists organisations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  created_at timestamptz default now()
);

-- ======================================================================
-- Profiles
-- A profile links an authenticated Supabase user (from auth.users) to a
-- company and assigns them a role. Roles can be 'CEO', 'DAF' (chief
-- financial officer), or 'Responsable' (manager). Row level security
-- ensures that a user can only see and modify their own profile.
-- ======================================================================
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references organisations(id),
  role text default 'Responsable',
  created_at timestamptz default now()
);

-- ======================================================================
-- Assets
-- Represents the physical or digital assets owned by a company. Additional
-- fields like code, category, purchase date and current value provide
-- essential metadata. The responsible_id points to the profile of the
-- person in charge of the asset. Row level security restricts access
-- based on the asset's company.
-- ======================================================================
create table if not exists assets (
  id uuid primary key default uuid_generate_v4(),
  code text unique,
  name text not null,
  category text,
  description text,
  purchase_date date,
  value numeric,
  status text default 'En service',
  company_id uuid references organisations(id),
  responsible_id uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ======================================================================
-- Incidents
-- Tracks maintenance or incident reports related to assets. Each
-- incident references an asset and has a status (e.g. 'En attente',
-- 'En cours', 'Résolu'). Row level security ties incident visibility
-- back to the associated asset's company.
-- ======================================================================
create table if not exists incidents (
  id uuid primary key default uuid_generate_v4(),
  asset_id uuid references assets(id),
  description text not null,
  status text default 'En attente',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ======================================================================
-- Row Level Security
-- Enable RLS on tables and define policies so that users can only see
-- records belonging to their own company. Note: policies are additive; if
-- nothing matches then access is denied.
-- ======================================================================
alter table profiles enable row level security;
alter table assets enable row level security;
alter table incidents enable row level security;

-- Profiles: users can read and modify only their own profile.
create policy profiles_read_own on profiles
  for select using (auth.uid() = id);
create policy profiles_insert_own on profiles
  for insert with check (auth.uid() = id);
create policy profiles_update_own on profiles
  for update using (auth.uid() = id);

-- Assets: users see assets belonging to their company. Users may insert,
-- update and delete assets only within their company.
create policy assets_read_company on assets
  for select using (
    company_id = (select company_id from profiles where id = auth.uid())
  );
create policy assets_insert_company on assets
  for insert with check (
    company_id = (select company_id from profiles where id = auth.uid())
  );
create policy assets_update_company on assets
  for update using (
    company_id = (select company_id from profiles where id = auth.uid())
  );
create policy assets_delete_company on assets
  for delete using (
    company_id = (select company_id from profiles where id = auth.uid())
  );

-- Incidents: users see incidents only for assets owned by their company.
-- Insert and update are also restricted to that scope.
create policy incidents_read_company on incidents
  for select using (
    asset_id in (
      select id from assets where company_id = (select company_id from profiles where id = auth.uid())
    )
  );
create policy incidents_insert_company on incidents
  for insert with check (
    asset_id in (
      select id from assets where company_id = (select company_id from profiles where id = auth.uid())
    )
  );
create policy incidents_update_company on incidents
  for update using (
    asset_id in (
      select id from assets where company_id = (select company_id from profiles where id = auth.uid())
    )
  );

-- ======================================================================
-- Sample data
-- Insert a few companies to get you started. Feel free to change the
-- UUIDs or names; they're deterministic here for clarity. Assets and
-- profiles should reference these organisation IDs.
-- ======================================================================
insert into organisations (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'Madajob') on conflict do nothing,
  ('22222222-2222-2222-2222-222222222222', 'Madatours') on conflict do nothing,
  ('33333333-3333-3333-3333-333333333333', 'Mobix') on conflict do nothing,
  ('44444444-4444-4444-4444-444444444444', 'Trio Holding') on conflict do nothing;

-- Insert a couple of example assets for each company. You can remove
-- these if you prefer to start with an empty database.
insert into assets (code, name, category, description, purchase_date, value, status, company_id)
values
  ('MAD-LAP-001', 'Ordinateur portable HP ProBook', 'Informatique', 'Laptop de bureau pour le siège', '2024-01-15', 1200, 'En service', '11111111-1111-1111-1111-111111111111'),
  ('MAD-LAP-002', 'Imprimante laser Canon', 'Impression', 'Imprimante administrative', '2024-03-02', 350, 'En service', '11111111-1111-1111-1111-111111111111'),
  ('TOUR-BUS-001', 'Minibus 15 places', 'Transport', 'Minibus pour excursions', '2023-12-10', 26000, 'En service', '22222222-2222-2222-2222-222222222222'),
  ('MOB-SM-001', 'Serveur de messagerie', 'Informatique', 'Serveur dédié aux emails', '2024-02-20', 5000, 'En service', '33333333-3333-3333-3333-333333333333'),
  ('TRI-HQ-001', 'Bureaux du siège social', 'Immobilier', 'Siège principal de Trio Holding', '2022-11-01', 200000, 'En service', '44444444-4444-4444-4444-444444444444')
  on conflict (code) do nothing;

-- ======================================================================
-- Extensions for advanced immobilization workflow
-- Adds accounting/predictive fields used by the application and
-- supports multi-file attachments per asset.
-- ======================================================================
alter table if exists assets
  add column if not exists purchase_value numeric,
  add column if not exists amortissement_type text default 'LINEAIRE',
  add column if not exists amortissement_duration integer,
  add column if not exists amortissement_method text,
  add column if not exists amortissement_rate numeric,
  add column if not exists amortissement_degressive_rate numeric,
  add column if not exists amortissement_degressive_coefficient numeric,
  add column if not exists attachment_name text,
  add column if not exists attachment_url text;

create table if not exists asset_attachments (
  id uuid primary key default uuid_generate_v4(),
  asset_id uuid not null references assets(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  file_url text,
  created_at timestamptz default now()
);

alter table if exists asset_attachments enable row level security;

create policy asset_attachments_read_company on asset_attachments
  for select using (
    asset_id in (
      select id from assets where company_id = (select company_id from profiles where id = auth.uid())
    )
  );

create policy asset_attachments_insert_company on asset_attachments
  for insert with check (
    asset_id in (
      select id from assets where company_id = (select company_id from profiles where id = auth.uid())
    )
  );

-- End of schema file
