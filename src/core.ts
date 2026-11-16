// Pure core for prime-rate-sofr-fed-funds-rate-today-mcp. The only I/O is keyless reads of the Federal Reserve Bank of New York
// Markets Data API, done through an injected fetchText.
//
// Sources (public, no key):
//   https://markets.newyorkfed.org/api/rates/all/latest.json                       SOFR, EFFR, OBFR, TGCR, BGCR, SOFRAI (latest)
//   https://markets.newyorkfed.org/api/rates/{secured|unsecured}/{type}/search.json?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
//     type sofr, tgcr, bgcr, sofrai (secured) and effr, obfr (unsecured). EFFR rows carry the FOMC target range
//     (targetRateFrom/targetRateTo; before 2008-12-16 a single target in targetRateFrom). EFFR history starts 2000-07-03,
//     SOFR 2018-04-02.
//
// The prime rate is not published by the New York Fed. It is derived here by the convention the Wall Street Journal Prime Rate
// and the major US banks have followed since 1994: the top of the federal funds target range plus 3 percentage points.
import type { FetchText } from './types.js';

export const REPO = 'prime-rate-sofr-fed-funds-rate-today-mcp';
export const SITE = 'https://www.mcpstamp.com';
export const UTM = `utm_source=mcp&utm_medium=${REPO}`;
export const more = () => `${SITE}/servers/?${UTM}`;
export const BASE = 'https://markets.newyorkfed.org';
export const SOURCE = 'Federal Reserve Bank of New York, reference rates (markets.newyorkfed.org). Percent per year. The prime rate is derived as the top of the fed funds target range plus 3 points (the Wall Street Journal Prime Rate convention).';
export const PRIME_SPREAD = 3;

export class InputError extends Error {}
export class UpstreamError extends Error {}

export interface RateRow {
  effectiveDate: string; type: string; percentRate?: number; targetRateFrom?: number; targetRateTo?: number;
  percentPercentile1?: number; percentPercentile99?: number; volumeInBillions?: number;
  average30day?: number; average90day?: number; average180day?: number; index?: number;
}

export const RATES: Record<string, { type: string; group: 'secured' | 'unsecured'; field: keyof RateRow; label: string; first: string }> = {
  sofr: { type: 'sofr', group: 'secured', field: 'percentRate', label: 'SOFR', first: '2018-04-02' },
  effr: { type: 'effr', group: 'unsecured', field: 'percentRate', label: 'Effective federal funds rate (EFFR)', first: '2000-07-03' },
  obfr: { type: 'obfr', group: 'unsecured', field: 'percentRate', label: 'Overnight bank funding rate (OBFR)', first: '2016-03-01' },
  tgcr: { type: 'tgcr', group: 'secured', field: 'percentRate', label: 'Tri-party general collateral rate (TGCR)', first: '2018-04-02' },
  bgcr: { type: 'bgcr', group: 'secured', field: 'percentRate', label: 'Broad general collateral rate (BGCR)', first: '2018-04-02' },
  sofr_30day_average: { type: 'sofrai', group: 'secured', field: 'average30day', label: '30-day average SOFR', first: '2020-03-02' },
  sofr_90day_average: { type: 'sofrai', group: 'secured', field: 'average90day', label: '90-day average SOFR', first: '2020-03-02' },
  sofr_180day_average: { type: 'sofrai', group: 'secured', field: 'average180day', label: '180-day average SOFR', first: '2020-03-02' },
  sofr_index: { type: 'sofrai', group: 'secured', field: 'index', label: 'SOFR Index', first: '2020-03-02' },
  fed_funds_upper: { type: 'effr', group: 'unsecured', field: 'targetRateTo', label: 'Fed funds target (upper bound of the range)', first: '2000-07-03' },
  prime: { type: 'effr', group: 'unsecured', field: 'targetRateTo', label: 'Prime rate (fed funds upper bound + 3)', first: '2000-07-03' },
};

const ALIASES: Record<string, string> = {
  'fed funds': 'effr', fed_funds: 'effr', 'federal funds': 'effr', fedfunds: 'effr', 'fed funds rate': 'effr', 'effective federal funds rate': 'effr',
  'prime rate': 'prime', wsj_prime: 'prime', 'sofr30': 'sofr_30day_average', '30 day sofr': 'sofr_30day_average', 'sofr90': 'sofr_90day_average',
  'sofr180': 'sofr_180day_average', 'sofr average': 'sofr_30day_average', 'target': 'fed_funds_upper', 'target range': 'fed_funds_upper',
};
export function rateKey(s: string): string {
  const k = String(s ?? '').trim().toLowerCase();
  const n = k.replace(/[\s-]+/g, '_');
  if (RATES[n]) return n;
  if (ALIASES[k]) return ALIASES[k];
  if (ALIASES[n]) return ALIASES[n];
  throw new InputError(`unknown rate "${s}". Use one of: ${Object.keys(RATES).join(', ')}.`);
}

/** Upper bound of the target (single target before 2008-12-16). */
export const upper = (r: RateRow): number | undefined => r.targetRateTo ?? r.targetRateFrom;
export const primeOf = (r: RateRow): number | undefined => { const u = upper(r); return u === undefined ? undefined : round(u + PRIME_SPREAD); };
export const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const bp = (n: number) => `${n >= 0 ? '+' : ''}${Math.round(n * 100)}bp`;
const pct = (n: number | undefined) => (n === undefined ? 'n/a' : `${Number(n.toFixed(5))}%`);
const range = (r: RateRow) => (r.targetRateTo !== undefined ? `${r.targetRateFrom?.toFixed(2)}-${r.targetRateTo.toFixed(2)}%` : r.targetRateFrom !== undefined ? `${r.targetRateFrom.toFixed(2)}% (single target)` : 'n/a');

export const today = (now: Date) => now.toISOString().slice(0, 10);
export function addDays(date: string, n: number): string { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

function parse(body: string): RateRow[] {
  let j: any;
  try { j = JSON.parse(body); } catch { throw new UpstreamError('markets.newyorkfed.org returned something that is not JSON'); }
  if (!j || !Array.isArray(j.refRates)) throw new UpstreamError('markets.newyorkfed.org returned JSON without refRates');
  return j.refRates as RateRow[];
}

export async function latestAll(f: FetchText): Promise<RateRow[]> {
  return parse(await f(`${BASE}/api/rates/all/latest.json`, { cacheTtl: 900 }));
}

export async function search(f: FetchText, group: string, type: string, start: string, end: string, now: Date): Promise<RateRow[]> {
  const closed = end < addDays(today(now), -7);
  const rows = parse(await f(`${BASE}/api/rates/${group}/${type}/search.json?startDate=${start}&endDate=${end}`, { cacheTtl: closed ? 86400 : 1800, timeoutMs: 30000 }));
  return rows.filter((r) => r.effectiveDate >= start && r.effectiveDate <= end).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
}

export interface Change { effective: string; from: string; to: string; change_bp: number; direction: 'cut' | 'hike'; prime_after: number }

/** FOMC target changes inside EFFR rows (ascending by date): the first day each new target was in effect. */
export function targetChanges(rows: RateRow[]): Change[] {
  const out: Change[] = [];
  let prev: RateRow | undefined;
  for (const r of rows) {
    const u = upper(r);
    if (u === undefined) continue;
    if (prev && upper(prev) !== u) {
      const d = u - (upper(prev) as number);
      out.push({ effective: r.effectiveDate, from: range(prev), to: range(r), change_bp: Math.round(d * 100), direction: d < 0 ? 'cut' : 'hike', prime_after: round(u + PRIME_SPREAD) });
    }
    prev = r;
  }
  return out;
}

function checkDate(s: string | undefined, name: string, now: Date, first = '2000-07-03'): string | undefined {
  if (s === undefined || s === '') return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(`${s}T00:00:00Z`)) || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) throw new InputError(`${name} must be a real date as YYYY-MM-DD, got "${s}"`);
  if (s < first) throw new InputError(`${name} ${s} is before this rate's history starts (${first})`);
  if (s > today(now)) throw new InputError(`${name} ${s} is in the future`);
  return s;
}

const find = (rows: RateRow[], type: string) => rows.find((r) => r.type === type);

export async function fedFundsToday(f: FetchText, _a: Record<string, never> = {}, now = new Date()) {
  const [all, hist] = await Promise.all([latestAll(f), search(f, 'unsecured', 'effr', addDays(today(now), -3 * 366), today(now), now)]);
  const effr = find(all, 'EFFR') ?? hist[hist.length - 1];
  if (!effr || effr.percentRate === undefined) throw new UpstreamError('no EFFR in the New York Fed answer');
  const changes = targetChanges(hist);
  const last = changes[changes.length - 1] ?? null;
  const prime = primeOf(effr) as number;
  const prev = hist.filter((r) => r.effectiveDate < effr.effectiveDate).pop();
  const summary = `Federal funds target range ${range(effr)} (as of ${effr.effectiveDate}). Effective federal funds rate ${pct(effr.percentRate)}` +
    `${prev?.percentRate !== undefined ? ` (${bp(effr.percentRate - prev.percentRate)} vs ${prev.effectiveDate})` : ''}, volume $${effr.volumeInBillions ?? '?'} billion. ` +
    `Prime rate ${prime.toFixed(2)}% (target top + 3). ` +
    (last ? `Last change: ${last.direction} of ${Math.abs(last.change_bp)} bp effective ${last.effective}, from ${last.from} to ${last.to}.` : `No target change since ${hist[0]?.effectiveDate ?? 'the start of the window'}.`) +
    ` Changes in the last 3 years: ${changes.length}.`;
  return {
    summary, as_of_date: effr.effectiveDate, target_range: { lower: effr.targetRateFrom ?? null, upper: effr.targetRateTo ?? null }, effective_federal_funds_rate: effr.percentRate,
    effr_percentile_1: effr.percentPercentile1 ?? null, effr_percentile_99: effr.percentPercentile99 ?? null, volume_billions: effr.volumeInBillions ?? null,
    prime_rate: prime, prime_rate_rule: 'Top of the fed funds target range plus 3 percentage points (Wall Street Journal Prime Rate convention). Individual banks set their own prime.',
    last_change: last, changes_last_3_years: changes, as_of: now.toISOString(), source: SOURCE, more: more(),
  };
}

export async function sofrToday(f: FetchText, _a: Record<string, never> = {}, now = new Date()) {
  const [all, hist] = await Promise.all([latestAll(f), search(f, 'secured', 'sofr', addDays(today(now), -14), today(now), now)]);
  const sofr = find(all, 'SOFR') ?? hist[hist.length - 1];
  if (!sofr || sofr.percentRate === undefined) throw new UpstreamError('no SOFR in the New York Fed answer');
  const ai = find(all, 'SOFRAI');
  const prev = hist.filter((r) => r.effectiveDate < sofr.effectiveDate).pop();
  const other = ['TGCR', 'BGCR', 'OBFR', 'EFFR'].map((t) => find(all, t)).filter((r): r is RateRow => !!r)
    .map((r) => ({ rate: r.type, date: r.effectiveDate, percent: r.percentRate ?? null, volume_billions: r.volumeInBillions ?? null }));
  const summary = `SOFR ${pct(sofr.percentRate)} for ${sofr.effectiveDate}${prev?.percentRate !== undefined ? ` (${bp(sofr.percentRate - prev.percentRate)} vs ${prev.effectiveDate})` : ''}, ` +
    `1st to 99th percentile ${pct(sofr.percentPercentile1)} to ${pct(sofr.percentPercentile99)}, volume $${sofr.volumeInBillions ?? '?'} billion. ` +
    (ai ? `SOFR averages published ${ai.effectiveDate}: 30-day ${pct(ai.average30day)}, 90-day ${pct(ai.average90day)}, 180-day ${pct(ai.average180day)}; SOFR Index ${ai.index}. ` : '') +
    other.map((o) => `${o.rate} ${pct(o.percent ?? undefined)}`).join(', ') + '. Term SOFR (CME) is a licensed rate and is not included.';
  return {
    summary, sofr: { date: sofr.effectiveDate, percent: sofr.percentRate, percentile_1: sofr.percentPercentile1 ?? null, percentile_99: sofr.percentPercentile99 ?? null, volume_billions: sofr.volumeInBillions ?? null },
    previous: prev ? { date: prev.effectiveDate, percent: prev.percentRate } : null,
    averages: ai ? { published: ai.effectiveDate, average_30day: ai.average30day, average_90day: ai.average90day, average_180day: ai.average180day, sofr_index: ai.index } : null,
    other_rates: other, as_of: now.toISOString(), source: SOURCE, more: more(),
  };
}

export async function rateHistory(f: FetchText, a: { rate: string; start?: string; end?: string }, now = new Date()) {
  const key = rateKey(a.rate);
  const spec = RATES[key];
  const end = checkDate(a.end, 'end', now, spec.first) ?? today(now);
  const start = checkDate(a.start, 'start', now, spec.first) ?? addDays(end, -90);
  if (start > end) throw new InputError(`start ${start} is after end ${end}`);
  if ((Date.parse(end) - Date.parse(start)) / 86400000 > 5 * 366) throw new InputError('a range can cover at most 5 years per call');
  const rows = await search(f, spec.group, spec.type, start, end, now);
  const pts = rows.map((r) => ({ date: r.effectiveDate, value: key === 'prime' ? primeOf(r) : key === 'fed_funds_upper' ? upper(r) : (r[spec.field] as number | undefined) }))
    .filter((p): p is { date: string; value: number } => typeof p.value === 'number');
  if (!pts.length) throw new UpstreamError(`no ${spec.label} values between ${start} and ${end}`);
  const vals = pts.map((p) => p.value);
  const hi = pts.reduce((m, p) => (p.value > m.value ? p : m)), lo = pts.reduce((m, p) => (p.value < m.value ? p : m));
  const avg = round(vals.reduce((s, v) => s + v, 0) / vals.length);
  const step = Math.max(1, Math.ceil(pts.length / 60));
  const table = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const first = pts[0], last = pts[pts.length - 1];
  const summary = `${spec.label} ${first.date} to ${last.date}: ${pts.length} business days, ${first.value} to ${last.value} (${bp(last.value - first.value)}), ` +
    `high ${hi.value} on ${hi.date}, low ${lo.value} on ${lo.date}, average ${avg}.`;
  return { summary, rate: key, label: spec.label, start, end, days: pts.length, first, last, change_bp: Math.round((last.value - first.value) * 100), high: hi, low: lo, average: avg,
    table_sampling: step === 1 ? 'every business day' : `every ${step}th business day`, table, as_of: now.toISOString(), source: SOURCE, more: more() };
}

export async function fedRateChanges(f: FetchText, a: { since?: string }, now = new Date()) {
  const since = checkDate(a.since, 'since', now) ?? addDays(today(now), -5 * 366);
  const rows = await search(f, 'unsecured', 'effr', since, today(now), now);
  if (!rows.length) throw new UpstreamError(`no EFFR rows since ${since}`);
  const changes = targetChanges(rows);
  const cuts = changes.filter((c) => c.direction === 'cut'), hikes = changes.filter((c) => c.direction === 'hike');
  const lastRow = rows[rows.length - 1];
  const summary = `Fed funds target changes since ${since}: ${changes.length} (${cuts.length} cuts, ${hikes.length} hikes). ` +
    `Current target ${range(lastRow)}, prime ${primeOf(lastRow)?.toFixed(2)}% (as of ${lastRow.effectiveDate}).` +
    (changes.length ? `\n${[...changes].reverse().slice(0, 30).map((c) => `${c.effective} ${c.direction} ${Math.abs(c.change_bp)}bp to ${c.to}, prime ${c.prime_after.toFixed(2)}%`).join('\n')}` : '');
  return { summary, since, current_target: range(lastRow), current_prime: primeOf(lastRow) ?? null, as_of_date: lastRow.effectiveDate, count: changes.length, cuts: cuts.length, hikes: hikes.length,
    changes: [...changes].reverse(), note: 'Dates are the first business day the new target was in effect (the day after the FOMC announcement).', as_of: now.toISOString(), source: SOURCE, more: more() };
}

export function payment(principal: number, annualPct: number, months: number): number {
  const r = annualPct / 100 / 12;
  return r === 0 ? principal / months : (principal * r) / (1 - (1 + r) ** -months);
}

const INDEX: Record<string, string> = { prime: 'Prime rate', sofr: 'SOFR (overnight)', sofr_30day_average: '30-day average SOFR', sofr_90day_average: '90-day average SOFR', sofr_180day_average: '180-day average SOFR', fed_funds: 'Effective federal funds rate' };

export async function loanRate(f: FetchText, a: { index: string; margin_percent: number; amount?: number; years?: number; floor_percent?: number; cap_percent?: number }, now = new Date()) {
  const idx = String(a.index ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  if (!INDEX[idx]) throw new InputError(`index must be one of ${Object.keys(INDEX).join(', ')}`);
  if (typeof a.margin_percent !== 'number' || !Number.isFinite(a.margin_percent) || a.margin_percent < -5 || a.margin_percent > 25) throw new InputError('margin_percent must be a number from -5 to 25 (percentage points over the index)');
  if (a.amount !== undefined && (!(a.amount > 0) || a.amount > 1e10)) throw new InputError('amount must be a positive number of dollars');
  if (a.years !== undefined && (!(a.years > 0) || a.years > 40)) throw new InputError('years must be more than 0 and at most 40');
  const all = await latestAll(f);
  let value: number | undefined, date = '';
  if (idx === 'prime') { const e = find(all, 'EFFR'); value = e && primeOf(e); date = e?.effectiveDate ?? ''; }
  else if (idx === 'sofr') { const s = find(all, 'SOFR'); value = s?.percentRate; date = s?.effectiveDate ?? ''; }
  else if (idx === 'fed_funds') { const e = find(all, 'EFFR'); value = e?.percentRate; date = e?.effectiveDate ?? ''; }
  else { const s = find(all, 'SOFRAI'); value = s?.[RATES[idx].field] as number | undefined; date = s?.effectiveDate ?? ''; }
  if (value === undefined) throw new UpstreamError(`no ${INDEX[idx]} in the New York Fed answer`);
  let rate = round(value + a.margin_percent);
  const notes: string[] = [];
  if (a.floor_percent !== undefined && rate < a.floor_percent) { notes.push(`floor ${a.floor_percent}% applies`); rate = a.floor_percent; }
  if (a.cap_percent !== undefined && rate > a.cap_percent) { notes.push(`cap ${a.cap_percent}% applies`); rate = a.cap_percent; }
  let pay: Record<string, number> | null = null;
  if (a.amount !== undefined) {
    const months = Math.round((a.years ?? 10) * 12);
    const m = payment(a.amount, rate, months);
    pay = { amount: a.amount, months, monthly_payment: Math.round(m * 100) / 100, total_interest: Math.round((m * months - a.amount) * 100) / 100, first_month_interest: Math.round(a.amount * rate / 1200 * 100) / 100 };
  }
  const summary = `${INDEX[idx]} ${Number(value.toFixed(5))}% (${date}) + margin ${a.margin_percent} = ${Number(rate.toFixed(5))}% per year${notes.length ? ` (${notes.join(', ')})` : ''}.` +
    (pay ? ` On $${pay.amount.toLocaleString('en-US')} over ${pay.months} months: $${pay.monthly_payment.toLocaleString('en-US', { minimumFractionDigits: 2 })} a month, $${pay.total_interest.toLocaleString('en-US', { minimumFractionDigits: 2 })} total interest if the rate never changes.` : '') +
    ' A variable rate resets when the index moves.';
  return { summary, index: idx, index_label: INDEX[idx], index_value: value, index_date: date, margin_percent: a.margin_percent, rate_percent: rate, notes, payment: pay,
    as_of: now.toISOString(), source: SOURCE, more: more() };
}
