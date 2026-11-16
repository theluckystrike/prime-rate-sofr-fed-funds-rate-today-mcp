# Data sources

All sources are public, keyless and read at call time. Test fixtures in `test/fixtures/` were downloaded on 2026-11-16.

| Data | URL | Notes |
|---|---|---|
| Latest reference rates | https://markets.newyorkfed.org/api/rates/all/latest.json | SOFR, EFFR (with the FOMC target range), OBFR, TGCR, BGCR and SOFRAI (30, 90 and 180 day averages and the SOFR Index). Fixture: EFFR 3.88 on 2026-11-13, range 3.75-4.00, SOFR 3.90. |
| Rate history | https://markets.newyorkfed.org/api/rates/{secured,unsecured}/{type}/search.json?startDate=&endDate= | EFFR back to 2000-07-03 (a single target before 2008-12-16), SOFR, TGCR and BGCR back to 2018-04-02, SOFR averages back to 2020-03-02. Fixtures: EFFR 2024-01-01 to 2026-11-16, SOFR and SOFRAI 2026-10-01 to 2026-11-16. |

The prime rate is derived as the top of the fed funds target range plus 3 percentage points, the rule the Wall Street Journal Prime Rate and the major banks have followed since 1994. Fed rate changes are the days the target range on the EFFR rows changed. The hosted server caches the latest rates for 15 minutes and closed history for a day. Source attribution: Federal Reserve Bank of New York (terms of use: https://www.newyorkfed.org/terms-of-use).
