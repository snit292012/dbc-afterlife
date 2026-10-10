// Resolve any address a user might paste (token mint, DBC pool or DBC config) to the decoded DBC config.
// Read-only. Runs in Node and in the browser (publicnode RPC + Meteora's DBC API both allow CORS).
import { Connection, PublicKey } from "@solana/web3.js";
import { DYNAMIC_BONDING_CURVE_PROGRAM_ID, createDbcProgram } from "@meteora-ag/dynamic-bonding-curve-sdk";

export const DEFAULT_RPC = "https://solana-rpc.publicnode.com";
const DBC_API = "https://dbc.datapi.meteora.ag/pools";

export type Resolved = { input: string; kind: "config" | "pool" | "mint"; configAddress: string; config: any;
  poolAddress?: string; mint?: string; name?: string; quoteMint: string };

export async function resolve(input: string, rpcUrl = DEFAULT_RPC): Promise<Resolved> {
  const key = new PublicKey(input.trim()); // throws on a malformed address
  const connection = new Connection(rpcUrl, "confirmed");
  const { program } = createDbcProgram(connection);
  const decode = (name: string, data: Buffer) => {
    const acc = program.coder.accounts.decode(name, data);
    return acc.poolConfig ?? acc;
  };
  const loadConfig = async (addr: string) => {
    const info = await connection.getAccountInfo(new PublicKey(addr));
    if (!info) throw new Error(`Config account ${addr} not found on mainnet`);
    return decode("poolConfig", info.data);
  };

  const info = await connection.getAccountInfo(key);
  if (info?.owner.equals(DYNAMIC_BONDING_CURVE_PROGRAM_ID)) {
    try {
      const config = decode("poolConfig", info.data);
      return { input, kind: "config", configAddress: key.toBase58(), config, quoteMint: config.quoteMint.toBase58() };
    } catch { /* not a config - try a pool */ }
    const raw = decode("virtualPool", info.data);
    const pool = raw.poolState ?? raw; // this SDK version nests the pool fields under poolState
    const configAddress = pool.config.toBase58();
    const config = await loadConfig(configAddress);
    return { input, kind: "pool", configAddress, config, poolAddress: key.toBase58(), mint: pool.baseMint.toBase58(),
      quoteMint: config.quoteMint.toBase58() };
  }

  // Otherwise treat it as a token mint and find its DBC pool through Meteora's public DBC API.
  let res = await fetch(`${DBC_API}?query=${key.toBase58()}&page_size=20`);
  for (let wait = 1500; res.status === 429 && wait <= 6000; wait *= 2) { // API busy: back off and retry
    await new Promise((s) => setTimeout(s, wait));
    res = await fetch(`${DBC_API}?query=${key.toBase58()}&page_size=20`);
  }
  if (res.status === 429) throw new Error("Meteora's DBC API is busy right now. Try again in a minute, or paste the DBC pool or config address instead (those are read straight from the chain).");
  if (!res.ok) throw new Error(`Meteora's DBC API returned HTTP ${res.status}. Try the DBC pool or config address instead.`);
  const hit = (await res.json()).data.find((p: any) => p.token_x.address === key.toBase58());
  if (!hit) throw new Error("No Meteora DBC launch found for this address (is it a DBC token, pool or config?)");
  const config = await loadConfig(hit.pool_config_address);
  return { input, kind: "mint", configAddress: hit.pool_config_address, config, poolAddress: hit.address,
    mint: key.toBase58(), name: hit.token_x.name, quoteMint: config.quoteMint.toBase58() };
}
