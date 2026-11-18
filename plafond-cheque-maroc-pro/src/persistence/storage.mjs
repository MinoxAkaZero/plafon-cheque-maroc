/**
 * PlafondChèque Maroc Pro — Authoritative Persistence, Conflict Resolution & Legacy Migration Engine (v11.0.0)
 *
 * Solves Split-Brain Storage Conflicts:
 * - IndexedDB (`PlafondChequeMarocDB` v4) is the primary source of truth.
 * - `localStorage` (`plafond_cheque_maroc_v2`) stores a synchronized encrypted envelope with monotonic `revision` and `updatedAt`.
 * - On startup, `selectAuthoritativeStateSnapshot(idbRecord, lsRecord)` compares `(revision, updatedAt)` so an interrupted
 *   write or stale store never overwrites newer user records.
 */

export const STORAGE_KEY = 'plafond_cheque_maroc_v2';
export const LEGACY_STORAGE_KEY = 'plafond_cheque_maroc_v1';
export const IDB_NAME = 'PlafondChequeMarocDB';
export const IDB_VERSION = 4;

/**
 * Selects the newest valid state record between IndexedDB and localStorage, preventing stale data overwrites.
 */
export function selectAuthoritativeStateSnapshot(idbRecord, lsRecord) {
  const validIdb = idbRecord && typeof idbRecord === 'object' && (idbRecord.encryptedVault || Array.isArray(idbRecord.operations));
  const validLs = lsRecord && typeof lsRecord === 'object' && (lsRecord.encryptedVault || Array.isArray(lsRecord.operations));

  if (validIdb && !validLs) {
    return { chosen: idbRecord, source: 'indexeddb', needsSyncToIdb: false, needsSyncToLs: true };
  }
  if (!validIdb && validLs) {
    return { chosen: lsRecord, source: 'localstorage', needsSyncToIdb: true, needsSyncToLs: false };
  }
  if (!validIdb && !validLs) {
    return { chosen: idbRecord || lsRecord || null, source: 'none', needsSyncToIdb: false, needsSyncToLs: false };
  }

  const revIdb = Number(idbRecord.revision) || 0;
  const revLs = Number(lsRecord.revision) || 0;
  if (revLs > revIdb) {
    return { chosen: lsRecord, source: 'localstorage_newer_revision', needsSyncToIdb: true, needsSyncToLs: false };
  }
  if (revIdb > revLs) {
    return { chosen: idbRecord, source: 'indexeddb_newer_revision', needsSyncToIdb: false, needsSyncToLs: true };
  }

  const tsIdb = Date.parse(idbRecord.updatedAt || '') || 0;
  const tsLs = Date.parse(lsRecord.updatedAt || '') || 0;
  if (tsLs > tsIdb) {
    return { chosen: lsRecord, source: 'localstorage_newer_timestamp', needsSyncToIdb: true, needsSyncToLs: false };
  }
  return {
    chosen: idbRecord,
    source: 'indexeddb',
    needsSyncToIdb: false,
    needsSyncToLs: tsIdb > tsLs
  };
}

/**
 * Migrates legacy v1–v10 state snapshots to the v11.0.0 schema without losing operations, photos, company info, or settings.
 */
export function migrateLegacyStateSnapshot(rawRecord) {
  if (!rawRecord || typeof rawRecord !== 'object') return null;
  const migrated = { ...rawRecord };
  migrated.schemaVersion = 4;
  migrated.appVersion = '11.0.0';
  migrated.revision = (Number(rawRecord.revision) || 0) + 1;
  migrated.updatedAt = rawRecord.updatedAt || new Date().toISOString();
  migrated.companyName = String(rawRecord.companyName || 'Société Marocaine de Négoce & Travaux SARL').trim();
  migrated.plafondJournalier = Number(rawRecord.plafondJournalier) >= 1000 ? Number(rawRecord.plafondJournalier) : 10000000;

  // If legacy non-PBKDF2 PIN hash was used without wrapped DEK, clear legacy weak hash so user configures PBKDF2-SHA256
  if (migrated.pinHash && (!String(migrated.pinHash).startsWith('pbkdf2_sha256$') || !migrated.wrappedDekByPin)) {
    migrated.legacyPinClearedForMigration = true;
    migrated.pinHash = '';
    migrated.pinSalt = '';
    migrated.recoveryHash = '';
    migrated.recoverySalt = '';
  }

  if (Array.isArray(migrated.operations)) {
    migrated.operations = migrated.operations.map((op, idx) => {
      const opId = op.id || `op_mig_${idx}`;
      const photoId = op.photoId || (op.photoDataUrl ? `photo_${opId}` : null);
      return {
        ...op,
        id: opId,
        beneficiaire: String(op.beneficiaire || `Opération #${idx + 1}`),
        banque: String(op.banque || 'Attijariwafa Bank'),
        montantTotal: Number(op.montantTotal) || 0,
        photoId,
        tranches: (op.tranches || []).map((tr, tIdx) => ({
          ...tr,
          id: tr.id || `chq_${opId}_${tIdx}`,
          status: tr.status || 'scheduled',
          photoId: tr.photoId || photoId || null
        }))
      };
    });
  }
  return migrated;
}
