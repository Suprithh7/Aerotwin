// Illustrative - verify coordinates and elevations against official AIP India before any real use.
//
// Coordinates, elevations, names and municipalities are taken verbatim from the
// OurAirports open database (airports.csv, downloaded 2026-10-25); elevation is
// the dataset value in feet converted to metres above mean sea level. Civil
// airports only - no military airbases, restricted or sensitive sites are listed.
// Where a code in the task brief did not exist in the dataset it is flagged in
// the row comment.

export interface Airfield {
  icao: string;
  name: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
  elevationM: number;
}

const FT_TO_M = 0.3048;
const ft = (v: number): number => Math.round(v * FT_TO_M * 10) / 10;

export const AIRFIELDS: Airfield[] = [
  // Ladakh / Jammu & Kashmir
  { icao: 'VILH', name: 'Leh Kushok Bakula Rimpochee Airport', city: 'Leh', state: 'Ladakh', lat: 34.135899, lon: 77.546501, elevationM: ft(10682) },
  { icao: 'VISR', name: 'Srinagar International Airport', city: 'Srinagar', state: 'Jammu & Kashmir', lat: 33.987099, lon: 74.7742, elevationM: ft(5429) },
  { icao: 'VIJU', name: 'Jammu Airport', city: 'Jammu', state: 'Jammu & Kashmir', lat: 32.688849, lon: 74.838152, elevationM: ft(996) },
  { icao: 'VICG', name: 'Shaheed Bhagat Singh International Airport', city: 'Chandigarh', state: 'Chandigarh (UT)', lat: 30.6735, lon: 76.788498, elevationM: ft(1012) },
  // Rajasthan / Gujarat
  { icao: 'VIJO', name: 'Jodhpur Airport', city: 'Jodhpur', state: 'Rajasthan', lat: 26.251101, lon: 73.048897, elevationM: ft(717) },
  { icao: 'VIJR', name: 'Jaisalmer Airport', city: 'Jaisalmer', state: 'Rajasthan', lat: 26.8887, lon: 70.864998, elevationM: ft(751) },
  // OurAirports marks Bikaner (Nal) as no scheduled service; it is a civil airport.
  { icao: 'VIBK', name: 'Nal Airport', city: 'Bikaner', state: 'Rajasthan', lat: 28.070601, lon: 73.207199, elevationM: ft(750) },
  { icao: 'VIJP', name: 'Jaipur International Airport', city: 'Jaipur', state: 'Rajasthan', lat: 26.8242, lon: 75.812202, elevationM: ft(1263) },
  { icao: 'VAUD', name: 'Maharana Pratap Airport', city: 'Udaipur', state: 'Rajasthan', lat: 24.617701, lon: 73.896103, elevationM: ft(1684) },
  { icao: 'VABJ', name: 'Bhuj Airport', city: 'Bhuj', state: 'Gujarat', lat: 23.2878, lon: 69.670197, elevationM: ft(268) },
  // West coast
  { icao: 'VABB', name: 'Chhatrapati Shivaji Maharaj International Airport', city: 'Mumbai', state: 'Maharashtra', lat: 19.088699, lon: 72.867897, elevationM: ft(39) },
  // Task brief gave VAGO, which is not in the dataset; Dabolim is VOGO.
  { icao: 'VOGO', name: 'Goa Dabolim International Airport', city: 'Vasco da Gama', state: 'Goa', lat: 15.380062, lon: 73.833328, elevationM: ft(150) },
  { icao: 'VOML', name: 'Mangaluru International Airport', city: 'Mangaluru', state: 'Karnataka', lat: 12.95471, lon: 74.886812, elevationM: ft(337) },
  { icao: 'VOCI', name: 'Cochin International Airport', city: 'Kochi', state: 'Kerala', lat: 10.151047, lon: 76.400838, elevationM: ft(30) },
  { icao: 'VAKP', name: 'Kolhapur Airport', city: 'Kolhapur', state: 'Maharashtra', lat: 16.6647, lon: 74.289398, elevationM: ft(1996) },
];

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
