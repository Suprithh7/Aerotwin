// Bundled India airport and heliport database.
//
// Source: OurAirports airports.csv, downloaded once on 2026-10-25 and filtered
// to iso_country = IN with type in {large_airport, medium_airport,
// small_airport, heliport}. Names containing Air Force, AFS, Air Base,
// Military, Naval or Army were excluded; the full excluded-name list is in
// ASSUMPTIONS.md. Coordinates and elevations are illustrative for this
// prototype and must be verified against AIP India before real use.
import raw from './airfields.json';
import type { LandingSite } from '../mission/types';

export type AirfieldType = 'large_airport' | 'medium_airport' | 'small_airport' | 'heliport';

export interface Airfield {
  icao: string;
  name: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
  elevationM: number;
  type: AirfieldType;
}

export const AIRFIELDS = raw as Airfield[];

const BY_ICAO = new Map(AIRFIELDS.map((a) => [a.icao, a]));

export function airfieldByIcao(icao: string): Airfield | undefined {
  return BY_ICAO.get(icao);
}

export function airfieldsByIcao(icas: string[]): Airfield[] {
  const out: Airfield[] = [];
  for (const icao of icas) {
    const a = BY_ICAO.get(icao);
    if (a) out.push(a);
  }
  return out;
}

/** A custom landing site in the same shape the alternate logic consumes. */
export function siteAsAirfield(site: LandingSite): Airfield {
  return {
    icao: `SITE-${site.id}`,
    name: site.name,
    city: 'CUSTOM SITE',
    state: site.type,
    lat: site.lat,
    lon: site.lon,
    elevationM: site.elevM,
    type: 'small_airport',
  };
}

export function alternatesForSites(sites: LandingSite[]): Airfield[] {
  return sites.map(siteAsAirfield);
}
