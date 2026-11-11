"""
Natural Gas Shock Monitor: data pipeline
========================================
Builds natgas_data.json from Yahoo Finance daily closes (NG=F, ^GSPC, ^VIX):
    pip install -r requirements.txt && python fetch_data.py

The question: after a sharp spike in Henry Hub natural gas, does the S&P 500 do
worse than usual? This is an event study, not a trading system.

Design rules
  * One pre-specified signal. A spike is a 5-day gas return of at least Z_SPIKE
    trailing standard deviations. The threshold was fixed before looking at
    outcomes; other thresholds are reported next to it, not picked from.
  * Roll-adjusted. NG=F is an unadjusted front-month series, so the day it
    switches contract shows the curve spread as a fake price move. Those daily
    returns are dropped.
  * No look-ahead. Volatility uses only earlier days, an event date never moves
    once it has fired, and forward returns start at the event-day close.
  * Always against a baseline. Every number is compared with all days, and with
    days at the same VIX level, because high VIX alone predicts weak returns.
  * Honest inference. Events cluster and forward windows overlap, so p-values
    come from circular shifts of the event dates, which keep both the clustering
    and the autocorrelation of the S&P intact.
"""

import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd

Z_SPIKE = 2.5                 # headline threshold, in trailing standard deviations
WINDOW = 5                    # trading days in the gas return
VOL_DAYS = 252                # trailing days used for volatility
REFRACTORY = 21               # trading days after an event before another can fire
HORIZONS = {"1m": 21, "3m": 63, "6m": 126}
DRAWDOWN = -5.0               # % fall from the event close that counts as a drawdown
VIX_EDGES = [15, 20, 30]      # VIX buckets: <15, 15-20, 20-30, >=30
PATH = (-21, 126)             # event-study window in trading days
OUT = "natgas_data.json"


# ── Fetch ────────────────────────────────────────────────────────────────────

def closes(ticker):
    import yfinance as yf
    df = yf.download(ticker, period="max", auto_adjust=False, progress=False)
    s = df["Close"]
    if isinstance(s, pd.DataFrame):
        s = s.iloc[:, 0]
    s = s.dropna()
    if len(s) < 1000:
        raise SystemExit(f"{ticker}: only {len(s)} rows from Yahoo, refusing to overwrite {OUT}")
    s.index = pd.to_datetime(s.index).tz_localize(None).normalize()
    return s


# ── Helpers ──────────────────────────────────────────────────────────────────

def roll_days(index):
    """Days whose return mixes two contracts: the second-to-last trading day of
    each month, the first day NG=F quotes the next contract (the old one expires
    on the third-to-last business day)."""
    s = pd.Series(index, index=index)
    days = set(s.groupby([index.year, index.month]).nth(-2))
    # shortcut: the current month is identified from the trading days seen so far,
    # so its roll day can be mislabelled until the month ends; the next run fixes it.
    last = index[-1]
    days -= {d for d in days if (d.year, d.month) == (last.year, last.month)}
    month = pd.bdate_range(last.replace(day=1), last + pd.offsets.MonthEnd(0))
    if len(month) >= 2 and month[-2] <= last:
        days.add(month[-2])
    return index.isin(list(days))


def find_events(signal, refractory=REFRACTORY):
    """Indices where the signal fires, skipping `refractory` days after each event.
    Causal: an event is never moved or replaced by a later, larger spike."""
    out, last = [], -10**9
    for i in np.flatnonzero(signal):
        if i - last > refractory:
            out.append(i)
            last = i
    return np.array(out, dtype=int)


def shift_test(x, events, lo, hi):
    """Mean of x on event days minus mean of x on all days in [lo, hi), with a
    two-sided p-value from every circular shift of the event dates."""
    events = events[(events >= lo) & (events < hi)]
    seg = x[lo:hi]
    n = len(seg)
    if len(events) == 0 or n < 2:
        return None, None, 0
    e = events - lo
    shifts = np.arange(n)[:, None]
    null = seg[(e[None, :] + shifts) % n].mean(axis=1)   # shift 0 is the actual sample
    diff = null[0] - seg.mean()
    p = float((np.abs(null - seg.mean()) >= abs(diff) - 1e-12).mean())
    return float(diff), p, len(events)


def rnd(x, n=2):
    return None if x is None or not np.isfinite(x) else round(float(x), n)


# ── Pipeline ─────────────────────────────────────────────────────────────────

def main():
    ng_raw = closes("NG=F")
    df = pd.DataFrame({"ng": ng_raw, "roll": roll_days(ng_raw.index)})
    df["ret"] = np.log(df["ng"]).diff().where(~df["roll"], 0.0)   # drop contract-switch returns
    df = df.join(closes("^GSPC").rename("sp"), how="inner").join(closes("^VIX").rename("vix"), how="inner")
    T = len(df)

    # Gas signal: 5-day roll-adjusted log return over the volatility known before the window.
    df["r5"] = df["ret"].rolling(WINDOW).sum()
    sigma = df["ret"].rolling(VOL_DAYS).std().shift(WINDOW)
    df["z"] = df["r5"] / (sigma * np.sqrt(WINDOW))
    z = df["z"].to_numpy()
    start = int(np.flatnonzero(np.isfinite(z))[0])

    # S&P outcomes from each day's close.
    sp = df["sp"].to_numpy()
    fwd, mdd = {}, {}
    for name, h in HORIZONS.items():
        f = np.full(T, np.nan)
        f[:T - h] = (sp[h:] / sp[:T - h] - 1) * 100
        fwd[name] = f
        low = pd.Series(sp).rolling(h).min().shift(-h).to_numpy()   # min close over t+1..t+h
        mdd[name] = np.minimum((low / sp - 1) * 100, 0)

    # VIX control: outcome minus the average outcome of all days in the same VIX bucket.
    bucket = np.digitize(df["vix"].to_numpy(), VIX_EDGES)

    def vix_adjusted(x, lo, hi):
        out = x.copy()
        for b in range(len(VIX_EDGES) + 1):
            m = (bucket == b) & (np.arange(T) >= lo) & (np.arange(T) < hi)
            if m.any():
                out[m] = x[m] - np.nanmean(x[m])
        return out

    events = find_events(z >= Z_SPIKE)

    def evaluate(ev, name, lo=start, hi=None):
        """Event-study row for one horizon over the days [lo, hi)."""
        h = HORIZONS[name]
        hi = min(hi or T, T - h)                 # only days whose outcome is known
        x, dd = fwd[name], (mdd[name] <= DRAWDOWN) * 100.0
        diff, p, n = shift_test(x, ev, lo, hi)
        adj, p_adj, _ = shift_test(vix_adjusted(x, lo, hi), ev, lo, hi)
        dd_diff, dd_p, _ = shift_test(dd, ev, lo, hi)
        dd_adj, dd_p_adj, _ = shift_test(vix_adjusted(dd, lo, hi), ev, lo, hi)
        e = ev[(ev >= lo) & (ev < hi)]
        return {
            "n": n,
            "ret_event": rnd(x[e].mean()) if n else None,
            "ret_all": rnd(x[lo:hi].mean()),
            "ret_diff": rnd(diff), "ret_p": rnd(p, 3),
            "ret_diff_vix": rnd(adj), "ret_p_vix": rnd(p_adj, 3),
            "dd_event": rnd(dd[e].mean(), 1) if n else None,
            "dd_all": rnd(dd[lo:hi].mean(), 1),
            "dd_diff": rnd(dd_diff, 1), "dd_p": rnd(dd_p, 3),
            "dd_diff_vix": rnd(dd_adj, 1), "dd_p_vix": rnd(dd_p_adj, 3),
        }

    results = [{"horizon": k, "days": h, **evaluate(events, k)} for k, h in HORIZONS.items()]

    # Robustness: other thresholds, sub-periods, and the rule the first version of this site used.
    def at(date):
        return int(df.index.searchsorted(pd.Timestamp(date)))

    raw5 = df["ng"].pct_change(5).to_numpy() * 100
    raw3 = df["ng"].pct_change(3).to_numpy() * 100
    old_rule = (raw5 >= 15) | (raw3 >= 12)
    variants = [
        (f"Headline: z ≥ {Z_SPIKE}", events, start, None),
        ("z ≥ 2.0", find_events(z >= 2.0), start, None),
        ("z ≥ 3.0", find_events(z >= 3.0), start, None),
        ("2001–2008", events, start, at("2009-01-01")),
        ("2009–2017 (shale glut)", events, at("2009-01-01"), at("2018-01-01")),
        ("2018–today", events, at("2018-01-01"), None),
        ("Old rule: +15% in 5d or +12% in 3d, not roll-adjusted", find_events(old_rule), start, None),
        ("Old rule and VIX ≥ 20", find_events(old_rule & (df["vix"].to_numpy() >= 20)), start, None),
    ]
    robustness = [{"label": label, **evaluate(ev, "3m", lo, hi)} for label, ev, lo, hi in variants]

    # Event-study path: average S&P move around a spike, against the same statistic
    # for shifted (placebo) event dates.
    k0, k1 = PATH
    lo, hi = max(start, -k0), T - k1
    e = events[(events >= lo) & (events < hi)] - lo
    n = hi - lo
    idx = (e[None, :] + np.arange(n)[:, None]) % n
    logsp = np.log(sp)
    path = []
    for k in range(k0, k1 + 1):
        col = (logsp[lo + k:hi + k] - logsp[lo:hi]) * 100
        null = col[idx].mean(axis=1)
        path.append({
            "k": k, "event": rnd(null[0]), "all": rnd(col.mean()),
            "lo": rnd(np.percentile(null, 5)), "hi": rnd(np.percentile(null, 95)),
        })

    event_rows = []
    for i in events:
        row = {
            "date": df.index[i].strftime("%Y-%m-%d"),
            "ng": rnd(df["ng"].iloc[i], 3),
            "ng_5d": rnd((np.exp(df["r5"].iloc[i]) - 1) * 100, 1),
            "z": rnd(z[i], 1),
            "vix": rnd(df["vix"].iloc[i], 1),
        }
        for name in HORIZONS:
            row[f"sp_{name}"] = rnd(fwd[name][i], 1)
        row["mdd_3m"] = rnd(mdd["3m"][i], 1)
        event_rows.append(row)

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "params": {
            "z_spike": Z_SPIKE, "window": WINDOW, "vol_days": VOL_DAYS, "refractory": REFRACTORY,
            "drawdown": DRAWDOWN, "vix_edges": VIX_EDGES,
        },
        "latest": {
            "date": df.index[-1].strftime("%Y-%m-%d"),
            "ng": rnd(df["ng"].iloc[-1], 3),
            "ng_5d": rnd((np.exp(df["r5"].iloc[-1]) - 1) * 100, 1),
            "z": rnd(z[-1]),
            "vix": rnd(df["vix"].iloc[-1], 1),
            "days_since_event": int(T - 1 - events[-1]) if len(events) else None,
            "last_event": event_rows[-1]["date"] if event_rows else None,
        },
        "sample": {"start": df.index[start].strftime("%Y-%m-%d"), "days": T - start, "events": len(events)},
        "results": results,
        "robustness": robustness,
        "path": path,
        "events": event_rows,
        "series": {
            "dates": [d.strftime("%Y-%m-%d") for d in df.index],
            "ng": [rnd(v, 3) for v in df["ng"]],
            "sp": [rnd(v, 1) for v in sp],
            "z": [rnd(v) for v in z],
        },
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))

    print(f"{out['sample']['events']} spikes over {out['sample']['days']} days, through {out['latest']['date']}")
    for r in results:
        print(f"  {r['horizon']}: S&P {r['ret_event']:+.2f}% after spikes vs {r['ret_all']:+.2f}% all days "
              f"(diff {r['ret_diff']:+.2f}, p={r['ret_p']}; VIX-adjusted {r['ret_diff_vix']:+.2f}, p={r['ret_p_vix']})")


def self_check():
    # refractory spacing is causal and strict
    sig = np.zeros(100, bool)
    sig[[10, 12, 31, 32, 60]] = True
    assert find_events(sig, 21).tolist() == [10, 32, 60]
    # events placed on the lowest values must be flagged; random ones must not
    rng = np.random.default_rng(0)
    x = rng.normal(size=3000)
    worst = np.sort(np.argsort(x)[:40])
    d, p, n = shift_test(x, worst, 0, len(x))
    assert n == 40 and d < -1 and p < 0.01
    _, p, _ = shift_test(x, np.sort(rng.choice(3000, 40, replace=False)), 0, len(x))
    assert p > 0.01
    # roll day = second-to-last trading day of a finished month
    idx = pd.bdate_range("2024-01-01", "2024-03-15")
    r = idx[roll_days(idx)]
    assert [d.strftime("%Y-%m-%d") for d in r] == ["2024-01-30", "2024-02-28"]


if __name__ == "__main__":
    self_check()
    main()
