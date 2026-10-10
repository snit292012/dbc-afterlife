// Config checker: turn one DBC config's settings into an evidence-backed verdict.
// Pure (no Node/browser APIs) so the CLI, the website and any launchpad can call it.
import { FAMILIES, PRESET_RULES, SELF_SERVE, WARNINGS, isSpam, settings, type Settings } from "./rules.ts";

export const SOL_MINT = "So11111111111111111111111111111111111111112";

export type Stat = { n: number; alive: number; too_few?: true; alive_pct?: number; alive_ci95?: [number, number]; partners?: number };
export type Evidence = {
  summary: { snapshot: string; kept: number; self_serve: Stat; spam_pct: number };
  evidence: { family: string; groups: (Stat & { value: string })[] }[];
  presetEvidence: (Stat & { preset: string })[];
  warningEvidence: (Stat & { id: string; text: string })[];
};

export type Verdict = {
  level: "red" | "green" | "amber" | "unknown";
  headline: string;
  settings: Settings;
  warnings: { id: string; text: string; stat: Stat }[];
  preset: { id: string; stat: Stat } | null;
  families: { family: string; value: string; stat: Stat | null }[];
  baseline: Stat;
  notes: string[];
};

const n = (x: number) => x.toLocaleString("en-US");
const rate = (s: Stat) => s.too_few ? `${s.alive} of ${n(s.n)} (too few to say)` : `${n(s.alive)} of ${n(s.n)} (${s.alive_pct}%)`;

/** Verdict for a decoded on-chain PoolConfig or SDK ConfigParameters. */
export function checkConfig(config: any, ev: Evidence, quoteMint?: string): Verdict {
  return checkSettings(settings(config), ev, quoteMint);
}

export function checkSettings(s: Settings, ev: Evidence, quoteMint?: string): Verdict {
  const baseline = ev.summary.self_serve;
  const notes = [
    `Compared with ${baseline.n.toLocaleString()} graduated self-serve (${SELF_SERVE}) launches; ${baseline.alive_pct}% of them still hold ≥ $1k liquidity.`,
    "Evidence is about launches that graduated, and shows association, not cause.",
  ];
  const families = Object.entries(FAMILIES).map(([family, key]) => {
    const value = key(s);
    const stat = ev.evidence.find((f) => f.family === family)?.groups.find((g) => g.value === value) ?? null;
    return { family, value, stat };
  });
  const base = { settings: s, families, baseline, notes };

  if (quoteMint && quoteMint !== SOL_MINT)
    return { ...base, level: "unknown", warnings: [], preset: null,
      headline: "Not SOL-quoted - the evidence only covers SOL-quoted launches." };
  if (isSpam(s))
    return { ...base, level: "red", warnings: [], preset: null,
      headline: `Graduates at ${s.threshold_sol.toFixed(4)} SOL: an instant-graduation setup (${ev.summary.spam_pct}% of graduations in our data look like this). Excluded as spam.` };

  const warnings = Object.entries(WARNINGS).filter(([, w]) => w.test(s))
    .map(([id, w]) => ({ id, text: w.text, stat: ev.warningEvidence.find((x) => x.id === id)! }));
  const presetId = Object.entries(PRESET_RULES).find(([, rule]) => rule(s))?.[0] ?? null;
  const preset = presetId ? { id: presetId, stat: ev.presetEvidence.find((p) => p.preset === presetId)! } : null;

  if (warnings.length) {
    const worst = warnings.map((w) => w.stat).sort((a, b) => (a.alive_pct ?? 100) - (b.alive_pct ?? 100))[0];
    return { ...base, level: "red", warnings, preset,
      headline: `Warning: launches with this setup almost never survive - ${rate(worst)} are still alive.` };
  }
  if (preset && !preset.stat.too_few)
    return { ...base, level: "green", warnings, preset,
      headline: `Matches the "${preset.id}" pattern: ${rate(preset.stat)} similar launches are still alive (vs ${baseline.alive_pct}% overall).` };
  return { ...base, level: "amber", warnings, preset,
    headline: preset ? `Matches "${preset.id}", but there are too few similar launches to say how it does.`
      : "No warning signs, but no proven pattern either - see how each setting compares below." };
}
