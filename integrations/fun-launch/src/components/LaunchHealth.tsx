// DBC Afterlife badge: shows creators how launches with this launchpad's settings fared after graduation.
// https://github.com/snit292012/dbc-afterlife
import { useEffect, useState } from 'react';
import type { LaunchHealth as Health } from '@/pages/api/launch-health';

const STYLE = {
  red: { ring: 'border-red-500/50 bg-red-500/10', pill: 'bg-red-500/20 text-red-300', label: 'Warning sign' },
  green: { ring: 'border-emerald-500/50 bg-emerald-500/10', pill: 'bg-emerald-500/20 text-emerald-300', label: 'Proven pattern' },
  amber: { ring: 'border-amber-500/50 bg-amber-500/10', pill: 'bg-amber-500/20 text-amber-300', label: 'No clear evidence' },
  unknown: { ring: 'border-neutral-750 bg-neutral-925', pill: 'bg-neutral-800 text-neutral-300', label: 'Out of scope' },
} as const;

export function LaunchHealth() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch('/api/launch-health')
      .then((r) => r.json())
      .then(setHealth)
      .catch((e) => setHealth({ ok: false, error: String(e) }));
  }, []);

  if (!health) {
    return (
      <div className="rounded-xl border border-neutral-850 bg-neutral-925 p-5 text-sm text-neutral-400">
        Checking this launchpad&apos;s launch settings against real graduated launches…
      </div>
    );
  }
  if (!health.ok) return null; // never block the form because the check is unavailable

  const v = health.verdict;
  const s = STYLE[v.level];
  return (
    <div className={`rounded-xl border p-5 sm:p-6 ${s.ring}`} aria-live="polite">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${s.pill}`}>{s.label}</span>
        <span className="text-xs text-neutral-400">Launch health · this launchpad&apos;s DBC settings</span>
      </div>
      <p className="text-base font-medium mb-2">{v.headline}</p>
      <p className="text-xs text-neutral-400 mb-3">
        Graduates at {v.settings.threshold_sol.toFixed(1)} SOL · starting fee {+v.settings.start_fee_pct.toFixed(2)}% (
        {v.settings.decay}) · {v.settings.locked_lp_pct}% liquidity locked after graduation
      </p>
      {v.warnings.length > 0 && (
        <ul className="mb-3 space-y-1 text-sm">
          {v.warnings.map((w) => (
            <li key={w.id}>
              ⚠ <strong>{w.text}.</strong> {w.stat.alive} of {w.stat.n} self-serve launches like this are still alive.
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-neutral-500">
        Evidence: graduated Meteora DBC launches, measured by{' '}
        <a className="underline" href="https://snit292012.github.io/dbc-afterlife/" target="_blank" rel="noreferrer">
          DBC Afterlife
        </a>
        . Association, not cause; not financial advice.
      </p>
    </div>
  );
}
