// Collector. Read-only mainnet. Rules: DATA_NOTE.md.
//   npx tsx collect.ts pages          -> data/pages/*.json + data/snapshot.json (all DAMM v2 pools)
//   npx tsx collect.ts lookup [max]   -> data/lookup.jsonl (mint -> DBC pool + config, resume-safe)
//   npx tsx collect.ts join           -> data/launches.jsonl (configs decoded on-chain, 100 per call)
import { Connection, PublicKey } from "@solana/web3.js";
import { createDbcProgram } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const API = "https://damm-v2.datapi.meteora.ag/pools";
const DBC_API = "https://dbc.datapi.meteora.ag/pools";
const SOL = "So11111111111111111111111111111111111111112";
const NON_DBC = new Set(["pump.fun", "letsbonk.fun", ""]);
const DAY = 86_400_000;
// SET=holdout: a second, untouched sample (candidates 2500-4999 of the same seeded shuffle) to test presets.
const SUF = process.env.SET ? `_${process.env.SET}` : "";
// SET=confirm: every remaining candidate (5000+) - a second, much larger test of the frozen preset rules.
const FROM = process.env.SET === "holdout" ? 2500 : process.env.SET === "confirm" ? 5000 : 0;
const sleep = (ms: number) => new Promise((s) => setTimeout(s, ms));

async function retry<T>(f: () => Promise<T>, what: string): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await f(); } catch (e: any) {
      if (i >= 6) throw e;
      const wait = 2000 * 2 ** i;
      console.log(`  retry ${what} in ${wait / 1000}s: ${String(e?.message ?? e).slice(0, 80)}`);
      await sleep(wait);
    }
  }
}

async function pages() {
  mkdirSync("data/pages", { recursive: true });
  const first = await retry(() => fetch(`${API}?page=1&page_size=1000`).then((r) => r.json()), "page 1");
  const n = first.pages;
  writeFileSync("data/snapshot.json", JSON.stringify({ taken_at: new Date().toISOString(), total: first.total, pages: n }));
  for (let p = 1; p <= n; p++) {
    const f = `data/pages/p${String(p).padStart(3, "0")}.json`;
    if (existsSync(f)) continue;
    const d = p === 1 ? first : await retry(() => fetch(`${API}?page=${p}&page_size=1000`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }), `page ${p}`);
    writeFileSync(f, JSON.stringify(d.data));
    if (p % 10 === 0) console.log(`page ${p}/${n}`);
    await sleep(300);
  }
  console.log(`done: ${n} pages, total ${first.total}`);
}

// Deterministic shuffle (seed 42) so the sample is reproducible.
function shuffle<T>(a: T[], seed = 42): T[] {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const plain = (v: any): any =>
  v == null ? v
  : v instanceof PublicKey ? v.toBase58()
  : typeof v === "object" && v.constructor?.name === "BN" ? v.toString()
  : Array.isArray(v) ? v.map(plain)
  : typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]))
  : v;

function candidates() {
  const snap = JSON.parse(readFileSync("data/snapshot.json", "utf8"));
  const cutoff = Date.parse(snap.taken_at) - 30 * DAY;
  const seen = new Set<string>();
  const all: any[] = [];
  for (const f of readdirSync("data/pages").sort())
    for (const r of JSON.parse(readFileSync(`data/pages/${f}`, "utf8")))
      if (!seen.has(r.address)) { seen.add(r.address); all.push(r); }
  // Exclusions that need no lookups (DATA_NOTE: quote SOL, DBC-capable launchpad, not blacklisted, >= 30 days old).
  const cands = shuffle(all.filter((r) => r.token_y?.address === SOL && !NON_DBC.has(r.launchpad ?? "")
    && !r.is_blacklisted && r.created_at <= cutoff));
  console.log(`pools ${all.length}, candidates ${cands.length}`);
  return cands;
}

// Step 1: token mint -> DBC pool + config address via Meteora's public DBC API (exact mint match only).
async function lookup(max: number) {
  const out = `data/lookup${SUF}.jsonl`;
  const done = new Set(existsSync(out) ? readFileSync(out, "utf8").trim().split("\n").filter(Boolean)
    .map((l) => JSON.parse(l).damm_pool) : []);
  const todo = candidates().slice(FROM, FROM + max).filter((r) => !done.has(r.address));
  const one = async (r: any) => {
    const mint = r.token_x.address;
    const d = await retry(() => fetch(`${DBC_API}?query=${mint}&page_size=20`).then((x) => {
      if (!x.ok) throw new Error(`HTTP ${x.status}`); return x.json(); }), "dbc lookup");
    const hit = d.data.find((p: any) => p.token_x.address === mint);
    appendFileSync(out, JSON.stringify({ damm_pool: r.address, mint, name: r.name, launchpad: r.launchpad,
      created_at: r.created_at, outcome: { tvl: r.tvl, holders: r.token_x.holders, market_cap: r.token_x.market_cap,
        volume_24h: r.volume?.["24h"] }, dbc_pool: hit?.address ?? null, config: hit?.pool_config_address ?? null }) + "\n");
  };
  const PAR = 4; // parallel API lookups: 4 had zero HTTP 429s, 8 was rate-limited
  for (let i = 0; i < todo.length; i += PAR) {
    await Promise.all(todo.slice(i, i + PAR).map(one));
    if ((i / PAR) % 50 === 0) console.log(`lookup ${i + done.size}/${max}`);
    await sleep(200);
  }
  console.log(`lookup done -> ${out}`);
}

// Step 2: decode DBC pools + configs on-chain, 100 accounts per RPC call, and join -> launches.jsonl.
async function join() {
  const rows = readFileSync(`data/lookup${SUF}.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const { program } = createDbcProgram(new Connection(process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com", "confirmed"));
  const fetchAll = async (kind: "poolConfig" | "virtualPool", keys: string[]) => {
    const m = new Map<string, any>();
    for (let i = 0; i < keys.length; i += 100) {
      const chunk = keys.slice(i, i + 100);
      const accs: any[] = await retry(() => (program.account as any)[kind].fetchMultiple(chunk.map((k) => new PublicKey(k))), kind);
      chunk.forEach((k, j) => m.set(k, accs[j]));
      await sleep(500);
    }
    return m;
  };
  const hits = rows.filter((r) => r.config);
  const cfgs = await fetchAll("poolConfig", [...new Set(hits.map((r) => r.config as string))]);
  const pools = await fetchAll("virtualPool", hits.map((r) => r.dbc_pool));
  const out = rows.map((r) => {
    if (!r.config) return { ...r, ok: false, why: "no DBC pool" };
    const cfg = cfgs.get(r.config), pool = pools.get(r.dbc_pool);
    if (!cfg || !pool) return { ...r, ok: false, why: "account missing on-chain" };
    return { ...r, ok: true, is_migrated: (pool.poolState ?? pool).isMigrated, config_state: plain(cfg) };
  });
  writeFileSync(`data/launches${SUF}.jsonl`, out.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`join: ${out.filter((r) => r.ok).length}/${out.length} ok -> data/launches${SUF}.jsonl`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "pages") await pages();
else if (cmd === "lookup") await lookup(Number(arg ?? 2000));
else if (cmd === "join") await join();
else console.log("usage: collect.ts pages | lookup [max] | join");
