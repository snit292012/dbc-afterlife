// Evidence tables, applying the frozen rules in rules.ts (DATA_NOTE.md).
//   npx tsx analyze.ts                 discovery set   -> data/evidence.json + RESULTS.md
//   SET=holdout|confirm npx tsx ...    test sets       -> data/evidence_<set>.json + RESULTS_<SET>.md
//   SET=all npx tsx analyze.ts         all three sets  -> data/evidence_all.json + RESULTS_ALL.md
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { SOL_MINT } from "./checker.ts";
import { ALIVE_TVL_USD, FAMILIES, PRESET_RULES, SELF_SERVE, WARNINGS, isAvoid, isSpam, settings, wilson, type Settings } from "./rules.ts";

const MIN_N = 20;
const SET = process.env.SET ?? process.argv[2] ?? "";
const SUF = SET ? `_${SET}` : "";
// Reads data/launches*.jsonl, or the gzipped copy published in the repo (data/launches*.jsonl.gz).
const pick = (f: string) => existsSync(f) ? f : existsSync(`${f}.gz`) ? `${f}.gz` : null;
const read = (f: string) => (f.endsWith(".gz") ? gunzipSync(readFileSync(f)).toString("utf8") : readFileSync(f, "utf8"))
  .trim().split("\n").map((l) => JSON.parse(l));
const files = (SET === "all" ? ["data/launches.jsonl", "data/launches_holdout.jsonl", "data/launches_confirm.jsonl"]
  : [`data/launches${SUF}.jsonl`]).map(pick).filter((f): f is string => f !== null);
if (!files.length) { console.log(`no data for set "${SET || "discovery"}" yet - skipped`); process.exit(0); }
const rows = files.flatMap(read);
const snap = JSON.parse(readFileSync("data/snapshot.json", "utf8"));

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN;
};

type Row = any & { s: Settings; alive: boolean };
const migrated = rows.filter((r) => r.ok && r.is_migrated === 1);
// DATA_NOTE exclusion 4, enforced on the DBC config itself: the DAMM v2 pool can pair with SOL while the
// bonding curve was quoted in USDC etc. (different decimals - its threshold is not SOL).
const nonSol = migrated.filter((r) => r.config_state.quoteMint !== SOL_MINT);
const traced = migrated.filter((r) => r.config_state.quoteMint === SOL_MINT);
const spam = traced.filter((r) => isSpam(settings(r.config_state)));
const kept: Row[] = traced.filter((r) => !isSpam(settings(r.config_state)))
  .map((r) => ({ ...r, s: settings(r.config_state), alive: r.outcome.tvl >= ALIVE_TVL_USD }));
const self = kept.filter((r) => r.launchpad === SELF_SERVE);

const stats = (g: Row[]) => {
  const k = g.filter((r) => r.alive).length;
  return g.length < MIN_N ? { n: g.length, alive: k, too_few: true as const }
    : { n: g.length, alive: k, alive_pct: Math.round((100 * k) / g.length), alive_ci95: wilson(k, g.length),
        median_holders: Math.round(median(g.map((r) => r.outcome.holders))),
        median_mcap_usd: Math.round(median(g.map((r) => r.outcome.market_cap))),
        partners: new Set(g.map((r) => r.config_state.feeClaimer)).size };
};
const table = (pop: Row[], key: (r: Row) => string) => {
  const groups: Record<string, Row[]> = {};
  for (const r of pop) (groups[key(r)] ??= []).push(r);
  return Object.entries(groups).sort((x, y) => y[1].length - x[1].length)
    .map(([value, g]) => ({ value, ...stats(g),
      examples: g.filter((r) => r.alive).slice(0, 3).concat(g.filter((r) => !r.alive).slice(0, 2)).map((r) => ({ name: r.name, damm_pool: r.damm_pool })) }));
};

const evidence = [
  { family: "Launchpad", scope: "all kept launches (shows the confounder)", groups: table(kept, (r) => r.launchpad || "(none)") },
  ...Object.entries(FAMILIES).map(([family, key]) => ({ family, scope: `within ${SELF_SERVE}`, groups: table(self, (r) => key(r.s)) })),
];
const presetEvidence = Object.entries(PRESET_RULES).map(([preset, rule]) => {
  const g = self.filter((r) => rule(r.s));
  return { preset, ...stats(g), alive_examples: g.filter((r) => r.alive).map((r) => ({ name: r.name, damm_pool: r.damm_pool })) };
});
const warningEvidence = [
  ...Object.entries(WARNINGS).map(([id, w]) => ({ id, text: w.text, ...stats(self.filter((r) => w.test(r.s))) })),
  { id: "avoid", text: "Any of the warning signs", ...stats(self.filter((r) => isAvoid(r.s))) },
];

const summary = {
  set: SET || "discovery", files, snapshot: snap.taken_at, rows: rows.length, traced: rows.filter((r) => r.ok).length,
  not_dbc: rows.filter((r) => !r.ok && r.why === "no DBC pool").length,
  errors: rows.filter((r) => !r.ok && r.why !== "no DBC pool").length,
  not_migrated: rows.filter((r) => r.ok && r.is_migrated !== 1).length, non_sol_quote: nonSol.length,
  graduated: traced.length, spam: spam.length, spam_pct: Math.round((100 * spam.length) / traced.length),
  kept: kept.length, alive_pct_all: Math.round((100 * kept.filter((r) => r.alive).length) / kept.length),
  self_serve: stats(self),
};
writeFileSync(`data/evidence${SUF}.json`, JSON.stringify({ summary, evidence, presetEvidence, warningEvidence }, null, 2));

const cell = (g: any) => g.too_few ? `too few to say (${g.alive}/${g.n})` : `${g.alive_pct}% (${g.alive_ci95[0]}–${g.alive_ci95[1]}%)`;
let md = `# RESULTS — ${summary.set} (generated by analyze.ts - do not edit by hand)\n\nSnapshot ${summary.snapshot}. ` +
  `${summary.rows} sampled pools → ${summary.traced} traced to DBC (${summary.not_dbc} not DBC, ${summary.errors} errors, ` +
  `${summary.not_migrated} not migrated, ${summary.non_sol_quote} non-SOL quote) → ${summary.graduated} graduated SOL-quoted → ${summary.spam} spam excluded (${summary.spam_pct}%) → ${summary.kept} kept. ` +
  `Alive = TVL ≥ $${ALIVE_TVL_USD.toLocaleString()} at snapshot. Overall alive ${summary.alive_pct_all}%; ` +
  `self-serve (${SELF_SERVE}) ${cell(summary.self_serve)} of ${summary.self_serve.n}. Graduates only; associations, not causes; ranges are 95% intervals.\n`;
for (const f of evidence) {
  md += `\n## ${f.family} (${f.scope})\n| Setting | Launches | Alive (95% range) | Median holders | Median mcap |\n|---|---|---|---|---|\n`;
  for (const g of f.groups as any[]) md += g.too_few ? `| ${g.value} | ${g.n} | ${cell(g)} | | |\n`
    : `| ${g.value} | ${g.n} | ${cell(g)} | ${g.median_holders} | $${g.median_mcap_usd.toLocaleString()} |\n`;
}
md += `\n## Presets (within ${SELF_SERVE}; every matching launch, alive or dead)\n| Preset | Launches | Alive (95% range) | Distinct partners |\n|---|---|---|---|\n`;
for (const p of presetEvidence as any[]) md += `| ${p.preset} | ${p.n} | ${cell(p)} | ${p.partners ?? ""} |\n`;
md += `\n## Warning signs (within ${SELF_SERVE})\n| Warning | Launches | Alive (95% range) | Distinct partners |\n|---|---|---|---|\n`;
for (const w of warningEvidence as any[]) md += `| ${w.text} | ${w.n} | ${cell(w)} | ${w.partners ?? ""} |\n`;
writeFileSync(`RESULTS${SUF.toUpperCase()}.md`, md);
console.log(md);
