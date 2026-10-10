// CLI: check a live DBC launch or a config file against the evidence.
//   npx tsx check.ts <token mint | DBC pool | DBC config address>
//   npx tsx check.ts presets/steady.json          (ConfigParameters before you call createConfig)
//   npx tsx check.ts --strict my-config.json      (exit code 2 on a red verdict - for a launchpad's CI)
import { existsSync, readFileSync } from "node:fs";
import { checkConfig, type Evidence, type Verdict } from "./checker.ts";
import { resolve } from "./resolve.ts";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const arg = args.find((a) => !a.startsWith("--"));
if (!arg) { console.log("usage: npx tsx check.ts [--strict] <mint | pool | config address | ConfigParameters .json>"); process.exit(1); }
// Verdicts use only samples not used to choose the rules (holdout + confirmation), when available.
const evFile = ["data/evidence_test.json", "data/evidence_all.json", "data/evidence.json"].find(existsSync)!;
const ev: Evidence = JSON.parse(readFileSync(evFile, "utf8"));

let verdict: Verdict, label: string;
if (arg.endsWith(".json")) {
  const j = JSON.parse(readFileSync(arg, "utf8"));
  verdict = checkConfig(j.configParameters ?? j, ev);
  label = arg;
} else {
  const r = await resolve(arg, process.env.RPC_URL).catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
  verdict = checkConfig(r.config, ev, r.quoteMint);
  label = `${r.name ? r.name + " - " : ""}${r.kind} ${arg}${r.kind === "config" ? "" : `\nconfig ${r.configAddress}`}`;
}

const icon = { red: "RED  ", green: "GREEN", amber: "AMBER", unknown: "?    " }[verdict.level];
const s = verdict.settings;
console.log(`${label}\n\n[${icon}] ${verdict.headline}\n`);
console.log(`Settings: graduates at ${s.threshold_sol.toFixed(2)} SOL · starting fee ${s.start_fee_pct.toFixed(2)}% (${s.decay}) · ${s.locked_lp_pct}% liquidity locked`);
for (const w of verdict.warnings) console.log(`  ! ${w.text}: ${w.stat.alive} of ${w.stat.n} such launches still alive`);
for (const f of verdict.families)
  console.log(`  ${f.family.padEnd(28)} ${f.value.padEnd(12)} ${f.stat ? (f.stat.too_few ? `too few (${f.stat.n})` : `${f.stat.alive_pct}% alive of ${f.stat.n}`) : "no data"}`);
console.log(`\n${verdict.notes.join("\n")}\nEvidence: ${evFile}`);
if (strict && verdict.level === "red") process.exit(2);
