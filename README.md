# AeroTwin

A mission rehearsal simulator built on a physics-informed digital twin of a
~100 hp turbocharged four-cylinder boxer UAV engine. Pick an Indian route,
brief the risk, fly a scripted fault, and debrief how early the twin caught it.
Fault injection, residual-based diagnosis, remaining-useful-life projection and
the Monte Carlo mission-risk planner are the same models used by the engineering
console behind the E key.

Everything on screen is computed. There is no recorded or decorative telemetry:
the app carries a permanent **SYNTHETIC DATA - PHYSICS-SIMULATED** chip, and
every run is reproducible from its seed.

## Running

```
npm install
npm run dev        # rehearsal at http://localhost:5173
npm run build      # tsc + vite build
npx vitest run     # 114 tests
```

## Stages

- **BRIEF** - three illustrative presets, the route map with hillshade, the
  mission risk verdict, three plain-language risk factors, and three scenario
  cards that script the existing fault model. One action: RUN REHEARSAL.
  A 7-hour mission is compressed into 120 simulation seconds; all clocks show
  mission time.
- **FLY** - full-bleed map with a five-panel HUD: engine state and one plain
  sentence, mission clock and speed, cylinder strip with oil-pressure/CHT/boost
  bars, nearest landing with reachability, and an 8-second event ticker.
- **DEBRIEF** - outcome, flight time, distance, engine life used, a one-row
  event timeline, and the computed lead between the twin's flag and the measured
  hard limit. REPLAY or NEW MISSION.

Press **E** on any stage for the engineering overlay: ENGINEER (strip charts,
boxer schematic, diagnosis, fault injection) and VALIDATION (route map with
per-leg Monte Carlo breach colours, weather, mission panel). **Esc** closes it
without resetting the run.

## Architecture

| Path | Contents |
|---|---|
| `src/sim/` | engine model, atmosphere, faults, channel definitions, worker |
| `src/diagnosis/` | signature library, fault classifier, RUL estimator, actions |
| `src/mission/` | route geometry and presets, weather, profile planner, Monte Carlo |
| `src/nav/` | alternate-airfield reachability, units, live layer |
| `src/rehearsal/` | stage store, clock compression, scenario scripts, HUD presentation, debrief metrics |
| `src/data/` | Indian civil airfields, reference places and illustrative exercise geography |
| `src/components/rehearsal/` | BRIEF, FLY, DEBRIEF, the stage map and the E overlay |
| `src/components/` | the original engineering console, reused inside the overlay |

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
- **No boundaries are depicted.** The stage map draws only dark fills,
  hillshade and its own restricted label set; the basemap's lines and labels are
  hidden. Its label filter is a rough subcontinent extent, not a boundary, and
  it is never drawn. Route waypoints and denied areas are illustrative and are
  placed well inside the interior; they are not survey-verified clearances from
  the LAC or any international border, and the exercise denied areas are not
  real restricted areas.
- **The scenario cards are calibration, not emergencies.** COOLING FAILURE
  (cylinder 3, severity 0.8, 30 s ramp) reaches a measured CHT limit after a
  warning; SENSOR GLITCH (CHT 1 drift, severity 0.5, 10 s ramp) stays below the
  measured limit so the twin can hold an ADVISORY false alarm. Both inject at
  20 % of the planned mission. See `ASSUMPTIONS.md` for the run traces.
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
