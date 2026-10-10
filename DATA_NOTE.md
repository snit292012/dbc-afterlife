# DATA NOTE — definitions fixed BEFORE looking at results (written 2026-10-10 00:30 UK)

These rules are frozen. If one changes later, the change and the reason are logged at the bottom.

## Population
- Source: Meteora DAMM v2 public data API (`https://damm-v2.datapi.meteora.ag/pools`), every page, one
  snapshot. Snapshot time is recorded in `data/snapshot.json`.
- A row = one DAMM v2 pool whose base token traces (via `getPoolByBaseMint` on the DBC program) to a DBC
  pool with `isMigrated = 1`. If it doesn't trace, it isn't a DBC launch and is dropped (miss rate reported).
- Candidates to trace: quote token = wrapped SOL; `launchpad` tag not `pump.fun`, `letsbonk.fun` or empty
  (those don't use DBC). Random sample (fixed seed 42) when there are more candidates than we can trace.
- **Graduates only.** Launches that never graduated are invisible here. Every result is about how
  *graduated* launches did afterwards - never "this setting graduates more often".

## Exclusions (decided up front)
1. Spam / instant graduation: `migrationQuoteThreshold` < 1 SOL.
2. `is_blacklisted = true` in the API.
3. Too young: DAMM v2 pool created < 30 days before the snapshot (they haven't had time to fail).
4. Non-SOL quote mints (too few to compare, different units).

## Outcomes (measured at the snapshot)
- **Alive** = pool TVL ≥ $1,000 at the snapshot. (Main outcome.)
- **Holders** = token holder count (median per family).
- **TVL** and **market cap** = median per family, USD, from the API.

## Setting families (what a creator chooses)
- Graduation threshold (SOL): <20 · 20–60 · 60–100 · ≥100
- Starting base fee: ≤0.25% · >0.25–1% · >1%
- Fee decay: flat (no periods) vs decaying (fee scheduler with periods > 0) vs rate limiter
- Locked LP after graduation: creator+partner permanently locked % = 0 vs > 0

## Reporting rules
- A family with fewer than 20 launches is shown as "too few to say" - no percentages.
- Every number shows its sample size. Every launch links to its pool.
- These are associations, not causes: a setting that looks better may just be popular with better teams.
- No invented numbers. Every figure in the writeup is regenerated from `data/` by a script.

## Change log
1. 2026-10-10, after first results: **launchpad** turned out to dominate outcomes (e.g. bags.fun 51% alive,
   all using one threshold band), so setting comparisons are now made **within self-serve `met-dbc`
   launches only**, with the launchpad table shown as the confounder. Added after seeing data - disclosed.
2. 2026-10-10: "Locked LP" = creator + partner permanently locked % (summed).
3. 2026-10-10: Preset rules ("steady", "anti-sniper", "avoid") were drawn from the first sample (seed 42,
   candidates 0-2499) *after* looking at surviving launches. To guard against fooling ourselves they were
   frozen and re-tested on an untouched **holdout** (candidates 2500-4999, zero overlap):
   steady 24% → 27% (n 50 → 49); avoid 0% → 1% (n 233 → 252); anti-sniper 28% (n 25) → n 7 = too few.
   Self-serve baseline 7% / 9%. Results: RESULTS.md (discovery), RESULTS_HOLDOUT.md (holdout).

4. 2026-10-10, **bug fix**: exclusion 4 (non-SOL quotes) was only applied to the DAMM v2 pool's pair, not to
   the DBC config. 167 discovery / 173 holdout launches had a SOL DAMM v2 pool but a bonding curve quoted in
   another token (mostly USDC, 6 decimals), so their "SOL" thresholds were wrong. Now excluded using the
   config's `quoteMint`. Effect: steady 24% → 29% (n 50 → 42) discovery, 27% → 30% (n 49 → 43) holdout;
   avoid 0% → 0% (n 233 → 225), 1% → 1% (n 252 → 248). Caught by a unit test on a real config fixture.
5. 2026-10-10: a third, larger **confirmation** sample (every remaining candidate, 5000+) is collected with
   the rules frozen, as a further test.

## Known limits
- Snapshot paging: API order shifted while paging, so 170,444 listed → 134,538 unique pools seen.
- Concentration: within self-serve, the biggest single partner (fee claimer) has 30 of the 187 ≤0.25%-fee
  launches; patterns hold across many partners (distinct-partner counts reported per preset).
- "Alive" is one snapshot; older launches had longer to die. No per-launch time series.
- 75 / 51 pools are in DAMM v2 but their DBC pool is not marked migrated; excluded.
