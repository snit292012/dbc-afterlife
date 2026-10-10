// The frozen rules (DATA_NOTE.md). Shared by analyze.ts (evidence) and checker.ts (verdicts) so they can't drift.
// Works on both an on-chain PoolConfig (decoded) and the SDK's ConfigParameters - same field names.

export type Settings = { threshold_sol: number; start_fee_pct: number; decay: string; locked_lp_pct: number };

// Accepts numbers, decimal strings and BN objects (BN.toString() is base 10; its JSON form is hex, so
// callers must pass decoded objects or decimal strings, never JSON.stringify'd BNs).
const num = (v: any) => v?.constructor?.name === "BN" ? Number(v.toString(10)) : Number(v);

/** Settings a creator chose, in human units. Assumes a SOL quote (9 decimals). */
export function settings(c: any): Settings {
  const bf = c.poolFees.baseFee;
  const mode = num(bf.baseFeeMode), periods = num(bf.firstFactor);
  return {
    threshold_sol: num(c.migrationQuoteThreshold) / 1e9,
    start_fee_pct: (num(bf.cliffFeeNumerator) / 1e9) * 100,
    decay: mode === 2 ? "rate limiter" : periods > 0 ? "decaying" : "flat",
    locked_lp_pct: num(c.creatorPermanentLockedLiquidityPercentage) + num(c.partnerPermanentLockedLiquidityPercentage),
  };
}

/** DATA_NOTE exclusion 1: graduates with an (almost) zero threshold are instant-graduation spam. */
export const isSpam = (s: Settings) => s.threshold_sol < 1;

/** Outcome: pool still holds at least $1,000 at the snapshot. */
export const ALIVE_TVL_USD = 1000;

/** Launchpad whose launches are compared with each other (launchpad itself is a confounder). */
export const SELF_SERVE = "met-dbc";

export const FAMILIES: Record<string, (s: Settings) => string> = {
  "Graduation threshold": (s) => s.threshold_sol < 20 ? "<20 SOL" : s.threshold_sol < 60 ? "20–60 SOL" : s.threshold_sol < 100 ? "60–100 SOL" : "≥100 SOL",
  "Starting fee": (s) => s.start_fee_pct <= 0.25 ? "≤0.25%" : s.start_fee_pct <= 1 ? "0.25–1%" : ">1%",
  "Fee decay": (s) => s.decay,
  "Locked LP after graduation": (s) => s.locked_lp_pct > 0 ? "some locked" : "none locked",
};

// Preset rules: frozen 2026-10-10 from the discovery sample, then tested on holdout + confirmation sets.
const inBand = (s: Settings) => s.threshold_sol >= 60 && s.threshold_sol <= 110;
export const PRESET_RULES: Record<string, (s: Settings) => boolean> = {
  steady: (s) => inBand(s) && s.decay === "flat" && s.start_fee_pct >= 1 && s.start_fee_pct <= 3 && s.locked_lp_pct >= 100,
  "anti-sniper": (s) => inBand(s) && s.decay === "decaying" && s.start_fee_pct >= 40 && s.locked_lp_pct >= 100,
};

// Warning signs: each frozen with the presets; "avoid" = any of them.
export const WARNINGS: Record<string, { test: (s: Settings) => boolean; text: string }> = {
  "low-fee": { test: (s) => s.start_fee_pct <= 0.25, text: "Starting fee is 0.25% or lower" },
  "low-threshold": { test: (s) => s.threshold_sol < 20, text: "Graduates at under 20 SOL" },
  "nothing-locked": { test: (s) => s.locked_lp_pct === 0, text: "No liquidity is permanently locked after graduation" },
};
export const isAvoid = (s: Settings) => Object.values(WARNINGS).some((w) => w.test(s));

/** Wilson 95% interval for k successes out of n, in whole percent. */
export function wilson(k: number, n: number): [number, number] {
  const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n);
  const w = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.round((100 * (c - w)) / d), Math.round((100 * (c + w)) / d)];
}
