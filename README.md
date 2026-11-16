# Natural Gas Shock Monitor

A research page on one hypothesis: Henry Hub natural gas rallies in the month before the S&P 500 tops out ahead of its biggest falls (15% or more). Every major decline since 2001, measured against what gas does on an ordinary day.

## Findings so far

| Test | Result |
|---|---|
| Gas rose in the month before every major decline | **Supported:** 7 of 7, against 44% of all months (p = 0.002) |
| The rallies were unusually large | Not supported: median +3.3% (p = 0.21) |
| A bigger rally means a deeper crash | Not supported: r = 0.02 |
| A gas rally warns of a crash in real time | Not supported: 20% vs 16% base rate after a 20%+ monthly gain (p = 0.46) |

Gas does rise before major crashes, but not by enough to warn you. The likeliest reading: gas rallies with everything else late in a bull market.

## Model

- **Major declines:** S&P 500 closes 15%+ below a closing high. An episode ends at a new high or after a 25% rally off its low, so corrections inside a long bear count too.
- **Gas run-up:** front-month Henry Hub (NG=F) over the 21 trading days to the peak, roll-adjusted (the day the series switches contract is dropped).
- **Forward test:** on every day, the past-month gas move in fixed buckets (−10/0/+10/+20%) against how often a 15%+ fall followed within 6 months. Fixed buckets keep the future out.
- **Inference:** p-values from circular shifts of the event dates, correlations from permutation tests.

The site is laid out as a short paper: the 25-year record, one chart per crash, the average gas path into the peaks, a calendar of every month, run-up size against crash depth, the real-time test, and a verdict table. All text is computed from the data.

## Run

```bash
pip install -r requirements.txt
python fetch_data.py          # rebuilds natgas_data.json from Yahoo Finance
python -m http.server 8000    # then open http://localhost:8000
```

A GitHub Action refreshes the data after the US close on trading days.

Not investment advice.
