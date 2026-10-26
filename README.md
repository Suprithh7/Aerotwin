# AeroTwin

A mission rehearsal simulator built on a physics-informed digital twin of a
~100 hp turbocharged four-cylinder boxer UAV engine. Plan a mission anywhere in
India, brief the risk, fly a scripted fault, and debrief how early the twin
caught it. Fault injection, residual-based diagnosis, remaining-useful-life
projection and the Monte Carlo mission-risk planner are the same models used by
the engineering console behind the E key.

The BRIEF stage is a **free-form mission editor**. Click the map to add nodes,
drag them to move, insert at leg midpoints, draw denied/restricted zones, move
the ground station, place custom landing sites, search Open-Meteo places or
paste `lat, lon`, and auto-place RECON points. Five illustrative templates are
editable starting points, not fixed routes. Missions save locally and
round-trip through GeoJSON.

The FLY stage also runs a **Data Guard** rehearsal: recon items are captured and
encrypted onboard, offloaded over a simulated datalink by priority, and the
onboard session key is destroyed if the aircraft is predicted to be lost inside
the exercise denied area with no friendly landing reachable.

Everything on screen is computed. There is no recorded or decorative telemetry:
the app carries a permanent **SYNTHETIC DATA - PHYSICS-SIMULATED** chip, and
every run is reproducible from its seed.

## Running

```
npm install
npm run dev        # rehearsal at http://localhost:5173
npm run build      # tsc + vite build
npx vitest run     # 217 tests
```

## Stages

- **BRIEF** - a map-centered editor (50-node cap, 100-step undo/redo, zone
  drawing, ground-station ring, custom sites, place search, seeded RECON
  auto-placement) beside six computed pre-flight checks and the Monte Carlo
  verdict with three plain-language risk factors. The checks cover terrain
  clearance, zones, fuel, alternates, datalink and weather; any edit marks the
  assessment OUTDATED. Weather is fetched for the mission start hour and each
  node is tagged LIVE, MANUAL or FALLBACK. One action: RUN REHEARSAL. A 7-hour
  mission is compressed into 120 simulation seconds; all clocks show mission
  time.
- **FLY** - full-bleed map with six overlay groups: engine state and one plain
  sentence, mission clock and speed, cylinder strip with oil-pressure/CHT/boost
  bars, nearest landing with reachability, the DATA panel with the collapsible
  ground station, and an 8-second event ticker. A collapsible **Failure
  Director** panel (**F**) gives the instructor engine faults, instrument
  faults, link jam/degrade, weather steps, scheduled events and a seeded
  surprise. Warning and critical states drive a flashing banner, a chime and
  spoken callout, a state-coloured aircraft ring, gauge deviation hatching, and
  the engine-out glide ring when no alternate is reachable.
- **DEBRIEF** - outcome, flight time, distance, engine life used, an event
  timeline, the computed twin-flag line, every instructor injection with its
  detection latency, and the Data Guard result by priority with the erase and
  recovery outcome. REPLAY or NEW MISSION.

Press **E** on any stage for the engineering overlay: ENGINEER (strip charts,
boxer schematic, diagnosis, fault injection) and VALIDATION (route map with
per-leg Monte Carlo breach colours, weather, mission panel). **Esc** closes it
without resetting the run.

## Failure Director

The instructor station is a side panel on FLY, closed by default (**F**). It
injects the eight engine faults with a severity, ramp and cylinder where the
fault is cylinder-specific; instrument drift, stuck and spike faults on any
telemetered channel; datalink **JAM**, **DEGRADE x0.25** and **RESTORE**;
turbulence and ISA-deviation steps. Every action can fire immediately or be
scheduled at a T+mm:ss, and the schedule is editable and clearable. A scenario
card's script loads into the same schedule at its trigger fraction.

**SURPRISE ME** draws a seeded engine or instrument fault and a firing time in
the chosen window (default 5-20 min), keeps the pick hidden in the schedule
list, and reveals it in the ticker only when it fires. The same seed and window
reproduce the same fault and time. The scheduler compares against the mission
clock, so a scheduled event is due at the same mission time at 1x, 10x and 60x
(worker ticks quantize the actual injection by up to one sample).

Each injection is logged with its mission time. An engine fault is detected at
the twin's first non-NOMINAL diagnosis; an instrument fault is also detected at
the first clear separation between the affected measured channel and the twin.
The ticker prints `Detected N s after injection.` and the AAR lists the same
latency per event. Detection latency is in compressed simulator seconds, not
wall time.

Presentation is deliberately restrained: a 4 px top bar and aircraft ring take
the state colour; on a state increase the banner flashes at 1 Hz for 5 s and
then holds, respecting `prefers-reduced-motion`; two synthesized chimes and a
short `speechSynthesis` callout distinguish caution from warning, one shot per
state increase, muted with **M** and unlocked by the first pointer or key
event. The affected gauge shows a hatched arc between measured and twin values
and the affected cylinder block gets a 1 px outline. When the state is WARNING
or CRITICAL and no alternate is reachable (or the best option is a glide), the
map draws the engine-out glide ring described below.

## Data Guard

One recon item is generated per RECON node in the mission, seeded from the
mission, node id and node name. Items are collected in route order: on the leg
into its own waypoint, when the aircraft passes within 3 km, the item (IMAGE or
VIDEO, size, priority 1-3) is encrypted with AES-256-GCM and stored as
ciphertext with the SHA-256 of its plaintext. While the simulated link is up the item is sent highest priority
first; the ground station decrypts it and checks the hash before it counts as
secured.

The guard is a decision table evaluated every session tick:

- **MONITOR** - no engine fault, or a sensor-only fault. Never escalates.
- **OFFLOAD_PRIORITY** - an engine fault and no friendly landing reachable,
  with the predicted loss outside the denied area. Send at the full link rate.
- **STANDBY** - an engine fault but a friendly alternate is reachable. The data
  stays encrypted onboard and the offload continues; the key is not erased.
- **ARMED** - an engine fault, no friendly landing, and the predicted loss
  inside the exercise denied area. The reason states the transfer time, how
  many MB and how many whole priority items fit before loss.
- **ZEROIZED** - erase triggered by the last byte sent, a lost or jammed link,
  less than 20 s to loss, a forced landing inside the area, or an operator
  remote zeroize. The onboard ciphertext is overwritten and the key dropped;
  a simulated adversary attempt against every stored block then fails.

The four fault cards are COOLING OVER DENIED AREA (offload, then erase),
FAILURE + LINK JAMMED (immediate erase, unsent data lost), FAILURE OVER FRIENDLY
AREA (STANDBY to landing, no erase), and SENSOR GLITCH (no escalation, no
erase). **J** or the JAM LINK button drops the datalink at any time.

**Cryptography is a demonstration, not a product claim.** Browser WebCrypto
performs the ephemeral ECDH P-256 exchange, HKDF-SHA256 derivation and
AES-256-GCM item encryption, and zeroize overwrites the buffers JavaScript
exposes, drops the `CryptoKey` reference, locks the element and overwrites the
stored ciphertext. JavaScript cannot guarantee that copies of the key have left
the heap, and the adversary is a decoy AES key rather than a hardware attacker.
Production would use a hardware secure element and a certified link encryption
device. The DATA panel footer repeats this.

## Architecture

| Path | Contents |
|---|---|
| `src/sim/` | engine model, atmosphere, faults, channel definitions, worker |
| `src/diagnosis/` | signature library, fault classifier, RUL estimator, actions |
| `src/mission/` | Mission model and editor store, route geometry, terrain/AGL, weather, GeoJSON, pre-flight checks, profile planner, Monte Carlo |
| `src/nav/` | alternate-airfield reachability, units, live layer |
| `src/payload/` | recon points from RECON nodes, dummy payloads, WebCrypto session, datalink, priority offload, Data Guard, session |
| `src/rehearsal/` | stage store, clock compression, scenario scripts, HUD presentation, failure director, audio, glide ring, debrief metrics |
| `src/data/` | 583 bundled Indian airfields, five mission templates, reference places |
| `src/components/rehearsal/` | BRIEF, FLY, DEBRIEF, Data Guard HUD, the stage map and the E overlay |
| `src/components/` | the original engineering console, reused inside the overlay |

`ASSUMPTIONS.md` lists every assumed constant with units and a `file:line`
citation, including the reason each figure is what it is.

## Limitations

**Terrain is sampled, not certified.** Planned AGL is resolved against
Open-Meteo's public elevation DEM along the route at 1 km samples. This catches
large ridges — the Ladakh template carries two extra passes (STOK PASS and
INDUS PASS) to clear DEM ridges found during acceptance — but it is not an
obstacle survey: towers, wires, buildings and DEM error are not modelled, and
the 100 m minimum applies only outside a 1 km buffer at each route end.
Glide range is still an obstacle-free figure:
`altitude above the field x an assumed L/D of 12`, so a "reachable" alternate on
the HUD can be behind a ridge. The FLY glide ring uses height above the
sampled terrain under the aircraft times the same ratio, and shifts its centre
downwind by `wind speed x glide time`; **terrain masking is not modelled**, so
the ring can cover ground the aircraft could not actually glide to. Treat every
glide number as an upper bound on range, never as clearance.

Related consequences, all of which the interface states or should be read with:

- **Airfield data is illustrative.** 583 fields were bundled from the
  OurAirports database (`iso_country = IN`; large/medium/small airports and
  heliports) after a documented name filter removed 41 military, naval and army
  rows; the heuristic and the full excluded-name list are in `ASSUMPTIONS.md`.
  Runway dimensions, operating hours, approach minima and alternate minima are
  not in the model at all. The nearest-landing layer considers every bundled
  field plus the mission's custom sites within 400 km, nearest first. Verify
  against AIP India before any real use. `VAGO` does not exist in the dataset;
  Dabolim, Goa is `VOGO`.
- **No boundaries are depicted.** The stage map draws only dark fills,
  hillshade and its own restricted label set; the basemap's lines and labels are
  hidden. Its label filter is a rough subcontinent extent, not a boundary, and
  it is never drawn. Route waypoints and zones come from editable illustrative
  templates and are placed well inside the interior; they are not
  survey-verified clearances from the LAC or any international border, and the
  exercise denied areas are not real restricted areas.
- **The scenario cards are calibration, not emergencies.** The three cooling
  cards use cylinder 3 at severity 0.6 with a 30 s ramp; the twin flags about
  32 sim seconds after injection and the measured CHT stays below the 135 C
  limit through the rehearsal. The friendly-area card injects at 57 % of the
  route, but whether the guard stands by depends on the current mission's zone
  and alternate geometry, not on the card title. SENSOR GLITCH (CHT 1 drift,
  severity 0.5, 10 s ramp) injects at 20 % and stays below the measured limit so
  the twin can hold an ADVISORY false alarm. See `ASSUMPTIONS.md` for the run
  traces.
- **Data Guard is an illustrative protocol exercise.** The datalink is
  line-of-sight only: terrain masking, multipath, antenna patterns and jamming
  strategy are not modelled, and losing the link is treated as an absolute
  event. Recon items are generated from the mission's RECON nodes; ground
  stations and denied areas are mission fields, all illustrative. The encrypted blob is a deterministic text header plus seeded
  random bytes at 1:100000 of the nominal size, while every transfer and
  capacity number uses the nominal megabytes. The ground station's "decrypt"
  preview therefore reads the demo header, not imagery.
- **Cryptographic erase cannot be proven in a browser.** WebCrypto has no key
  destruction API; zeroize overwrites the exposed raw key and ciphertext,
  drops the reference and locks the element, but JavaScript cannot guarantee
  that no copy survives in the heap. The adversary is a decoy key, not a
  hardware attacker. Production requires a hardware secure element and a
  certified link encryption device.
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
- **Weather is an engineering approximation.** Each node is fetched from
  Open-Meteo for the hour containing the mission start; ISA deviation is derived
  from the surface temperature reduced to the cell's elevation, gust excess is
  banded into turbulence levels, and wind is uniform over the leg rather than a
  profile. A per-node manual override replaces the forecast (tagged MANUAL); a
  failed fetch falls back silently to bundled values (tagged FALLBACK).
- **Mission physics is a planned profile.** Constant airspeeds and climb rates,
  a fixed fuel flow schedule, and no wind shear or re-clearance; the Monte Carlo
  randomises noise seed, turbulence realisation, degradation growth and weather
  jitter within documented spreads.
- **Units are mixed on purpose.** Altitudes are m AMSL with feet beside them,
  distances km with NM beside them, and the clock is UTC with IST alongside, so
  the console reads the same figures an Indian ops board would.
