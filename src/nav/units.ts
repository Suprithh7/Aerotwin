// Unit presentation helpers. 1 ft = 0.3048 m and 1 NM = 1852 m exactly.
export const M_PER_FT = 0.3048;
export const M_PER_NM = 1852;

export const mToFt = (m: number): number => m / M_PER_FT;
export const mToNm = (m: number): number => m / M_PER_NM;

/** Altitude as metres AMSL and feet, e.g. `3256 M / 10682 FT`. */
export function fmtAltM(m: number): string {
  return `${Math.round(m)} M / ${Math.round(mToFt(m))} FT`;
}

/** Distance as kilometres and nautical miles, e.g. `257 KM / 139 NM`. */
export function fmtDistKm(m: number): string {
  return `${(m / 1000).toFixed(0)} KM / ${mToNm(m).toFixed(0)} NM`;
}

/** Elapsed/estimated time as h:mm:ss. */
export function fmtHms(s: number): string {
  const total = Math.max(0, Math.round(s));
  const h = Math.floor(total / 3600);
  const mn = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return `${h}:${String(mn).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Bearing to three digits, e.g. `286`. */
export function fmtBrg(deg: number): string {
  return String(Math.round(deg) % 360).padStart(3, '0');
}
