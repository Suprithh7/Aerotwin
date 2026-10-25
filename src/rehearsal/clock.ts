/**
 * Rehearsal clock compression: the whole planned mission is rehearsed in this
 * many simulation seconds. The HUD and debrief always show mission time, never
 * the compressed simulation time. See ASSUMPTIONS.md.
 */
export const REHEARSAL_SIM_SPAN_S = 120;

export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Mission-clock seconds for a simulation-time value. */
export function missionClockS(simT: number, missionS: number): number {
  if (!(missionS > 0) || !Number.isFinite(simT)) return 0;
  return clamp01(simT / REHEARSAL_SIM_SPAN_S) * missionS;
}

/** Mission-clock seconds expressed as compressed simulation seconds. */
export function simSForMission(missionS: number, totalS: number): number {
  if (!(totalS > 0)) return 0;
  return (Math.max(0, missionS) / totalS) * REHEARSAL_SIM_SPAN_S;
}

/** h:mm:ss for mission clocks. */
export function fmtClock(s: number): string {
  const total = Math.max(0, Math.round(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** mm:ss, the duration unit used by the computed debrief line. */
export function fmtMmSs(s: number): string {
  const total = Math.max(0, Math.round(s));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Hours and minutes for whole-mission durations. */
export function fmtHM(s: number): string {
  const totalMin = Math.max(0, Math.round(s / 60));
  return `${Math.floor(totalMin / 60)} h ${String(totalMin % 60).padStart(2, '0')} min`;
}
