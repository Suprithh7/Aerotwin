// Illustrative reference places for the India map: well-known towns and
// landmarks near the three mission presets. Positions are approximate (to a few
// km), are drawn only as map context from zoom 6 upward and carry no operational
// meaning. No boundary or boundary-adjacent feature is represented.

export interface Place {
  name: string;
  state: string;
  lat: number;
  lon: number;
}

export const PLACES: Place[] = [
  // Ladakh / Jammu & Kashmir / Himachal (Indus and Jehlum corridors)
  { name: 'Kargil', state: 'Ladakh', lat: 34.5812, lon: 76.13 },
  { name: 'Dras', state: 'Ladakh', lat: 34.3444, lon: 76.0281 },
  { name: 'Mulbekh', state: 'Ladakh', lat: 34.454, lon: 76.637 },
  { name: 'Alchi', state: 'Ladakh', lat: 34.125, lon: 76.792 },
  { name: 'Sham', state: 'Ladakh', lat: 34.116, lon: 77.1 },
  { name: 'Thiksey', state: 'Ladakh', lat: 34.1637, lon: 77.6378 },
  { name: 'Anantnag', state: 'Jammu & Kashmir', lat: 33.74, lon: 75.15 },
  { name: 'Pahalgam', state: 'Jammu & Kashmir', lat: 34.01, lon: 75.32 },
  { name: 'Patnitop', state: 'Jammu & Kashmir', lat: 33.066, lon: 74.993 },
  { name: 'Keylong', state: 'Himachal Pradesh', lat: 32.533, lon: 77.143 },
  { name: 'Shimla', state: 'Himachal Pradesh', lat: 31.1048, lon: 77.1734 },
  // Rajasthan / Gujarat (Thar and western plain)
  { name: 'Pokhran', state: 'Rajasthan', lat: 26.8333, lon: 71.5333 },
  { name: 'Barmer', state: 'Rajasthan', lat: 25.7431, lon: 71.4219 },
  { name: 'Bikaner', state: 'Rajasthan', lat: 28.03, lon: 73.315 },
  { name: 'Jodhpur', state: 'Rajasthan', lat: 26.2389, lon: 73.0243 },
  { name: 'Ajmer', state: 'Rajasthan', lat: 26.449, lon: 74.639 },
  { name: 'Jaipur', state: 'Rajasthan', lat: 26.9124, lon: 75.7873 },
  { name: 'Udaipur', state: 'Rajasthan', lat: 24.6646, lon: 73.7847 },
  { name: 'Mount Abu', state: 'Rajasthan', lat: 24.592, lon: 72.718 },
  { name: 'Ahmedabad', state: 'Gujarat', lat: 23.0225, lon: 72.5714 },
  // West coast (Konkan and Malabar)
  { name: 'Pune', state: 'Maharashtra', lat: 18.5204, lon: 73.8567 },
  { name: 'Kolhapur', state: 'Maharashtra', lat: 16.7, lon: 74.23 },
  { name: 'Mahabaleshwar', state: 'Maharashtra', lat: 17.93, lon: 73.65 },
  { name: 'Ratnagiri', state: 'Maharashtra', lat: 16.991, lon: 73.34 },
  { name: 'Panaji', state: 'Goa', lat: 15.491, lon: 73.829 },
  { name: 'Margao', state: 'Goa', lat: 15.274, lon: 74.015 },
  { name: 'Karwar', state: 'Karnataka', lat: 14.813, lon: 74.133 },
  { name: 'Udupi', state: 'Karnataka', lat: 13.341, lon: 74.751 },
  { name: 'Kozhikode', state: 'Kerala', lat: 11.2587, lon: 75.7804 },
  { name: 'Alappuzha', state: 'Kerala', lat: 9.4981, lon: 76.3389 },
];
