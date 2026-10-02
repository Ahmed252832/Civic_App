export type ReportDraft = {
  title: string; description: string; categoryId: number; severity: string; wardCode: string;
  placeName: string; latitude: number | null; longitude: number | null; image: string | null; savedAt: number;
};

const key = (userId: number) => `civicpulse-report-draft-${userId}`;
const maxAge = 30 * 24 * 60 * 60 * 1000;

export function readDraft(userId: number): ReportDraft | null {
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return null;
    const value = JSON.parse(raw) as ReportDraft;
    if (!value || typeof value.title !== 'string' || typeof value.description !== 'string' ||
      typeof value.wardCode !== 'string' || !Number.isFinite(value.savedAt) || Date.now() - value.savedAt > maxAge) {
      localStorage.removeItem(key(userId));
      return null;
    }
    return value;
  } catch { return null; }
}

export function saveDraft(userId: number, draft: ReportDraft): boolean {
  try { localStorage.setItem(key(userId), JSON.stringify(draft)); return true; }
  catch {
    // Browser storage quotas vary. Keep the text and pin if the photo will not fit.
    try { localStorage.setItem(key(userId), JSON.stringify({ ...draft, image: null })); return true; }
    catch { return false; }
  }
}

export function clearDraft(userId: number) {
  try { localStorage.removeItem(key(userId)); } catch { /* Storage may be unavailable. */ }
}
