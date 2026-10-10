// Build the static site: copy evidence + presets into docs/data and bundle docs/src/app.ts.
//   npx tsx build-site.ts            (REPO_URL=https://github.com/<you>/<repo> to set the code link)
import * as esbuild from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

mkdirSync("docs/data/presets", { recursive: true });
for (const f of ["evidence.json", "evidence_holdout.json", "evidence_confirm.json", "evidence_all.json", "evidence_test.json", "simulation.json"])
  if (existsSync(`data/${f}`)) copyFileSync(`data/${f}`, `docs/data/${f}`);
const presets = JSON.parse(readFileSync("presets/specs.json", "utf8")).map((p: any) => p.id);
for (const id of presets) {
  copyFileSync(`presets/${id}.json`, `docs/data/presets/${id}.json`);
  if (existsSync(`data/devnet_${id}.json`)) copyFileSync(`data/devnet_${id}.json`, `docs/data/devnet_${id}.json`);
}
writeFileSync("docs/data/site.json", JSON.stringify({ repo_url: process.env.REPO_URL ?? "https://github.com/snit292012/dbc-afterlife", presets }, null, 2));

await esbuild.build({
  entryPoints: ["docs/src/app.ts"], bundle: true, format: "esm", platform: "browser", minify: true, target: "es2022",
  outfile: "docs/app.js", define: { "process.env.NODE_DEBUG": "false", global: "globalThis" },
  inject: ["docs/src/shims.ts"], logLevel: "warning",
});
console.log(`site built: ${presets.length} presets, repo ${process.env.REPO_URL ?? "default"}`);
