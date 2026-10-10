// DBC Afterlife: how did launches with THIS launchpad's config settings fare after graduation?
// Reads POOL_CONFIG_KEY from mainnet (or devnet) and scores it against held-out evidence.
// Read-only. https://github.com/snit292012/dbc-afterlife
import type { NextApiRequest, NextApiResponse } from 'next';
import { Connection } from '@solana/web3.js';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { checkConfig, type Evidence, type Verdict } from '@/lib/afterlife/checker';

const EVIDENCE_URL =
  process.env.AFTERLIFE_EVIDENCE_URL ??
  'https://snit292012.github.io/dbc-afterlife/data/evidence_test.json';
const TTL_MS = 10 * 60 * 1000;

let cache: { at: number; body: LaunchHealth } | null = null;

export type LaunchHealth =
  | { ok: true; configKey: string; verdict: Verdict; evidenceUrl: string }
  | { ok: false; error: string };

export default async function handler(_req: NextApiRequest, res: NextApiResponse<LaunchHealth>) {
  if (cache && Date.now() - cache.at < TTL_MS) return res.status(200).json(cache.body);

  const configKey = process.env.POOL_CONFIG_KEY?.split(',')[0];
  const rpcUrl = process.env.RPC_URL;
  if (!configKey || !rpcUrl) {
    return res.status(500).json({ ok: false, error: 'POOL_CONFIG_KEY and RPC_URL must be set' });
  }

  try {
    const [config, evidence] = await Promise.all([
      new DynamicBondingCurveClient(new Connection(rpcUrl, 'confirmed'), 'confirmed').state.getPoolConfig(configKey),
      fetch(EVIDENCE_URL).then((r) => {
        if (!r.ok) throw new Error(`evidence: HTTP ${r.status}`);
        return r.json() as Promise<Evidence>;
      }),
    ]);
    if (!config) throw new Error(`config ${configKey} not found`);
    const c = (config as any).poolConfig ?? config;
    const body: LaunchHealth = {
      ok: true,
      configKey,
      verdict: checkConfig(c, evidence, c.quoteMint.toBase58()),
      evidenceUrl: EVIDENCE_URL,
    };
    cache = { at: Date.now(), body };
    return res.status(200).json(body);
  } catch (e) {
    return res.status(502).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
