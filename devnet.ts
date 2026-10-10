// Devnet proof: a preset is a real, launchable DBC config. DEVNET ONLY - free test SOL, no real money.
//   npx tsx devnet.ts [presetId]     -> createConfig -> createPool -> test buy; links saved to data/devnet_<id>.json
// The throwaway devnet keypair lives in .devnet-keypair.json (gitignored).
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import { DynamicBondingCurveClient, deriveDbcPoolAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { buildPreset } from "./presets.ts";

const RPC = "https://api.devnet.solana.com";
const SOL = new PublicKey("So11111111111111111111111111111111111111112");
const id = process.argv[2] ?? "steady";
const out = `data/devnet_${id}.json`;
const conn = new Connection(RPC, "confirmed");
const client = new DynamicBondingCurveClient(conn, "confirmed");
const tx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const acct = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;

const KP = ".devnet-keypair.json";
if (!existsSync(KP)) writeFileSync(KP, JSON.stringify(Array.from(Keypair.generate().secretKey)));
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KP, "utf8"))));
const state: any = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : { preset: id, payer: payer.publicKey.toBase58(), steps: {} };
const save = () => writeFileSync(out, JSON.stringify(state, null, 2));

let bal = await conn.getBalance(payer.publicKey);
console.log(`payer ${payer.publicKey.toBase58()} balance ${bal / LAMPORTS_PER_SOL} devnet SOL`);
if (bal < 0.5 * LAMPORTS_PER_SOL) {
  console.log("requesting devnet airdrop...");
  const sig = await conn.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, "confirmed");
  bal = await conn.getBalance(payer.publicKey);
  console.log(`balance now ${bal / LAMPORTS_PER_SOL}`);
}

const spec = JSON.parse(readFileSync("presets/specs.json", "utf8")).find((p: any) => p.id === id);
const { cfg, valid, error } = buildPreset(spec);
if (!valid) throw new Error(`preset invalid: ${error}`);

if (!state.steps.config) {
  const config = Keypair.generate();
  const t = await client.partner.createConfig({ ...cfg, config: config.publicKey, feeClaimer: payer.publicKey,
    leftoverReceiver: payer.publicKey, quoteMint: SOL, payer: payer.publicKey } as any);
  const sig = await sendAndConfirmTransaction(conn, t, [payer, config], { commitment: "confirmed" });
  state.steps.config = { address: config.publicKey.toBase58(), sig, tx: tx(sig), account: acct(config.publicKey.toBase58()) };
  save(); console.log("createConfig", tx(sig));
}

if (!state.steps.pool) {
  const mint = Keypair.generate();
  const config = new PublicKey(state.steps.config.address);
  const t = await client.creator.createPool({ name: `Afterlife ${id} test`, symbol: "AFTR", uri: "https://example.com/afterlife.json",
    payer: payer.publicKey, poolCreator: payer.publicKey, config, baseMint: mint.publicKey });
  const sig = await sendAndConfirmTransaction(conn, t, [payer, mint], { commitment: "confirmed" });
  const pool = deriveDbcPoolAddress(SOL, mint.publicKey, config).toBase58();
  state.steps.pool = { pool, mint: mint.publicKey.toBase58(), sig, tx: tx(sig), account: acct(pool) };
  save(); console.log("createPool", tx(sig));
}

if (!state.steps.buy) {
  const t = await client.pool.swap({ owner: payer.publicKey, pool: new PublicKey(state.steps.pool.pool),
    amountIn: new BN(0.05 * LAMPORTS_PER_SOL), minimumAmountOut: new BN(0), swapBaseForQuote: false, referralTokenAccount: null });
  const sig = await sendAndConfirmTransaction(conn, t, [payer], { commitment: "confirmed" });
  state.steps.buy = { amount_sol: 0.05, sig, tx: tx(sig) };
  save(); console.log("test buy", tx(sig));
}

// Read the config back from devnet and confirm the on-chain settings equal the preset.
const onchain: any = await client.state.getPoolConfig(state.steps.config.address);
const c = onchain?.poolConfig ?? onchain;
state.readback = {
  migrationQuoteThreshold: c.migrationQuoteThreshold.toString(), expected: cfg.migrationQuoteThreshold.toString(),
  cliffFeeNumerator: c.poolFees.baseFee.cliffFeeNumerator.toString(), expectedFee: cfg.poolFees.baseFee.cliffFeeNumerator.toString(),
};
state.readback.match = state.readback.migrationQuoteThreshold === state.readback.expected && state.readback.cliffFeeNumerator === state.readback.expectedFee;
save();
console.log("readback", state.readback);
