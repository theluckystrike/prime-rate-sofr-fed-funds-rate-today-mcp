# prime-rate-sofr-fed-funds-rate-today-mcp

The prime rate, SOFR and the fed funds rate today for AI assistants. Ask what the prime rate is, what SOFR printed yesterday, when the Fed last cut rates, or what an SBA loan at prime + 2.75 costs this month.

This is a Model Context Protocol (MCP) server. It reads the Federal Reserve Bank of New York reference rates (Markets Data API) at call time. It needs no API key.

## Tools

| Tool | What it returns |
| --- | --- |
| `fed_funds_rate_today` | The FOMC federal funds target range, the effective fed funds rate for the latest business day, the prime rate it implies, and the last Fed rate change with every change in the last 3 years. |
| `sofr_rate_today` | The latest SOFR with its change, percentiles and volume, the 30, 90 and 180 day SOFR averages and SOFR Index, plus TGCR, BGCR, OBFR and EFFR. |
| `interest_rate_history` | One rate between two dates, up to 5 years per call: start, end, change, high, low, average and a table. SOFR, SOFR averages, EFFR, OBFR, TGCR, BGCR, the fed funds target and prime. |
| `fed_rate_changes` | Every Fed rate cut and hike since a date (back to 2000) with the new target range and the prime rate after each. |
| `loan_rate_calculator` | The all-in rate for prime or SOFR plus a margin, with an optional floor or cap and the monthly payment for an amount and term. |

Every result has structured JSON, a plain-text summary, `as_of`, `source` and `more` (a page on [mcpstamp.com](https://www.mcpstamp.com/servers/?utm_source=mcp&utm_medium=prime-rate-sofr-fed-funds-rate-today-mcp)). Every tool is marked read-only.

## What it knows that your model does not

- Today's numbers. The New York Fed publishes SOFR and EFFR at about 8 am ET for the previous business day.
- The latest FOMC decision, read from the target range carried on every EFFR row, so a cut or hike shows up the day it takes effect.
- The prime rate by the rule banks follow: the top of the fed funds target range plus 3 percentage points.

## Install

### Hosted (custom connector, ChatGPT developer mode, any remote MCP client)

Paste this URL. No token, no sign-up.

```
https://prime-rate-sofr-fed-funds-rate-today-mcp.lipmichal.workers.dev/mcp
```

### Cursor

Add to `~/.cursor/mcp.json`.

```json
{
  "mcpServers": {
    "prime-sofr-rates": { "url": "https://prime-rate-sofr-fed-funds-rate-today-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`.

```json
{
  "servers": {
    "prime-sofr-rates": { "type": "http", "url": "https://prime-rate-sofr-fed-funds-rate-today-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### Local stdio

The npm package is not published. Build it from this repository with Node 20 or newer, then point your MCP client at `node /path/to/prime-rate-sofr-fed-funds-rate-today-mcp/dist/stdio.js`.

```
git clone https://github.com/theluckystrike/prime-rate-sofr-fed-funds-rate-today-mcp && cd prime-rate-sofr-fed-funds-rate-today-mcp
npm install && npm run build
node dist/stdio.js
```

## Example prompts

- "What is the prime rate today?"
- "What is SOFR today, and what is the 30-day average SOFR?"
- "When did the Fed last cut interest rates, and by how much?"
- "What is the rate on an SBA 7(a) loan at prime + 2.75, and the monthly payment on $250,000 over 10 years?"
- "How has SOFR moved since October 1?"

## Data sources

Full list in [DATA_SOURCES.md](DATA_SOURCES.md).

- [Federal Reserve Bank of New York reference rates](https://www.newyorkfed.org/markets/reference-rates) through the [Markets Data API](https://markets.newyorkfed.org/static/docs/markets-api.html): SOFR, EFFR, OBFR, TGCR, BGCR and the SOFR averages and index.

## Limitations

- The prime rate is derived (target top + 3), not read from a bank. Individual banks may set their own prime.
- Term SOFR (CME) is a licensed rate and is not included; the SOFR averages are the New York Fed's compounded in-arrears averages.
- Rates are for the previous business day; there are no intraday quotes.
- Loan payments assume a fixed rate for the whole term. A variable-rate loan resets when the index moves.

## More

More MCP servers that answer questions your assistant cannot answer alone are on [mcpstamp.com](https://www.mcpstamp.com/servers/?utm_source=mcp&utm_medium=prime-rate-sofr-fed-funds-rate-today-mcp).

Part of the Zovo MCP collection at https://mcp.zovo.one

Built by [theluckystrike](https://github.com/theluckystrike).

## Development

```
npm install
npm test                              # builds, then runs the fixture tests and an offline stdio test
node scripts/stdio-transcript.mjs     # live stdio round trip, writes .live/stdio-transcript.jsonl
```

CI (`.github/workflows/bundle.yml`) runs the tests, the type check and `wrangler deploy --dry-run --outdir out`, and uploads the Worker bundle as an artifact.

## License

MIT
