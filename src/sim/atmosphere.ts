// ISA standard atmosphere (troposphere) with temperature offset.
// Units: SI. Valid to 11 km (MALE UAV ops ceiling is far below this).

export const ISA = {
  T0: 288.15, // K, sea-level temperature
  P0: 101325, // Pa, sea-level pressure
  RHO0: 1.225, // kg/m3, sea-level density
  L: 0.0065, // K/m, lapse rate
  G: 9.80665, // m/s2
  R: 287.052, // J/(kg K), specific gas constant of air
};

export interface Atmosphere {
  altM: number; // pressure altitude used for the calculation
  tempK: number; // actual temperature incl. ISA deviation
  tempC: number;
  pressPa: number;
  densKgM3: number;
  sigma: number; // density ratio vs sea level
  densityAltM: number; // altitude where ISA density equals densKgM3
}

export function isaAtmosphere(altM: number): Atmosphere {
  const T = ISA.T0 - ISA.L * altM;
  const P = ISA.P0 * Math.pow(T / ISA.T0, ISA.G / (ISA.R * ISA.L));
  const rho = P / (ISA.R * T);
  return atmos(altM, T, P, rho);
}

// altM: true altitude, isaDevC: temperature deviation from ISA (deg C)
export function atmosphere(altM: number, isaDevC: number): Atmosphere {
  const Tstd = ISA.T0 - ISA.L * altM;
  const T = Tstd + isaDevC;
  // warmer air mass: same sea-level standard pressure, larger scale height,
  // so pressure at a fixed geometric altitude rises; density falls (P/RT).
  const P = ISA.P0 * Math.pow(1 - (ISA.L * altM) / (ISA.T0 + isaDevC), ISA.G / (ISA.R * ISA.L));
  const rho = P / (ISA.R * T);
  return atmos(altM, T, P, rho);
}

function atmos(altM: number, T: number, P: number, rho: number): Atmosphere {
  const sigma = rho / ISA.RHO0;
  // density altitude: ISA altitude where standard density == rho
  // rho/rho0 = (1 - L h / T0)^(G/(R L) - 1)  =>  h = (T0/L)(1 - (rho/rho0)^(1/(G/(RL)-1)))
  const e = ISA.G / (ISA.R * ISA.L) - 1;
  const densityAltM = (ISA.T0 / ISA.L) * (1 - Math.pow(sigma, 1 / e));
  return {
    altM,
    tempK: T,
    tempC: T - 273.15,
    pressPa: P,
    densKgM3: rho,
    sigma,
    densityAltM,
  };
}
