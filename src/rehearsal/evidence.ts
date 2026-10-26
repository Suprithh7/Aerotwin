// Exportable SIH evidence card. The data builder and text formatters are pure
// so they can be tested in Node; the canvas renderer and download/copy helpers
// only run in the browser.
import { fmtClock } from './clock';
import { outcomeHeadline } from './metrics';
import type { DebriefResult, Outcome } from './types';

export interface EvidenceOptions {
  missionName: string;
  scenarioTitle: string;
  now?: Date;
}

export interface EvidenceData {
  missionName: string;
  scenarioTitle: string;
  seed: number;
  outcome: Outcome;
  outcomeLabel: string;
  leadLine: string;
  flightS: number;
  distanceKm: number;
  engineLifePct: number;
  detectionLatencyS: number | null;
  detectionMissionS: number | null;
  limitReached: boolean;
  limitLabel: string | null;
  hasDataGuard: boolean;
  collectedMB: number;
  securedMB: number;
  onboardMB: number;
  lostMB: number;
  eraseMissionS: number | null;
  eraseReason: string | null;
  recoveryFailed: number | null;
  recoveryAttempted: number | null;
  generatedAtISO: string;
}

function roundedMb(value: number): number {
  return Math.max(0, Math.round(value));
}

export function fmtMb(value: number): string {
  return `${roundedMb(value)} MB`;
}

export function buildEvidence(debrief: DebriefResult, opts: EvidenceOptions): EvidenceData {
  const dg = debrief.dataGuard;
  const rows = debrief.director ?? [];
  const detected =
    rows.find((r) => r.detectedMissionS !== null || r.detectedS !== null) ?? null;
  return {
    missionName: opts.missionName,
    scenarioTitle: opts.scenarioTitle,
    seed: debrief.seed ?? 0,
    outcome: debrief.outcome,
    outcomeLabel: outcomeHeadline(debrief.outcome),
    leadLine: debrief.leadLine,
    flightS: debrief.flightS,
    distanceKm: debrief.distanceKm,
    engineLifePct: debrief.engineLifePct,
    detectionLatencyS: detected?.detectedS ?? null,
    detectionMissionS: detected?.detectedMissionS ?? debrief.flagS ?? null,
    limitReached: debrief.limitS !== null && debrief.limitS !== undefined,
    limitLabel: debrief.limitLabel ?? null,
    hasDataGuard: dg !== undefined,
    collectedMB: dg?.collectedMB ?? 0,
    securedMB: dg?.securedMB ?? 0,
    onboardMB: dg?.onboardMB ?? 0,
    lostMB: dg?.lostMB ?? 0,
    eraseMissionS: dg?.eraseMissionS ?? null,
    eraseReason: dg?.eraseReason ?? null,
    recoveryFailed: dg?.recovery?.failed ?? null,
    recoveryAttempted: dg?.recovery?.attempted ?? null,
    generatedAtISO: (opts.now ?? new Date()).toISOString(),
  };
}

export function detectionValue(d: EvidenceData): string {
  if (d.detectionLatencyS !== null) {
    return `+${Math.max(0, Math.round(d.detectionLatencyS))} s`;
  }
  if (d.detectionMissionS !== null) return 'FLAGGED';
  return 'NO FLAG';
}

export function detectionNote(d: EvidenceData): string {
  if (d.detectionMissionS !== null) {
    return `sim s after injection at T+${fmtClock(d.detectionMissionS)}`;
  }
  if (d.detectionLatencyS !== null) return 'mission clock unavailable';
  return 'no twin disagreement';
}

export function eraseValue(d: EvidenceData): string {
  if (d.eraseMissionS !== null) return `T+${fmtClock(d.eraseMissionS)}`;
  if (!d.hasDataGuard) return 'N/A';
  if (d.onboardMB > 0) return 'RETAINED';
  return 'NOT ERASED';
}

export function eraseNote(d: EvidenceData): string {
  if (d.eraseMissionS !== null) return 'mission key destroyed';
  if (!d.hasDataGuard) return 'no recon payload';
  if (d.onboardMB > 0) return 'encrypted onboard, key retained';
  return 'all collected data at ground';
}

export function recoveryValue(d: EvidenceData): string {
  if (d.recoveryFailed !== null) return 'FAILED';
  if (d.eraseMissionS !== null) return 'PENDING';
  return 'N/A';
}

export function recoveryNote(d: EvidenceData): string {
  if (d.recoveryFailed !== null && d.recoveryAttempted !== null) {
    return `${d.recoveryFailed}/${d.recoveryAttempted} blocks failed auth`;
  }
  if (d.eraseMissionS !== null) return 'attempt not complete';
  return 'no key erase';
}

export function evidenceNarrative(d: EvidenceData): string {
  const detection =
    d.detectionLatencyS !== null
      ? `Twin flagged the fault ${Math.max(0, Math.round(d.detectionLatencyS))} s after injection`
      : d.detectionMissionS !== null
        ? `Twin flagged the fault at T+${fmtClock(d.detectionMissionS)}`
        : 'Twin did not flag a fault';
  const limit = d.limitReached
    ? `the measured ${d.limitLabel ?? 'engine'} limit was reached`
    : 'no measured limit was reached';
  const guard = !d.hasDataGuard
    ? 'No reconnaissance payload was carried.'
    : d.eraseMissionS !== null
      ? `${fmtMb(d.securedMB)} was secured at the ground station and the mission key was destroyed at T+${fmtClock(d.eraseMissionS)}.`
      : `${fmtMb(d.securedMB)} was secured at the ground station and the key was retained onboard.`;
  return `${detection}; ${limit}. ${guard}`;
}

export function evidenceLines(d: EvidenceData): string[] {
  return [
    'AEROTWIN - MISSION EVIDENCE CARD',
    `Mission: ${d.missionName}`,
    `Scenario: ${d.scenarioTitle}`,
    `Outcome: ${d.outcomeLabel}`,
    `Seed: ${d.seed}`,
    `Twin detection: ${detectionValue(d)} (${detectionNote(d)})`,
    `Data secured: ${fmtMb(d.securedMB)} of ${fmtMb(d.collectedMB)} collected; ${fmtMb(d.onboardMB)} onboard`,
    `Key erase: ${eraseValue(d)} - ${eraseNote(d)}`,
    `Adversary recovery: ${recoveryValue(d)} - ${recoveryNote(d)}`,
    `Flight: ${fmtClock(d.flightS)}; ${d.distanceKm.toFixed(1)} km; engine life ${d.engineLifePct.toFixed(4)} %`,
    d.leadLine,
    evidenceNarrative(d),
    'Synthetic data - physics-simulated. Browser WebCrypto demonstrates the protocol only; no hardware in the loop.',
  ];
}

export const EVIDENCE_CARD_W = 1600;
export const EVIDENCE_CARD_H = 1000;

function outcomeColor(outcome: Outcome): string {
  if (outcome === 'complete') return '#5b8db8';
  if (outcome === 'aborted') return '#c9922e';
  return '#c4443f';
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawMetric(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  note: string,
  color: string,
): void {
  ctx.fillStyle = '#11151a';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#232a33';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, 5);

  ctx.fillStyle = '#93a0b0';
  ctx.font = '500 17px "IBM Plex Mono", monospace';
  ctx.fillText(label, x + 22, y + 42);

  ctx.fillStyle = '#d7dee7';
  ctx.font = '600 40px "IBM Plex Mono", monospace';
  ctx.fillText(value, x + 22, y + 100);

  ctx.fillStyle = '#93a0b0';
  ctx.font = '500 16px "IBM Plex Mono", monospace';
  wrapLines(ctx, note, w - 44)
    .slice(0, 2)
    .forEach((line, i) => ctx.fillText(line, x + 22, y + 132 + i * 21));
}

export function drawEvidenceCard(ctx: CanvasRenderingContext2D, d: EvidenceData): void {
  const W = EVIDENCE_CARD_W;
  const H = EVIDENCE_CARD_H;
  const accent = outcomeColor(d.outcome);

  ctx.fillStyle = '#0b0d10';
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(35, 42, 51, 0.55)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 80) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  ctx.strokeStyle = '#232a33';
  ctx.lineWidth = 3;
  ctx.strokeRect(24, 24, W - 48, H - 48);
  ctx.fillStyle = accent;
  ctx.fillRect(24, 24, W - 48, 8);

  ctx.fillStyle = '#5b8db8';
  ctx.font = '600 26px "IBM Plex Mono", monospace';
  ctx.fillText('AEROTWIN', 72, 96);

  ctx.fillStyle = '#93a0b0';
  ctx.font = '500 18px "IBM Plex Mono", monospace';
  ctx.fillText('MISSION EVIDENCE CARD', 72, 132);

  ctx.strokeStyle = '#c9922e';
  ctx.lineWidth = 2;
  ctx.strokeRect(W - 444, 74, 372, 48);
  ctx.fillStyle = '#c9922e';
  ctx.font = '600 17px "IBM Plex Mono", monospace';
  ctx.fillText('SYNTHETIC DATA - SIMULATED', W - 426, 105);

  ctx.fillStyle = accent;
  ctx.font = '600 62px "IBM Plex Sans", sans-serif';
  ctx.fillText(d.outcomeLabel, 72, 250);

  ctx.fillStyle = '#d7dee7';
  ctx.font = '500 25px "IBM Plex Sans", sans-serif';
  ctx.fillText(d.missionName, 72, 296);

  ctx.fillStyle = '#93a0b0';
  ctx.font = '500 19px "IBM Plex Mono", monospace';
  ctx.fillText(d.scenarioTitle, 72, 330);

  ctx.strokeStyle = '#232a33';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(72, 372);
  ctx.lineTo(W - 72, 372);
  ctx.stroke();

  const gap = 24;
  const cardW = (W - 144 - gap * 3) / 4;
  const cardY = 410;
  const cardH = 180;
  drawMetric(
    ctx,
    72,
    cardY,
    cardW,
    cardH,
    'TWIN DETECTION',
    detectionValue(d),
    detectionNote(d),
    '#c9922e',
  );
  drawMetric(
    ctx,
    72 + (cardW + gap),
    cardY,
    cardW,
    cardH,
    'DATA SECURED',
    fmtMb(d.securedMB),
    `${fmtMb(d.collectedMB)} collected, ${fmtMb(d.onboardMB)} onboard`,
    '#5b8db8',
  );
  drawMetric(
    ctx,
    72 + (cardW + gap) * 2,
    cardY,
    cardW,
    cardH,
    'KEY ERASE',
    eraseValue(d),
    eraseNote(d),
    d.eraseMissionS !== null ? '#c4443f' : '#5b8db8',
  );
  drawMetric(
    ctx,
    72 + (cardW + gap) * 3,
    cardY,
    cardW,
    cardH,
    'ADVERSARY RECOVERY',
    recoveryValue(d),
    recoveryNote(d),
    d.recoveryFailed !== null ? '#5b8db8' : '#93a0b0',
  );

  ctx.fillStyle = '#d7dee7';
  ctx.font = '500 27px "IBM Plex Sans", sans-serif';
  wrapLines(ctx, d.leadLine, W - 144)
    .slice(0, 2)
    .forEach((line, i) => ctx.fillText(line, 72, 660 + i * 38));

  ctx.fillStyle = '#93a0b0';
  ctx.font = '500 20px "IBM Plex Sans", sans-serif';
  wrapLines(ctx, evidenceNarrative(d), W - 144)
    .slice(0, 3)
    .forEach((line, i) => ctx.fillText(line, 72, 760 + i * 30));

  ctx.strokeStyle = '#232a33';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(72, 872);
  ctx.lineTo(W - 72, 872);
  ctx.stroke();

  ctx.fillStyle = '#93a0b0';
  ctx.font = '500 16px "IBM Plex Mono", monospace';
  ctx.fillText(
    `SEED ${d.seed}   FLIGHT ${fmtClock(d.flightS)}   ${d.distanceKm.toFixed(1)} KM   ENGINE LIFE ${d.engineLifePct.toFixed(4)} %`,
    72,
    908,
  );

  ctx.textAlign = 'right';
  ctx.fillText('AEROTWIN - MISSION REHEARSAL', W - 72, 908);
  ctx.fillText(`GENERATED ${d.generatedAtISO}`, W - 72, 936);
  ctx.textAlign = 'left';

  ctx.fillStyle = '#93a0b0';
  ctx.font = '500 15px "IBM Plex Mono", monospace';
  ctx.fillText(
    'Synthetic data - physics-simulated. Browser WebCrypto demonstrates the protocol only; no hardware in the loop.',
    72,
    948,
  );
}

export function downloadEvidenceCard(d: EvidenceData): void {
  const canvas = document.createElement('canvas');
  canvas.width = EVIDENCE_CARD_W;
  canvas.height = EVIDENCE_CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');
  drawEvidenceCard(ctx, d);
  const link = document.createElement('a');
  link.download = `aerotwin-evidence-${d.seed}.png`;
  link.href = canvas.toDataURL('image/png');
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function copyEvidenceSummary(d: EvidenceData): Promise<void> {
  const text = evidenceLines(d).join('\n');
  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard is not available in this browser.');
  }
  await navigator.clipboard.writeText(text);
}
