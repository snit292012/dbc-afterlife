// Prove each preset is accepted by the LIVE mainnet DBC program - by simulation only. Nothing is signed or sent.
//   npx tsx simulate.ts      -> data/simulation.json
// The fee payer is a funded system account picked from getLargestAccounts; signatures are not verified in a
// simulation, so no keys are involved. The config address is a fresh throwaway public key.
import { Connection, Keypair, PublicKey, SystemProgram, VersionedTransaction, TransactionMessage } from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { readFileSync, writeFileSync } from "node:fs";
import { buildPreset } from "./presets.ts";

const conn = new Connection(process.env.RPC_URL ?? "https://solana-rpc.publicnode.com", "confirmed");
const client = new DynamicBondingCurveClient(conn, "confirmed");
const SOL = new PublicKey("So11111111111111111111111111111111111111112");

// A funded, system-owned wallet to stand in as fee payer for the simulation: the first fee-claimer wallet
// from our dataset that holds at least 0.5 SOL. Nothing is signed or sent, so its funds are never touched.
let payer: PublicKey | null = null;
const wallets = [...new Set(readFileSync("data/launches.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l))
  .filter((r) => r.ok).map((r) => r.config_state.feeClaimer as string))].slice(0, 60);
for (const w of wallets) {
  const info = await conn.getAccountInfo(new PublicKey(w));
  if (info?.owner.equals(SystemProgram.programId) && info.data.length === 0 && info.lamports > 5e8) { payer = new PublicKey(w); break; }
}
if (!payer) throw new Error("no system-owned funded account found for simulation");

const results: any[] = [];
const specs = JSON.parse(readFileSync("presets/specs.json", "utf8"));
// Negative control: same preset, but the config address already exists on mainnet - the program must refuse it.
// (A bad-fee control never reaches the program: the SDK's own validation throws first.)
const EXISTING_CONFIG = "4YMVhJZgg8K6C5pBEYcjUCYmER3V1caobkRGrmQsJfis";
const bad = { ...specs[0], id: "control-existing-config" };
for (const spec of [...specs, bad]) {
  const { cfg } = buildPreset(spec);
  const config = spec === bad ? new PublicKey(EXISTING_CONFIG) : Keypair.generate().publicKey;
  const legacy = await client.partner.createConfig({ ...cfg, config, feeClaimer: payer, leftoverReceiver: payer,
    quoteMint: SOL, payer } as any);
  const { blockhash } = await conn.getLatestBlockhash();
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: legacy.instructions }).compileToV0Message();
  const sim = await conn.simulateTransaction(new VersionedTransaction(msg), { sigVerify: false, replaceRecentBlockhash: true });
  const ok = sim.value.err == null;
  const log = (sim.value.logs ?? []).filter((l) => /Instruction|success|failed|Error|error/i.test(l)).slice(-4);
  results.push({ preset: spec.id, accepted: ok, err: sim.value.err, units: sim.value.unitsConsumed, log });
  console.log(`${spec.id.padEnd(16)} ${ok ? "ACCEPTED" : "REJECTED"} by mainnet DBC program  (${sim.value.unitsConsumed} CU)`, ok ? "" : JSON.stringify(sim.value.err));
}
writeFileSync("data/simulation.json", JSON.stringify({ at: new Date().toISOString(), program: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN", results }, null, 2));
