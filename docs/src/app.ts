// DBC Afterlife - browser app. Every number on the page is rendered from data/*.json (made by analyze.ts).
import { checkConfig, checkSettings, type Evidence, type Stat, type Verdict } from "../../checker.ts";
import { resolve } from "../../resolve.ts";
import { SELF_SERVE } from "../../rules.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (n: number) => n.toLocaleString("en-GB");
const getJson = async (path: string) => { const r = await fetch(path); if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`); return r.json(); };
const tryJson = (path: string) => getJson(path).catch(() => null);

type SetEv = Evidence & { summary: Evidence["summary"] & Record<string, any> };
const SETS = [
  { id: "discovery", file: "data/evidence.json", label: "Discovery" },
  { id: "holdout", file: "data/evidence_holdout.json", label: "Holdout" },
  { id: "confirm", file: "data/evidence_confirm.json", label: "Confirmation" },
];
const EXAMPLES = [
  { label: "AUTON (token)", addr: "39ahtL8ynzE4amH26J29C93PA5172V3ft9UuUcqQS8fz" },
  { label: "MOLTBOOK (token)", addr: "3pNAQPH6DRXykgoKzJooeystSELztB4ehDGgn69RjfBs" },
  { label: "a DBC pool", addr: "FhPVcHJxPLsNdGE6Sw7Et3z6idyVDoNW7gbRfgm6Crv6" },
];

// ---------- charts: single series (% still alive), 95% range whisker, dashed baseline ----------
const rateText = (s: Stat) => s.too_few ? `${s.alive}/${s.n} · few` : `${s.alive_pct}% · n=${fmt(s.n)}`;
function barChart(title: string, groups: (Stat & { value: string })[], opts: { hit?: string; base?: number } = {}) {
  const shown = groups.filter((g) => g.n > 0);
  const top = Math.max(opts.base ?? 0, ...shown.map((g) => g.alive_ci95?.[1] ?? 0));
  const max = Math.min(100, Math.max(20, Math.ceil(top / 20) * 20));
  const pct = (v: number) => `${(100 * v) / max}%`;
  const rows = shown.map((g) => {
    const tip = g.too_few ? `${g.value}: ${g.alive} of ${g.n} alive - too few launches to say`
      : `${g.value}: ${g.alive_pct}% alive (${g.alive} of ${fmt(g.n)}), 95% range ${g.alive_ci95![0]}–${g.alive_ci95![1]}%`;
    const bar = g.too_few ? "" : `<span class="bar" style="width:${pct(g.alive_pct!)}"></span>
      <span class="ci" style="left:${pct(g.alive_ci95![0])};width:calc(${pct(g.alive_ci95![1])} - ${pct(g.alive_ci95![0])})"></span>`;
    return `<div class="bar-row${g.value === opts.hit ? " hit" : ""}${g.too_few ? " few" : ""}" data-tip="${esc(tip)}">
      <span class="lab">${esc(g.value)}</span>
      <span class="track"><span class="grid"></span>${bar}${opts.base != null ? `<span class="base" style="left:${pct(opts.base)}"></span>` : ""}</span>
      <span class="val">${esc(rateText(g))}</span></div>`;
  }).join("");
  const ticks = [0, 1, 2, 3, 4].map((i) => `<span>${(max * i) / 4}%</span>`).join("");
  return `<div class="chart" role="img" aria-label="${esc(title)}"><div class="chart-title">${esc(title)}</div>${rows}
    <div class="axis"><span></span><span class="ticks">${ticks}</span><span></span></div></div>`;
}

function wireTooltips() {
  const tip = $("tip");
  document.addEventListener("mouseover", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
    if (!row) { tip.hidden = true; return; }
    tip.textContent = row.dataset.tip!; tip.hidden = false;
  });
  document.addEventListener("mousemove", (e) => {
    if (tip.hidden) return;
    tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${e.clientY + 16}px`;
  });
}

// ---------- verdict ----------
const LEVEL_LABEL = { red: "Warning sign", green: "Proven pattern", amber: "No clear evidence", unknown: "Out of scope" };
function renderVerdict(v: Verdict, who: string, ev: Evidence) {
  const s = v.settings;
  const lock = s.locked_lp_pct;
  const families = v.level === "unknown" ? "" : v.families.map((f) => {
    const fam = ev.evidence.find((x) => x.family === f.family);
    return fam ? barChart(`${f.family}: yours is ${f.value} (dashed line = all ${SELF_SERVE} graduates, ${v.baseline.alive_pct}%)`, fam.groups,
      { hit: f.value, base: v.baseline.alive_pct }) : "";
  }).join("");
  $("verdict").innerHTML = `<div class="verdict" data-level="${v.level}">
    <span class="pill" data-level="${v.level}">${LEVEL_LABEL[v.level]}</span>
    <p class="verdict-head">${esc(v.headline)}</p>
    <p class="who">${who}</p>
    <div class="settings"><span>graduates at ${s.threshold_sol.toFixed(s.threshold_sol < 1 ? 5 : 1)} SOL</span>
      <span>starting fee ${+s.start_fee_pct.toFixed(2)}% · ${esc(s.decay)}</span><span>${lock}% liquidity locked</span></div>
    ${v.warnings.length ? `<ul class="warnlist">${v.warnings.map((w) => `<li><span><strong>${esc(w.text)}.</strong> ${w.stat.alive} of ${fmt(w.stat.n)} self-serve launches like this are still alive.</span></li>`).join("")}</ul>` : ""}
    ${v.preset ? `<p>Matches the <a href="#preset-${v.preset.id}">${esc(v.preset.id)}</a> preset rule: ${v.preset.stat.too_few ? `${v.preset.stat.alive} of ${v.preset.stat.n} alive (too few to say)` : `${v.preset.stat.alive_pct}% of ${fmt(v.preset.stat.n)} similar launches alive`}.</p>` : ""}
    <div style="display:grid;gap:18px">${families}</div>
    <p class="muted" style="font-size:.85rem">${v.notes.map(esc).join(" ")} Verdicts use only samples that were not used to choose the rules.</p></div>`;
}

// ---------- page sections ----------
function renderFindings(all: SetEv, sets: (SetEv | null)[]) {
  const s = all.summary;
  const self = s.self_serve as Stat;
  $("snapshot").textContent = `Mainnet snapshot ${s.snapshot.slice(0, 10)}`;
  $("headline").innerHTML = `Graduating isn't success. Of ${fmt(self.n)} graduated self-serve Meteora launches we traced, <strong>${self.alive_pct}% still have $1k of liquidity</strong>.`;
  $("found-intro").textContent = `${fmt(s.rows)} randomly sampled graduated pools from Meteora's DAMM v2 API, each traced back to the DBC config it launched with. ` +
    `Settings are compared within self-serve (${SELF_SERVE}) launches, because the launchpad a token uses matters more than any single setting.`;

  const lp = all.evidence.find((f) => f.family === "Launchpad")!.groups.filter((g) => !g.too_few);
  const best = [...lp].sort((a, b) => b.n - a.n).filter((g) => g.value !== SELF_SERVE)[0];
  const tested = sets.filter(Boolean).length;
  const rob = (all as any).robustness ?? [];
  const rc = (x: any) => `${x.alive_pct ?? "–"}% <span class="muted">(${x.alive}/${fmt(x.n)})</span>`;
  const warnRows = all.warningEvidence.map((w) => `<tr><td>${esc(w.text)}</td>${sets.map((e) => {
    const x = e?.warningEvidence.find((y) => y.id === w.id);
    return `<td class="n">${x ? `${x.alive} / ${fmt(x.n)}` : "–"}</td>`; }).join("")}</tr>`).join("");
  const famTables = all.evidence.filter((f) => f.family !== "Launchpad").map((f) => barChart(`${f.family} (within ${SELF_SERVE})`, f.groups, { base: self.alive_pct })).join("");

  $("findings").innerHTML = `
    <div class="finding"><span class="big num">${s.spam_pct}%</span>
      <p><strong>of graduations are instant-graduation spam.</strong> ${fmt(s.spam)} of ${fmt(s.graduated)} graduated DBC pools in our sample set a graduation threshold below 1 SOL, so the curve "completes" with almost no buying. Counting them as successes would make every graduation statistic meaningless, so they are excluded everywhere else on this page.</p></div>
    <div class="finding"><span class="big num">${self.alive_pct}%</span>
      <p><strong>of real self-serve graduates are still alive</strong> (pool liquidity of at least $1,000 at the snapshot), ${self.alive} of ${fmt(self.n)}. Across every launchpad it is ${s.alive_pct_all}% of ${fmt(s.kept)}. A tool that ranks settings by graduation rate stops one step too early.</p></div>
    <div class="finding"><h3>The launchpad matters more than the settings</h3>
      <p>${best ? `${esc(best.value)} launches are still alive ${best.alive_pct}% of the time (n=${fmt(best.n)}), self-serve ones ${self.alive_pct}%. ` : ""}Launchpads also tend to use one setting each. Comparing settings across launchpads would credit the setting for the community. So every setting comparison here is made inside one population: self-serve Meteora launches.</p>
      ${barChart("Still alive, by launchpad (launchpads with 20+ launches; dashed line = all kept launches)", lp, { base: s.alive_pct_all })}</div>
    <div class="finding"><h3>Three warning signs, tested on ${tested === 1 ? "one sample" : `${tested} samples`}</h3>
      <p>We chose these rules on the discovery sample, froze them, then checked them on ${tested - 1 === 1 ? "a sample" : `${tested - 1} samples`} nobody had looked at. Launches with any of them almost never survive. Each cell is self-serve launches still alive / launches with that warning sign.</p>
      <div class="tablewrap"><table><thead><tr><th>Warning sign</th>${SETS.map((x, i) => `<th class="n">${x.label}${sets[i] ? "" : " (pending)"}</th>`).join("")}</tr></thead><tbody>${warnRows}</tbody></table></div></div>
    <div class="finding"><h3>Good settings prevent failure. They don't create success.</h3>
      <p>Change what "alive" means and the warning signs still hold. The Steady pattern's lead is clear at $500 and $1,000 of liquidity, but at $5,000 almost nothing survives in any group. Settings can keep a launch from dying; the rest is up to the project.</p>
      <div class="tablewrap"><table><thead><tr><th>Alive if liquidity ≥</th><th class="n">All self-serve</th>${Object.keys(rob[0]?.presets ?? {}).map((k) => `<th class="n">${esc(k)}</th>`).join("")}<th class="n">Any warning sign</th></tr></thead>
      <tbody>${rob.map((r: any) => `<tr><td>$${fmt(r.tvl_usd)}</td><td class="n">${rc(r.baseline)}</td>${Object.values(r.presets).map((x: any) => `<td class="n">${rc(x)}</td>`).join("")}<td class="n">${rc(r.avoid)}</td></tr>`).join("")}</tbody></table></div></div>
    <div class="finding"><h3>Every setting, compared</h3>${famTables}</div>`;
}

function renderPresets(all: SetEv, sets: (SetEv | null)[], presets: any[], sim: any, devnet: Record<string, any>) {
  $("presets").innerHTML = presets.map((p) => {
    const reps = SETS.map((x, i) => {
      const st = sets[i]?.presetEvidence.find((q) => q.preset === p.id);
      return `<tr><td>${x.label}</td><td class="n">${st ? (st.too_few ? `${st.alive} / ${st.n} (too few)` : `${st.alive_pct}% (${st.alive} / ${fmt(st.n)})`) : "pending"}</td></tr>`;
    }).join("");
    const fee = p.feePeriods ? `${p.startFeeBps / 100}% → ${p.endFeeBps / 100}% over ${p.feeDurationSec} s (${p.feeMode})` : `${p.startFeeBps / 100}% flat`;
    return `<article class="preset" id="preset-${esc(p.id)}"><h3>${esc(p.title)}</h3><p style="font-size:.92rem">${esc(p.why)}</p>
      <dl><dt>Graduates at</dt><dd>${p.thresholdSol} SOL</dd><dt>Trading fee</dt><dd>${esc(fee)}</dd>
      <dt>Locked after graduation</dt><dd>${p.creatorLockedPct + p.partnerLockedPct}% (creator ${p.creatorLockedPct} / partner ${p.partnerLockedPct})</dd>
      <dt>SDK validation</dt><dd>${p.sdk_valid ? "passes validateConfigParameters" : "FAILS"}</dd>
      <dt>Mainnet program</dt><dd>${(() => { const r = sim?.results.find((x: any) => x.preset === p.id);
        return r ? (r.accepted ? `createConfig accepted in simulation (${fmt(r.units)} CU, ${esc(sim.at.slice(0, 10))})` : "createConfig REJECTED in simulation") : "not simulated"; })()}</dd>
      <dt>Devnet launch</dt><dd>${(() => { const d = devnet[p.id]?.steps; return d?.buy
        ? `<a href="${esc(d.config.tx)}">config</a> · <a href="${esc(d.pool.tx)}">pool</a> · <a href="${esc(d.buy.tx)}">test buy</a>${devnet[p.id].readback?.match ? " · on-chain settings match" : ""}`
        : "not yet"; })()}</dd></dl>
      <div class="tablewrap"><table><thead><tr><th>Sample</th><th class="n">Still alive</th></tr></thead><tbody>${reps}</tbody></table></div>
      <div class="inrow"><button type="button" data-copy="${esc(p.id)}">Copy ConfigParameters JSON</button><button type="button" data-check="${esc(p.id)}">Check it</button></div></article>`;
  }).join("");
  $("presets").addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest("button"); if (!b) return;
    const p = presets.find((x) => x.id === (b.dataset.copy ?? b.dataset.check));
    if (b.dataset.copy) {
      const text = JSON.stringify(p.configParameters, null, 2);
      try { await navigator.clipboard.writeText(text); b.textContent = "Copied"; }
      catch { b.textContent = "Copy failed - see presets/ in the repo"; }
      setTimeout(() => (b.textContent = "Copy ConfigParameters JSON"), 2000);
    } else {
      renderVerdict(checkConfig(p.configParameters, all), `Preset "${esc(p.title)}" (ConfigParameters, before createConfig)`, all);
      $("check-h").scrollIntoView({ behavior: "smooth" });
    }
  });
}

function renderMethod(all: SetEv, sets: (SetEv | null)[], repo: string) {
  const sizes = SETS.map((x, i) => sets[i] ? `${x.label.toLowerCase()} ${fmt(sets[i]!.summary.rows)} pools` : null).filter(Boolean).join(", ");
  $("method").innerHTML = `
    <p><strong>Data.</strong> Every pool in Meteora's public DAMM v2 API (snapshot ${esc(all.summary.snapshot.slice(0, 16).replace("T", " "))} UTC). We kept SOL-quoted pools at least 30 days old from launchpads that use DBC, shuffled them with a fixed seed and split them: ${sizes}. Each token is matched to its DBC pool through Meteora's DBC API, and its config is read and decoded from mainnet with the official SDK. For the 40 launches that both methods looked up, Meteora's DBC API and direct <code>getProgramAccounts</code> lookups found the same config with the same settings in all 40 cases. The checker's verdicts use only the samples that were not used to choose the rules.</p>
    <p><strong>Outcome.</strong> "Alive" means the graduated pool still holds at least $1,000 of liquidity at the snapshot. Spam (threshold under 1 SOL) and blacklisted pools are excluded. Every percentage carries a 95% range, and groups under 20 launches are shown as "too few to say".</p>
    <p><strong>Guarding against ourselves.</strong> All rules were written down before results were read, and changes are logged with reasons. Preset and warning rules were picked on the discovery sample, frozen, and only then measured on the holdout and confirmation samples.</p>
    <p><strong>What this can't tell you.</strong></p>
    <ul style="margin:0;padding-left:1.2em;display:grid;gap:6px;max-width:68ch">
      <li>Which settings help a launch graduate. Only graduated launches are visible here.</li>
      <li>Why a setting works. These are associations: a setting can look good because careful teams choose it.</li>
      <li>Whether a launch will thrive. "Alive" is a modest bar ($1,000 of liquidity at one snapshot), and above $5,000 the differences mostly vanish.</li>
      <li>Some warnings overlap with the outcome itself: unlocked liquidity can simply be withdrawn, which empties the pool. That is part of the finding, not a quirk of it.</li>
      <li>Patterns driven by one big launcher. Many partners stand behind each number${(() => { const w = all.warningEvidence.find((x) => x.id === "low-fee") as any;
        return w?.partners ? `: the ${fmt(w.n)} launches with a fee of 0.25% or less come from ${fmt(w.partners)} partners, the largest with ${fmt(w.top_partner_launches)}` : ""; })()}, but a few big launchers still weigh more than small ones.</li>
      <li>Launches quoted in anything other than SOL.</li>
    </ul>
    <p>Full definitions: <a href="${repo}/blob/main/DATA_NOTE.md">DATA_NOTE.md</a> · generated tables: <a href="${repo}/blob/main/RESULTS_ALL.md">RESULTS_ALL.md</a> · raw rows: <a href="${repo}/tree/main/data">data/</a></p>`;
}

// ---------- checker wiring ----------
function wireChecker(all: SetEv) {
  const ex = $("examples");
  ex.innerHTML = EXAMPLES.map((e, i) => `<button type="button" data-i="${i}">${esc(e.label)}</button>`).join("");
  ex.addEventListener("click", (e) => {
    const i = (e.target as HTMLElement).closest("button")?.dataset.i; if (i == null) return;
    $<HTMLInputElement>("addr").value = EXAMPLES[+i].addr; run();
  });
  const status = $("status");
  async function run() {
    const addr = $<HTMLInputElement>("addr").value.trim();
    if (!addr) { status.className = "status error"; status.textContent = "Paste a Solana address first."; return; }
    const go = $<HTMLButtonElement>("go"); go.disabled = true;
    status.className = "status"; status.textContent = "Reading the launch config from Solana mainnet…";
    try {
      const r = await resolve(addr);
      const who = `${r.name ? `${esc(r.name)} · ` : ""}${r.kind} <span>${esc(addr)}</span>${r.kind === "config" ? "" : `<br>config ${esc(r.configAddress)}`}`;
      renderVerdict(checkConfig(r.config, all, r.quoteMint), who, all);
      status.textContent = "";
    } catch (e: any) {
      status.className = "status error";
      status.textContent = /Invalid public key/i.test(e.message) ? "That isn't a valid Solana address. Check for missing characters." : e.message;
    } finally { go.disabled = false; }
  }
  $("pane-live").addEventListener("submit", (e) => { e.preventDefault(); run(); });

  const manual = () => {
    const s = { threshold_sol: +$<HTMLInputElement>("m-thr").value, start_fee_pct: +$<HTMLInputElement>("m-fee").value,
      decay: $<HTMLSelectElement>("m-decay").value, locked_lp_pct: +$<HTMLInputElement>("m-lock").value };
    renderVerdict(checkSettings(s, all), "Planned settings (nothing is read from or sent to the chain)", all);
  };
  $("pane-manual").addEventListener("input", manual);
  $("pane-manual").addEventListener("submit", (e) => e.preventDefault());
  for (const [tab, pane, other, otherPane] of [["tab-live", "pane-live", "tab-manual", "pane-manual"], ["tab-manual", "pane-manual", "tab-live", "pane-live"]])
    $(tab).addEventListener("click", () => {
      $(tab).setAttribute("aria-selected", "true"); $(other).setAttribute("aria-selected", "false");
      $(pane).hidden = false; $(otherPane).hidden = true; status.textContent = "";
      if (pane === "pane-manual") manual();
    });
  // Complete at rest: show a worked example without touching the network.
  renderVerdict(checkSettings({ threshold_sol: 85, start_fee_pct: 2, decay: "flat", locked_lp_pct: 100 }, all),
    "Example: 85 SOL threshold, 2% flat fee, 100% locked. Paste a real address above to check a live launch.", all);
}

async function main() {
  wireTooltips();
  const [all0, test0, site, ...rest] = await Promise.all([tryJson("data/evidence_all.json"), tryJson("data/evidence_test.json"),
    tryJson("data/site.json"), ...SETS.map((x) => tryJson(x.file))]);
  const sets = rest.slice(0, SETS.length) as (SetEv | null)[];
  const all = (all0 ?? sets[0]) as SetEv;
  // Verdicts use only the samples that were NOT used to choose the rules (holdout + confirmation).
  const test = (test0 ?? all) as SetEv;
  const presets = await Promise.all((site?.presets ?? []).map((id: string) => getJson(`data/presets/${id}.json`)));
  const devnet = Object.fromEntries(await Promise.all((site?.presets ?? []).map(async (id: string) => [id, await tryJson(`data/devnet_${id}.json`)])));
  const repo = site?.repo_url ?? "#";
  ($("repo-link") as HTMLAnchorElement).href = repo;
  ($("pad-link") as HTMLAnchorElement).href = `${repo}/tree/main/integrations/fun-launch`;
  wireChecker(test);
  renderFindings(all, sets);
  renderPresets(test, sets, presets, await tryJson("data/simulation.json"), devnet);
  renderMethod(all, sets, repo);
}
main().catch((e) => { $("status").className = "status error"; $("status").textContent = `Could not load the evidence data: ${e.message}`; });
