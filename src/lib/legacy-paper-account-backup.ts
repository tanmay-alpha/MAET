const V3_KEY = "maet.paper-account.v3";
const V2_KEY = "maet.paper-account.v2";
const BACKUP_KEY = "maet.paper-account.legacy-backup";
const CUTOVER_KEY = "maet.paper-account.backend-cutover";

export interface LegacyPaperBackupData {
  v3?: string | null;
  v2?: string | null;
  backedUpAt: string;
}

export function initializeLegacyPaperBackup(): LegacyPaperBackupData | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  try {
    const isCutoverDone = window.localStorage.getItem(CUTOVER_KEY);
    const rawV3 = window.localStorage.getItem(V3_KEY);
    const rawV2 = window.localStorage.getItem(V2_KEY);

    if (!isCutoverDone && (rawV3 || rawV2)) {
      const backup: LegacyPaperBackupData = {
        v3: rawV3,
        v2: rawV2,
        backedUpAt: new Date().toISOString(),
      };
      window.localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
      window.localStorage.setItem(CUTOVER_KEY, "true");
      return backup;
    }

    const existingBackup = window.localStorage.getItem(BACKUP_KEY);
    return existingBackup ? (JSON.parse(existingBackup) as LegacyPaperBackupData) : null;
  } catch {
    return null;
  }
}

export function getLegacyPaperBackup(): LegacyPaperBackupData | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(BACKUP_KEY);
    return raw ? (JSON.parse(raw) as LegacyPaperBackupData) : null;
  } catch {
    return null;
  }
}

export function exportLegacyBackupAsJson(): void {
  const backup = getLegacyPaperBackup();
  if (!backup) return;

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `maet-legacy-paper-account-backup-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function deleteLegacyBackup(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(BACKUP_KEY);
    window.localStorage.removeItem(V3_KEY);
    window.localStorage.removeItem(V2_KEY);
  } catch {
    // Ignore storage errors
  }
}
