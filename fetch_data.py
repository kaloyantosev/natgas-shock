"""
Natural Gas Shock Monitor: data pipeline
========================================
Builds natgas_data.json from Yahoo Finance daily closes (NG=F, ^GSPC):
    pip install -r requirements.txt && python fetch_data.py

The hypothesis: natural gas rallies in the month before the S&P 500 tops out
ahead of a correction (a fall of 10% or more). Tested two ways:
  1. Backward: date every correction since 2001 and look at gas in the month
     before each peak, against all days.
  2. Forward: on every day, bucket the past-month gas move and see how often a
     10%+ S&P fall followed within 3 months. Only this view is usable in real
     time, because peaks are only known in hindsight.

Design rules
  * Roll-adjusted. NG=F is an unadjusted front-month series, so the day it
    switches contract shows the curve spread as a fake price move. Those daily
    returns are dropped.
  * Fixed buckets (-10/0/10/20%), set before looking at outcomes, so no
    full-sample quantiles leak the future into the forward test.
  * Always against a baseline: every number sits next to the same number for
    all days.
  * p-values from circular shifts of the event dates, which keep clustering and
    the overlap of forward windows intact; correlations use permutation tests.
"""

import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd

RUNUP = 21                    # trading days of gas move before a peak (one month)
FWD = 63                      # forward window for the real-time test (three months)
CORRECTION = -10.0            # % S&P fall from a closing high that counts as a correction
REBOUND = 25.0                # % rally off a correction low that starts a new cycle
BUCKETS = [-10, 0, 10, 20]    # past-month gas move, % edges
START = 126                   # trading days of history before the sample starts
WINDOW = (-63, 21)            # per-correction chart: days before peak, days after trough
GAS_PATH = (-126, 63)         # average gas path around S&P peaks
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


def find_corrections(price, threshold):
    """(peak, trough, depth %) for every fall of at least `threshold` % from a closing
    high. An episode ends at a new high, or at a REBOUND rally off its low, so
    corrections inside a long bear (2010, 2011 under the 2007 high) count too."""
    out, peak, low, live = [], 0, 0, False
    for i, p in enumerate(price):
        if p > price[peak] or (live and p >= price[low] * (1 + REBOUND / 100)):
            if live:
                out.append((peak, low, (price[low] / price[peak] - 1) * 100))
            peak, low, live = i, i, False
        else:
            if p < price[low]:
                low = i
            live = live or (p / price[peak] - 1) * 100 <= threshold
    if live:
        out.append((peak, low, (price[low] / price[peak] - 1) * 100))
    return out


def event_path(level, events, start, k0, k1):
    """Average change of `level` (log) from day 0 to day k around events, with a
    5-95% band from circular shifts of the event dates."""
    lo, hi = max(start, -k0), len(level) - k1
    e = events[(events >= lo) & (events < hi)] - lo
    n = hi - lo
    idx = (e[None, :] + np.arange(n)[:, None]) % n
    out = []
    for k in range(k0, k1 + 1):
        col = (level[lo + k:hi + k] - level[lo:hi]) * 100
        null = col[idx].mean(axis=1)
        out.append({
            "k": k, "event": rnd(null[0]), "all": rnd(col.mean()),
            "lo": rnd(np.percentile(null, 5)), "hi": rnd(np.percentile(null, 95)),
        })
    return out


def rnd(x, n=2):
    return None if x is None or not np.isfinite(x) else round(float(x), n)


# ── Pipeline ─────────────────────────────────────────────────────────────────


def perm_corr(x, y, n=20000, seed=0):
    """Pearson r, Spearman rho and two-sided permutation p-values."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    rank = lambda v: np.argsort(np.argsort(v)).astype(float)
    rng = np.random.default_rng(seed)
    perms = np.array([rng.permutation(len(y)) for _ in range(n)])
    out = []
    for a, b in ((x, y), (rank(x), rank(y))):
        r = np.corrcoef(a, b)[0, 1]
        null = np.array([np.corrcoef(a, b[p])[0, 1] for p in perms])
        out += [r, float((np.abs(null) >= abs(r) - 1e-12).mean())]
    return out   # r, p_r, rho, p_rho


# ── Pipeline ─────────────────────────────────────────────────────────────────

def main():
    ng_raw = closes("NG=F")
    df = pd.DataFrame({"ng": ng_raw, "roll": roll_days(ng_raw.index)})
    df["ret"] = np.log(df["ng"]).diff().where(~df["roll"], 0.0)   # drop contract-switch returns
    df = df.join(closes("^GSPC").rename("sp"), how="inner")
    T, dates = len(df), df.index
    ds = lambda i: dates[i].strftime("%Y-%m-%d")
    g = np.cumsum(df["ret"].fillna(0).to_numpy())     # roll-adjusted log gas level
    sp = df["sp"].to_numpy()

    gas1m = np.full(T, np.nan)
    gas1m[RUNUP:] = (np.exp(g[RUNUP:] - g[:-RUNUP]) - 1) * 100
    low = pd.Series(sp).rolling(FWD).min().shift(-FWD).to_numpy()   # min close over t+1..t+FWD
    mdd = np.minimum((low / sp - 1) * 100, 0)

    # 1. Backward: gas in the month before every correction peak.
    corr = [c for c in find_corrections(sp, CORRECTION) if c[0] >= START]
    peaks = np.array([c[0] for c in corr], dtype=int)
    rose = np.where(np.isnan(gas1m), np.nan, (gas1m > 0) * 100.0)
    _, rose_p, _ = shift_test(rose, peaks, START, T)
    _, mean_p, _ = shift_test(gas1m, peaks, START, T)
    k0, k1 = WINDOW
    scenarios = []
    for pk, tr, depth in corr:
        end = min(tr + k1, T - 1)
        ks = list(range(k0, end - pk + 1))
        base = g[pk - RUNUP]
        scenarios.append({
            "peak": ds(pk), "trough": ds(tr), "depth": rnd(depth, 1), "days": int(tr - pk),
            "bear": bool(depth <= -20), "gas_1m": rnd(gas1m[pk], 1),
            "gas_3m": rnd((np.exp(g[pk] - g[pk - 63]) - 1) * 100, 1),
            "ng_peak": rnd(df["ng"].iloc[pk], 2),
            "k": ks,
            "gas": [rnd((np.exp(g[pk + k] - base) - 1) * 100, 1) for k in ks],   # % from day -21
            "sp": [rnd((sp[pk + k] / sp[pk] - 1) * 100, 1) for k in ks],         # % from the peak
        })
    x = [s["gas_1m"] for s in scenarios]
    r, p_r, rho, p_rho = perm_corr(x, [s["depth"] for s in scenarios])
    r_d, p_d, _, _ = perm_corr(x, [s["days"] for s in scenarios])
    e = peaks
    backward = {
        "n": len(peaks), "rose": int((gas1m[e] > 0).sum()),
        "rose_pct": rnd(rose[e].mean(), 0), "rose_all": rnd(np.nanmean(rose[START:]), 0), "rose_p": rnd(rose_p, 3),
        "gas_mean": rnd(gas1m[e].mean(), 1), "gas_median": rnd(np.median(gas1m[e]), 1),
        "gas_all": rnd(np.nanmean(gas1m[START:]), 1), "gas_p": rnd(mean_p, 3),
        "depth_mean": rnd(np.mean([c[2] for c in corr]), 1),
        "days_median": int(np.median([c[1] - c[0] for c in corr])),
        "r_depth": rnd(r), "p_depth": rnd(p_r, 3), "rho_depth": rnd(rho), "p_rho_depth": rnd(p_rho, 3),
        "r_days": rnd(r_d), "p_days": rnd(p_d, 3),
    }

    # 2. Forward: after a given past-month gas move, how often did a 10%+ fall follow?
    hi = T - FWD
    days = np.arange(START, hi)
    b = np.digitize(gas1m, BUCKETS)
    dd10 = (mdd <= CORRECTION) * 100.0
    edges = [None] + BUCKETS + [None]
    forward = []
    for i in range(len(BUCKETS) + 1):
        idx = days[b[days] == i]
        _, p, _ = shift_test(dd10, idx, START, hi)
        forward.append({
            "lo": edges[i], "hi": edges[i + 1], "days": int(len(idx)),
            "share": rnd(len(idx) / len(days) * 100, 0),
            "dd10": rnd(dd10[idx].mean(), 1), "dd10_p": rnd(p, 3),
            "mdd": rnd(mdd[idx].mean(), 1),
        })
    forward_all = {"dd10": rnd(dd10[days].mean(), 1), "mdd": rnd(mdd[days].mean(), 1)}

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "params": {"runup": RUNUP, "fwd": FWD, "correction": CORRECTION, "rebound": REBOUND, "buckets": BUCKETS},
        "latest": {
            "date": ds(T - 1), "ng": rnd(df["ng"].iloc[-1], 3), "gas_1m": rnd(gas1m[-1], 1),
            "bucket": int(b[-1]), "sp_off_high": rnd((sp[-1] / sp.max() - 1) * 100, 1),
        },
        "sample_start": ds(START),
        "backward": backward,
        "scenarios": scenarios,
        "gas_path": event_path(g, peaks, START, *GAS_PATH),
        "forward": forward,
        "forward_all": forward_all,
        "series": {
            "dates": [d.strftime("%Y-%m-%d") for d in dates],
            "ng": [rnd(v, 3) for v in df["ng"]],
            "sp": [rnd(v, 1) for v in sp],
        },
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))

    print(f"{len(peaks)} corrections; gas rose in the month before {backward['rose']} "
          f"({backward['rose_pct']}% vs {backward['rose_all']}% of all days, p={backward['rose_p']})")
    print(f"  run-up vs depth: r={backward['r_depth']} (p={backward['p_depth']})")
    for f_ in forward:
        print(f"  gas 1m {f_['lo']}..{f_['hi']}: {f_['days']} days, 10% fall within 3m {f_['dd10']}% (p={f_['dd10_p']})")


def self_check():
    px = np.array([100, 110, 95, 99, 112, 100, 120, 105, 100])
    assert [(a, b, round(c, 1)) for a, b, c in find_corrections(px, -10)] == [(1, 2, -13.6), (4, 5, -10.7), (6, 8, -16.7)]
    # rebound: 100 -> 70 -> 90 (+29%) -> 78 is a second episode below the old high
    assert [(a, b) for a, b, _ in find_corrections(np.array([100, 70, 90, 78]), -10)] == [(0, 1), (2, 3)]
    rng = np.random.default_rng(0)
    x = rng.normal(size=3000)
    d, p, n = shift_test(x, np.sort(np.argsort(x)[:40]), 0, len(x))
    assert n == 40 and d < -1 and p < 0.01
    _, p, _ = shift_test(x, np.sort(rng.choice(3000, 40, replace=False)), 0, len(x))
    assert p > 0.01
    r, p, _, _ = perm_corr(np.arange(10), np.arange(10) * 2 + 1, n=2000)
    assert r > 0.99 and p < 0.01
    idx = pd.bdate_range("2024-01-01", "2024-03-15")
    assert [d.strftime("%Y-%m-%d") for d in idx[roll_days(idx)]] == ["2024-01-30", "2024-02-28"]


if __name__ == "__main__":
    self_check()
    main()
