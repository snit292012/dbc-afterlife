// npx tsx --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import BN from "bn.js";
import { SOL_MINT, checkConfig, checkSettings, type Evidence } from "../checker.ts";
import { PRESET_RULES, isAvoid, settings, wilson } from "../rules.ts";
import { buildPreset } from "../presets.ts";

const ev: Evidence = JSON.parse(readFileSync("data/evidence.json", "utf8"));
const fixture = JSON.parse(readFileSync("test/fixture-config.json", "utf8"));
const specs = JSON.parse(readFileSync("presets/specs.json", "utf8"));

test("settings() reads a real decoded mainnet config", () => {
  assert.deepEqual(settings(fixture.config_state), { threshold_sol: 100, start_fee_pct: 1, decay: "flat", locked_lp_pct: 100 });
});

test("settings() accepts BN objects the same as decimal strings", () => {
  const c = structuredClone(fixture.config_state);
  c.migrationQuoteThreshold = new BN("100000000000");
  c.poolFees.baseFee.cliffFeeNumerator = new BN("10000000");
  assert.deepEqual(settings(c), settings(fixture.config_state));
});

test("non-SOL quote is out of scope, not judged", () => {
  assert.equal(checkConfig(fixture.config_state, ev, fixture.config_state.quoteMint).level, "unknown");
});

test("each warning sign turns the verdict red", () => {
  const ok = { threshold_sol: 85, start_fee_pct: 2, decay: "flat", locked_lp_pct: 100 };
  for (const bad of [{ start_fee_pct: 0.25 }, { threshold_sol: 12 }, { locked_lp_pct: 0 }]) {
    const v = checkSettings({ ...ok, ...bad }, ev, SOL_MINT);
    assert.equal(v.level, "red", JSON.stringify(bad));
    assert.equal(v.warnings.length, 1);
  }
});

test("instant-graduation spam is flagged red", () => {
  const v = checkSettings({ threshold_sol: 0.00009, start_fee_pct: 1, decay: "flat", locked_lp_pct: 100 }, ev);
  assert.equal(v.level, "red");
  assert.match(v.headline, /instant-graduation/);
});

test("the steady preset matches its own rule and comes out green", () => {
  const { cfg, valid } = buildPreset(specs.find((p: any) => p.id === "steady"));
  assert.ok(valid);
  assert.ok(PRESET_RULES.steady(settings(cfg)));
  assert.equal(checkConfig(cfg, ev).level, "green");
});

test("every preset avoids every warning sign", () => {
  for (const spec of specs) assert.equal(isAvoid(settings(buildPreset(spec).cfg)), false, spec.id);
});

test("preset builder refuses impossible LP shares; SDK refuses a 99.99% fee", () => {
  const base = specs[0];
  assert.throws(() => buildPreset({ ...base, creatorLockedPct: 80, partnerLockedPct: 50 }), /sum to <= 100/);
  assert.equal(buildPreset({ ...base, startFeeBps: 9999, endFeeBps: 9999 }).valid, false);
});

test("wilson interval matches known values", () => {
  assert.deepEqual(wilson(0, 187), [0, 2]);
  assert.deepEqual(wilson(12, 50), [14, 37]);
});

test("the fun-launch integration's vendored rules and checker match the root copies", () => {
  const norm = (s: string) => s.replace(/from "\.\/rules(\.ts)?"/g, 'from "./rules"').replace(/\r\n/g, "\n");
  for (const f of ["rules.ts", "checker.ts"])
    assert.equal(norm(readFileSync(`integrations/fun-launch/src/lib/afterlife/${f}`, "utf8")), norm(readFileSync(f, "utf8")), f);
});
