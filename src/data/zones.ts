// Illustrative exercise geography only. No polygon here is operational, and
// none follows a real international boundary: each one is a small area inside
// a route preset's working region, at least 50 km from any land border, chosen
// so the rehearsal can show a denied area without depicting a real one.
// This file is intentionally the only source of denied-area geometry.

export const DENIED_LABEL = 'DENIED AREA (EXERCISE - ILLUSTRATIVE)';

export interface DeniedZone {
  id: string;
  presetId: string;
  /** Closed ring, [lon, lat]. */
  polygon: [number, number][];
}

export interface GroundStation {
  id: string;
  presetId: string;
  name: string;
  lat: number;
  lon: number;
}

export const DENIED_ZONES: DeniedZone[] = [
  {
    id: 'ladakh-denied',
    presetId: 'ladakh',
    polygon: [
      [77.19, 34.06],
      [77.35, 34.06],
      [77.36, 34.14],
      [77.2, 34.145],
      [77.19, 34.06],
    ],
  },
  {
    id: 'rajasthan-denied',
    presetId: 'rajasthan',
    polygon: [
      [71.84, 26.37],
      [72.07, 26.36],
      [72.09, 26.52],
      [71.86, 26.54],
      [71.84, 26.37],
    ],
  },
  {
    id: 'coastal-denied',
    presetId: 'coastal',
    polygon: [
      [72.98, 14.1],
      [73.2, 14.08],
      [73.24, 14.3],
      [73.01, 14.32],
      [72.98, 14.1],
    ],
  },
];

export const GROUND_STATIONS: GroundStation[] = [
  { id: 'ladakh-gs', presetId: 'ladakh', name: 'LEH GROUND STATION', lat: 34.08, lon: 77.35 },
  { id: 'rajasthan-gs', presetId: 'rajasthan', name: 'JODHPUR GROUND STATION', lat: 26.33, lon: 73.1 },
  { id: 'coastal-gs', presetId: 'coastal', name: 'GOA GROUND STATION', lat: 15.43, lon: 73.79 },
];

export function zoneForPreset(presetId: string): DeniedZone | undefined {
  return DENIED_ZONES.find((z) => z.presetId === presetId);
}

export function groundForPreset(presetId: string): GroundStation | undefined {
  return GROUND_STATIONS.find((g) => g.presetId === presetId);
}

/** Area centroid of a lon/lat ring, adequate for placing a label. */
export function zoneLabelPoint(zone: DeniedZone): { lat: number; lon: number } {
  const ring = zone.polygon.slice(0, -1);
  const lon = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return { lat, lon };
}
