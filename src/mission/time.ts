// Mission start time is stored as an ISO instant and edited in IST (UTC+5:30).
export const IST_OFFSET_MIN = 330;

export function istInputToIso(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return new Date().toISOString();
  const [, y, mo, d, h, mi] = m.map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - IST_OFFSET_MIN * 60_000).toISOString();
}

export function isoToIstInput(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return isoToIstInput(new Date().toISOString());
  return new Date(t + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 16);
}

export function fmtStartIST(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'INVALID TIME';
  const d = new Date(t + IST_OFFSET_MIN * 60_000);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${d.getUTCFullYear()} ${hh}:${mm} IST`;
}

export function defaultStartIso(): string {
  // The next whole hour in IST, at least an hour ahead of wall time.
  const now = Date.now() + 60 * 60_000;
  const ist = new Date(now + IST_OFFSET_MIN * 60_000);
  ist.setUTCMinutes(0, 0, 0);
  return new Date(ist.getTime() - IST_OFFSET_MIN * 60_000).toISOString();
}
