// Turn evidence-backed settings into real DBC ConfigParameters with the official SDK builder,
// then check them with the SDK's own validator. No transactions are sent.
//   npx tsx presets.ts   -> presets/*.json (+ prints validation result per preset)
import {
  ActivationType, BaseFeeMode, CollectFeeMode, DammV2DynamicFeeMode, MigratedCollectFeeMode, MigrationFeeOption,
  MigrationOption, TokenAuthorityOption, TokenDecimal, TokenType, buildCurve, validateConfigParameters,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Keypair } from "@solana/web3.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export type PresetSpec = {
  id: string; title: string; why: string;
  thresholdSol: number;          // graduation threshold
  startFeeBps: number;           // starting trading fee
  endFeeBps: number;             // = startFeeBps for a flat fee
  feePeriods: number;            // 0 = flat
  feeDurationSec: number;
  feeMode: "linear" | "exponential";
  creatorLockedPct: number;      // permanently locked LP after graduation (creator share)
  partnerLockedPct: number;      // permanently locked LP after graduation (partner/config-owner share)
  evidence: string[];            // which RESULTS.md rows back this preset
};

export function buildPreset(p: PresetSpec) {
  const flat = p.feePeriods === 0;
  // The SDK only checks that LP shares sum to 100, so a negative leftover share would slip through.
  if (p.creatorLockedPct < 0 || p.partnerLockedPct < 0 || p.creatorLockedPct + p.partnerLockedPct > 100)
    throw new Error("locked LP shares must be >= 0 and sum to <= 100");
  const cfg = buildCurve({
    token: { tokenType: TokenType.SPLToken, tokenBaseDecimal: TokenDecimal.SIX, tokenQuoteDecimal: 9,
      tokenAuthorityOption: TokenAuthorityOption.Immutable, totalTokenSupply: 1_000_000_000, leftover: 0 },
    fee: {
      baseFeeParams: { baseFeeMode: p.feeMode === "exponential" ? BaseFeeMode.FeeSchedulerExponential : BaseFeeMode.FeeSchedulerLinear, feeSchedulerParam: {
        startingFeeBps: p.startFeeBps, endingFeeBps: flat ? p.startFeeBps : p.endFeeBps,
        numberOfPeriod: p.feePeriods, totalDuration: flat ? 0 : p.feeDurationSec } },
      dynamicFeeEnabled: true, collectFeeMode: CollectFeeMode.QuoteToken, creatorTradingFeePercentage: 0,
      poolCreationFee: 0, enableFirstSwapWithMinFee: false,
    },
    migration: { migrationOption: MigrationOption.MET_DAMM_V2, migrationFeeOption: MigrationFeeOption.FixedBps25,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
      migratedPoolFee: { collectFeeMode: MigratedCollectFeeMode.QuoteToken, dynamicFee: DammV2DynamicFeeMode.Disabled, poolFeeBps: 25 } },
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: p.partnerLockedPct, partnerLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: p.creatorLockedPct,
      creatorLiquidityPercentage: 100 - p.creatorLockedPct - p.partnerLockedPct,
    },
    lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: ActivationType.Timestamp,
    percentageSupplyOnMigration: 20,
    migrationQuoteThreshold: p.thresholdSol,
  });
  let valid = true, error = "";
  try { // Accounts are placeholders: validation checks the economic parameters, not who signs.
    validateConfigParameters({ ...cfg, leftoverReceiver: Keypair.generate().publicKey } as any); }
  catch (e: any) { valid = false; error = String(e?.stack ?? e); }
  return { cfg, valid, error };
}

// BN / PublicKey -> decimal strings (BN's own toJSON would give hex).
const plain = (v: any): any =>
  v == null ? v
  : v.constructor?.name === "BN" ? v.toString()
  : v.constructor?.name === "PublicKey" ? v.toBase58()
  : Array.isArray(v) ? v.map(plain)
  : typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]))
  : v;
const toJson = (o: any) => JSON.stringify(plain(o), null, 2);

if (process.argv[1]?.endsWith("presets.ts")) {
  const specs: PresetSpec[] = existsSync("presets/specs.json") ? JSON.parse(readFileSync("presets/specs.json", "utf8"))
    : [{ id: "smoke", title: "smoke test", why: "builder check", thresholdSol: 85, startFeeBps: 100, endFeeBps: 100,
         feePeriods: 0, feeDurationSec: 0, feeMode: "linear", creatorLockedPct: 50, partnerLockedPct: 50, evidence: [] }];
  mkdirSync("presets", { recursive: true });
  for (const s of specs) {
    const { cfg, valid, error } = buildPreset(s);
    writeFileSync(`presets/${s.id}.json`, toJson({ ...s, sdk_valid: valid, configParameters: cfg }));
    console.log(valid ? "VALID  " : "INVALID", s.id, error.slice(0, 200));
  }
}
