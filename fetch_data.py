"""
Natural Gas Shock Monitor: data pipeline
========================================
Builds natgas_data.json from Yahoo Finance daily closes (NG=F, ^GSPC):
    pip install -r requirements.txt && python fetch_data.py

The hypothesis: in the days and weeks before the S&P 500 starts a major decline
(a fall of 15% or more), natural gas spikes: a sharp burst up, wherever it lands
in that window, not the net change over it. A spike is the largest 5-day gas
gain inside the window. Tested two ways:
  1. Backward: date every major decline since 2001 and look for spikes in the
     week to two months before each peak, against all days.
  2. Forward: on every day, bucket the biggest spike of the past month and see
     how often a 15%+ S&P fall followed within 6 months. Only this view is
     usable in real time, because peaks are only known in hindsight.

Design rules
  * Roll-adjusted. NG=F is an unadjusted front-month series, so the day it
    switches contract shows the curve spread as a fake price move. Those daily
    returns are dropped.
  * Fixed thresholds (a spike is +10% in 5 days; buckets 5/10/15/20%), set as
    round numbers, so no full-sample quantiles leak into the forward test.
  * Always against a baseline: every number sits next to the same number for
    all days.
  * p-values from circular shifts of the event dates, which keep clustering and
    the overlap of forward windows intact; correlations use permutation tests.
"""

import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd

BURST = 5                     # trading days in a spike
SPIKE = 10.0                  # % gain in BURST days that counts as a spike
LOOKBACKS = {"1w": 5, "2w": 10, "1m": 21, "2m": 42}
RUNUP = 21                    # headline window before a peak (one month)
FWD = 126                     # forward window for the real-time test (six months)
CORRECTION = -15.0            # % S&P fall from a closing high that counts as a major decline
REBOUND = 25.0                # % rally off a correction low that starts a new cycle
BUCKETS = [5, 10, 15, 20]     # biggest spike of the past month, % edges
START = 126                   # trading days of history before the sample starts
WINDOW = (-63, 21)            # per-crash chart: days before peak, days after trough
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

    # burst[t] = gas gain over the BURST days ending at t; maxb[W][t] = biggest burst ending in (t-W, t].
    burst = (np.exp(pd.Series(g).diff(BURST).to_numpy()) - 1) * 100
    maxb = {name: pd.Series(burst).rolling(W).max().to_numpy() for name, W in LOOKBACKS.items()}
    low = pd.Series(sp).rolling(FWD).min().shift(-FWD).to_numpy()   # min close over t+1..t+FWD
    mdd = np.minimum((low / sp - 1) * 100, 0)
    pctile = lambda x, name: float((maxb[name][START:] < x).mean() * 100)

    # 1. Backward: spikes in the windows before every major decline.
    corr = [c for c in find_corrections(sp, CORRECTION) if c[0] >= START]
    peaks = np.array([c[0] for c in corr], dtype=int)
    windows = []
    for name, W in LOOKBACKS.items():
        m = maxb[name]
        spiked = np.where(np.isnan(m), np.nan, (m >= SPIKE) * 100.0)
        _, p_spike, _ = shift_test(spiked, peaks, START, T)
        _, p_size, _ = shift_test(np.nan_to_num(m), peaks, START, T)
        windows.append({
            "window": name, "days": W, "n": len(peaks),
            "spiked": int((m[peaks] >= SPIKE).sum()),
            "spike_pct": rnd(spiked[peaks].mean(), 0), "spike_all": rnd(np.nanmean(spiked[START:]), 0), "spike_p": rnd(p_spike, 3),
            "max_median": rnd(np.median(m[peaks]), 1), "max_all_median": rnd(np.nanmedian(m[START:]), 1),
            "pctile_median": rnd(np.median([pctile(m[p], name) for p in peaks]), 0), "size_p": rnd(p_size, 3),
        })

    k0, k1 = WINDOW
    scenarios = []
    for pk, tr, depth in corr:
        end = min(tr + k1, T - 1)
        ks = list(range(k0, end - pk + 1))
        base = g[pk + k0]
        top = pk - RUNUP + 1 + int(np.nanargmax(burst[pk - RUNUP + 1:pk + 1]))   # end of the month's biggest burst
        row = {
            "peak": ds(pk), "trough": ds(tr), "depth": rnd(depth, 1), "days": int(tr - pk),
            "bear": bool(depth <= -20), "ng_peak": rnd(df["ng"].iloc[pk], 2),
            "spike_end": int(top - pk), "spike_date": ds(top),
            "pctile": rnd(pctile(maxb["1m"][pk], "1m"), 0),
            "k": ks,
            "gas": [rnd((np.exp(g[pk + k] - base) - 1) * 100, 1) for k in ks],   # % from day -63
            "sp": [rnd((sp[pk + k] / sp[pk] - 1) * 100, 1) for k in ks],         # % from the peak
        }
        for name in LOOKBACKS:
            row[f"spike_{name}"] = rnd(maxb[name][pk], 1)
        scenarios.append(row)
    # Hedge: gas over each decline, peak to low, against random windows of the same lengths.
    lens = np.array([c[1] - c[0] for c in corr])
    gas_dd = (np.exp(g[peaks + lens] - g[peaks]) - 1) * 100
    n_sh = T - START - lens.max()
    null = np.array([((np.exp(g[(peaks - START + k) % n_sh + START + lens] - g[(peaks - START + k) % n_sh + START]) - 1) * 100).mean()
                     for k in range(n_sh)])
    hedge_p = float((np.abs(null - null.mean()) >= abs(gas_dd.mean() - null.mean()) - 1e-12).mean())
    for row, v in zip(scenarios, gas_dd):
        row["gas_dd"] = rnd(v, 1)
    # Hedge, every month: gas over 21-day windows in which the S&P fell 5% or more.
    sp21 = np.full(T, np.nan)
    sp21[21:] = (sp[21:] / sp[:-21] - 1) * 100
    gas21 = np.full(T, np.nan)
    gas21[21:] = (np.exp(g[21:] - g[:-21]) - 1) * 100
    bad = np.flatnonzero(sp21 <= -5)
    bad = bad[bad >= START]
    _, bad_p, _ = shift_test(np.nan_to_num(gas21), bad, START, T)
    up = np.where(np.isnan(gas21), np.nan, (gas21 > 0) * 100.0)
    _, bad_up_p, _ = shift_test(up, bad, START, T)
    ok = np.isfinite(sp21) & np.isfinite(gas21)
    hedge = {
        "crash_up": int((gas_dd > 0).sum()), "crash_mean": rnd(gas_dd.mean(), 1), "crash_median": rnd(np.median(gas_dd), 1),
        "crash_null": rnd(null.mean(), 1), "crash_p": rnd(hedge_p, 3),
        "bad_months": int(len(bad)), "bad_gas": rnd(np.nanmean(gas21[bad]), 1), "all_gas": rnd(np.nanmean(gas21[START:]), 1),
        "bad_p": rnd(bad_p, 3), "bad_up": rnd(up[bad].mean(), 0), "all_up": rnd(np.nanmean(up[START:]), 0), "bad_up_p": rnd(bad_up_p, 3),
        "corr_daily": rnd(np.corrcoef(np.diff(g)[START:], np.diff(np.log(sp))[START:])[0, 1]),
        "corr_monthly": rnd(np.corrcoef(gas21[ok][::21], sp21[ok][::21])[0, 1]),
    }

    x = [s["spike_1m"] for s in scenarios]
    r, p_r, rho, p_rho = perm_corr(x, [s["depth"] for s in scenarios])
    r_d, p_d, _, _ = perm_corr(x, [s["days"] for s in scenarios])
    backward = {
        "n": len(peaks), "depth_mean": rnd(np.mean([c[2] for c in corr]), 1),
        "days_median": int(np.median([c[1] - c[0] for c in corr])),
        "r_depth": rnd(r), "p_depth": rnd(p_r, 3), "rho_depth": rnd(rho), "p_rho_depth": rnd(p_rho, 3),
        "r_days": rnd(r_d), "p_days": rnd(p_d, 3),
    }

    # 2. Forward: after a spike of a given size in the past month, how often did a 15%+ fall follow?
    hi = T - FWD
    days = np.arange(START, hi)
    b = np.digitize(maxb["1m"], BUCKETS)
    hit = (mdd <= CORRECTION) * 100.0
    edges = [None] + BUCKETS + [None]
    forward = []
    for i in range(len(BUCKETS) + 1):
        idx = days[b[days] == i]
        _, p, _ = shift_test(hit, idx, START, hi)
        forward.append({
            "lo": edges[i], "hi": edges[i + 1], "days": int(len(idx)),
            "share": rnd(len(idx) / len(days) * 100, 0),
            "hit": rnd(hit[idx].mean(), 1), "hit_p": rnd(p, 3),
            "mdd": rnd(mdd[idx].mean(), 1),
        })
    forward_all = {"hit": rnd(hit[days].mean(), 1), "mdd": rnd(mdd[days].mean(), 1)}

    # Calendar: biggest 5-day spike in each month, with run-up and peak months flagged.
    s_b = pd.Series(burst, index=dates)
    m_max = s_b.groupby([dates.year, dates.month]).max()
    flag = {(dates[pk - RUNUP].year, dates[pk - RUNUP].month) for pk in peaks} | {(dates[pk].year, dates[pk].month) for pk in peaks}
    monthly = [{"y": int(y), "m": int(m), "r": rnd(v, 1), "pre": (y, m) in flag}
               for (y, m), v in m_max.items() if y >= dates[START].year]

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "params": {"burst": BURST, "spike": SPIKE, "runup": RUNUP, "fwd": FWD, "correction": CORRECTION,
                   "rebound": REBOUND, "buckets": BUCKETS,
                   "spike_share": rnd(np.nanmean(burst[START:] >= SPIKE) * 100, 1)},
        "latest": {
            "date": ds(T - 1), "ng": rnd(df["ng"].iloc[-1], 3), "spike_1m": rnd(maxb["1m"][-1], 1),
            "bucket": int(b[-1]), "sp_off_high": rnd((sp[-1] / sp.max() - 1) * 100, 1),
        },
        "sample_start": ds(START),
        "backward": backward,
        "hedge": hedge,
        "windows": windows,
        "scenarios": scenarios,
        "forward": forward,
        "forward_all": forward_all,
        "monthly": monthly,
        "series": {
            "dates": [d.strftime("%Y-%m-%d") for d in dates],
            "ng": [rnd(v, 3) for v in df["ng"]],
            "sp": [rnd(v, 1) for v in sp],
        },
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))

    print(f"{len(peaks)} major declines")
    for w in windows:
        print(f"  {w['window']}: spike before {w['spiked']}/{w['n']} ({w['spike_pct']}% vs {w['spike_all']}% all days, p={w['spike_p']}); "
              f"median pctile {w['pctile_median']} (p={w['size_p']})")
    print("  hedge:", hedge, [r["gas_dd"] for r in scenarios])
    print(f"  spike size vs depth: r={backward['r_depth']} (p={backward['p_depth']})")
    for f_ in forward:
        print(f"  spike {f_['lo']}..{f_['hi']}: {f_['days']} days, hit {f_['hit']}% (p={f_['hit_p']})")


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
