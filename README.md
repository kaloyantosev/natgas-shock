# Natural Gas Shock Monitor

Hypothesis: natural gas rallies in the month before the S&P 500 tops out ahead of a correction (a fall of 10% or more). The site tests it on every correction since 2001 and shows where gas stands today.

## Findings so far

- **Direction holds:** gas rose in the month before 9 of the 10 corrections since 2001, against 44% of all months (p = 0.004).
- **Size does not:** only 5 of those run-ups exceeded 5%, and the size of the run-up has no correlation with how deep the fall was (r = 0.07) or how long it took.
- **In real time:** after gas gained 20%+ in a month, a 10%+ S&P fall followed within 3 months 27% of the time, against 16% for all days (p = 0.05). Smaller moves told you nothing.

Ten corrections and several tests make this a lead, not proof. Stocks rally into a peak, and commodities tend to rise in the same risk-on mood.

## Model

- **Corrections:** S&P 500 closes 10%+ below a closing high. An episode ends at a new high or after a 25% rally off its low, so corrections inside a long bear count too.
- **Gas run-up:** front-month Henry Hub (NG=F) over the 21 trading days to the peak, roll-adjusted (the day the series switches contract is dropped).
- **Forward test:** on every day, the past-month gas move in fixed buckets (−10/0/+10/+20%) against how often a 10%+ fall followed within 3 months. Fixed buckets keep the future out.
- **Inference:** p-values from circular shifts of the event dates, correlations from permutation tests.

The site shows today's reading, the forward test, the average gas path into S&P peaks, one chart per correction, and the run-up against the depth of each fall.

## Run

```bash
pip install -r requirements.txt
python fetch_data.py          # rebuilds natgas_data.json from Yahoo Finance
python -m http.server 8000    # then open http://localhost:8000
```

A GitHub Action refreshes the data after the US close on trading days.

Not investment advice.
