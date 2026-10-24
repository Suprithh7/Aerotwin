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
