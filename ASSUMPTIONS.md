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
| `hCylBase` | 55 | W/K | static cylinder cooling coefficient (passive path) |
| `hCylPerMs` | 0.72 | W/(K·m/s) | passive cooling gain with airspeed |
| `cylRadiate` | 8 | W/K | lumped radiation loss per cylinder |
| `hCylThermoMax` | 135 | W/K | extra head cooling at full thermostat opening |
| `tStatOpenC` | 100 | °C | head thermostat cracking temperature |
| `tStatSpanC` | 10 | K | cracking to full-opening span |
| `hOilBase` | 25 | W/K | oil-cooler coefficient at zero airspeed |
| `hOilPerMs` | 0.35 | W/(K·m/s) | oil-cooling gain with airspeed |
| `cylToOilCond` | 8 | W/K | block-to-oil conduction per cylinder |
| `hOilThermoMax` | 70 | W/K | extra oil-cooler conductance at full opening |
| `oilStatOpenC` | 90 | °C | oil thermostat cracking temperature |
| `oilStatSpanC` | 10 | K | cracking to full-opening span |
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
| unburnt→exh 0.25 | hard-coded in `engineModel.ts:178` | – | fraction of misfire fuel energy released in the exhaust manifold |
| late-burn→exh 0.5 | `engineModel.ts:172` | – | fraction of retarded-combustion energy dumped into the exhaust |
| friction-to-head 0.02 | `engineModel.ts:199` | – | shaft-power share heating each cylinder head |
| egt quench 0.55/ inj excess | `engineModel.ts:215` | – | EGT reduction per unit of over-fuelling |
| vib lag 0.4 | `engineModel.ts:102` | s | vibration RMS EWMA time constant |
| eta compression split 0.55+0.45·comp | `engineModel.ts:163` | – | efficiency share vs charge density under compression loss |
| back-pressure penalties 0.22 (VE, `:154`) / 0.28 (eta, `:164`) / 0.18 (MAP, `:144`) | `engineModel.ts` | – | efficiency/flow losses at full exhaust fault |

## Reference engine and operating limits — `src/sim/limits.ts`
The single reference class is a **turbocharged boxer-4 of roughly 100 hp,
Rotax 914-like**, with liquid-cooled cylinder heads. The limits are taken from
the public operator's manual and type certificate, not invented:

| Constant | Value | Unit | Source |
|---|---|---|---|
| `CHT_LIMIT_C` | 135 | °C | Rotax 914 Operator's Manual, coolant temperature max; applied here to the lumped head temperature |
| `OILT_LIMIT_C` | 130 | °C | Rotax 914 Operator's Manual, oil temperature max |
| `OILP_MIN_BAR` | 0.8 | bar | Rotax 914 Operator's Manual, minimum below 3500 rpm |
| `CHT_NOMINAL_C` | 110 | °C | display band only (not a limit); top of the continuous nominal CHT band |
| `CHT_CAUTION_C` | 120 | °C | display band only (not a limit); set below the 135 °C limit |
| `OILT_NOMINAL_C` | 100 | °C | display band only; top of the continuous nominal oil band |
| `OILT_CAUTION_C` | 110 | °C | display band only; top of the normal oil range |

The engine schematic colours each head and the oil-temperature readout on a
three-anchor ramp: blue-grey through the nominal band, a blend to amber as the
caution temperature approaches, amber across caution, and red only at the
limit. The anchors are display bands, not new physical thresholds.

Sources:
- BRP-Rotax **914 Operator's Manual, Edition 3** —
  `https://aeloswissacademy.com/documents/sonaca/OM_914_Series_ED3.pdf`
  (coolant temperature max 135 °C; oil temperature max 130 °C, normal
  90-110 °C, minimum 50 °C; oil pressure normal 2.0-5.0 bar above 3500 rpm,
  minimum 0.8 bar below 3500 rpm, maximum 7.0 bar).
- EASA **TCDS E.122, issue 06** —
  `https://www.flyrotax.com/assets/files/Certificates/TC-TCDS-EASA.E.122-914.pdf`
  (certified 914 series limits and ratings).

Two mappings are assumptions in their own right. First, the manual's 135 °C is
a **coolant** temperature; the model's `cht` state is a lumped cylinder-head
metal temperature, and the limit is applied to that state unchanged. Second,
the model's rpm is **propeller** rpm (1800-2400), so the "below 3500 rpm"
minimum oil pressure (0.8 bar) is the applicable row; the model's 7.0 bar
pressure clamp matches the manual's maximum. The mission layer's 5.0 mm/s
vibration limit and 0.85 power margin are prototype monitoring assumptions, not
Rotax limits.

## Thermal / oil calibration — `src/sim/constants.ts`, `src/sim/engineModel.ts`
The calibration target is: a healthy engine at ISA, in cruise at 3000-4000 m
and in takeoff at sea level to 500 m, stays inside the limits above. The model
now has **thermostatic radiators** in both cooling circuits:

- head: `h = (hCylBase + hCylPerMs·v + hCylThermoMax·open_cht) · cooling[i]`,
  where `open_cht = clamp((cht − 100)/10, 0, 1)`. The multiplier `cooling[i]`
  lets a cooling fault degrade the thermostat's capacity as well as the passive
  path.
- oil: `h = hOilBase + hOilPerMs·v + hOilThermoMax·open_oil`,
  `open_oil = clamp((oilT − 90)/10, 0, 1)`.

The thermostat is not cosmetic. At takeoff the engine rejects roughly 1.7× the
cruise waste heat at a *lower* airspeed, so no single constant conductance can
hold takeoff below 135 °C without overcooling cruise and loiter. With the
thermostat, the head runs at ~103 °C in cruise (inside the Rotax normal band)
and opens only for high-power, low-airspeed operation.

Settled healthy operating points after recalibration (no turbulence, ISA,
noise-free warm state):

| Condition | CHT (max) | Oil temp | Oil pressure | Shaft power |
|---|---|---|---|---|
| cruise, 3000 m | 103.3 °C | 90.7 °C | 3.9 bar | 44.7 kW |
| cruise, 1000 m, ISA +20 | 107.3 °C | 93.6 °C | 3.8 bar | 44.7 kW |
| loiter, 4000 m | 89.0 °C | 62.7 °C | 4.9 bar | 24.8 kW |
| takeoff, sea level | 130.7 °C | 97.3 °C | 4.1 bar | 74.6 kW |
| takeoff, 500 m | 127.5 °C | 96.9 °C | 4.1 bar | 74.6 kW |

The takeoff schedule was also brought onto the reference class: `throttle`
0.65 (was 1.0) and `airspeedMs` 25 (was 12). At full throttle the governor
saturated at its authority limit and the engine settled at 106.7 kW (143 hp)
and 2700 rpm; at 0.65 the governor holds 2400 rpm and the propeller load fixes
74.6 kW (100 hp), so the thermal calibration is being demonstrated at the
class rating rather than above it. On a **hot day** the absolute CHT rises with
ambient and a sea-level takeoff at ISA +20 will exceed 135 °C; the calibration
envelope is ISA standard conditions, consistent with the mission layer's
practice of exempting the short takeoff transient from thermal limit checks.

### Constant review — thermal and oil
| Constant | Before → After | Rationale |
|---|---|---|
| `chtHeatFrac` | 0.54 → 0.54 | heat split among head/exhaust/overboard; not a measured coefficient |
| `exhHeatFrac`, `radFrac` | 0.30, 0.05 → unchanged | keep the energy split summing to 0.89 with the residual to oil/losses |
| `bpExhHeatFrac`, `bpCylHeatFrac` | 0.15, 0.22 → unchanged | fault-path coefficients, not active in the healthy calibration |
| `cpExhaust` | 1160 → unchanged | typical exhaust-gas cp |
| `chtCapJk` | 1400 → unchanged | lumped head wall: ~1.5 kg aluminium at ~900 J/(kg·K); the full head+block mass would give a much slower response than the observed CHT lag |
| `oilCapJk` | 5200 → unchanged | ~3 L of oil at ~2000 J/(kg·K) plus sump metal |
| `hCylBase`, `hCylPerMs` | 55, 0.72 → unchanged | passive/convective path; with the thermostat these place cruise just above the 100 °C crack |
| `hCylThermoMax` | new 135 W/K | sized so sea-level, ISA takeoff tops out at 130.7 °C with the thermostat fully open |
| `tStatOpenC`, `tStatSpanC` | new 100 °C, 10 K | holds cruise at ~103 °C, inside the Rotax 90-110 °C normal band |
| `hOilBase`, `hOilPerMs` | 40, 0.5 → 25, 0.35 | the old values held cruise oil at 67 °C, below the Rotax normal band; the new values hold ~91 °C |
| `hOilThermoMax` | new 70 W/K | holds takeoff oil at ~97 °C; without it the old model settled at 264 °C |
| `oilStatOpenC`, `oilStatSpanC` | new 90 °C, 10 K | oil thermostat cracks at the bottom of the normal band |
| `cylToOilCond` | 8 → unchanged | keeps a small, physically sensible oil response to head temperature |
| `oilFrictPowerFrac`, `oilFrictRpmK` | 0.08, 55 → unchanged | ~9 % of shaft power as oil heat (4.1 kW at cruise), consistent with the observed oil warm-up |
| `oilPRef`, `oilVisicPerK` | 4.3 bar, 0.013/K → unchanged | 4.3 bar at 2000 rpm/80 °C sits mid-band (2-5 bar); at 130 °C pressure still reads ~2.3 bar, above the 0.8 bar floor |

A cooling fault is compensated by the thermostat until the faulted capacity
falls below the healthy demand. In this calibration that is at about **0.5
severity**: the steady CHT rise is only ~3 °C at severity 0.3 but ~21 °C at
0.6 and ~43 °C at 0.7. The classifier therefore has a detection floor near
0.55 severity for this fault; the signature library and diagnosis tests use
0.55-0.8, and this floor is a documented consequence of thermostatic control,
not a classifier bug. Oil-seal degradation is likewise partly compensated by
the oil thermostat (oil temperature rises ~4 °C at severity 0.7); its oil
pressure collapse and vibration rise remain the dominant signature.

## Flight phases — `src/sim/constants.ts` (`PHASES`)
RPM target, schedule throttle, airspeed, propeller load constant
(N·m/(rad/s)²) and command AFR per phase — all assumed:
takeoff 2400 rpm/0.65/25 m/s/4.7e-3/AFR 12.8; climb 2300/0.88/27/4.3e-3/13.6;
cruise 2100/0.72/41/4.2e-3/16.5; loiter 1800/0.5/26/3.7e-3/17.0;
descent 1650/0.32/32/2.9e-3/17.5.

The takeoff throttle is deliberately inside the governor authority
(`base ± 0.3`) so the governor, not saturation, holds 2400 rpm. The resulting
propeller load fixes 74.6 kW (100 hp), the reference-class continuous rating.
This live schedule is deliberately separate from the mission power schedule
below, which is a planning cap.

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

## LIMIT vs FAULT alerts — `src/diagnosis/diagnose.ts:42-56`, `:173-290`
LIMIT and FAULT are independent alert types. A LIMIT is a measured channel
beyond its operating limit (any cylinder CHT, oil temperature, minimum oil
pressure) and is always CRITICAL. A FAULT is a twin disagreement the signature
library can name; it is WARNING unless its severity, the RUL projection or the
P10 life makes it CRITICAL. The diagnosis chip shows the higher of the two
(a hard limit wins a tie), and both the chip tooltip and the alert list name
the type. When a limit is present with no fault and the residual RMS is below
`ANOMALY_MAG` (2 z), the limit text reads
`{channel} {above|below} operating limit ({value} / {limit}). Engine behaving as modelled.`
An over-limit condition with no matched signature but a large residual is not
described as modelled.

## Mission / demo setup
`FUEL_CAPACITY_KG` = 95 kg tank capacity (`src/sim/constants.ts`). Each
mission carries `fuelLoadKg` (default: full profile capacity, editable as
"Fuel load" in BRIEF); the pre-flight FUEL check and the FLY simulation both
start from that value.
Default scenario: cruise, 3000 m, ISA +0, no turbulence, seed 1337
(`src/state/store.ts:26-31` and `:63`, `src/sim/worker.ts:19-23`).
Chart window 120 s, history stride 0.1 s, sim step 0.05 s (20 Hz),
UI tick 10 Hz, worker catch-up cap 240 steps/frame (`worker.ts:65`).

## Documented cross-channel effects
- Cooling degradation (cyl): raises that cylinder's CHT; other CHTs, EGT,
  power stay within noise. Oil temp rises slightly (~2-4 °C) because hot
  block-to-oil conduction (`cylToOilCond`) transfers part of the extra head
  heat to the sump; the oil thermostat absorbs most of that extra heat.
- Thermostatic compensation sets the cooling-fault detection floor. A partial
  cooling loss raises CHT only once the radiator's faulted capacity is below
  the healthy demand; in this calibration the first ~0.5 severity is
  compensated (steady CHT rise ~3 °C at 0.3, ~21 °C at 0.6, ~43 °C at 0.7).
  The classifier is therefore specified over 0.55-0.8 severity, and the
  library's 0.3 template is retained only as the low end of the response curve,
  not as a detection claim.
- Oil-seal degradation: the oil thermostat also compensates part of the extra
  friction heat, so oil temperature rises only ~4 °C at severity 0.7 while oil
  pressure collapses and vibration rises; those channels carry the signature.
- Governor coupling: faults that cut power (misfire, turbo, compression,
  exhaust) make the electronic governor open the throttle to hold the phase
  rpm target, so MAP/boost/fuel residuals move opposite to raw power loss;
  rpm itself stays near target unless the governor saturates (turbo/exhaust
  faults show the strongest rpm residual).
- Misfire: that cylinder's CHT falls (no combustion heat) while its EGT
  rises modestly (unburnt fuel burns in the exhaust manifold, assumed 25 %
  share), and vibration is dominant.

# AeroTwin M3 — Mission Risk assumptions

The mission layer reuses the M1 engine model; the recalibrated thermostatic
cooling above applies unchanged to both the live and headless runs. Everything
below is a planning or profile assumption, not a second physics model.

## Route geometry — `src/mission/route.ts`
| Item | Value | Units | Location |
|---|---|---|---|
| Earth radius (spherical haversine) | 6 371 000 | m | `route.ts:26` |
| Leg distance | great-circle haversine | m | `route.ts:32` |
| Leg course | initial great-circle bearing, true 0-360 | deg | `route.ts:42` |
| Wind convention | meteorological, direction the wind blows FROM | deg | `route.ts:56` |
| Groundspeed | TAS − headwind, floored | m/s | `route.ts:69`, `mission.ts:167` |
| Minimum planned groundspeed | 10 (a slower leg is flagged wind-limited, never infinite) | m/s | `constants.ts:63` |

Track sampling for the marker is 24 straight-line samples per leg
(`route.ts:191`); the marker position interpolates that polyline, so it follows
the drawn route rather than a recomputed great circle.

## Route presets — superseded by editable mission templates
The M3 fixed presets and the ±2° edit lock were removed in the mission-editor
release. The three original exercise routes were migrated into
`src/data/templates/*.json` in the same schema as a hand-drawn mission, joined
by two civil survey examples. Waypoints, zones, sites, ground station, start
time and name now all come from the Mission object; there is no preset bounding
box or route lock. See "Mission editor" below for the data model, limits and
the Ladakh terrain waypoints. **All geography remains illustrative.**

The five bundled templates are:

| Template id | Name | Character |
|---|---|---|
| `ladakh` | Ladakh Valley Recon | Indus valley, 3.3-5.4 km AMSL, three holds |
| `rajasthan` | Thar Desert Transit | Jodhpur to Jaisalmer, hot high-density-altitude holds |
| `coastal` | West Coast Transit | Mumbai to Kochi, southbound headwind |
| `plains-agri` | Punjab Agri Survey | Ludhiana plains, 120 m AGL survey lines |
| `coastal-survey` | Tamil Coast Survey | Chennai to Kalpakkam, 180 m AGL coastal passes |

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
| `MISSION_FUEL_KG` (tank capacity) | 95 | kg | `constants.ts:66` |
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

- The loads are capped at about 55 kW peak, roughly 75 % of the 75 kW class
  rating, rather than at the live sim's 74.6 kW reference takeoff power. The
  cap is a **planning** choice: it keeps every template flyable with thermal
  margin so weather and degradation, not raw rated power, produce the risk
  separation the Monte Carlo is meant to show. The recalibrated cooling model
  can sustain more at field elevation; the mission schedule was left unchanged
  to preserve the M3 comparison basis.
- `throttleBase` must keep the row inside the governor authority
  (`govClamp` = ±0.3, `sim/constants.ts:62`): a segment is only controllable if
  the throttle that holds its rpm target lies within `base ± 0.3`, so the base
  is centred on the sea-level requirement and the rows hold from sea level to
  ~6 km. AFR is paired with the throttle band its load needs.

## Integration rate — `src/mission/constants.ts:10`
Mission runs step at `MISSION_DT` = 0.25 s against the live sim's 0.05 s. The
crank is still explicit Euler and its mechanical time constant is ~0.3 s, so
the step cannot go much coarser without the rpm state ringing; the first-order
thermal states use the model's analytic step and are stable at any dt. This is
the documented response to the runtime target: at 0.25 s, 200 runs take
**3.7 s wall on 4 workers** (measured in-app, seed 1337, Ladakh template),
so no further reduction was needed.

## Mission limits — `src/sim/limits.ts`, `src/mission/constants.ts`
| Limit | Value | Units | Location | Notes |
|---|---|---|---|---|
| `CHT_LIMIT_C` | 135 | °C | `sim/limits.ts:5` | shared with the diagnosis layer |
| `OILT_LIMIT_C` | 130 | °C | `sim/limits.ts:6` | |
| `OILP_MIN_BAR` | 0.8 | bar | `sim/limits.ts:7` | |
| `VIB_LIMIT_MM_S` | 5.0 | mm/s | `mission/constants.ts:71` | mission-layer monitoring limit |
| `PWR_MARGIN_FRAC` | 0.85 | – | `mission/constants.ts:72` | mean delivered power must reach 85 % of the required leg power (`mission.ts:551`) |
| `CEILING_DENSITY_ALT_M` | 6300 | m DA | `mission/constants.ts:81` | see below |

The thermal and oil limits live in `src/sim/limits.ts` so the simulation,
diagnosis and mission layers share one set; the mission layer keeps only its
own vibration and planning limits. Sources are listed in "Reference engine and
operating limits" above.

Thermal limits (CHT, oil temp) are exempt during takeoff and landing, the two
short transients at high power (`mission.ts:627-631`); oil pressure, vibration
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

## Weather model — mission editor release (October 2026)
Weather is fetched **per mission node** from the Open-Meteo hourly forecast
(`https://api.open-meteo.com/v1/forecast`, temperature_2m, wind_speed_10m,
wind_direction_10m, wind_gusts_10m, m/s) for the hour containing
`startTimeUTC`. The mission start is stored as an ISO instant and edited in IST
(UTC+5:30); the default is the next whole IST hour. A route, start-time or
weather-mode edit re-fetches after a **1.5 s debounce** and supersedes any
request still in flight.

Each node keeps a source tag shown in the editor: **LIVE** (forecast),
**MANUAL** (a per-node override is applied) or **FALLBACK** (bundled default:
0 °C ISA deviation, 5 m/s wind, light turbulence). The weather panel always
shows `n LIVE / n MAN / n FB`; if every node falls back it also shows
`FORECAST UNAVAILABLE - USING FALLBACK WEATHER`. A manual override is keyed to
the node id, so moving or reordering the node keeps it. Failure is per node:
the fallback is silent apart from the small notice, and `fetchOne` never throws.

Two derivations are engineering assumptions:

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
coordinate rounded to 0.01°, TTL 30 min. A cached cell is re-tagged LIVE when
reused. Nothing about the fetch is allowed to take the app down: a failed node
becomes FALLBACK, and the pre-flight WEATHER check still uses the fallback cell.

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
carrying the mission's `fuelLoadKg` (`monteCarlo.ts:155-166`).

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

## India airfield data — mission editor release (October 2026)
`src/data/airfields.json` is a one-time download of the OurAirports
`airports.csv` on 2026-10-25, filtered to `iso_country = IN` and
`type in {large_airport, medium_airport, small_airport, heliport}`. After the
name exclusions below the bundle holds **583** fields. Nothing is fetched at
runtime; the rows are compiled into the app.

Name heuristic (case-insensitive substring on the airport name): exclude
`Air Force`, `AFS`, `Air Base`, `Military`, `Naval`, `Army`. This documented
heuristic is not an airspace or ownership check: a civil-looking name can still
be sensitive, and a military field with a civil name would survive. The full
list of the **41** excluded names:

```
Agra Airport / Agra Air Force Station
Ambala Air Force Station
Army Hospital Leh Heliport
Awantipura Air Force Station
Bakshi Ka Talab Air Force Station
Bareilly Air Force Station
Barrackpore Air Force Station
Bhatinda Air Force Station
Bidar Airport / Bidar Air Force Station
Bihta Air Force Station
Car Nicobar Air Force Base
Chabua Air Force Station
Chennai Military Hospital Helipad
Coimbatore Air Force Station
Cuttack Airport / Charbatia Air Force Station
Dinjan Air Force Station
Dundigul Air Force Academy
Hashimara Air Force Station
Hindon Airport / Hindon Air Force Station
INS Garuda / Willingdon Island Naval Air Station
INS Rajali / Arakkonam Naval Air Station
Indian Naval Academy Heliport
Kharagpur Airport / Kalaikunda Air Force Station
Naliya Air Force Station
Panagarh Air Force Station
Phalodi Air Force Station
Prayagraj Army Helipad
Ramnad Naval Air Station
STC BSF Indian Army Helipad
Sarsawa Air Force Station
Sevoke Road Indian Army Heliport
Shikra Naval Helibase
Shillong Indian Army Helipad
Sirsa Air Force Station
Surichua Air Base
Tambaram Air Force Station
Tawang Air Force Station
Thanjavur Air Force Station
Udhampur Air Force Station
Upper Tadong Indian Army Helipad
Yelahanka Air Force Station
```

Coordinates and elevations are the dataset values (feet converted to metres at
0.3048) and are field elevations, not obstacle-limited takeoff alternates.
They are illustrative for this prototype and must be verified against AIP India
before real use. Runway dimensions, operating hours, approach and
alternate-minima rules, fuel availability and airspace are not modelled.

One code in the brief does not exist in the dataset: **VAGO is not an airport**.
Dabolim, Goa is **VOGO**, and the row carries that flag in a comment
(`airfields.ts`). `src/data/places.ts` remains a list of well-known towns and
landmarks used only as map context; it carries no operational meaning.

**All of it is illustrative.** Real diversion planning needs AIP India, which
this model does not have or pretend to have.

## Alternate reachability — `src/nav/alternates.ts`, `src/nav/useAlternates.ts`
The live layer answers one question: can this aircraft get to that airfield,
right now, on the state the simulation reports.

| Constant | Value | Units | Location |
|---|---|---|---|
| Hold-out reserve before diverting | 1800 (30 min at the current flow) | s | `alternates.ts:16` |
| Fuel-flow smoothing window | 30 | s | `alternates.ts:18`, `store.ts:47-53` |
| Engine-out lift-to-drag ratio | 12 | - | `alternates.ts:20` |
| Margin that counts as comfortable | 0.20 of the requirement | - | `alternates.ts:22` |
| Recompute cadence | 1000 | ms | `useAlternates.ts:106` |
| Alternate field set | all bundled fields + mission sites within 400 km, nearest first | m | `useAlternates.ts:16`, `:36` |
| Foot / nautical mile | 0.3048 / 1852 | m | `units.ts:2-3` |

Inputs, and why each is taken where it is:

- `altM`, `sigmaRatio`, `phase`, shaft power and fuel come from the live
  snapshot; TAS is the phase airspeed from `PHASES`, the same value the engine
  model is being driven at (`useAlternates.ts:71-85`). The *planned* route
  altitude is a different quantity and is never substituted for the altitude
  the twin is actually at.
- Wind is the mission weather cell for the leg being flown
  (`useAlternates.ts:69`), so the HUD and the Monte Carlo see the same wind.
- Engine life is the diagnosis RUL **P10** and only when its status is `OK`;
  an `INSUFFICIENT_DATA` projection contributes no margin rather than a false
  one (`useAlternates.ts:84`).

Model:

- Powered range = (endurance − 1800 s) × groundspeed along the bearing to the
  field (`alternates.ts:71-75`). Endurance is fuel remaining divided by the
  smoothed flow, so a lean, thirsty engine shortens the range even at the same
  indicated fuel.
- Mode selection compares the shaft power the engine is *delivering* against
  `PWR_MARGIN_FRAC` (0.85) of the power needed to hold level flight at the
  current density ratio (`alternates.ts:94-96`). The requirement is
  `requiredPowerKw(phase, sigma)` from `mission.ts:44` — the same figure the
  Monte Carlo already uses for its "Shaft Power" breach channel, deliberately
  not a second drag polar. It is a density-ratio power law with no weight term:
  for this airframe the mission model treats weight as a fixed fuel load, so
  landing weight and cruise weight differ by tens of kilograms against a
  hundred-hectowatt requirement, and a weight-sensitive polar would be precision
  the model does not have.
- Glide range = (altitude − field elevation) × 12, a still-air figure with no
  allowance for anything below the aircraft (`alternates.ts:66-68`). In glide
  the fuel state is irrelevant, which is the point of the mode.
- Verdict uses the *binding* margin: the smaller of the range margin and the
  RUL margin, so `FUEL`, `GLIDE` and `ENGINE LIFE` name whichever actually
  decides the answer (`alternates.ts:101-108`).

The mission editor's nearest-landing layer considers every bundled airfield plus
the mission's custom landing sites within **400 km** of the UAV, nearest first
(`useAlternates.ts:16`, `:36`). The pre-flight ALTERNATES check uses the same
field set and tests engine-out glide reachability from each leg midpoint
(`preflight.ts`).

Mission Risk integration: the per-leg "Alternates in glide range" column counts
civil fields an engine-out glide can reach from that leg's midpoint at its
planned altitude (`MissionPanel.tsx`). It is a glide-only figure — a planned leg
has no live fuel state, so a powered range for it would be fiction.
At L/D 12 the glide is only 45-65 km from a 5 km cruise, while transit legs are
hundreds of kilometres, so most long legs read zero. The high-altitude template
is the *better* case for this column because its survey legs are short and flown
at 5 km. Altitude buys range; it does not buy it across a 400 km gap.

Measured on the live model (cruise, ISA+15, 5400 m, seed 1337): level power
required 25.1 kW, the 0.85 gate 21.4 kW, healthy shaft power ~25 kW at a
smoothed 9.5 kg/h. Turbo boost loss at severity 0.9 delivers 18.6 kW and flips
every alternate to GLIDE, where a 5400 m glide over a 3256 m field is 26 km
against 256 km to Srinagar, so all three read NOT REACHABLE / GLIDE.
Compression loss at the same severity still delivers 24.6 kW and stays POWERED:
boost is the only engine fault that reaches the glide branch in this band. A
4 kg fuel load reads NOT REACHABLE / FUEL on every alternate.

## Map and display — `src/components/MissionMap.tsx`, `src/App.tsx`
Basemap is the CARTO dark-matter style
(`MissionMap.tsx:31`); it is a visual layer only, and if it has not loaded
within 6 s the route is drawn on a dark vector fallback with a HUD notice
(`:144`, `:727-734`, `:970`) — no risk number depends on it.

Basemap layers are data of a kind the console cannot accept: the style draws
country-level and disputed boundaries whose depiction does not match India's
official one. Every layer whose id matches `country|border|disputed|breakaway|
maritime` is switched to `visibility: none` after each style load, and no
boundary line is drawn by this app (`:46`, `:679-684`). The test is id-based and
runs on every `styledata`, so it is idempotent — the `setLayoutProperty` call
provokes a style reload itself. The CARTO style has four boundary layers,
`boundary_country_outline` (z6+), `boundary_country_inner` (z0+),
`boundary_state` (z4+) and `boundary_county` (z9+); only the two country layers
are switched off, and the state and county lines stay because they are separate
layers, as agreed. `place_country_1` and `place_country_2` match the same test,
so country name labels go with the lines; `place_state` and the city labels
stay. This is a *display* filter, not a claim: the app opens on an India
overview (centre [79, 22], zoom 4.2, `:42`) with the footer "Illustrative map.
Boundaries not depicted."

Markers are display geometry, all in pixels against the current zoom so they
keep their size as the camera changes: waypoint squares 4.5 px half-size,
airfield squares 4 px half-size (8 px across) with a 1 px border, the UAV dart a
10 px span, a 12 px hit radius, 3 px of travel before a press becomes a drag,
and a trailing track of 1000 m over 12 samples (`:137-148`). Reference places
are drawn from zoom 5.5 and labelled only from zoom 6, because below that the
labels collide (`:96-97`, `:148`). Route framing is computed from the waypoint
bounds with 28 px padding and a zoom-10 ceiling rather than MapLibre `fitBounds`,
which returns no camera when the bounds cannot fit the canvas and the
constructor then dereferences it (`:145-146`, `:367-380`).

Units: altitudes are shown as m AMSL and feet, distances as km and NM
(`units.ts:9-16`), and the top bar carries wall-clock UTC and IST alongside the
mission timer (`TopBar.tsx:18-30`, IST from the IANA zone `Asia/Kolkata`, not a
hand-applied +05:30).

The Live Monitor map replays the planned route on a compressed clock, cycling
the whole mission in 600 s of wall time (`App.tsx:15`) so the marker is
observable at the sim's own speed multipliers. Leg colours on the map and the
swatch column in the results table both come from the single `legRiskColor`
ramp (steel #5B8DB8 → red #C4443F, `missionStore.ts:230`, used at
`MissionMap.tsx:264`), so they cannot disagree. The divert line is drawn only
while the diagnosis is off NOMINAL and takes its colour from that alternate's
verdict (`MissionMap.tsx:305-306`, `:604-605`); the fuel-load field in the
scenario panel (`ScenarioPanel.tsx:88-107`) writes the sim state through
`Sim.setFuelKg` (`sim.ts:142-150`) without restarting the run, and moves the
healthy twin with the true engine so a re-load never reads as a residual.

## Physical model — findings, not changes
No physics was modified for M3; the thermal/oil recalibration described above
belongs to M1 and applies identically to the live and headless runs. Two
observations from wiring the mission layer to the unchanged model:
- Cooling improves with thin, cold air at altitude, so a hot day at high
  altitude shows up mainly as lost margin, not as a thermal breach; the
  ceiling rule above is what encodes the real operational cost.
- The governor cannot hold a segment whose load asks for a throttle outside
  `base ± govClamp`; an out-of-band row produces rpm droop that reads as a
  false power breach. Both mission schedule rows were set from this constraint.
- The live `Sim` drives the propeller with `PHASES[phase].propC` unchanged at
  every altitude (`sim.ts:191`), so the load it places on the engine is the
  sea-level figure, while the alternate layer's *requirement* is
  `requiredPowerKw(phase, sigma)` and does fall with the density ratio. The two
  are only comparable because both are powers at the same rpm; a boost-loss
  fault therefore shows up as a shortfall against a threshold that thins more
  slowly than the engine does. Measured at cruise, seed 1337, no turbulence:
  healthy delivers 44.7 kW at 0-3000 m, 43.4 kW at 4500 m, 35.0 kW at 5400 m and
  30.2 kW at 6000 m, against requirements (0.85 x) of 38.0, 28.2, 24.1 and 21.8
  kW. Loss of boost is the only engine fault that reaches the glide branch in
  the sim's altitude band; compression loss alone does not. This is reported,
  not corrected — the physical model was not touched.

## Rehearsal mode — stages, scripts, life and map (October 2026)
The app now opens on a three-stage rehearsal: BRIEF → FLY → DEBRIEF
(`App.tsx:45-47`). The existing console (top bar, fault injection, strip
charts, diagnosis, schematic, validation map and Monte Carlo panel) is still
the same code, mounted full screen behind the E key
(`App.tsx:23-41`, `EngineerOverlay.tsx:61-118`). Nothing from the overlay is
rendered on the three stages. Esc closes the overlay and leaves every store
untouched, so the run continues from the same epoch, clock, pause and speed.

### Time compression
- One rehearsal spans **120 simulation seconds**, irrespective of the planned
  mission (`clock.ts:6`). Mission clock = `clamp01(simT / 120) * plannedS`,
  where `plannedS` is the whole planned flight time in mission seconds
  (`clock.ts:11-14`). Every HUD, ticker and debrief time is mission time; the
  compressed sim time is never shown.
- Mission time is clamped at the span, so a delayed sample cannot overshoot the
  planned duration (`FlyStage.tsx:223`).
- A normal flight finishes at exactly 120 sim s and reports the planned
  duration and cruise distance (`FlyStage.tsx:287-295`). An abort is held for
  **2400 ms** after the first measured hard limit so the crew sees the state
  before the debrief arrives (`FlyStage.tsx:25`, `:272`).
- Debrief timeline uses the planned duration as its finish line; an aborted run
  therefore reads e.g. `4:00:11 of 7:04:00` rather than shortening the plan to
  the abort point (`DebriefStage.tsx:67`, `:130`). Tick labels are measured and
  stacked into up to three rows when events cluster, so a fault, the twin flag
  and the limit that follows remain readable (`DebriefStage.tsx:72-88`,
  `:134-164`).

### Scenario scripts
Scripts are the only fault source in a rehearsal; a run starts from the
default healthy engine. Each card injects when the mission clock reaches
`triggerFrac x plannedS` (`FlyStage.tsx:315-316`), so the trigger is not tied to
the compressed simulation clock.
- **NORMAL FLIGHT** - no fault (`scripts.ts:16-23`).
- **COOLING OVER DENIED AREA** - engine `cooling`, cylinder **3**, severity
  **0.6**, ramp **30 s**, trigger **0** (`scripts.ts`). The twin flags about
  32 sim s after injection (mission ~1 h 50 min); on the Ladakh template that
  detection point is inside the exercise denied area. The measured CHT stays
  below the 135 °C limit through the rehearsal.
- **FAILURE + LINK JAMMED** - the same fault with `jam: true` from the start.
  The guard erases at detection; no item is ever sent.
- **FAILURE OVER FRIENDLY AREA** - the same fault injected at **57 %** of the
  route, intended to be after the aircraft has left the denied area. When a
  friendly alternate is reachable, the guard stays in STANDBY and does not
  erase. The actual outcome depends on the current mission's geometry.
- **SENSOR GLITCH** - sensor `drift`, CHT 1, severity **0.5**, ramp **10 s**,
  trigger **0.2**, flagged as `sensorOnly` (`scripts.ts:71-83`). Its measured
  offset peaks around 21-24 °C, below the 135 °C CHT limit, so the rehearsal
  stays at ADVISORY to the end; this is the false alarm the script is named for.
  Measured values, not true values, gate the hard limits, so a larger drift
  would still abort (`presentation.ts:104-117`). The ADVISORY sentence names the
  channel and the measured-minus-true offset: “Engine healthy, instrument
  fault: CHT Cyl 1 reads N C above the twin.” (`presentation.ts:108-117`).

### Failure Director, detection and failure presentation (October 2026)
- The director is a separate Zustand store (`director.ts`). At every rehearsal
  epoch `resetForRehearsal` clears injections, detections and the schedule,
  seeds the scenario card's fault at `triggerFrac x plannedS`, sets the initial
  jam for the jammed card, and closes the panel. The manual schedule lives in
  the same list as the scenario item and is editable and clearable.
- The scheduler compares schedule times to the **mission clock**, not sim time,
  so an event due at T+10:00 fires at the same mission time at 1x, 10x and 60x
  (`dueScheduled`). A scheduled record stores its nominal scheduled time for
  display and AAR; worker sample quantisation can delay the actual sim
  injection by up to one tick.
- **SURPRISE ME** uses `mulberry32(seed)` with a fixed draw order: firing time,
  engine-vs-instrument, kind, cylinder or channel, severity, ramp. The default
  window is 5-20 mission minutes, the window end is capped at 98 % of the
  planned duration, and the item stays hidden in the schedule until it fires.
  Same seed and window reproduce the same payload and time. This is a
  reproducibility device, not a cryptographic draw.
- **Detection latency** is measured in compressed simulator seconds:
  `announcementSimS - injectionSimS`, stored unrounded for the AAR and rounded
  only for the ticker. An engine fault is detected at the twin's first
  non-NOMINAL diagnosis. An instrument fault also counts at the first clear
  measured-minus-twin separation on the affected channel, using
  `max(4 x noise sigma, 0.2 x drift range)` for that channel: 3 sigma alone is
  too coarse for oil pressure and too fine for CHT. Detection is not a
  wall-clock claim at 10x or 60x.
- **Sensor-only** is derived from the active records, not the card: an
  instrument injection with no engine injection holds the HUD at ADVISORY and
  the guard at MONITOR. A later engine injection puts the run back on the
  engine path.
- The **audio** and voice callouts are synthesized in the browser (Web Audio
  oscillators, `speechSynthesis`); no audio assets are bundled. A chime and
  callout play once on each state increase, never loop, are muted with **M**,
  and are unlocked by the first pointer or key gesture. The banner flash is a
  1 Hz CSS step animation lasting 5 s and disabled under
  `prefers-reduced-motion`.
- The **engine-out glide ring** appears only when the HUD state is WARNING or
  CRITICAL and either no alternate is reachable or the best alternate option is
  already a glide. Radius = `max(0, aircraft MSL - terrain elevation under the
  aircraft) x 12`. Its centre is the aircraft shifted toward
  `wind direction + 180` by `wind speed x radius / phase airspeed`, i.e. the
  drift accumulated during the glide. It returns no ring at or below terrain.
  **Terrain masking, obstacles and landing suitability are not modelled**; the
  ring is a range estimate, not a safe-landing footprint.
- **DEGRADE x0.25** multiplies the simulated datalink rate by 0.25 in
  `payload/link.ts`; the guard does not treat it as a jam. Link mode is a single
  store field shared by the **J** key, the Data Guard button and the director,
  so those controls cannot disagree. Weather steps post an `env` command to the
  sim worker and change turbulence/ISA without resetting active faults.

### Engine life
The life model is unchanged from M2 and now integrates the rehearsal:
`weight = max(1, exp((maxCHTtrue − 110 °C) / 15 °C))`, and dose =
`simDt × (plannedS / 120) × weight`, using the hottest **true** CHT
(`metrics.ts:16-32`). The assumed overhaul life is **1200 h**; the result is
shown as percent used and equivalent hours in the debrief
(`DebriefStage.tsx:117-121`). At 1200 h, 1 equivalent hour is 0.0833 % of the
overhaul life.

### Briefing risk
The MISSION RISK verdict is the existing Monte Carlo result (200 runs, seed
1337) reduced to GO / CAUTION / NO-GO; the three highest-|correlation| factors
are rendered as plain sentences from `factorSentence` (`metrics.ts:111-123`).
While the worker is still sampling the panel says ASSESSING with `done/total`;
the RUN button is available throughout, so a rehearsal can start without
waiting for the full Monte Carlo.

### HUD rules applied
- Panel surface is `bg-1` at **88 %**, 1 px `line-0` border, square corners,
  no shadow or gradient (`index.css:64-68`).
- The FLY stage has six overlay groups: engine state + sentence (28 px /
  16 px), clock/pause/speed (12-13 px), engine strip (12-13 px), nearest
  landing top-right (12-13 px), the DATA panel with the collapsible ground
  station bottom-right, and the ticker bottom-centre (12-13 px). No chart,
  table, z-score or sigma is mounted on the stage; the only canvas is the map
  (`FlyStage.tsx:457-582`, `DataGuardHud.tsx:46-333`).
- Ticker keeps the last three events younger than **8 s** wall time, fading
  between 6.5 s and 8 s (`FlyStage.tsx:27`, `:93-117`).
- Data teal `#5E9C9A` is used for measured numeric elements only; the thermal
  ramp remains the anchored nominal/caution/limit scale
  (`FlyStage.tsx:493-517`). The nearest-landing readout updates on the existing
  1 s alternate cadence (`useAlternates.ts:99-103`), so it can read ASSESSING
  for the first second and then steps between the plan's holds.
- The DATA panel refreshes on every session tick and on a 1 s wall timer, so
  the adversary verdict appears after its 3 s hold even if the simulation is
  paused (`FlyStage.tsx:202-210`). Jamming is available from the panel or the
  **J** key and resets with every rehearsal epoch (`FlyStage.tsx:184-200`,
  `:221-223`). Remote zeroize is enabled only in ARMED and requires the inline
  CONFIRM (`DataGuardHud.tsx:286-326`).

### Stage map
The stages use a new MapLibre view (`RehearsalMap.tsx`), while the E overlay
keeps the original `MissionMap`. Base is the CARTO dark-matter Protomaps style
(`RehearsalMap.tsx:25`); all base layers except background, fills and rasters
are hidden, so no road, rail, place dot or boundary line is drawn
(`:136-144`). A terrarium DEM adds hillshade at 0.35 exaggeration
(`:146-170`). State and city symbol layers are added from the `places` source
from zoom 5, filtered to a rough subcontinent ring that is **not a boundary
and is never drawn** (`:68-102`, `:172-235`). The ring includes Ladakh and
excludes the neighbouring capitals checked during tuning (Lahore, Islamabad,
Karachi, Kabul, Lhasa, Colombo); Kathmandu and Dhaka fall inside this rough
extent. Region labels are limited by the basemap's own tile contents: they
appear at country/regional zooms and drop out at the route's ~9-10 zoom because
the high-zoom `places` tiles do not carry region features. No static state data
is invented to fill that gap.
- Route: 6 px background casing plus 2 px steel line, both squared; direction
  shown by a generated chevron icon every 72 px (`:288-315`, `:254-272`).
- Waypoints are numbered DOM dots; altitude text is CSS-hidden until hover or
  selection. DOM labels exist only for HOME, DEST, alternate airfields, the
  ground station and the denied area (`:641-690`), with collision placement
  against other labels and a ±12 px waypoint anchor, clamped inside the canvas
  (`:329-385`).
- Denied areas: pattern hatch, **18 %** fill opacity, 1 px muted-red line, and
  the label `DENIED AREA (EXERCISE - ILLUSTRATIVE)` (`RehearsalMap.tsx`). They
  come from the current Mission's zones, are drawn only as exercise geography
  and are not real restricted areas. Ground stations are similarly
  illustrative and come from the Mission object.
- Camera: `fitRouteCamera` is explicit Web Mercator math rather than
  `fitBounds`, with a zoom-10 ceiling and caller padding (FLY now uses
  96/380 px so the DATA panel does not cover the route) so the route is framed
  inside the HUD (`:404-431`, `FlyStage.tsx:436`).
  Preset changes use `flyTo` (900 ms); first paint uses `jumpTo`
  (`RehearsalMap.tsx:618-629`).
- Basemap failure: if overlays never become ready within 6 s, the style falls
  back to a flat dark background and the same route/denied layers are added;
  no glyph stack is required because chevrons are icons (`:33`, `:573-597`).

## Data Guard — recon payload, crypto, link and guard (October 2026)

### Recon points and dummy payload
- **One item per mission RECON node**, in route order; the node name is the
  manifest anchor and its position is the site (`pois.ts`). There is no fixed
  per-preset anchor table any more: add, move, rename or delete a RECON node and
  the manifest follows. Type (IMAGE/VIDEO), nominal size (±10 %), priority (1-3)
  and a sub-kilometre site offset are seeded from
  `templateId|missionId:nodeId:nodeName`, so every rehearsal of a mission
  captures the same manifest.
- **Sizes:** IMAGE **15-60 MB**, VIDEO **150-600 MB**. These are assumed
  reconnaissance-product sizes, not sensor-format arithmetic.
- **Capture:** items are collected in route order. A RECON item becomes
  eligible on the leg into its own waypoint and captures at the first route
  sample within **3 000 m** of the site, and only after every earlier RECON
  item; a later node that sits near an earlier leg is not collected by
  proximity. The route is sampled every **5 mission seconds**, so capture
  timestamps are mission-clock values, not sim time.
- The encrypted object is a deterministic dummy: a readable four-line header
  plus seeded random bytes at **1:100000** of the nominal size, floor **192 B**.
  Every transfer, counter and capacity figure uses the nominal MB, never the
  dummy byte count. The ground-station DECRYPT button therefore shows the demo
  header, not imagery.
- Ground stations, denied areas and custom landing sites come from the Mission
  object. They are illustrative and are not operational geography. The Data
  Guard cards are generic: their titles describe the intended geometry, and the
  guard reacts to the current mission's zone, alternates and link rather than a
  hard-coded preset.

### Cryptography
- At session start each end generates an **ephemeral ECDH P-256** key pair.
  Both derive the same key with **HKDF-SHA256** (salt
  `aerotwin/datalink/session/v1`, info `recon payload aes-256-gcm`) into a
  non-extractable **AES-256-GCM** key (`crypto.ts:9-12`, `:74-115`).
- Each item is encrypted once with a fresh **12-byte nonce**
  (`crypto.ts:117-128`); the record keeps ciphertext, nonce and the **SHA-256
  of the plaintext** (`crypto.ts:179-195`). The aircraft key and records live
  in one `SecureElement`; the ground holds only its derived key
  (`session.ts:164-178`).
- Delivery copies the record before dispatch (`snapshotRecord`,
  `crypto.ts:266-273`), so a later erase cannot corrupt data already at the
  ground. The ground decrypts and compares the hash before the item becomes
  AT_GROUND (`session.ts:362-382`).
- `zeroize` overwrites the exposed raw key bytes with CSPRNG output and zero,
  drops the `CryptoKey`, overwrites every stored nonce and ciphertext block
  with CSPRNG output, and locks the element with a wall-clock timestamp
  (`crypto.ts:197-213`). Items not already AT_GROUND are marked ERASED
  (`session.ts:384-402`). It is idempotent and returns the number of records
  destroyed.
- `adversaryRecoveryAttempt` runs only on a locked element: it tries every
  overwritten block with a fresh random AES-256 key and requires every
  authentication-tag check to fail (`crypto.ts:215-247`). The UI holds the
  verdict for **3 000 ms** wall time after erase before showing it, unless
  REVEAL is pressed (`session.ts:393`, `:446-450`).
- **Honest limit:** browser WebCrypto has no key-destruction API. JavaScript
  cannot guarantee that no key copy remains in the heap, and the adversary is a
  decoy key rather than a hardware attacker. This is a protocol demonstration;
  production needs a hardware secure element and certified link encryption.
  The DATA panel footer and README state the same.

### Simulated datalink
- The ground station is a Mission field (draggable in BRIEF). Effective range is
  **min(250 km, 4.12 x (sqrt(h_uav_m) + sqrt(10 m)))** km
  (`link.ts:9-17`, `:35`). With the UAV at 5 200 m the horizon is ~301 km, so
  the 250 km assumption binds.
- Rate is **2.0 Mbps** inside 20 % of range, falls linearly to **0.2 Mbps** at
  the range edge, and is zero beyond it (`link.ts:8-13`, `:44-49`). Jamming
  wins over geometry and forces zero (`link.ts:38-40`). States are UP,
  DEGRADED, LOST and JAMMED.
- Terrain masking, multipath, antenna gain, rain fade and jamming strategy are
  **not modelled**. The link is an illustrative line-of-sight budget.
- Offload spends at most **rate / 8 MB per mission second** each tick, in
  priority order (P1 first), then oldest capture, then id
  (`offload.ts:20-22`, `:34-38`, `:95-112`). An item is complete when its last
  byte is sent; only a successful ground hash check makes it AT_GROUND. If the
  link drops, unsent bytes stay pending and the guard makes the erase decision.

### Guard decision table
Evaluated every session tick after capture, link update and offload
(`session.ts:192-291`):
- **MONITOR** - no engine fault, or `sensorOnly`. A sensor fault never latches
  an engine fault and never escalates (`guard.ts:165-179`). The named engine
  fault is latched on the first non-nominal engine diagnosis so a flickering
  classifier cannot drop the guard back to MONITOR.
- **OFFLOAD_PRIORITY** - engine fault, no friendly landing, predicted loss
  outside the denied area; sending continues at the available rate.
- **STANDBY** - engine fault and a friendly alternate is reachable; data stays
  encrypted onboard and the offload continues, with no erase.
- **ARMED** - engine fault, no friendly landing, predicted loss inside the
  denied area. The reason gives pending/collected MB, transfer time and the
  whole priority items that fit in the time to loss (`offloadFit`,
  `offload.ts:63-89`).
- **ZEROIZED** - terminal. Trigger precedence: operator remote zeroize, forced
  landing inside the area, JAMMED, LOST, time to loss below **20 s**, then
  offload finished (`guard.ts:136-163`). The 20 s figure is an assumed erase
  cushion (`guard.ts:11-12`).

Supporting rules:
- **Predicted loss** is the route position after
  `min(RUL P10, glide time)` mission seconds. RUL P10 is reported by the
  diagnosis in compressed sim seconds and is converted with
  `plannedS / 120` (`guard.ts:14-20`, `:27-32`). Glide time is
  `altitude x 12 / TAS` (`guard.ts:22-25`). Both the current position and the
  predicted loss point are tested against the denied polygon
  (`guard.ts:34-49`).
- **Friendly landing** requires verdict REACHABLE and a non-negative alternate
  RUL margin. When the RUL margin is not available yet, a range-only reachable
  field is accepted **only if the predicted loss is outside the denied area**
  (`guard.ts:51-69`). This is what makes the jammed card arm (predicted inside,
  RUL null) while the friendly-area card may stand by (predicted outside,
  RUL null). The alternate layer's existing `rulMarginS` is the reachability
  module's own mixed-clock margin (`nav/alternates.ts:103-104`); Data Guard uses
  its sign, not its magnitude.
- Reasons are built from the computed values; there are no canned scenario
  sentences in the guard (`guard.ts:82-102`, `:165-224`).
- Time compression affects only the display and the estimator horizon. Capture
  times, fault triggers, RUL conversion and offload budgets all use mission
  seconds, so the Data Guard arithmetic matches the debrief clock.

### Scenario calibration
- All three cooling cards use cylinder **3**, severity **0.6**, ramp **30 s**.
  The twin starts flagging about **32 sim s** (~1 h 50 min mission) after
  injection, and the measured CHT stays below the 135 °C limit through 120 sim
  seconds. This is a property of the fault model, independent of geography.
- The guard outcome is **mission-dependent**. The card titles describe the
  intended geometry; the guard follows the decision table on the current
  mission's zones, alternates and link. Load the Ladakh template to exercise the
  denied-area erase paths; a mission with no zone or no reachable alternate
  will not behave as the title suggests.
- **COOLING OVER DENIED AREA (a):** injection at mission 0. If detection occurs
  inside a denied zone with the link up, the guard arms, sends what fits and
  erases on "Offload finished". On the Ladakh template the detection point is
  inside the exercise zone.
- **FAILURE + LINK JAMMED (b):** jammed from the start, so no item is ever
  sent. At detection, with the predicted loss inside and the RUL still null,
  the null-margin fallback rejects range-only alternates and JAMMED fires the
  erase immediately. Every captured item is lost.
- **FAILURE OVER FRIENDLY AREA (c):** trigger at **57 %** of the route,
  intended to be after the aircraft has left the denied area. When the
  predicted loss stays outside the zone, a range-REACHABLE alternate with a
  null margin is accepted and the guard holds STANDBY to landing; data offloads
  and the key is retained.
- **SENSOR GLITCH (d):** `sensorOnly` is set by the card, so the guard stays in
  MONITOR for the whole run even though the classifier warns; no erase.

### Verification
`npx tsc --noEmit`, `npm run build`, and `npx vitest run` (187 tests) pass.
The mission-editor tests cover route geometry and zone crossings, undo/redo,
GeoJSON round-trip, template loading and validation of every template. The Data
Guard tests cover: ECDH/HKDF agreement, AES-GCM round trip and tamper
rejection, hash verification at the ground, zeroize making the stored
ciphertext undecryptable, word-for-word adversary failure after zeroize, link
horizon/rate/jam states, offload budget and priority order, the four guard
cards plus edge cases, seeded manifests and 3 km capture scheduling, and the
session's secured/onboard/lost conservation. Runtime checks at 1440×900
covered all four Data Guard cards, the ground-station progress + DECRYPT
preview, the 3 s adversary verdict, JAM by button and key, STOP/PAUSE and
REPLAY reset. See README for the browser-crypto limitation.

Live acceptance of the mission editor (October 2026): search "Mysuru" then add
three nodes by map click, drag, insert, delete, undo/redo with list and map in
agreement; edit latitude in the list and see the marker move; draw a denied zone
across the route and get ZONES CAUTION; save, reload, load from localStorage and
round-trip a 12 kB GeoJSON export through import in a fresh tab; and run a
Bengaluru-only mission BRIEF → FLY → DEBRIEF (0:06:57, 14.8 km) with no app
console errors. The only console errors during the run were Open-Meteo HTTP 429
rate limits; the app degraded to FALLBACK weather and a "terrain resolving"
CAUTION as designed.

Earlier rehearsal checks remain valid: template load and route fit, MC GO with
three factor sentences; cooling WARNING/CRITICAL with cylinder + delta and the
computed lead line; sensor ADVISORY for a full run; nearest-landing changes
between holds; ticker fade after 8 s; E/Esc overlay round trip while paused;
REPLAY and NEW MISSION.

## Mission editor (October 2026)

### One Mission object is the source of truth
`Mission` (`src/mission/types.ts`) is:

```ts
{ id, name, templateId?, engineProfileId, startTimeUTC,
  nodes: Node[], zones: Zone[], groundStation: {lat, lon},
  customSites: Site[], weatherMode: 'FORECAST' | 'MANUAL' }
```

- `Node`: `id`, `type` (LAUNCH | WAYPOINT | LOITER | RECON | LAND), `name`,
  `lat`, `lon`, `alt`, `altRef` (AGL | AMSL), `loiterMin`, optional `speed`.
- `Zone`: `id`, `name`, `type` (DENIED | RESTRICTED), closed `polygon` of
  `[lon, lat]` pairs.
- `Site`: `id`, `name`, `type` (STRIP | FIELD | HELIPAD), `lat`, `lon`,
  `elevM`.

BRIEF, FLY, DEBRIEF, the pre-flight checks, the alternates layer, the Data Guard
manifest, the replay map and the Monte Carlo all read this same object. No
component looks up a fixed preset table: change a node and every derived panel
follows. The five JSON templates are cloned into a Mission and are only a
starting point.

### Templates
`src/data/templates/*.json` holds `ladakh`, `rajasthan`, `coastal`,
`plains-agri` and `coastal-survey`; `index.ts` clones them (deep-copying nodes,
zones, sites and polygons). Loading a template replaces name, nodes, zones,
sites, ground station, start time and `templateId` and clears undo/redo; the
saved-mission list and assessment settings (run count, seed) are not touched.
RESET TO TEMPLATE restores the source template's nodes, zones, sites and ground
station while keeping the current mission name, start time, id and engine
profile, and it clears per-node weather overrides. Every template is marked
**illustrative** in the UI and is not operational geography.

### Editing rules
- Click empty map to append a node; drag a marker to move it; click a **+**
  handle at a leg midpoint to insert; Delete or the row button removes.
  A mission needs at least two nodes.
- **50 node maximum.** A 51st click is refused with `NODE LIMIT REACHED (50)`.
- Undo/redo keep the last **100** mission snapshots (`HISTORY_LIMIT = 100`);
  Ctrl+Z / Ctrl+Y or the panel buttons. Esc cancels zone/site placement and
  search.
- Node list rows are draggable to reorder. Inline fields validate before
  commit: name non-empty (trimmed to 40 characters); latitude −90..90;
  longitude −180..180; altitude 0..20 000 m (stored as an integer); loiter
  ≥ 0 min (integer); speed either blank or 5..150 m/s. Lat/lon are displayed to
  **5 decimal places** and stored as entered. A rejected edit turns the field
  red with an `INVALID INPUT - NOT APPLIED` title and leaves the stored value
  unchanged.
- Search uses Open-Meteo geocoding
  (`https://geocoding-api.open-meteo.com/v1/search?name=...&count=5`), flies
  the map to the result and offers ADD NODE HERE. Pasting `lat, lon` is
  accepted.
- Zones: draw a polygon by clicking vertices and double-clicking to finish;
  drag vertices to reshape; rename, retype (DENIED/RESTRICTED) or delete. A
  warning names every crossing leg when the route intersects a zone.
- Ground station: draggable marker with a link-range ring. Custom landing
  sites: ADD LANDING SITE then a map click; name, type and elevation are
  editable, with elevation prefilled from the terrain cache or the elevation
  API.
- AUTO-PLACE RECON inserts `k` (1-10) RECON nodes spaced along the route with
  a seeded ±150 m lateral offset, so the same mission and `k` produce the same
  points. Each is editable.
- Mission start is stored as an ISO instant and edited in **IST (UTC+5:30)**;
  weather is fetched for that hour.

### Terrain and AGL
- Elevations come from the Open-Meteo elevation API
  (`https://api.open-meteo.com/v1/elevation`), in **batches of 100** points,
  because the stage map does not enable a terrain DEM. Requests never throw;
  a failed batch is treated as absent.
- Cache: memory plus `localStorage` under `aerotwin.terrain.v1`, keyed to
  **4 decimal places** (about 11 m at the equator), trimmed to the newest
  **4000** entries. A node with no cached elevation shows 0 m terrain until the
  fetch settles.
- AGL is resolved at edit time (`alt + terrain` for AGL nodes) and again when
  the profile is planned. The pre-flight route is sampled every **1 km**, up to
  **600** samples, and each sample is compared with the cached terrain.
- **Terminal buffer:** the 100 m cruise minimum is not applied within
  **1 km** (or 10 % of a shorter route) of each route end, because takeoff and
  landing are planned at field elevation. Outside that buffer: below terrain
  FAIL, below 100 m CAUTION, above 100 m PASS. More than 10 % (or at least 5)
  of samples without terrain data reports CAUTION "still resolving" rather than
  a false clearance.
- **Ladakh waypoints:** live DEM sampling found a 5 543 m ridge between ALCHI
  RIDGE and PHEY and a 5 462 m ridge between SHAM and ALCHI in the migrated
  template. Two waypoints were added — **STOK PASS** (5 660 m, id 9) and
  **INDUS PASS** (5 580 m, id 10) — so the planned path clears the ridge by
  about 117 m. The ids are deliberately non-sequential: the Data Guard manifest
  seeds on `node.id` and `node.name`, and renumbering the survey points would
  change every existing rehearsal's payload. This is a DEM check, not a
  certified obstacle survey.

### Loiter and long missions
- A LOITER node flies a level circle at the local cruise TAS; radius is
  `V² / (g·tan 20°)` (**~343 m** at 35 m/s, bank **20°**), held for
  `loiterMin`. Entry and exit are part of the planned profile; the orbit is not
  a separate physics model.
- Climb and descent use the documented profile rates (3.0 m/s up, 5.0 m/s
  down) and the fixed phase airspeeds; no wind shear or step climbs.
- Missions longer than **8 h** switch the headless/Monte Carlo integration step
  from **0.25 s** to **0.5 s** (`LONG_MISSION_S`, `LONG_MISSION_DT`). This keeps
  a long mission's run time bounded while preserving the rpm state's stability;
  the step is chosen by planned duration, so it is deterministic per mission.

### GeoJSON interchange
Export writes a FeatureCollection containing:
- the route as a **LineString** (`kind: route`, plus name, engine profile and
  start time);
- one **Point** per node with all node properties (including `altRef` and
  `loiterMin`);
- one **Polygon** per zone with name and type;
- the ground station as a **Point**;
- one **Point** per custom landing site.

The complete Mission is also attached as a non-standard `mission` member, so an
AeroTwin export round-trips exactly in ids and metadata. Import accepts
that fast path, and otherwise reconstructs a mission from a foreign
FeatureCollection (LineString required; node/site points, zone polygons and
ground station optional). Invalid JSON, a missing LineString or an incomplete
`mission` member is rejected with a message; the current mission is unchanged.

### Persistence
Saved missions live in `localStorage` under `aerotwin.missions.v1` as an array
of `{id, name, savedAt, mission}`. Save uses the current mission name;
duplicate and delete are explicit list actions. This is browser-local only —
there is no account or server. An application error boundary replaces the
stage with a flat `SOMETHING WENT WRONG - RESET` panel, so a rendering fault
does not leave a white screen.

### Pre-flight checks
The BRIEF panel recomputes six checks after every edit (terrain 0.5 s debounce,
weather 1.5 s debounce) and marks the stored assessment **OUTDATED** until
ASSESS MISSION is rerun.

| Check | PASS | CAUTION | FAIL |
|---|---|---|---|
| TERRAIN CLEARANCE | min AGL ≥ 100 m | < 100 m, or > 10 % samples unresolved | below terrain |
| ZONES | no crossing | any route/zone crossing | — |
| FUEL | margin ≥ 6 kg after reserve | 0-6 kg | negative margin |
| ALTERNATES | every leg midpoint has a field in glide range | any leg with none | — |
| DATALINK | ≥ 90 % of route within link range | 60-90 % | < 60 % |
| WEATHER | DA below ceiling − 500 m and < severe turbulence | DA ≤ ceiling with < 500 m margin, or severe turbulence | DA above the 6.3 km ceiling |

Fuel uses the nominal healthy full-profile run from the mission's
`fuelLoadKg` (bounded by the 95 kg profile capacity) and a
**12 kg / 30 min** reserve; margin minutes are margin divided by nominal burn
per minute. Alternates use glide ratio **12:1**; datalink samples every 2 km
(up to 500 samples) against `min(250 km, radio horizon)`; weather compares the
peak density altitude at the segment endpoints and nodes with
`CEILING_DENSITY_ALT_M` 6300 m. The six statuses are shown separately; they are
not collapsed into one score.

ASSESS MISSION runs the existing seeded Monte Carlo (minimum 200 runs) and
returns GO / CAUTION / NO-GO with the top three plain-language factors. The
verdict thresholds are unchanged from M3: GO needs P(complete) ≥ 0.90, every
leg ≤ 0.25 breach and median margin ≥ 6 kg; CAUTION needs ≥ 0.75, legs ≤ 0.55
and margin ≥ 0 kg; anything worse is NO-GO.

### Verification
`npx tsc --noEmit`, `npm run build` and `npx vitest run` pass (187 tests in 14
files). The mission tests cover geometry and zone crossings, undo/redo and the
100-step cap, the 50-node cap, GeoJSON round-trip (own and foreign), template
reset identity, saved-mission reload and the append/drag/insert/delete
acceptance flow. See the Data Guard verification above for the live acceptance
run.

