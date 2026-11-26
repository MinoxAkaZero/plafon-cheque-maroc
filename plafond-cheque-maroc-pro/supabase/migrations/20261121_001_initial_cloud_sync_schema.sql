-- ============================================================================
-- PlafondChèque Maroc Pro (v12.0.0) — Supabase PostgreSQL Cloud Sync Schema
-- Strictly enforces per-user isolation via Row Level Security (auth.uid() = user_id).
-- Run this script in Supabase Dashboard -> SQL Editor (or `supabase db push`).
-- ============================================================================

-- 1. User Settings & Working Environment Table
CREATE TABLE IF NOT EXISTS public.user_profiles_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plafond_journalier NUMERIC(16, 2) NOT NULL DEFAULT 10000000.00 CHECK (plafond_journalier >= 1000),
  company_name TEXT NOT NULL DEFAULT 'Société Marocaine de Négoce & Travaux SARL',
  language TEXT NOT NULL DEFAULT 'fr' CHECK (language IN ('fr', 'ar', 'en')),
  lwalid_mode BOOLEAN NOT NULL DEFAULT FALSE,
  dark_mode BOOLEAN NOT NULL DEFAULT FALSE,
  show_arabic_words BOOLEAN NOT NULL DEFAULT TRUE,
  auto_lock_minutes INTEGER NOT NULL DEFAULT 5 CHECK (auto_lock_minutes >= 0 AND auto_lock_minutes <= 120),
  notification_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  holidays JSONB NOT NULL DEFAULT '[]'::jsonb,
  sent_notifications_registry JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Cloud Operations & Cheques Table (Composite PK for idempotent multi-device sync)
CREATE TABLE IF NOT EXISTS public.cloud_operations (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  beneficiaire TEXT NOT NULL,
  banque TEXT NOT NULL DEFAULT 'Attijariwafa Bank',
  num_cheque_base TEXT NOT NULL DEFAULT '',
  montant_total NUMERIC(16, 2) NOT NULL DEFAULT 0,
  date_saisie TEXT NOT NULL,
  echeance_days INTEGER NOT NULL DEFAULT 0,
  date_limite_brute TEXT,
  date_ouvrable_cible TEXT,
  mode TEXT NOT NULL DEFAULT 'backward',
  notes TEXT DEFAULT '',
  photo_id TEXT,
  tranches JSONB NOT NULL DEFAULT '[]'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  last_device_id TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ DEFAULT NULL,
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_cloud_operations_user_updated
  ON public.cloud_operations (user_id, server_updated_at DESC);

-- 3. Cloud Clients / Beneficiaries Directory Table
CREATE TABLE IF NOT EXISTS public.cloud_clients (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  default_bank TEXT DEFAULT 'Attijariwafa Bank',
  phone TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ DEFAULT NULL,
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_cloud_clients_user_name
  ON public.cloud_clients (user_id, name);

-- 4. Cloud Cheque Photos Table (Compressed JPEG payloads isolated per user via RLS)
CREATE TABLE IF NOT EXISTS public.cloud_cheque_photos (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_id TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
  byte_size INTEGER NOT NULL DEFAULT 0 CHECK (byte_size >= 0 AND byte_size <= 524288),
  data_url TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ DEFAULT NULL,
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, photo_id)
);

-- Automatic server_updated_at trigger function
CREATE OR REPLACE FUNCTION public.pcm_touch_server_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.server_updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_settings_server_updated ON public.user_profiles_settings;
CREATE TRIGGER trg_settings_server_updated
  BEFORE INSERT OR UPDATE ON public.user_profiles_settings
  FOR EACH ROW EXECUTE FUNCTION public.pcm_touch_server_updated_at();

DROP TRIGGER IF EXISTS trg_operations_server_updated ON public.cloud_operations;
CREATE TRIGGER trg_operations_server_updated
  BEFORE INSERT OR UPDATE ON public.cloud_operations
  FOR EACH ROW EXECUTE FUNCTION public.pcm_touch_server_updated_at();

DROP TRIGGER IF EXISTS trg_clients_server_updated ON public.cloud_clients;
CREATE TRIGGER trg_clients_server_updated
  BEFORE INSERT OR UPDATE ON public.cloud_clients
  FOR EACH ROW EXECUTE FUNCTION public.pcm_touch_server_updated_at();

DROP TRIGGER IF EXISTS trg_photos_server_updated ON public.cloud_cheque_photos;
CREATE TRIGGER trg_photos_server_updated
  BEFORE INSERT OR UPDATE ON public.cloud_cheque_photos
  FOR EACH ROW EXECUTE FUNCTION public.pcm_touch_server_updated_at();

-- ============================================================================
-- STRICT ROW LEVEL SECURITY (RLS) — ZERO CROSS-TENANT ACCESS
-- ============================================================================
ALTER TABLE public.user_profiles_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_cheque_photos ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners where supported
ALTER TABLE public.user_profiles_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_clients FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_cheque_photos FORCE ROW LEVEL SECURITY;

-- Policies for user_profiles_settings
DROP POLICY IF EXISTS "settings_select_own" ON public.user_profiles_settings;
CREATE POLICY "settings_select_own" ON public.user_profiles_settings
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "settings_insert_own" ON public.user_profiles_settings;
CREATE POLICY "settings_insert_own" ON public.user_profiles_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "settings_update_own" ON public.user_profiles_settings;
CREATE POLICY "settings_update_own" ON public.user_profiles_settings
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "settings_delete_own" ON public.user_profiles_settings;
CREATE POLICY "settings_delete_own" ON public.user_profiles_settings
  FOR DELETE USING (auth.uid() = user_id);

-- Policies for cloud_operations
DROP POLICY IF EXISTS "operations_select_own" ON public.cloud_operations;
CREATE POLICY "operations_select_own" ON public.cloud_operations
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "operations_insert_own" ON public.cloud_operations;
CREATE POLICY "operations_insert_own" ON public.cloud_operations
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "operations_update_own" ON public.cloud_operations;
CREATE POLICY "operations_update_own" ON public.cloud_operations
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "operations_delete_own" ON public.cloud_operations;
CREATE POLICY "operations_delete_own" ON public.cloud_operations
  FOR DELETE USING (auth.uid() = user_id);

-- Policies for cloud_clients
DROP POLICY IF EXISTS "clients_select_own" ON public.cloud_clients;
CREATE POLICY "clients_select_own" ON public.cloud_clients
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "clients_insert_own" ON public.cloud_clients;
CREATE POLICY "clients_insert_own" ON public.cloud_clients
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "clients_update_own" ON public.cloud_clients;
CREATE POLICY "clients_update_own" ON public.cloud_clients
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "clients_delete_own" ON public.cloud_clients;
CREATE POLICY "clients_delete_own" ON public.cloud_clients
  FOR DELETE USING (auth.uid() = user_id);

-- Policies for cloud_cheque_photos
DROP POLICY IF EXISTS "photos_select_own" ON public.cloud_cheque_photos;
CREATE POLICY "photos_select_own" ON public.cloud_cheque_photos
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "photos_insert_own" ON public.cloud_cheque_photos;
CREATE POLICY "photos_insert_own" ON public.cloud_cheque_photos
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "photos_update_own" ON public.cloud_cheque_photos;
CREATE POLICY "photos_update_own" ON public.cloud_cheque_photos
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "photos_delete_own" ON public.cloud_cheque_photos;
CREATE POLICY "photos_delete_own" ON public.cloud_cheque_photos
  FOR DELETE USING (auth.uid() = user_id);
