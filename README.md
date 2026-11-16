# Natural Gas Shock Monitor

A research page on whether natural gas can play two roles for stock investors in the S&P 500's biggest falls (15% or more):

- **Leading indicator:** gas spikes (a 10%+ gain within 5 trading days) in the days and weeks before the S&P 500 peaks.
- **Hedge:** gas rises while the S&P 500 falls, from peak to low.

## Findings so far

Both roles appear in the record, but neither stands out from chance:

| Role | Test | Result |
|---|---|---|
| Leading indicator | Spike in the final week before the peak | 3 of 7 (2020, 2022, 2025) vs 19% of all days, p = 0.11 |
| Leading indicator | Spike in the final month | 4 of 7 vs 46% of all days, p = 0.66 |
| Leading indicator | Bigger spike, deeper crash | r = −0.27, p = 0.54 |
| Leading indicator | Spike raises crash odds in real time | No: 13% after a 20%+ spike vs 16% base rate |
| Hedge | Gas rose during the decline | 3 of 7 (2010, 2018, 2022); median −15% |
| Hedge | Gas rises in bad months for stocks | No: correlation with stocks −0.04 |

Gas looks more like an independent risk that occasionally pays off in a crisis (2022: +166% while stocks fell 25%) than a dependable hedge or warning.

## Model

- **Major declines:** S&P 500 closes 15%+ below a closing high. An episode ends at a new high or after a 25% rally off its low, so corrections inside a long bear count too.
- **Spike:** the largest 5-day gain in front-month Henry Hub gas (NG=F) inside the window before the peak, roll-adjusted (the day the series switches contract is dropped).
- **Hedge:** gas over the same days as each S&P fall from peak to low, against random windows of the same lengths.
- **Forward test:** on every day, the past month's biggest spike in fixed buckets (5/10/15/20%) against how often a 15%+ fall followed within 6 months. Fixed buckets keep the future out.
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
