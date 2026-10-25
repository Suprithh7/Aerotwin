// Operating limits for the reference engine class: a Rotax 914-like
// turbocharged boxer-4 of roughly 100 hp. Values are taken from the public
// BRP-Rotax 914 Operator's Manual and EASA Type Certificate Data Sheet E.122
// (see ASSUMPTIONS.md for the edition and source URL).
export const CHT_LIMIT_C = 135; // max cylinder-head (coolant) temperature
export const OILT_LIMIT_C = 130; // max oil temperature
export const OILP_MIN_BAR = 0.8; // min oil pressure below 3500 rpm

// Caution bands used to colour the thermal ramp: nominal stays blue-grey,
// amber starts only near the limit, red is reserved for the limit itself.
export const CHT_CAUTION_C = 120;
export const OILT_CAUTION_C = 110;
