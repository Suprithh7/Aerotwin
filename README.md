# AeroTwin

A mission rehearsal simulator built on a physics-informed digital twin of a
~100 hp turbocharged four-cylinder boxer UAV engine. Pick an Indian route,
brief the risk, fly a scripted fault, and debrief how early the twin caught it.
Fault injection, residual-based diagnosis, remaining-useful-life projection and
the Monte Carlo mission-risk planner are the same models used by the engineering
console behind the E key.

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
npx vitest run     # 176 tests
```

## Stages

- **BRIEF** - three illustrative presets, the route map with hillshade, the
  mission risk verdict, three plain-language risk factors, and five scenario
  cards that script the existing fault model. One action: RUN REHEARSAL.
  A 7-hour mission is compressed into 120 simulation seconds; all clocks show
  mission time.
- **FLY** - full-bleed map with six overlay groups: engine state and one plain
  sentence, mission clock and speed, cylinder strip with oil-pressure/CHT/boost
  bars, nearest landing with reachability, the DATA panel with the collapsible
  ground station, and an 8-second event ticker.
- **DEBRIEF** - outcome, flight time, distance, engine life used, an event
  timeline, the computed twin-flag line, and the Data Guard result by priority
  with the erase and recovery outcome. REPLAY or NEW MISSION.

Press **E** on any stage for the engineering overlay: ENGINEER (strip charts,
boxer schematic, diagnosis, fault injection) and VALIDATION (route map with
per-leg Monte Carlo breach colours, weather, mission panel). **Esc** closes it
without resetting the run.

## Data Guard

Five seeded recon points sit beside the route holds and waypoints. When the
aircraft passes within 3 km, the item (IMAGE or VIDEO, size, priority 1-3) is
encrypted with AES-256-GCM and stored as ciphertext with the SHA-256 of its
plaintext. While the simulated link is up the item is sent highest priority
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
| `src/mission/` | route geometry and presets, weather, profile planner, Monte Carlo |
| `src/nav/` | alternate-airfield reachability, units, live layer |
| `src/payload/` | recon points, dummy payloads, WebCrypto session, datalink, priority offload, Data Guard, session |
| `src/rehearsal/` | stage store, clock compression, scenario scripts, HUD presentation, debrief metrics |
| `src/data/` | Indian civil airfields, reference places and illustrative exercise geography |
| `src/components/rehearsal/` | BRIEF, FLY, DEBRIEF, Data Guard HUD, the stage map and the E overlay |
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
- **The scenario cards are calibration, not emergencies.** The three cooling
  cards use cylinder 3 at severity 0.6 with a 30 s ramp; the twin flags about
  32 sim seconds after injection and the measured CHT stays below the 135 C
  limit through the rehearsal. The friendly-area card injects at 57 % of the
  route so detection happens over PHEY, after the aircraft has left the denied
  area. SENSOR GLITCH (CHT 1 drift, severity 0.5, 10 s ramp) injects at 20 % and
  stays below the measured limit so the twin can hold an ADVISORY false alarm.
  See `ASSUMPTIONS.md` for the run traces.
- **Data Guard is an illustrative protocol exercise.** The datalink is
  line-of-sight only: terrain masking, multipath, antenna patterns and jamming
  strategy are not modelled, and losing the link is treated as an absolute
  event. The recon points, ground stations and denied areas are illustrative
  geography. The encrypted blob is a deterministic text header plus seeded
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
