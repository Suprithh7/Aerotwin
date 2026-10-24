# AeroTwin M1 — Assumptions

Every numeric constant in the simulation is an engineering assumption for a
physics-informed synthetic dataset, not a measured value. Locations below.

## Atmospheric model — `src/sim/atmosphere.ts`
| Constant | Value | Units | Meaning |
|---|---|---|---|
| `ISA.T0` | 288.15 | K | sea-level standard temperature |
| `ISA.P0` | 101 325 | Pa | sea-level standard pressure |
| `ISA.RHO0` | 1.225 | kg/m³ | sea-level standard density |
| `ISA.L` | 0.0065 | K/m | tropospheric lapse rate |
| `ISA.G` | 9.80665 | m/s² | standard gravity |
| `ISA.R` | 287.052 | J/(kg·K) | specific gas constant of air |
| validity | 0–11 000 m geometric | m | troposphere only; UAV ceiling is well below |

ISA-deviation assumption: a warm/cold air mass keeps sea-level pressure at P0
and scales the pressure by `(1 - L·h/(T0+dev))^5.2558` (constant relative
lapse rate). Density altitude inverts the standard density law.

## Engine — `src/sim/constants.ts` (`ENG`)
| Constant | Value | Units | Meaning |
|---|---|---|---|
| `dispM3` | 0.003 | m³ | total displacement (3.0 L, 4-cyl turbo boxer ~100 hp class) |
| `veBase` | 0.85 | – | volumetric efficiency |
| `lhvJkg` | 43.4e6 | J/kg | fuel lower heating value (Jet-A-like) |
| `etaBase` | 0.32 | – | peak brake thermal efficiency |
| `mechEff` | 0.94 | – | mechanical (crank/accessory) efficiency |
| `chtHeatFrac` | 0.54 | – | fraction of combustion waste heat into the head |
| `exhHeatFrac` | 0.30 | – | fraction of waste heat carried by exhaust gas |
| `radFrac` | 0.05 | – | heat lost overboard without heating head or exhaust |
| `bpExhHeatFrac` | 0.15 | – | extra exhaust heat at full back-pressure (fraction of fuel power) |
| `bpCylHeatFrac` | 0.22 | – | hot-residual soak into head at full back-pressure |
| `cpExhaust` | 1160 | J/(kg·K) | exhaust gas specific heat |
| `mapTauS` | 0.35 | s | manifold filling time constant |
| `egtTauS` | 0.6 | s | EGT measurement lag |
| `chtCapJk` | 1400 | J/K | lumped head heat capacity per cylinder |
| `oilCapJk` | 5200 | J/K | oil sump + cooler lumped heat capacity |
| `prRef` | 2.55 | – | wastegate-limited turbo pressure ratio near rated rpm |
| `prRpmRef` | 2300 | rpm | rpm at which the gate pressure is reached (PR ∝ (rpm/2300)^1.8) |
| `compHeatBase` | 22 | K | compressor outlet rise over OAT at zero boost |
| `compHeatPerPR` | 70 | K | additional intake temperature rise per unit PR |
| `mapThrFloor` | 0.25 | – | manifold pressure fraction of boost pressure at idle throttle |
| `hCylBase` | 55 | W/K | static cylinder cooling coefficient |
| `hCylPerMs` | 0.72 | W/(K·m/s) | cooling gain with airspeed |
| `cylRadiate` | 8 | W/K | lumped radiation loss per cylinder |
| `hOilBase` | 40 | W/K | oil cooler coefficient at zero airspeed |
| `hOilPerMs` | 0.5 | W/(K·m/s) | oil cooling gain with airspeed |
| `cylToOilCond` | 8 | W/K | block-to-oil conduction per cylinder |
| `oilFrictPowerFrac` | 0.08 | – | friction heat as fraction of shaft power |
| `oilFrictRpmK` | 55 | W/(krpm)³ | speed-dependent friction heat |
| `oilPRef` | 4.3 | bar | oil pressure at 2000 rpm, 80 °C, healthy seals |
| `oilVisicPerK` | 0.013 | 1/K | viscosity falloff per °C above 80 °C |
| `inertiaKgM2` | 0.55 | kg·m² | crank + prop inertia reduced to crank |
| `vibBase` | 0.9 | mm/s | baseline vibration RMS |
| `vibImbalanceK` | 6 | mm/s | vibration per unit relative cylinder imbalance |
| `vibOilK` | 1.8 | mm/s | added vibration at full oil-seal degradation |
| `vibIgnK` | 2.5 | mm/s | added vibration at full ignition degradation |
| `govKp` | 3e-4 | 1/(rpm·s) | electronic-governor integral gain |
| `govClamp` | 0.3 | – | governor authority around the schedule throttle |
| unburnt→exh 0.25 | hard-coded in `engineModel.ts:153` | – | fraction of misfire fuel energy released in the exhaust manifold |
| late-burn→exh 0.5 | `engineModel.ts:151` | – | fraction of retarded-combustion energy dumped into the exhaust |
| friction-to-head 0.02 | `engineModel.ts:172` | – | shaft-power share heating each cylinder head |
| egt quench 0.55/ inj excess | `engineModel.ts:185` | – | EGT reduction per unit of over-fuelling |
| vib lag 0.4 | `engineModel.ts:213` | s | vibration RMS EWMA time constant |
| eta compression split 0.55+0.45·comp | `engineModel.ts:141` | – | efficiency share vs charge density under compression loss |
| back-pressure penalties 0.22 (VE, `:132`) / 0.28 (eta, `:142`) / 0.18 (MAP, `:119`) | `engineModel.ts` | – | efficiency/flow losses at full exhaust fault |

## Flight phases — `src/sim/constants.ts` (`PHASES`)
RPM target, schedule throttle, airspeed, propeller load constant
(N·m/(rad/s)²) and command AFR per phase — all assumed:
takeoff 2400 rpm/1.0/12 m/s/4.7e-3/AFR 12.8; climb 2300/0.88/27/4.3e-3/13.6;
cruise 2100/0.72/41/4.2e-3/16.5; loiter 1800/0.5/26/3.7e-3/17.0;
descent 1650/0.32/32/2.9e-3/17.5.

## Fault strength coefficients — `src/sim/faults.ts:30-52`
Each engine fault scales a model parameter by `severity × rampProgress`
(linear ramp over `rampTime` seconds). Assumed full-severity effects:
misfire → firing ×(1−0.97·s); injector → injector ×(1+1.3·s);
cooling → cooling ×(1−0.85·s); oil → oilSeal ×(1−0.8·s);
ignition → ignition ×(1−0.55·s); turbo → turbo ×(1−0.9·s);
compression → compression ×(1−0.55·s); exhaust → back-pressure = s.

## Turbulence / gust — `src/sim/constants.ts` (`TURB`, `GUST`) and `sim.ts`
Ornstein–Uhlenbeck process dx = −x/τ dt + σ dW with level factors
0/0.35/0.75/1.35, correlation times 1/4/3/2 s, driving-noise scale
`0.4·factor` (`sim.ts:133`), clip ±3.5 (`sim.ts:135`). Gust impact
amplitudes: prop load ±14 %, throttle ±3.5 %, rpm-target jitter ±18 rpm,
airspeed ±6 %.

## Sensors — `src/sim/constants.ts` (`CHANNELS`)
Per-channel Gaussian noise 1-σ (`noiseSigma`) and full-severity drift
range (`driftRange`) are assumed sensor characteristics, listed per channel
(RPM 11 rpm, MAP 0.9 kPa, CHT 1.1 °C, EGT 3.4 °C, oil temp 0.55 °C, oil
pressure 0.03 bar, vibration 0.07 mm/s, power 0.65 kW, fuel 0.05 kg, …).
Sensor "noise spike" adds `0.35·driftRange·severity` to σ
(`sim.ts:173`). Stuck faults freeze the last measured value.

## Residual / twin — `src/sim/constants.ts`, `sim.ts`
Twin time constant `EWMA_TAU_S` = 0.8 s; EWMA update α = dt/(τ+dt)
(`sim.ts:183`); z-score divides the residual by the channel noise σ.

## Mission / demo setup
`INITIAL_FUEL_KG` = 42 kg (`constants.ts:84`).
Default scenario: cruise, 3000 m, ISA +0, no turbulence, seed 1337
(`src/state/store.ts:26-31` and `:63`, `src/sim/worker.ts:19-23`).
Chart window 120 s, history stride 0.1 s, sim step 0.05 s (20 Hz),
UI tick 10 Hz, worker catch-up cap 240 steps/frame (`worker.ts:65`).

## Documented cross-channel effects
- Cooling degradation (cyl): raises that cylinder's CHT; other CHTs, EGT,
  power stay within noise. Oil temp rises slightly (~2–4 °C) because hot
  block-to-oil conduction (`cylToOilCond`) transfers part of the extra head
  heat to the sump — expected physics, visible as a small positive residual.
- Governor coupling: faults that cut power (misfire, turbo, compression,
  exhaust) make the electronic governor open the throttle to hold the phase
  rpm target, so MAP/boost/fuel residuals move opposite to raw power loss;
  rpm itself stays near target unless the governor saturates (turbo/exhaust
  faults show the strongest rpm residual).
- Misfire: that cylinder's CHT falls (no combustion heat) while its EGT
  rises modestly (unburnt fuel burns in the exhaust manifold, assumed 25 %
  share), and vibration is dominant.

# AeroTwin M3 — Mission Risk assumptions

The mission layer reuses the M1 engine model unchanged. Everything below is a
planning or profile assumption, not a change to the physics.

## Route geometry — `src/mission/route.ts`
| Item | Value | Units | Location |
|---|---|---|---|
| Earth radius (spherical haversine) | 6 371 000 | m | `route.ts:22` |
| Leg distance | great-circle haversine | m | `route.ts:28` |
| Leg course | initial great-circle bearing, true 0-360 | deg | `route.ts:38` |
| Wind convention | meteorological, direction the wind blows FROM | deg | `route.ts:52` |
| Groundspeed | TAS − headwind, floored | m/s | `route.ts:65`, `mission.ts:167` |
| Minimum planned groundspeed | 10 (a slower leg is flagged wind-limited, never infinite) | m/s | `constants.ts:63` |

Track sampling for the marker is 24 straight-line samples per leg
(`route.ts:177`); the marker position interpolates that polyline, so it follows
the drawn route rather than a recomputed great circle.

## Route presets — `src/mission/route.ts:117-158`
**Illustrative waypoints only.** The coordinates, altitudes and loiter holds
below were chosen for plausible geography and a 6-10 h endurance profile with
at least one station-keeping segment. They are NOT operational planning data:
they must not be used for real flight planning, and the altitudes are leg
cruise altitudes (m AMSL) of the leg flying TO that waypoint, not terrain.

| Preset | Points | Cruise band | Loiter total |
|---|---|---|---|
| HIGH ALTITUDE — Ladakh/Leh | LEH 3500 → KARDUNG 5800/30m → DBO 6100/150m → SHYOK 5800/90m → PANOM 5500 → LEH | 3.5-6.1 km | 4 h 30 m |
| HOT DAY — western Rajasthan | JAISALMER 300 → POKHRAN 3700/45m → BARMER 4000/90m → BAYANU 4000/60m → JAISALMER | 0.3-4.0 km | 3 h 15 m |
| HEADWIND — Kathiawar coast | JAMNAGAR 300 → RADHANPUR 3800/30m → DIU 4000/90m → DWARKA 4200/90m → JAMNAGAR | 0.3-4.2 km | 3 h 30 m |

## Mission profile — `src/mission/constants.ts`
Segment sequence is takeoff → (climb/descent) → cruise → loiter → … → descent →
landing. All speeds and rates are assumed constants:

| Constant | Value | Units | Location |
|---|---|---|---|
| `MISSION_AIRSPEED` takeoff/climb/cruise/loiter/descent/landing | 30/45/55/35/50/25 | m/s TAS | `constants.ts:13-20` |
| `CLIMB_RATE_MS` | 3.0 | m/s | `constants.ts:53` |
| `DESCENT_RATE_MS` | 5.0 | m/s | `constants.ts:54` |
| `TAKEOFF_S` | 30 | s | `constants.ts:58` |
| `LANDING_S` | 120 | s | `constants.ts:59` |
| `MISSION_FUEL_KG` | 95 | kg | `constants.ts:66` |
| `MISSION_RESERVE_KG` | 12 | kg that must remain at landing | `constants.ts:67` |

## Mission power schedule — `src/mission/constants.ts:43-50`
Each segment sets a target rpm and a sea-level propeller load constant; the
pair fixes the shaft power the airframe requires, since the runner scales the
load by the local density ratio: `P = propC · σ · (rpm·π/30)³`.

| Segment | rpm | throttleBase | AFR | propC (N·m/(rad/s)²) | sea-level shaft power |
|---|---|---|---|---|---|
| takeoff | 2400 | 0.58 | 13.4 | 3.6e-3 | ~55 kW |
| climb | 2150 | 0.62 | 14.5 | 4.7e-3 | ~54 kW |
| cruise | 2100 | 0.72 | 16.5 | 4.2e-3 | ~45 kW |
| loiter | 1800 | 0.50 | 17.0 | 3.7e-3 | ~24 kW |
| descent | 1650 | 0.32 | 17.5 | 2.9e-3 | ~15 kW |
| landing | 2000 | 0.62 | 14.5 | 4.4e-3 | ~40 kW |

Two schedule constraints are assumptions in their own right:

- The loads are capped at the power this model's cooling envelope sustains at
  field elevation (~55 kW peak), not at the 75 kW class rating. Raising them
  makes every mission breach CHT regardless of weather, which would leave the
  risk model nothing to discriminate on.
- `throttleBase` must keep the row inside the governor authority
  (`govClamp` = ±0.3, `sim/constants.ts:53`): a segment is only controllable if
  the throttle that holds its rpm target lies within `base ± 0.3`, so the base
  is centred on the sea-level requirement and the rows hold from sea level to
  ~6 km. AFR is paired with the throttle band its load needs.

## Integration rate — `src/mission/constants.ts:10`
Mission runs step at `MISSION_DT` = 0.25 s against the live sim's 0.05 s. The
crank is still explicit Euler and its mechanical time constant is ~0.3 s, so
the step cannot go much coarser without the rpm state ringing; the first-order
thermal states use the model's analytic step and are stable at any dt. This is
the documented response to the runtime target: at 0.25 s, 200 runs take
**3.7 s wall on 4 workers** (measured in-app, seed 1337, HIGH ALTITUDE preset),
so no further reduction was needed.

## Mission limits — `src/mission/constants.ts:71-75`
| Limit | Value | Units | Notes |
|---|---|---|---|
| `CHT_LIMIT_C` | 230 | °C | shared with the diagnosis layer |
| `OILT_LIMIT_C` | 115 | °C | |
| `OILP_MIN_BAR` | 2.5 | bar | |
| `VIB_LIMIT_MM_S` | 5.0 | mm/s | |
| `PWR_MARGIN_FRAC` | 0.85 | – | mean delivered power must reach 85 % of the required leg power (`mission.ts:553`) |
| `CEILING_DENSITY_ALT_M` | 6300 | m DA | see below |

Thermal limits (CHT, oil temp) are exempt during takeoff and landing, the two
short transients at high power (`mission.ts:627-633`); oil pressure, vibration
and the ceiling still apply.

Service ceiling is expressed as the highest density altitude at which the
airframe is assumed able to hold level flight. This is a **mission-planning
rule, not part of the engine model** — the model cools better in thin, cold
air, so altitude alone does not stress it; the ceiling is what makes a hot day
at high altitude cost altitude rather than only margin. Calibrated against
this atmosphere: density altitude gains only ~10 m per °C of ISA deviation at
6 km (~20 m/°C near the surface), so the 6.1 km DBO waypoint is 6100 m DA on a
standard day and 6287 m at +18 °C — inside the limit planned, breached by a
minority of the Monte Carlo draws.

## Weather model — `src/mission/weather.ts`, `src/mission/constants.ts`
Presets are authored for up to 6 waypoints and clamp to the last entry beyond
that (`weather.ts:25`, `:75`):

| Preset | ISA dev (°C) | wind dir (°) | wind (m/s) | gust (m/s) | turbulence |
|---|---|---|---|---|---|
| STANDARD DAY | 0/3/5/3/0/0 | 240-250 | 4-6 | 6-10 | light, moderate at index 3 |
| HOT AND HIGH | 12/15/18/16/12/10 | 210-250 | 6-10 | 10-17 | light → severe |
| HEADWIND + TURBULENCE | 5-8 | each point opposes its outbound leg | 12-16 | 19-26 | severe |

The HEADWIND preset is a worst-case construction (wind set against each leg's
bearing, `weather.ts:58-61`), not a synoptic pattern.

Live weather is read from Open-Meteo
(`https://api.open-meteo.com/v1/forecast`, current temperature_2m,
wind_speed_10m, wind_direction_10m, wind_gusts_10m, m/s — `weather.ts:125`,
`:198-201`). Two derivations are engineering assumptions:

- **ISA deviation from a station reading**: `isaDev = T₂ₘ − T_ISA(ground
  elevation)`, with the standard atmosphere at 6.5 K/km from 15 °C
  (`constants.ts:118-120`, `weather.ts:183`). The deviation measured on the
  ground is carried to cruise altitude unchanged, i.e. the assumption is that
  the air mass is anomalous by the same offset through the layer.
- **Gust excess to turbulence band** (`constants.ts:108-116`): with
  excess = gust − mean wind, ≤1.5 m/s none, ≤3.5 light, ≤6.0 moderate, above
  that severe; a sustained mean wind ≥12 m/s forces at least moderate and
  ≥17 m/s forces severe regardless of the gust. `wind_speed_10m` is a 10 m
  measurement while the aircraft flies at 0.3-6 km, so the mapping is a
  qualitative band assignment, not a scaled intensity.

Caching: memory plus `localStorage` under `aerotwin.wx.v1`, keyed to the
coordinate rounded to 0.01°, TTL 30 min (`weather.ts:126-134`). Failure is
per-cell: a point that cannot be fetched keeps its preset values and reports
`PARTIAL LIVE WEATHER: n/m POINTS…`; if nothing comes back the notice is
`LIVE WEATHER UNAVAILABLE - USING PRESET VALUES` (`weather.ts:253-258`).
`fetchOne` never throws (`weather.ts:194`), so a network failure cannot take
the app down.

Weather reaches the engine only through the existing sim inputs: ISA deviation
→ OAT and density altitude in `atmosphere()`, wind → groundspeed and therefore
leg time and fuel burnt, turbulence → the Ornstein-Uhlenbeck gust intensity of
the M1 model. No new physics input was added.

## Monte Carlo — `src/mission/monteCarlo.ts`, `src/mission/constants.ts:86-105`
All randomness is drawn once, on the main thread, in run-index order
(`drawRunSet`, `monteCarlo.ts:140`) from a mulberry32 stream seeded with
`seed ^ 0x5bf03635`; per-run seeds are `Math.imul(seed, 2654435761) +
Math.imul(index+1, 40503)` (`:108`). Runs are then dealt round-robin to at most
4 workers (`:204-214`) and the summaries are re-sorted by index before
aggregation, so results are identical for a given seed regardless of pool
size. Minimum 200 runs (`constants.ts:87`); the UI clamps 200-1000
(`missionStore.ts:180`).

Per-run perturbations, all 1-σ Gaussians:

| Quantity | Spread | Location |
|---|---|---|
| ISA deviation | ±5 °C | `constants.ts:88` |
| Wind speed | ±18 % relative | `constants.ts:89` |
| Wind direction | ±12° | `constants.ts:90` |
| Turbulence level | steps up with p 0.2, down with p 0.15 | `constants.ts:91-92` |
| Degradation growth | from the M2 slope with σ = 0.5·\|slope\| (floor 0.01), else nominal-wear prior N(0.02, 0.03) severity/h floored at 0 | `constants.ts:93-96`, `monteCarlo.ts:112` |

Health parameters are refreshed every 60 s of mission time and scale with
severity as `1 + growth·hours` (`constants.ts:97`, `mission.ts:510-512`). A
run starts from the engine's current state — the live snapshot's active faults
and severity, or, with no twin, a warm power-settled engine at field elevation
carrying the full mission fuel load (`monteCarlo.ts:155-166`).

The healthy-vs-current bars are two deterministic full-length runs
(`monteCarlo.ts:294-333`), and three rules keep them honest:

- Both start from the **same** settled engine state at the first waypoint, so
  the only difference between the bars is the degradation acting during the
  flight. Inheriting the live twin's instantaneous temperatures would compare
  two different starts, and a fault ramping on the Live Monitor would make the
  "healthy" bar hotter than healthy is.
- Neither run enforces the limits, so both fly the whole profile. Truncating at
  the first breach would compare a short run against a long one and flatter
  whichever channel lags: a cooling-degraded engine that quits on leg 1 never
  warms the 80 s time-constant sump, so its oil temperature reads *better* than
  the healthy engine's.
- The Monte Carlo sample is separate and does use the live state and the limit
  checks; breach information stays in the verdict and the per-leg table.

Statistics: `P(mission complete)` is the completed fraction; per-leg risk
attributes each first breach to the leg it happened on, with the breaching
channel as the limiting one. Landing medians and the P90 CHT and P10 fuel
margin come from the same sorted samples. Thermal peaks are taken over **every**
run (a failed run still experienced them), while fuel margin and mission time
are conditioned on completion, since an early breach leaves fuel unburnt
(`monteCarlo.ts:439-446`).

Top contributing factors rank nine **exogenous** drivers by point-biserial
Pearson correlation against the failure indicator (`monteCarlo.ts:363-373`):
cruise density altitude, ISA deviation, peak headwind, turbulence exposure,
station-keeping time, mission duration, degradation growth, start severity,
wind speed. Outcomes such as fuel burnt are deliberately excluded: an early
breach truncates them, which manufactures a spurious correlation of ±1.

Verdict thresholds (`constants.ts:100-105`): GO needs P(complete) ≥ 0.90, every
leg ≤ 0.25 breach probability and median margin ≥ 6 kg; CAUTION needs ≥ 0.75,
legs ≤ 0.55 and margin ≥ 0 kg; anything worse is NO-GO.

## Map and display — `src/components/MissionMap.tsx`, `src/App.tsx`
Basemap is the CARTO dark-matter style
(`MissionMap.tsx:25`); it is a visual layer only, and if it has not loaded
within 6 s the route is drawn on a vector fallback with a HUD notice
(`:91`, `:552`) — no risk number depends on it. Route framing is computed from
the waypoint bounds with 28 px padding and a zoom-10 ceiling rather than
MapLibre `fitBounds`, which returns no camera when the bounds cannot fit the
canvas (`:92-93`, `:217`). Interaction tolerances are display constants:
waypoint squares 4.5 px half-size, 12 px hit radius, 3 px before a press
becomes a drag, trailing track 1000 m over 12 samples (`:85-90`).

The Live Monitor map replays the planned route on a compressed clock, cycling
the whole mission in 600 s of wall time (`App.tsx:14`) so the marker is
observable at the sim's own speed multipliers. Leg colours on the map and the
swatch column in the results table both come from the single `legRiskColor`
ramp (steel #5B8DB8 → red #C4443F, `missionStore.ts:230`, used at
`MissionMap.tsx:154`), so they cannot disagree.

## Physical model — findings, not changes
No physics was modified for M3. Two observations from wiring the mission layer
to the untouched model:
- Cooling improves with thin, cold air at altitude, so a hot day at high
  altitude shows up mainly as lost margin, not as a thermal breach; the
  ceiling rule above is what encodes the real operational cost.
- The governor cannot hold a segment whose load asks for a throttle outside
  `base ± govClamp`; an out-of-band row produces rpm droop that reads as a
  false power breach. Both mission schedule rows were set from this constraint.
