// Fixtures in test/fixtures/ are New York Fed Markets API answers downloaded 2026-11-16: rates/all/latest, EFFR 2024-01-01 to
// 2026-11-16, SOFR and SOFRAI 2026-10-01 to 2026-11-16. Values read off those files: EFFR 3.88 on 2026-11-13 with target range
// 3.75 to 4.00 (so prime 7.00), SOFR 3.90 on 2026-11-13 and 2026-11-12; SOFRAI published 2026-11-16: 30-day 3.91831, 90-day 3.82858,
// 180-day 3.74938, index 1.26729374. Target changes in the EFFR file: cuts effective 2024-09-19 (50 bp), 2024-11-08, 2024-12-19,
// 2025-09-18, 2025-10-30, 2025-12-11 (25 bp each), and a 25 bp hike effective 2026-09-17 to 3.75-4.00.
// SOFR 2026-10-01 to 2026-11-13: 30 days, 3.87 to 3.90, high 3.97 on 2026-11-03, low 3.87 on 2026-10-01, average 3.9033.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import {
  rateKey, targetChanges, primeOf, payment, fedFundsToday, sofrToday, rateHistory, fedRateChanges, loanRate, InputError, UpstreamError, UTM,
} from '../dist/core.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const SEARCH = { effr: fx('effr-2024-01-01-2026-11-16.json'), sofr: fx('sofr-2026-10-01-2026-11-16.json'), sofrai: fx('sofrai-2026-10-01-2026-11-16.json') };
const seen = [];
const f = async (u) => {
  seen.push(u);
  if (u === 'https://markets.newyorkfed.org/api/rates/all/latest.json') return fx('all-latest.json');
  const m = /^https:\/\/markets\.newyorkfed\.org\/api\/rates\/(secured|unsecured)\/([a-z]+)\/search\.json\?startDate=(\d{4}-\d{2}-\d{2})&endDate=(\d{4}-\d{2}-\d{2})$/.exec(u);
  if (m && SEARCH[m[2]]) {
    const rows = JSON.parse(SEARCH[m[2]]).refRates.filter((r) => r.effectiveDate >= m[3] && r.effectiveDate <= m[4]);
    return JSON.stringify({ refRates: rows });
  }
  throw new Error(`HTTP 404 (no fixture for ${u})`);
};
const NOW = new Date('2026-11-16T15:00:00Z');

test('rate names, prime rule and the payment formula', () => {
  assert.equal(rateKey('SOFR'), 'sofr'); assert.equal(rateKey('fed funds'), 'effr'); assert.equal(rateKey('prime rate'), 'prime'); assert.equal(rateKey('sofr 30day average'), 'sofr_30day_average');
  assert.throws(() => rateKey('libor'), InputError);
  assert.equal(primeOf({ targetRateFrom: 3.75, targetRateTo: 4 }), 7); assert.equal(primeOf({ targetRateFrom: 5.25 }), 8.25);
  assert.equal(Math.round(payment(250000, 9.75, 120) * 100) / 100, 3269.26); assert.equal(payment(1200, 0, 12), 100);
});

test('target changes from EFFR rows: six cuts then a hike, first day in effect', () => {
  const rows = JSON.parse(SEARCH.effr).refRates.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  const c = targetChanges(rows);
  assert.deepEqual(c.map((x) => [x.effective, x.direction, x.change_bp]), [
    ['2024-09-19', 'cut', -50], ['2024-11-08', 'cut', -25], ['2024-12-19', 'cut', -25], ['2025-09-18', 'cut', -25], ['2025-10-30', 'cut', -25], ['2025-12-11', 'cut', -25], ['2026-09-17', 'hike', 25],
  ]);
  assert.equal(c[6].to, '3.75-4.00%'); assert.equal(c[6].prime_after, 7);
});

test('fed funds today: range 3.75-4.00, EFFR 3.88, prime 7.00, last change a 25 bp hike effective 2026-09-17', async () => {
  const r = await fedFundsToday(f, {}, NOW);
  assert.deepEqual(r.target_range, { lower: 3.75, upper: 4 }); assert.equal(r.effective_federal_funds_rate, 3.88); assert.equal(r.prime_rate, 7); assert.equal(r.as_of_date, '2026-11-13');
  assert.equal(r.last_change.effective, '2026-09-17'); assert.equal(r.last_change.direction, 'hike'); assert.equal(r.changes_last_3_years.length, 7);
  assert.match(r.summary, /^Federal funds target range 3\.75-4\.00% \(as of 2026-11-13\)\. Effective federal funds rate 3\.88% \(\+0bp vs 2026-11-12\)/);
  assert.match(r.summary, /Prime rate 7\.00%/); assert.ok(r.more.includes(UTM));
});

test('SOFR today: 3.90 on 2026-11-13, unchanged from 2026-11-12, averages and index from SOFRAI', async () => {
  const r = await sofrToday(f, {}, NOW);
  assert.deepEqual(r.sofr, { date: '2026-11-13', percent: 3.9, percentile_1: 3.85, percentile_99: 3.97, volume_billions: 3092 });
  assert.deepEqual(r.previous, { date: '2026-11-12', percent: 3.9 });
  assert.deepEqual(r.averages, { published: '2026-11-16', average_30day: 3.91831, average_90day: 3.82858, average_180day: 3.74938, sofr_index: 1.26729374 });
  assert.deepEqual(r.other_rates.map((o) => o.rate), ['TGCR', 'BGCR', 'OBFR', 'EFFR']);
  assert.match(r.summary, /^SOFR 3\.9% for 2026-11-13 \(\+0bp vs 2026-11-12\)/);
});

test('rate history: SOFR 2026-10-01 to 2026-11-13 and prime over 2024', async () => {
  const r = await rateHistory(f, { rate: 'sofr', start: '2026-10-01', end: '2026-11-13' }, NOW);
  assert.equal(r.days, 30); assert.deepEqual(r.first, { date: '2026-10-01', value: 3.87 }); assert.deepEqual(r.last, { date: '2026-11-13', value: 3.9 });
  assert.equal(r.change_bp, 3); assert.deepEqual(r.high, { date: '2026-11-03', value: 3.97 }); assert.deepEqual(r.low, { date: '2026-10-01', value: 3.87 }); assert.equal(r.average, 3.9033);
  const p = await rateHistory(f, { rate: 'prime', start: '2024-01-01', end: '2024-12-31' }, NOW);
  assert.equal(p.first.value, 8.5); assert.equal(p.last.value, 7.5); assert.equal(p.change_bp, -100); assert.ok(p.table.length <= 61);
  const a = await rateHistory(f, { rate: 'sofr_30day_average', start: '2026-11-16', end: '2026-11-16' }, NOW);
  assert.equal(a.last.value, 3.91831);
});

test('Fed rate changes since 2025-01-01: three cuts and one hike, newest first', async () => {
  const r = await fedRateChanges(f, { since: '2025-01-01' }, NOW);
  assert.equal(r.count, 4); assert.equal(r.cuts, 3); assert.equal(r.hikes, 1); assert.equal(r.changes[0].effective, '2026-09-17'); assert.equal(r.current_prime, 7);
  assert.match(r.summary, /2025-12-11 cut 25bp to 3\.50-3\.75%, prime 6\.75%/);
});

test('loan rate: prime + 2.75 = 9.75%, $250,000 over 10 years is $3,269.26 a month; SOFR 30-day average + 2.5 with a floor', async () => {
  const r = await loanRate(f, { index: 'prime', margin_percent: 2.75, amount: 250000, years: 10 }, NOW);
  assert.equal(r.index_value, 7); assert.equal(r.rate_percent, 9.75); assert.equal(r.payment.monthly_payment, 3269.26); assert.equal(r.payment.total_interest, 142310.73);
  assert.equal(r.payment.first_month_interest, 2031.25);
  const s = await loanRate(f, { index: 'sofr_30day_average', margin_percent: 2.5, floor_percent: 6.5 }, NOW);
  assert.equal(s.index_value, 3.91831); assert.equal(s.rate_percent, 6.5); assert.deepEqual(s.notes, ['floor 6.5% applies']); assert.equal(s.payment, null);
});

test('input errors and upstream errors', async () => {
  await assert.rejects(rateHistory(f, { rate: 'sofr', start: '2017-01-01' }, NOW), InputError);
  await assert.rejects(rateHistory(f, { rate: 'sofr', start: '2026-11-13', end: '2026-10-01' }, NOW), InputError);
  await assert.rejects(rateHistory(f, { rate: 'effr', start: '2010-01-01', end: '2026-11-13' }, NOW), InputError);
  await assert.rejects(rateHistory(f, { rate: 'sofr', end: '2027-01-01' }, NOW), InputError);
  await assert.rejects(rateHistory(f, { rate: 'sofr', start: '2026-02-30' }, NOW), InputError);
  await assert.rejects(rateHistory(f, { rate: 'sofr', start: '2026-09-01', end: '2026-09-10' }, NOW), UpstreamError);
  await assert.rejects(loanRate(f, { index: 'libor', margin_percent: 2 }, NOW), InputError);
  await assert.rejects(loanRate(f, { index: 'prime', margin_percent: 30 }, NOW), InputError);
  await assert.rejects(fedFundsToday(async () => '<html>', {}, NOW), UpstreamError);
});

test('stdio: initialize, tools/list with annotations and a tools/call error over JSON-RPC (offline)', async () => {
  const child = spawn(process.execPath, [new URL('../dist/stdio.js', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = []; let buf = '';
  const got = (id) => new Promise((res) => { const iv = setInterval(() => { const m = lines.find((l) => l.id === id); if (m) { clearInterval(iv); res(m); } }, 10); });
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  assert.equal((await got(1)).result.serverInfo.name, 'prime-rate-sofr-fed-funds-rate-today-mcp');
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list' });
  const tools = (await got(2)).result.tools;
  assert.deepEqual(tools.map((t) => t.name), ['fed_funds_rate_today', 'sofr_rate_today', 'interest_rate_history', 'fed_rate_changes', 'loan_rate_calculator']);
  for (const t of tools) { assert.ok(t.title); assert.equal(t.annotations.readOnlyHint, true); assert.equal(t.annotations.destructiveHint, false); assert.equal(t.annotations.openWorldHint, true); }
  send({ id: 3, method: 'tools/call', params: { name: 'interest_rate_history', arguments: { rate: 'libor' } } });
  const r3 = await got(3);
  child.kill();
  assert.equal(r3.result?.isError ?? Boolean(r3.error), true);
});
