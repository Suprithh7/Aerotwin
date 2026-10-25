// Deterministic stand-in for recon imagery. The encrypted blob is a small text
// header plus seeded random bytes, at 1:100000 of the nominal size; every
// transfer and capacity number in the UI uses the nominal MB (ASSUMPTIONS.md).
import { mulberry32 } from '../sim/rng';
import { fmtClock } from '../rehearsal/clock';
import type { PoiSpec } from './types';

export const DUMMY_SCALE = 100_000;
const MIN_BYTES = 192;

export function dummyPayloadBytes(sizeMB: number): number {
  return Math.max(MIN_BYTES, Math.ceil((Math.max(0, sizeMB) * 1_000_000) / DUMMY_SCALE));
}

function latText(lat: number): string {
  return `${Math.abs(lat).toFixed(4)} ${lat >= 0 ? 'N' : 'S'}`;
}

function lonText(lon: number): string {
  return `${Math.abs(lon).toFixed(4)} ${lon >= 0 ? 'E' : 'W'}`;
}

function headerFor(poi: PoiSpec, capturedAtS: number, bytes: number): string {
  return [
    `AEROTWIN RECON // ${poi.type} // ITEM ${String(poi.id).padStart(2, '0')}`,
    `SITE ${latText(poi.lat)} ${lonText(poi.lon)} // PRIORITY ${poi.priority}`,
    `MISSION ${fmtClock(capturedAtS)} // ${poi.sizeMB} MB NOMINAL`,
    `DEMO PAYLOAD ${bytes} B AT 1:${DUMMY_SCALE} // SHA-256 CHECKED ON RECEIPT`,
  ].join('\n');
}

/**
 * Build the plaintext exactly once per item. The header is stable so the ground
 * preview can be read as text; the body is seeded from the site and time.
 */
export function buildDummyPayload(poi: PoiSpec, capturedAtS: number): Uint8Array {
  const total = dummyPayloadBytes(poi.sizeMB);
  const header = new TextEncoder().encode(headerFor(poi, capturedAtS, total));
  if (header.length + 1 >= total) {
    const out = new Uint8Array(header.length + 1);
    out.set(header);
    return out;
  }
  const out = new Uint8Array(total);
  out.set(header);
  out[header.length] = 0;
  const seed =
    (Math.imul(poi.id, 2654435761) ^
      Math.round(poi.lat * 10000) ^
      Math.round(poi.lon * 10000) ^
      Math.round(capturedAtS)) >>>
    0;
  const rng = mulberry32(seed);
  for (let i = header.length + 1; i < out.length; i++) out[i] = Math.floor(rng() * 256);
  return out;
}

/** Readable header of an encrypted item, for the ground-station preview. */
export function previewDummyPayload(plaintext: Uint8Array): string {
  const end = plaintext.indexOf(0);
  const slice = plaintext.slice(0, end >= 0 ? end : Math.min(plaintext.length, 512));
  return new TextDecoder().decode(slice);
}
