-- ============================================================================
-- PlafondChèque Maroc Pro (Phase 3.1) — Cloud E2EE Schema Migration
--
-- HONEST SECURITY MODEL (Option B):
--   Your cheque details and photos are encrypted on your device. A compromised
--   server could still see timing and size metadata and could withhold or replay
--   old data.
--
-- ENCRYPTED CLIENT-SIDE (AES-256-GCM + AAD = userId|table|id|version):
--   - cloud_operations.encrypted_payload: beneficiaire, banque, numChequeBase,
--     montantTotal, notes, dateLimiteBrute, dateOuvrableCible, tranches.
--   - cloud_clients.encrypted_payload: name, defaultBank, phone, notes.
--     (cloud_clients.id uses HMAC-SHA256(DEK, name) — zero client names in IDs)
--   - cloud_cheque_photos.encrypted_payload: dataUrl, mimeType.
--   AAD blocks cross-user, cross-table, and cross-row substitution; it does NOT
--   prevent a malicious server from replaying an older valid version.
--
-- PLAINTEXT METADATA KEPT FOR RLS, SYNC ORDERING & TOMBSTONES (unauthenticated):
--   - user_id, id / photo_id, date_saisie, echeance_days, mode, version,
--     crypto_version (0=legacy plaintext, 1=dual-write migrating, 2=redacted E2EE),
--     last_device_id, created_at, updated_at, deleted_at, byte_size.
-- ============================================================================

ALTER TABLE public.user_profiles_settings
  ADD COLUMN IF NOT EXISTS cloud_e2ee_meta JSONB DEFAULT NULL;

ALTER TABLE public.cloud_operations
  ADD COLUMN IF NOT EXISTS crypto_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS encrypted_payload JSONB DEFAULT NULL;

ALTER TABLE public.cloud_clients
  ADD COLUMN IF NOT EXISTS crypto_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS encrypted_payload JSONB DEFAULT NULL;

-- Photo validation: client enforces max 512 KB plaintext (image/jpeg|png|webp);
-- ~1.36x AES-GCM + Base64 overhead -> 1 MB (1,048,576 bytes) DB CHECK constraint.
ALTER TABLE public.cloud_cheque_photos
  ADD COLUMN IF NOT EXISTS crypto_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS encrypted_payload JSONB DEFAULT NULL;

ALTER TABLE public.cloud_cheque_photos
  DROP CONSTRAINT IF EXISTS cloud_cheque_photos_byte_size_check;

ALTER TABLE public.cloud_cheque_photos
  ADD CONSTRAINT cloud_cheque_photos_byte_size_check
  CHECK (byte_size >= 0 AND byte_size <= 1048576);

ALTER TABLE public.cloud_cheque_photos
  DROP CONSTRAINT IF EXISTS cloud_cheque_photos_mime_type_check;

ALTER TABLE public.cloud_cheque_photos
  ADD CONSTRAINT cloud_cheque_photos_mime_type_check
  CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'));
