# Natural Gas Shock Monitor

Do sharp spikes in Henry Hub natural gas lead S&P 500 drawdowns? An event study on daily data since 2001, with the current state of the signal and the full record of what followed each spike.

Short answer so far: no as a forward signal. After a spike the S&P 500 does about what it does on any other day, and the gap is well within chance.

The reverse view, starting from each S&P 500 correction (10%+) since 2001, finds one thing worth watching: gas rose in the month before 9 of the 10 peaks, against 44% of all months. Over three to six months, and in terms of outright spikes, there is nothing. Ten peaks and many tests make this a lead, not proof.

## Model

- **Signal:** 5-day return of the front-month future (NG=F) of at least 2.5 trailing standard deviations. Returns are roll-adjusted: the day the series switches contract is dropped, because the gap between two contracts is not a price move. One event per 21 trading days.
- **No look-ahead:** volatility uses only earlier days, an event date never moves once it has fired, and S&P returns start at the event-day close. The threshold was fixed before looking at outcomes.
- **Baseline and control:** every result is compared with all days, and with days at the same VIX level, since high VIX on its own goes with weak returns.
- **Reverse study:** S&P 500 corrections (10%+ from a closing high; an episode ends at a new high or a 25% rally off its low) and the gas move 1 week to 6 months before each peak, against all days.
- **Inference:** spikes cluster and forward windows overlap, so p-values come from circular shifts of the event dates (placebo tests that keep the clustering), not from a t-test.

The site shows the latest reading, the average S&P path around a spike against a placebo band, gas history with every spike marked, forward returns and drawdown rates at 1, 3 and 6 months, the average gas path into every S&P peak, a table of every correction with the gas move before it, the same test under other thresholds and sub-periods, and a table of every event.

## Run

```bash
pip install -r requirements.txt
python fetch_data.py          # rebuilds natgas_data.json from Yahoo Finance
python -m http.server 8000    # then open http://localhost:8000
```

A GitHub Action refreshes the data after the US close on trading days.

Not investment advice.
