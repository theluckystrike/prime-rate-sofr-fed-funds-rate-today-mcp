// Tool registry shared by the stdio and Worker entries.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { InputError, REPO, SITE, RATES, fedFundsToday, fedRateChanges, loanRate, rateHistory, sofrToday } from './core.js';
import type { FetchText } from './types.js';

export const VERSION = '1.0.0';

export const META = {
  alias: 'prime-sofr-rates',
  metaDescription: 'MCP server for the prime rate, SOFR and the fed funds rate today: the federal funds target range, effective fed funds rate, prime rate, SOFR and its averages, rate history, every Fed rate change and a prime or SOFR plus margin loan rate calculator.',
  intro: 'The prime rate, SOFR and the fed funds rate today for AI assistants, read live from the Federal Reserve Bank of New York reference rates.',
};

export const TOOL_INFO = [
  { name: 'fed_funds_rate_today', blurb: 'The federal funds target range, the effective fed funds rate, the prime rate it implies, and the last Fed rate change.' },
  { name: 'sofr_rate_today', blurb: 'Today\'s SOFR with the change from the previous business day, the 30, 90 and 180 day SOFR averages, the SOFR Index, and TGCR, BGCR, OBFR and EFFR.' },
  { name: 'interest_rate_history', blurb: 'History of SOFR, a SOFR average, the effective fed funds rate, OBFR, TGCR, BGCR, the fed funds target or the prime rate between two dates.' },
  { name: 'fed_rate_changes', blurb: 'Every Fed rate cut and hike since a date (back to 2000), with the new target range and the prime rate after each.' },
  { name: 'loan_rate_calculator', blurb: 'All-in variable rate for prime or SOFR plus a margin (an SBA 7(a) loan, a line of credit, a commercial loan), with an optional monthly payment.' },
];

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

function ok(data: Record<string, unknown> & { summary: string }) {
  return { content: [{ type: 'text' as const, text: `${data.summary}\n\n${JSON.stringify(data, null, 2)}` }], structuredContent: data };
}
function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: 'text' as const, text: `${e instanceof InputError ? 'Error' : 'Upstream New York Fed error'}: ${msg}` }] };
}
const wrap = <A>(fn: (a: A) => unknown) => async (a: A) => { try { return ok((await fn(a)) as any); } catch (e) { return fail(e); } };
const date = (d: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe(d);

export function createServer(fetchText: FetchText): McpServer {
  const server = new McpServer({ name: REPO, version: VERSION, websiteUrl: SITE } as any, {
    instructions:
      'US benchmark interest rates read at call time from the Federal Reserve Bank of New York: the fed funds target range and effective rate, SOFR and its averages. ' +
      'A model cannot know today\'s rates or the latest Fed decision. Use fed_funds_rate_today for "fed funds rate today", "prime rate today" or "did the Fed cut rates", ' +
      'sofr_rate_today for SOFR, interest_rate_history for how a rate moved, fed_rate_changes for the list of cuts and hikes, and loan_rate_calculator for prime or SOFR plus a margin. ' +
      'The prime rate is derived as the top of the target range plus 3 points (the Wall Street Journal Prime Rate convention).',
  });

  server.registerTool('fed_funds_rate_today', {
    title: 'Fed funds rate and prime rate today',
    description:
      'The current federal funds target range set by the FOMC, the effective federal funds rate (EFFR) for the latest business day with its change and volume, ' +
      'the prime rate (top of the range plus 3 points), and the last Fed rate change with every change in the last 3 years.',
    inputSchema: {},
    annotations: { title: 'Fed funds rate today', ...RO },
  }, wrap(() => fedFundsToday(fetchText)));

  server.registerTool('sofr_rate_today', {
    title: 'SOFR rate today',
    description:
      'The latest Secured Overnight Financing Rate (SOFR) with the change from the previous business day, percentiles and volume, the 30, 90 and 180 day SOFR ' +
      'averages and SOFR Index (used to price SOFR loans), and the other New York Fed reference rates: TGCR, BGCR, OBFR and EFFR.',
    inputSchema: {},
    annotations: { title: 'SOFR rate today', ...RO },
  }, wrap(() => sofrToday(fetchText)));

  server.registerTool('interest_rate_history', {
    title: 'Interest rate history',
    description:
      'History of one reference rate between two dates (up to 5 years per call): start, end, change in basis points, high, low and average, with a daily or ' +
      `sampled table. Rates: ${Object.keys(RATES).join(', ')}. EFFR and prime back to 2000, SOFR back to 2018-04-02.`,
    inputSchema: {
      rate: z.string().min(2).max(40).describe(`One of ${Object.keys(RATES).join(', ')}.`),
      start: date('YYYY-MM-DD. Default 90 days before end.'),
      end: date('YYYY-MM-DD. Default today.'),
    },
    annotations: { title: 'Interest rate history', ...RO },
  }, wrap((a: any) => rateHistory(fetchText, a)));

  server.registerTool('fed_rate_changes', {
    title: 'Fed rate cuts and hikes',
    description:
      'Every change to the federal funds target since a date (default the last 5 years, back to 2000): the date it took effect, cut or hike, basis points, ' +
      'the new target range and the prime rate after it. Answers "when did the Fed last cut rates".',
    inputSchema: { since: date('YYYY-MM-DD, back to 2000-07-03. Default 5 years ago.') },
    annotations: { title: 'Fed rate changes', ...RO },
  }, wrap((a: any) => fedRateChanges(fetchText, a)));

  server.registerTool('loan_rate_calculator', {
    title: 'Prime or SOFR plus margin loan rate',
    description:
      'The all-in variable rate today for a loan priced at an index plus a margin, such as an SBA 7(a) loan at prime + 2.75, a business line of credit at prime + 1 ' +
      'or a commercial loan at 30-day average SOFR + 2.5, with an optional floor or cap and the monthly payment for an amount and term.',
    inputSchema: {
      index: z.enum(['prime', 'sofr', 'sofr_30day_average', 'sofr_90day_average', 'sofr_180day_average', 'fed_funds']).describe('The rate index the loan is priced on.'),
      margin_percent: z.number().min(-5).max(25).describe('Percentage points over the index, e.g. 2.75.'),
      amount: z.number().positive().optional().describe('Loan amount in dollars, for a monthly payment.'),
      years: z.number().positive().max(40).optional().describe('Amortization term in years. Default 10.'),
      floor_percent: z.number().optional().describe('Rate floor in percent, if the loan has one.'),
      cap_percent: z.number().optional().describe('Rate cap in percent, if the loan has one.'),
    },
    annotations: { title: 'Loan rate calculator', ...RO },
  }, wrap((a: any) => loanRate(fetchText, a)));

  return server;
}
