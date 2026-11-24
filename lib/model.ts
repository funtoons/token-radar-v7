// Token Radar v7 — the model: one snapshot in, one ranked board out.
//
// The board ranks launch candidates by PURE implied value only. The implied
// value is a least-squares fit of log market cap on the 128 live protocols
// that record a market cap, using log TVL and the clipped 7-day change.
// Token odds never touch the rank: they appear on the dashboard only as the
// share of same-age peers that already record a token, labelled as exactly
// that, never as a launch forecast.
//
// Feature selection was earned, not assumed. Three candidate feature sets
// were scored on two blind tests each (leave-one-out and walk-forward at two
// cutoffs, listed_at before 2025-01-06 vs after and before 2025-06-01 vs
// after), with the error in each test the median multiplicative factor
// exp(median |predicted log mcap - actual log mcap|). The numbers below are
// what this program recomputes from the snapshot at run time; they are
// restated here so a reader of the source can check them without running it:
//
//   set A  logTVL + clipped change            LOO 3.509x   WF 2.917x / 4.923x   worst 4.923x
//   set B  A + age capped at 1 year           LOO 3.553x   WF 2.917x / 4.923x   worst 4.923x
//   set C  A + uncapped age in years          LOO 3.657x   WF 5.053x / 3.912x   worst 5.053x
//
// Set B ties A on walk-forward worst case (in both walk-forward train sets
// every protocol is old enough that the 1-year cap makes the age column
// constant, so it drops out and B predicts exactly as A does), and A wins
// the tie-break on leave-one-out (3.509x vs 3.553x). Set C loses outright:
// uncapped age is a cohort effect, not a predictor, and its worst-case
// walk-forward error is the largest of the three. So v7 fits set A.
// Age is therefore NOT a feature of the fitted model; it is still shown on
// the dashboard (how long a protocol has run with no token recorded) and it
// still defines the peer group for the token-odds information column.
//
// A protocol whose listed_at is null is treated as age 0 years in the
// candidate tests (a listing date the snapshot does not carry is scored as
// a fresh listing, never imputed from the other protocols).

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One candidate feature set, and its blind-test numbers. */
export interface SelectionRow {
  set: 'A' | 'B' | 'C';
  features: string;
  loo_factor: number;
  walk_forward_2025_01_06: number;
  walk_forward_2025_06_01: number;
  worst_walk_forward: number;
}

/** The outcome of feature selection: the winner and the full table. */
export interface Selection {
  winner: 'A' | 'B' | 'C';
  rows: SelectionRow[];
  /** The fitted coefficients of the winning set on all 128 live protocols. */
  coefficients: number[];
  /** How many live protocols with a market cap the fit used. */
  fit_size: number;
}

/** The farm economics of one ranked row, from stated assumptions. */
export interface FarmEconomics {
  /** FARM when the standard position earns well, THIN when it earns a little, SKIP when it loses. */
  verdict: 'FARM' | 'THIN' | 'SKIP';
  /** Expected share of the 5% pool for a $2,000 standard position, whole dollars. */
  expected_share_usd: number;
  /** Gas for the plan's 12 transactions on the protocol's cheapest chain, dollars. */
  gas_total_usd: number;
  /** Net dollars per active hour on the standard position. */
  usd_per_hour: number;
  /** The deposit at which the expected share first covers the gas, whole dollars. */
  break_even_usd: number;
  /** The smallest deposit worth farming with: the larger of $50 and the break-even. */
  min_capital_usd: number;
  /** The deposit the farm plan itself starts with, by TVL tier. */
  plan_capital_usd: number;
  /** The cheapest chain's gas per transaction, dollars. */
  cheapest_gas_usd: number;
  /** The chain that gas price is for. */
  cheapest_chain: string;
}

/** One row of board.json: a ranked launch candidate. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token';
  implied_value_usd: number;
  model: { log_tvl: number; change_clipped: number; predicted_log_mcap: number };
  verdict: 'FARM' | 'THIN' | 'SKIP';
  usd_per_hour: number;
  expected_share_usd: number;
  break_even_usd: number;
  min_capital_usd: number;
  /** Share of same-age peers that already record a token: information only, never a rank input. */
  token_odds: number;
  token_odds_band: string;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  age_days: number | null;
}

/** A pre-token protocol the board does not rank: tracked, but marked as no launch candidate. */
export interface TrackedRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  reason: string;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source_note: string;
  floor_usd: number;
  model_version: string;
  selection: Selection;
  counts: { total: number; board: number; watchlist: number; live: number; live_with_mcap: number; tracked: number };
  rows: BoardRow[];
  live: LiveRow[];
  tracked: TrackedRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export const MODEL_VERSION = 'radar-v7-A';

/** The two walk-forward cutoffs the selection rule tests. */
export const WALK_FORWARD_CUTOFFS = ['2025-01-06', '2025-06-01'] as const;

/** The 7-day change as the snapshot stores it (per cent), clipped to [-1, 3] to limit outlier leverage. */
export const CHANGE_CLIP_LOW = -1;
export const CHANGE_CLIP_HIGH = 3;

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when the date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Age in years from listed_at to the snapshot date; an unknown listing date counts as 0 years. */
export function ageYears(asOf: string, listedAt: string | null): number {
  const days = ageDays(asOf, listedAt);
  return days === null ? 0 : days / 365.25;
}

/** The clipped 7-day change: null counts as 0, then clipped to [-1, 3]. */
export function clippedChange(p: SnapshotProtocol): number {
  const raw = finite(p.change_7d, 0);
  return Math.min(CHANGE_CLIP_HIGH, Math.max(CHANGE_CLIP_LOW, raw));
}

/** The feature vector of one protocol under a candidate set (A, B or C). */
export function features(p: SnapshotProtocol, asOf: string, set: 'A' | 'B' | 'C'): number[] {
  const base = [1, Math.log(p.tvl_usd), clippedChange(p)];
  if (set === 'A') return base;
  const age = ageYears(asOf, p.listed_at);
  if (set === 'B') return [...base, Math.min(age, 1)];
  return [...base, age];
}

/** Solve a small dense linear system by Gauss-Jordan with partial pivoting.
 *  A column whose pivot is effectively zero keeps its coefficient at 0. */
function solveLinear(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const m = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    if (Math.abs(m[pivot]![col]!) < 1e-12) continue;
    if (pivot !== col) {
      const tmp = m[col]!;
      m[col] = m[pivot]!;
      m[pivot] = tmp;
    }
    const pv = m[col]![col]!;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r]![col]! / pv;
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) m[r]![k] = m[r]![k]! - factor * m[col]![k]!;
    }
  }
  return m.map((row, i) => (Math.abs(row[i]!) < 1e-12 ? 0 : row[n]! / row[i]!));
}

/**
 * Least squares of log market cap on a candidate feature set. Each
 * non-intercept column is standardised first (the raw columns are badly
 * scaled: log TVL sits near 20 while the intercept is 1), and a column with
 * no variance in the training rows — the capped-age column in a
 * walk-forward train set, where every protocol is older than the cap —
 * drops out with coefficient 0 instead of breaking the solve.
 */
export function fitLeastSquares(rows: SnapshotProtocol[], asOf: string, set: 'A' | 'B' | 'C'): number[] {
  const raw = rows.map((p) => features(p, asOf, set));
  const y = rows.map((p) => Math.log(p.mcap_usd!));
  const k = raw[0]!.length;
  const means: number[] = [0];
  const sds: number[] = [1];
  const keep: boolean[] = [true];
  for (let j = 1; j < k; j++) {
    const col = raw.map((r) => r[j]!);
    const mean = col.reduce((a, b) => a + b, 0) / col.length;
    const sd = Math.sqrt(col.reduce((a, b) => a + (b - mean) * (b - mean), 0) / col.length);
    means.push(mean);
    sds.push(sd);
    keep.push(sd > 1e-12);
  }
  const kept = keep.filter(Boolean).length;
  const x: number[][] = raw.map((r) => {
    const row = [1];
    for (let j = 1; j < k; j++) row.push(keep[j] ? (r[j]! - means[j]!) / sds[j]! : 0);
    return row;
  });
  const xtx: number[][] = [];
  const xty: number[] = [];
  for (let i = 0; i < kept; i++) {
    xtx.push([]);
    for (let j = 0; j < kept; j++) xtx[i]!.push(x.reduce((a, r) => a + r[i]! * r[j]!, 0));
    xty.push(x.reduce((a, r, t) => a + r[i]! * y[t]!, 0));
  }
  const solved = solveLinear(xtx, xty);
  const beta: number[] = [solved[0]!];
  let idx = 1;
  for (let j = 1; j < k; j++) {
    if (!keep[j]) {
      beta.push(0);
      continue;
    }
    const b = solved[idx]! / sds[j]!;
    beta.push(b);
    beta[0] = beta[0]! - (solved[idx]! * means[j]!) / sds[j]!;
    idx++;
  }
  return beta;
}

/** Predicted log market cap of one protocol under a fitted coefficient set. */
export function predictLogMcap(beta: number[], p: SnapshotProtocol, asOf: string, set: 'A' | 'B' | 'C'): number {
  const x = features(p, asOf, set);
  return beta.reduce((a, b, i) => a + b * x[i]!, 0);
}

/** The median of a list of numbers (the mean of the two middles when even). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Median multiplicative error of a fitted set on a set of live protocols. */
function medianFactor(beta: number[], rows: SnapshotProtocol[], asOf: string, set: 'A' | 'B' | 'C'): number {
  const errors = rows.map((p) => Math.abs(predictLogMcap(beta, p, asOf, set) - Math.log(p.mcap_usd!)));
  return Math.exp(median(errors));
}

/** Leave-one-out median factor for one candidate set. */
function leaveOneOut(rows: SnapshotProtocol[], asOf: string, set: 'A' | 'B' | 'C'): number {
  const errors: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const train = rows.filter((_, j) => j !== i);
    const beta = fitLeastSquares(train, asOf, set);
    errors.push(Math.abs(predictLogMcap(beta, rows[i]!, asOf, set) - Math.log(rows[i]!.mcap_usd!)));
  }
  return Math.exp(median(errors));
}

/** Walk-forward median factor: fit on listed_at before the cutoff, test on listed_at on/after it. */
function walkForward(rows: SnapshotProtocol[], asOf: string, set: 'A' | 'B' | 'C', cutoff: string): number {
  const train = rows.filter((p) => p.listed_at !== null && p.listed_at < cutoff);
  const test = rows.filter((p) => p.listed_at !== null && p.listed_at >= cutoff);
  const beta = fitLeastSquares(train, asOf, set);
  return medianFactor(beta, test, asOf, set);
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Feature selection: score A, B and C on leave-one-out and on walk-forward
 * at both cutoffs, then pick the best worst-case walk-forward factor, with
 * leave-one-out as the tie-break. The live protocols are the 128 that
 * record a market cap above zero.
 */
export function selectFeatures(snapshot: Snapshot): Selection {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
  const table: SelectionRow[] = (['A', 'B', 'C'] as const).map((set) => {
    const loo = leaveOneOut(live, snapshot.as_of, set);
    const wf1 = walkForward(live, snapshot.as_of, set, WALK_FORWARD_CUTOFFS[0]);
    const wf2 = walkForward(live, snapshot.as_of, set, WALK_FORWARD_CUTOFFS[1]);
    return {
      set,
      features:
        set === 'A'
          ? 'intercept + log(TVL) + clipped 7-day change'
          : set === 'B'
            ? 'A + age capped at 1 year'
            : 'A + age in years (uncapped)',
      loo_factor: round3(loo),
      walk_forward_2025_01_06: round3(wf1),
      walk_forward_2025_06_01: round3(wf2),
      worst_walk_forward: round3(Math.max(wf1, wf2)),
    };
  });
  const sorted = [...table].sort(
    (a, b) => a.worst_walk_forward - b.worst_walk_forward || a.loo_factor - b.loo_factor,
  );
  const winner = sorted[0]!.set;
  const coefficients = fitLeastSquares(live, snapshot.as_of, winner);
  return { winner, rows: table, coefficients, fit_size: live.length };
}

/** The fitted implied value of a pre-token protocol: exp(predicted log mcap), whole dollars, at least $1. */
export function impliedValue(p: SnapshotProtocol, beta: number[], asOf: string, set: 'A' | 'B' | 'C'): { implied: number; predicted: number } {
  const predicted = predictLogMcap(beta, p, asOf, set);
  return { implied: Math.max(1, Math.round(Math.exp(predicted))), predicted };
}

/** Whether a protocol records no token: no CoinGecko id in the snapshot.
 *  (258 protocols carry a symbol but no CoinGecko id and no market cap; the
 *  design counts them pre-token, as the snapshot records no token for them
 *  that any market prices. A protocol with a CoinGecko id is LIVE.) */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAPPED_OR_STAKED = /\b(wrapped|staked|staking)\b/i;
/** A name beginning with an exchange's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const NON_CANDIDATE_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** Whether a protocol is a launch candidate the board may rank. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    p.category !== null &&
    !NON_CANDIDATE_CATEGORIES.has(p.category) &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_OR_STAKED.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  ) || (isPreToken(p) && p.category === null && !VERSIONED.test(p.name) && !WRAPPED_OR_STAKED.test(p.name) && !EXCHANGE_PREFIX.test(p.name));
}

/** Why a pre-token protocol is not a launch candidate, for the tracked list. */
export function nonCandidateReason(p: SnapshotProtocol): string {
  if (p.category !== null && NON_CANDIDATE_CATEGORIES.has(p.category)) {
    if (p.category === 'CEX') return 'Centralised exchange: its token, if any, is not a protocol launch.';
    return `${p.category}: a wrapped, staked or bridged product of a token that already trades.`;
  }
  if (VERSIONED.test(p.name)) return 'Versioned name: a pool of another protocol, not a launch of its own.';
  if (WRAPPED_OR_STAKED.test(p.name)) return 'Wrapped or staked product: its underlying token already trades.';
  if (EXCHANGE_PREFIX.test(p.name)) return 'Exchange product: named for an exchange whose token already trades.';
  return 'Not a launch candidate under the watchlist rule.';
}

/** The age band a protocol's token-odds peer group is: the share of peers in the band that already record a token. */
export function oddsBand(p: SnapshotProtocol, asOf: string): string {
  const days = ageDays(asOf, p.listed_at);
  if (days === null) return 'unknown age';
  const years = days / 365.25;
  if (years < 1) return 'under 1 year';
  if (years < 2) return '1-2 years';
  if (years < 3) return '2-3 years';
  return '3+ years';
}

/** For each age band, the share of protocols in it that already record a token. */
export function peerTokenShares(snapshot: Snapshot): Map<string, number> {
  const bands = new Map<string, { total: number; withToken: number }>();
  for (const p of snapshot.protocols) {
    const band = oddsBand(p, snapshot.as_of);
    const entry = bands.get(band) ?? { total: 0, withToken: 0 };
    entry.total++;
    if (p.gecko_id !== null) entry.withToken++;
    bands.set(band, entry);
  }
  const shares = new Map<string, number>();
  for (const [band, entry] of bands) shares.set(band, entry.total === 0 ? 0 : entry.withToken / entry.total);
  return shares;
}

// ---------------------------------------------------------------- farm economics

/** The airdrop pool is 5% of the implied value. */
export const POOL_SHARE = 0.05;
/** The typical farmer's deposit: the farmer count is TVL divided by this. */
export const TYPICAL_DEPOSIT_USD = 2000;
/** The standard position the $/hour verdict is judged on. */
export const STANDARD_POSITION_USD = 2000;
/** Transactions in one farm plan. */
export const PLAN_TRANSACTIONS = 12;
/** Active hours across the whole farm: setup, weekly actions, claim and log. */
export const ACTIVE_HOURS = 4;
/** FARM at or above this net $/hour, THIN at or above the thin line, else SKIP. */
export const FARM_HOURLY_USD = 10;
export const THIN_HOURLY_USD = 2;

/** Gas per transaction in dollars, by chain; chains not listed here cost $0.50. */
export const GAS_PER_TX_USD: Record<string, number> = {
  Solana: 0.02,
  Base: 0.05,
  Polygon: 0.05,
  Arbitrum: 0.1,
  Optimism: 0.1,
  BSC: 0.15,
  'BNB Chain': 0.15,
  Binance: 0.15,
  Avalanche: 0.3,
  Ethereum: 8,
};

/** The cheapest chain a protocol runs on, and its gas per transaction. */
export function cheapestChain(p: SnapshotProtocol): { chain: string; gasUsd: number } {
  if (p.chains.length === 0) return { chain: 'its main chain', gasUsd: 0.5 };
  let best = p.chains[0]!;
  let bestGas = GAS_PER_TX_USD[best] ?? 0.5;
  for (const chain of p.chains) {
    const gas = GAS_PER_TX_USD[chain] ?? 0.5;
    if (gas < bestGas) {
      best = chain;
      bestGas = gas;
    }
  }
  return { chain: best, gasUsd: bestGas };
}

/** The deposit the farm plan starts with, by TVL tier. */
export function planCapital(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The farm economics of one ranked row, from the stated assumptions above. */
export function farmEconomics(p: SnapshotProtocol, implied: number): FarmEconomics {
  const pool = POOL_SHARE * implied;
  const farmers = Math.min(250_000, Math.max(200, Math.round(p.tvl_usd / TYPICAL_DEPOSIT_USD)));
  const expectedShare = pool / farmers;
  const cheapest = cheapestChain(p);
  const gasTotal = PLAN_TRANSACTIONS * cheapest.gasUsd;
  const net = expectedShare - gasTotal;
  const usdPerHour = round2(net / ACTIVE_HOURS);
  const verdict = usdPerHour >= FARM_HOURLY_USD ? 'FARM' : usdPerHour >= THIN_HOURLY_USD ? 'THIN' : 'SKIP';
  const breakEven = expectedShare > 0 ? Math.ceil(((STANDARD_POSITION_USD * gasTotal) / expectedShare / 10)) * 10 : 1_000_000;
  return {
    verdict,
    expected_share_usd: Math.round(expectedShare * 100) / 100,
    gas_total_usd: round2(gasTotal),
    usd_per_hour: usdPerHour,
    break_even_usd: breakEven,
    min_capital_usd: Math.max(50, breakEven),
    plan_capital_usd: planCapital(p),
    cheapest_gas_usd: cheapest.gasUsd,
    cheapest_chain: cheapest.chain,
  };
}

/** The category's one action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age, break-even) — never from a hand-written list of names. The $/hour
 * verdict is judged on a $2,000 standard position; a smaller deposit earns
 * proportionally less, so the plan starts at the TVL-tier capital and scales
 * up only past the break-even.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, econ: FarmEconomics): string[] {
  const chain = econ.cheapest_chain;
  const capital = econ.plan_capital_usd;
  const hold = holdDaysFor(age);
  const gasEach = econ.cheapest_gas_usd;
  const gasWord = gasEach >= 1 ? `$${gasEach} of gas` : `${Math.round(gasEach * 100)} cents of gas`;
  return [
    stepText(
      `Use a fresh wallet that holds only the funds you plan to farm on ${chain}, and keep its seed phrase offline.`,
      `under $3 of gas for the first transaction`,
      '5 minutes',
    ),
    stepText(
      `${actionFor(p, capital, chain)} This starts at $${capital}; scale toward the $2,000 standard position only past the $${econ.break_even_usd} break-even.`,
      `$${capital} of capital and about ${gasWord} per transaction`,
      '15 minutes to set up',
    ),
    stepText(
      `Make one qualifying action each week on ${chain}, such as a deposit, a borrow, a swap or a vote in ${p.name}.`,
      `about ${gasWord} a week`,
      '10 minutes a week',
    ),
    stepText(
      `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ),
    stepText(
      `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes.`,
      'no fee to check, and never pay to claim',
      '10 minutes',
    ),
    stepText(
      `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      'nothing but the log',
      '5 minutes',
    ),
  ];
}

// ---------------------------------------------------------------- the board

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, selection: Selection): BoardRow[] {
  const shares = peerTokenShares(snapshot);
  const scored = snapshot.protocols
    .filter((p) => isRankable(p))
    .map((p) => {
      const { implied, predicted } = impliedValue(p, selection.coefficients, snapshot.as_of, selection.winner);
      const age = ageDays(snapshot.as_of, p.listed_at);
      const econ = farmEconomics(p, implied);
      const band = oddsBand(p, snapshot.as_of);
      return { p, implied, predicted, age, econ, band, share: shares.get(band) ?? 0 };
    });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age,
    token_status: 'pre-token',
    implied_value_usd: s.implied,
    model: {
      log_tvl: round2(Math.log(s.p.tvl_usd)),
      change_clipped: clippedChange(s.p),
      predicted_log_mcap: round2(s.predicted),
    },
    verdict: s.econ.verdict,
    usd_per_hour: s.econ.usd_per_hour,
    expected_share_usd: s.econ.expected_share_usd,
    break_even_usd: s.econ.break_even_usd,
    min_capital_usd: s.econ.min_capital_usd,
    token_odds: round3(s.share),
    token_odds_band: s.band,
    farm_steps: farmSteps(s.p, s.age, s.econ),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      age_days: ageDays(snapshot.as_of, p.listed_at),
    }));
}

/** The pre-token protocols the board does not rank, tracked with their reason. */
export function trackedRows(snapshot: Snapshot): TrackedRow[] {
  return snapshot.protocols
    .filter((p) => isPreToken(p) && !isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: ageDays(snapshot.as_of, p.listed_at),
      reason: nonCandidateReason(p),
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData; selection: Selection } {
  const selection = selectFeatures(snapshot);
  const board = buildBoard(snapshot, selection);
  const live = liveRows(snapshot);
  const tracked = trackedRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source_note: 'DefiLlama public API, fetched once by the house (see snapshot source)',
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    selection,
    counts: {
      total: snapshot.protocols.length,
      board: board.length,
      watchlist: snapshot.watchlist.length,
      live: live.length,
      live_with_mcap: snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0).length,
      tracked: tracked.length,
    },
    rows: board,
    live,
    tracked,
  };
  return { board, radar, selection };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
