// Build the static site: copy evidence + presets into site/data and bundle site/src/app.ts.
//   npx tsx build-site.ts            (REPO_URL=https://github.com/<you>/<repo> to set the code link)
import * as esbuild from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

mkdirSync("site/data/presets", { recursive: true });
for (const f of ["evidence.json", "evidence_holdout.json", "evidence_confirm.json", "evidence_all.json", "simulation.json"])
  if (existsSync(`data/${f}`)) copyFileSync(`data/${f}`, `site/data/${f}`);
const presets = JSON.parse(readFileSync("presets/specs.json", "utf8")).map((p: any) => p.id);
for (const id of presets) copyFileSync(`presets/${id}.json`, `site/data/presets/${id}.json`);
writeFileSync("site/data/site.json", JSON.stringify({ repo_url: process.env.REPO_URL ?? "#", presets }, null, 2));

await esbuild.build({
  entryPoints: ["site/src/app.ts"], bundle: true, format: "esm", platform: "browser", minify: true, target: "es2022",
  outfile: "site/app.js", define: { "process.env.NODE_DEBUG": "false", global: "globalThis" },
  inject: ["site/src/shims.ts"], logLevel: "warning",
});
console.log(`site built: ${presets.length} presets, repo ${process.env.REPO_URL ?? "(unset)"}`);
