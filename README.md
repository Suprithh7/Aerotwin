# AeroTwin

A physics-informed digital twin of a ~100 hp turbocharged four-cylinder boxer
UAV engine, with fault injection, residual-based diagnosis, remaining-useful-life
projection and a Monte Carlo mission-risk planner over Indian geography.

Everything on screen is computed. There is no recorded or decorative telemetry:
the top bar carries a permanent **SYNTHETIC DATA - PHYSICS-SIMULATED** chip, and
every run is reproducible from its seed.

## Running

```
npm install
npm run dev        # console at http://localhost:5173
npm run build      # tsc + vite build
npx vitest run     # 91 tests
```

## Tabs

- **Live Monitor** - 20 Hz model in a Web Worker, strip charts, boxer
  schematic, scenario controls and fault injection, diagnosis verdict with
  residual attribution and an RUL band, and the route map with the live
  alternate-airfield layer.
- **Mission Risk** - route, per-waypoint weather and Monte Carlo mission runs
  with a per-leg risk table, landing state, contributing factors and the
  healthy-vs-current engine bars.

## Architecture

| Path | Contents |
|---|---|
| `src/sim/` | engine model, atmosphere, faults, channel definitions, worker |
| `src/diagnosis/` | signature library, fault classifier, RUL estimator, actions |
| `src/mission/` | route geometry and presets, weather, profile planner, Monte Carlo |
| `src/nav/` | alternate-airfield reachability, units, live layer |
| `src/data/` | Indian civil airfields and reference places |
| `src/components/` | the console |

`ASSUMPTIONS.md` lists every assumed constant with units and a `file:line`
citation, including the reason each figure is what it is.

## Limitations

**Terrain clearance is not modelled.** Glide range is a still-air,
obstacle-free figure: `altitude above the field x an assumed L/D of 12`. In the
Ladakh preset the aircraft is planned at 5.2-5.4 km over terrain that reaches
well above 5 km, so a "reachable" alternate on the HUD can be a ridge. Treat
every glide number as an upper bound on range, never as clearance.

Related consequences, all of which the interface states or should be read with:

- **Airfield data is illustrative.** Coordinates and elevations were taken from
  the OurAirports open database and filtered to civil airports; runway
  dimensions, operating hours, approach minima and alternate minima are not in
  the model at all. Verify against AIP India before any real use. `VAGO` does
  not exist in the dataset; Dabolim, Goa is `VOGO`.
- **No boundaries are depicted.** The basemap's country-level and disputed
  boundary layers are switched off on style load because their depiction does
  not match India's official one, and the app draws none of its own. Route
  waypoints are illustrative and are placed well inside the interior; they are
  not survey-verified clearances from the LAC or any international border.
- **The power model is coarse.** Level-flight power required is a density-ratio
  power law shared with the mission planner, not a drag polar, and it carries no
  weight term. Alternates therefore read the engine's delivered shaft power
  against a fixed requirement for the phase and density altitude.
- **Diagnosis is signature matching, not inference about the true fault.** The
  classifier sees only the smoothed residuals the sensors would give it. Ground
  truth is deliberately not read. Severity is estimated by a fixed LUT
  interpolation of the model's own nonlinear response curves, so the RUL band
  inherits the model's response shape; the sampled quantity is degradation
  *growth*, not wear rate.
- **Weather is an engineering approximation.** Live fetch is Open-Meteo at the
  waypoint; ISA deviation is derived from the surface temperature reduced to the
  grid cell's elevation, gust excess is banded into turbulence levels, and wind
  is uniform over the leg rather than a profile.
- **Mission physics is a planned profile.** Constant airspeeds and climb rates,
  a fixed fuel flow schedule, and no wind shear or re-clearance; the Monte Carlo
  randomises noise seed, turbulence realisation, degradation growth and weather
  jitter within documented spreads.
- **Units are mixed on purpose.** Altitudes are m AMSL with feet beside them,
  distances km with NM beside them, and the clock is UTC with IST alongside, so
  the console reads the same figures an Indian ops board would.
