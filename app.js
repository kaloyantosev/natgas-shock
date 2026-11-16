// Natural Gas Shock Monitor: renders natgas_data.json (built by fetch_data.py).

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const $ = (id) => document.getElementById(id);
const fmt = (x, d = 1) => (x == null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d)}`);
const pct = (x, d = 1) => (x == null ? '—' : `${fmt(x, d)}%`);
const share = (x) => (x == null ? '—' : `${x.toFixed(0)}%`);
const pv = (p) => (p < 0.001 ? '<0.001' : p.toFixed(p < 0.01 ? 3 : 2));
const day = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const month = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
const bucketName = (b) => (b.lo == null ? `under +${b.hi}%` : b.hi == null ? `+${b.lo}% or more` : `+${b.lo}% to +${b.hi}%`);
const WINDOW = { '1w': 'final week', '2w': 'final 2 weeks', '1m': 'final month', '2m': 'final 2 months' };

function rgba(color, a) {
  const n = parseInt(color.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Vertical gradient fill for line charts, created once the chart area is known.
const fade = (color, top = 0.35) => (c) => {
  const { ctx, chartArea: a } = c.chart;
  if (!a) return 'transparent';
  const g = ctx.createLinearGradient(0, a.top, 0, a.bottom);
  g.addColorStop(0, rgba(color, top));
  g.addColorStop(1, rgba(color, 0));
  return g;
};

async function main() {
  const data = await (await fetch('natgas_data.json', { cache: 'no-cache' })).json();

  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = css('--muted');
  Chart.defaults.borderColor = css('--line');
  Chart.defaults.plugins.tooltip.backgroundColor = css('--fg');
  Chart.defaults.plugins.tooltip.titleColor = css('--bg');
  Chart.defaults.plugins.tooltip.bodyColor = css('--bg');
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;

  const tests = verdictTests(data);
  renderHeader(data, tests);
  renderRoles(data);
  renderTimeline(data.series, data.scenarios, data.params.runup);
  renderCases(data.scenarios);
  renderWindows(data.windows);
  renderCalendar(data.monthly);
  renderHedge(data.scenarios, data.hedge);
  renderScatter(data.scenarios, data.backward);
  renderForward(data.forward, data.forward_all);
  renderScore(tests);
  renderToday(data);

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => location.reload());
}

const win = (data, name) => data.windows.find((w) => w.window === name);

// ── Verdict ──────────────────────────────────────────────────────────────────
function verdictTests(data) {
  const b = data.backward;
  const h = data.hedge;
  const w1 = win(data, '1w');
  const w4 = win(data, '1m');
  const all = data.forward_all;
  const top = data.forward[data.forward.length - 1];
  const best = data.forward.reduce((x, y) => (y.hit_p < x.hit_p && y.hit > all.hit ? y : x), top);
  return [
    {
      role: 'Leading indicator',
      q: 'Gas spiked in the final week before major declines more often than usual',
      pass: w1.spike_p < 0.05,
      ev: `${w1.spiked} of ${w1.n} peaks had a spike in the final week, against ${share(w1.spike_all)} of all days (p = ${pv(w1.spike_p)}).`,
    },
    {
      role: 'Leading indicator',
      q: 'Gas spiked in the month before major declines more often than usual',
      pass: w4.spike_p < 0.05,
      ev: `${w4.spiked} of ${w4.n} peaks, against ${share(w4.spike_all)} of all days (p = ${pv(w4.spike_p)}). Spikes are common: almost half of all months have one.`,
    },
    {
      role: 'Leading indicator',
      q: 'A bigger spike means a deeper crash',
      pass: b.p_depth < 0.05 && b.r_depth < 0,
      ev: `Correlation of spike size with depth r = ${fmt(b.r_depth, 2)} (p = ${pv(b.p_depth)}).`,
    },
    {
      role: 'Leading indicator',
      q: 'A gas spike raises the odds of a crash in real time',
      pass: best.hit_p < 0.05 && best.hit > all.hit,
      ev: `After a spike of ${bucketName(top)}, a 15%+ fall followed within 6 months ${share(top.hit)} of the time, against ${share(all.hit)} on all days (p = ${pv(top.hit_p)}).`,
    },
    {
      role: 'Hedge',
      q: 'Gas rose while the S&P 500 fell in major declines',
      pass: h.crash_p < 0.05 && h.crash_mean > h.crash_null && h.crash_up > b.n / 2,
      ev: `Gas rose in ${h.crash_up} of ${b.n} declines. Median ${pct(h.crash_median)}; the average of ${pct(h.crash_mean)} is almost all 2022 (p = ${pv(h.crash_p)}).`,
    },
    {
      role: 'Hedge',
      q: 'Gas rises in bad months for stocks',
      pass: h.bad_p < 0.05 && h.bad_gas > h.all_gas,
      ev: `In the ${h.bad_months.toLocaleString()} 21-day windows where the S&P fell 5%+, gas averaged ${pct(h.bad_gas)} against ${pct(h.all_gas)} overall (p = ${pv(h.bad_p)}). Monthly correlation with stocks: ${fmt(h.corr_monthly, 2)}.`,
    },
  ];
}

function renderHeader(data, tests) {
  const b = data.backward;
  const h = data.hedge;
  const w1 = win(data, '1w');
  const passed = tests.filter((t) => t.pass).length;
  $('updated').textContent = `Data through ${day(data.latest.date)}`;
  $('byline').innerHTML =
    `<span><b>${b.n}</b> major declines since ${new Date(data.sample_start).getFullYear()}</span>` +
    `<span><b>${data.series.dates.length.toLocaleString()}</b> trading days</span>` +
    '<span>Refreshed every trading day</span>';
  $('verdict').textContent = passed === tests.length
    ? 'Natural gas works as both a hedge and an early warning.'
    : passed === 0
      ? 'Natural gas played both roles in some crashes, but neither reliably.'
      : 'The evidence is mixed: some roles hold, others do not.';
  $('abstract').textContent =
    `Both roles appear in the record. Gas spiked in the final week before ${w1.spiked} of ${b.n} major S&P 500 declines, and it rose during ${h.crash_up} of them, most dramatically in 2022 when it more than doubled while stocks fell a quarter. ` +
    `But neither pattern stands out from chance: spikes are frequent in any month, their size says nothing about the crash that follows, and in the other declines gas fell with stocks. ` +
    `Over the whole period gas and stocks are almost uncorrelated (${fmt(h.corr_monthly, 2)} month to month). ${passed} of ${tests.length} tests support the idea. ` +
    'Gas is better described as an independent risk that occasionally pays off in a crisis than as a dependable hedge or warning.';
  $('stats').innerHTML = [
    [`${w1.spiked}/${b.n}`, 'crashes with a gas spike in the final week'],
    [`${h.crash_up}/${b.n}`, 'crashes in which gas rose while stocks fell'],
    [fmt(h.corr_monthly, 2), 'monthly correlation of gas with stocks'],
  ].map(([v, s]) => `<div><b>${v}</b><span>${s}</span></div>`).join('');
}

function renderRoles(data) {
  const sc = data.scenarios;
  const spikes = sc.filter((s) => s.spike_1w >= data.params.spike).map((s) => `${month(s.peak)} (${pct(s.spike_1w, 0)})`);
  const hedges = sc.filter((s) => s.gas_dd > 0).map((s) => `${month(s.peak)} (gas ${pct(s.gas_dd, 0)}, S&P ${pct(s.depth, 0)})`);
  $('role-lead').innerHTML = `<b>Where it showed up:</b> a spike in the final week before ${spikes.join(', ') || 'none'}.`;
  $('role-hedge').innerHTML = `<b>Where it showed up:</b> ${hedges.join(', ') || 'none'}.`;
}

// ── Figure 1: timeline ───────────────────────────────────────────────────────
function renderTimeline(series, scenarios, runup) {
  const at = new Map(series.dates.map((d, i) => [d, i]));
  const year = (i) => series.dates[i].slice(0, 4);
  const crash = css('--crash');
  const gas = css('--gas');
  const bands = {
    id: 'bands',
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea: a, scales: { x } } = chart;
      ctx.save();
      for (const s of scenarios) {
        const p = at.get(s.peak);
        const x0 = x.getPixelForValue(p);
        const x1 = Math.max(x.getPixelForValue(at.get(s.trough)), x0 + 3);
        const xr = x.getPixelForValue(p - runup);
        ctx.fillStyle = rgba(gas, 0.28);
        ctx.fillRect(xr, a.top, x0 - xr, a.bottom - a.top);
        const g = ctx.createLinearGradient(0, a.top, 0, a.bottom);
        g.addColorStop(0, rgba(crash, 0.26));
        g.addColorStop(1, rgba(crash, 0.06));
        ctx.fillStyle = g;
        ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
        ctx.fillStyle = crash;
        ctx.font = '600 11px Inter, system-ui, sans-serif';
        ctx.fillText(s.peak.slice(0, 4), x0 + 4, a.top + 12);
      }
      ctx.restore();
    },
  };
  new Chart($('timeline'), {
    type: 'line',
    data: {
      labels: series.dates,
      datasets: [
        { label: 'S&P 500', data: series.sp, yAxisID: 'sp', borderColor: css('--fg'), borderWidth: 1.4, pointRadius: 0, fill: 'start', backgroundColor: fade(css('--fg').startsWith('#') ? css('--fg') : '#888888', 0.08) },
        { label: 'Natural gas', data: series.ng, yAxisID: 'ng', borderColor: gas, borderWidth: 1.2, pointRadius: 0, fill: 'start', backgroundColor: fade(gas, 0.3) },
      ],
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: (items) => day(items[0].label), label: (c) => (c.dataset.yAxisID === 'sp' ? ` S&P 500  ${c.raw?.toLocaleString()}` : ` Natural gas  $${c.raw?.toFixed(2)}`) } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: false, callback: (v, i) => (i > 0 && year(i) !== year(i - 1) && +year(i) % 5 === 0 ? year(i) : null) } },
        sp: { type: 'logarithmic', stack: 'v', stackWeight: 3, position: 'left', grid: { color: css('--line') }, ticks: { callback: (v) => ([1000, 2000, 3000, 5000, 7000].includes(v) ? v.toLocaleString() : null) } },
        ng: { type: 'logarithmic', stack: 'v', stackWeight: 1.4, offset: true, position: 'left', grid: { color: css('--line') }, ticks: { color: gas, callback: (v) => ([2, 4, 8, 16].includes(v) ? `$${v}` : null) } },
      },
    },
    plugins: [bands],
  });
  $('legend-timeline').innerHTML =
    `<span><i style="background:${css('--fg')}"></i>S&amp;P 500</span>` +
    `<span><i style="background:${gas}"></i>Natural gas, $/MMBtu</span>` +
    `<span><i class="box" style="background:${rgba(gas, 0.35)}"></i>Month before the peak</span>` +
    `<span><i class="box" style="background:${rgba(crash, 0.3)}"></i>Major decline, peak to low</span>`;
}

// ── Section 3: one chart per crash ───────────────────────────────────────────
function renderCases(scenarios) {
  const gas = css('--gas');
  const crash = css('--crash');
  $('cases-lead').textContent =
    'Each chart runs from three months before the S&P peak to a month after the low. Look for two things: a spike in the shaded month (the dot marks the biggest 5-day gas gain in it), and whether the amber line climbs while the red one falls.';
  const shade = { id: 'shade', beforeDatasetsDraw(chart) {
    const { ctx, chartArea: a, scales: { x } } = chart;
    const ks = chart.data.labels;
    ctx.save();
    ctx.fillStyle = rgba(gas, 0.16);
    const x0 = x.getPixelForValue(ks.indexOf(-21));
    const x1 = x.getPixelForValue(ks.indexOf(0));
    ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
    ctx.strokeStyle = rgba(crash, 0.6);
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x1, a.top); ctx.lineTo(x1, a.bottom); ctx.stroke();
    ctx.restore();
  } };
  $('cases').innerHTML = scenarios.map((s, i) => `
    <figure class="case${i === 0 ? ' wide' : ''}">
      <header><h3>${month(s.peak)}</h3><span class="tag">${s.bear ? 'Bear market' : 'Major correction'}</span></header>
      <div class="nums">
        <span>S&amp;P <b class="neg">${pct(s.depth)}</b> in ${s.days} days</span>
        <span>Spike before: <b class="gas">${pct(s.spike_1m)}</b> in 5 days, ${-s.spike_end === 0 ? 'on the peak day' : `${-s.spike_end} days before the peak`}</span>
        <span>Gas during the fall: <b class="${s.gas_dd > 0 ? 'pos' : 'neg'}">${pct(s.gas_dd)}</b></span>
      </div>
      <div class="case-box"><canvas id="case-${i}" aria-label="Natural gas and S&amp;P 500 around the ${month(s.peak)} peak"></canvas></div>
    </figure>`).join('');
  scenarios.forEach((s, i) => {
    const spikeAt = s.k.indexOf(s.spike_end);
    new Chart($(`case-${i}`), {
      type: 'line',
      data: {
        labels: s.k,
        datasets: [
          {
            label: 'Natural gas', data: s.gas, borderColor: gas, borderWidth: 2, yAxisID: 'g', fill: 'origin', backgroundColor: fade(gas, 0.25),
            pointRadius: s.k.map((_, j) => (j === spikeAt ? 6 : 0)), pointBackgroundColor: gas, pointBorderColor: css('--surface'), pointBorderWidth: 2,
          },
          { label: 'S&P 500', data: s.sp, borderColor: crash, borderWidth: 2, pointRadius: 0, yAxisID: 's' },
        ],
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: (items) => `Day ${fmt(+items[0].label, 0)} from peak`, label: (c) => ` ${c.dataset.label}  ${pct(c.raw)}` } } },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: false, callback: (v, j) => (s.k[j] % 63 === 0 ? (s.k[j] === 0 ? 'peak' : s.k[j]) : null) } },
          g: { position: 'left', ticks: { color: gas, maxTicksLimit: 5, callback: (v) => `${v}%` }, grid: { color: (c) => (c.tick.value === 0 ? css('--line') : 'transparent') } },
          s: { position: 'right', ticks: { color: crash, maxTicksLimit: 5, callback: (v) => `${v}%` }, grid: { display: false } },
        },
      },
      plugins: [shade],
    });
  });
}

// ── Figure 2: spikes by window ───────────────────────────────────────────────
function renderWindows(windows) {
  const w1 = windows[0];
  $('windows-lead').textContent =
    `The closer to the peak, the more the pattern stands out: ${w1.spiked} of ${w1.n} crashes had a gas spike in the final week, against ${share(w1.spike_all)} of ordinary days (p = ${pv(w1.spike_p)}). ` +
    'Widen the window to a month or two and the edge disappears, because gas spikes so often that most months contain one anyway.';
  const gas = css('--gas');
  new Chart($('windows'), {
    type: 'bar',
    data: {
      labels: windows.map((w) => WINDOW[w.window]),
      datasets: [
        { label: 'Before a crash peak', data: windows.map((w) => w.spike_pct), backgroundColor: gas, borderRadius: 6, maxBarThickness: 60 },
        { label: 'Any day', data: windows.map((w) => w.spike_all), backgroundColor: css('--band'), borderColor: css('--muted'), borderWidth: 1, borderRadius: 6, maxBarThickness: 60 },
      ],
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      plugins: {
        legend: { align: 'start', labels: { boxWidth: 12, boxHeight: 12 } },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${share(c.raw)}${c.datasetIndex === 0 ? ` (${windows[c.dataIndex].spiked} of ${windows[c.dataIndex].n}, p = ${pv(windows[c.dataIndex].spike_p)})` : ''}` } },
      },
      scales: {
        x: { title: { display: true, text: 'Window before the S&P peak' }, grid: { display: false } },
        y: { beginAtZero: true, max: 100, title: { display: true, text: 'Had a 10%+ gas spike' }, ticks: { callback: (v) => `${v}%` } },
      },
    },
  });
}

// ── Figure 3: calendar ───────────────────────────────────────────────────────
function renderCalendar(monthly) {
  const up = css('--gas');
  const color = (r) => (r == null ? 'transparent' : rgba(up, 0.05 + Math.max(0, Math.min(r, 25)) / 25 * 0.9));
  const byYear = new Map();
  monthly.forEach((m) => {
    if (!byYear.has(m.y)) byYear.set(m.y, Array(12).fill(null));
    byYear.get(m.y)[m.m - 1] = m;
  });
  const names = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  let html = '<span></span>' + names.map((n) => `<span class="h">${n}</span>`).join('');
  for (const [y, months] of byYear) {
    html += `<span class="y">${y}</span>` + months.map((m, i) => (m
      ? `<span class="c${m.pre ? ' pre' : ''}" style="background:${color(m.r)}" title="${new Date(y, i).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}: biggest 5-day spike ${pct(m.r)}${m.pre ? ' · before or at a crash peak' : ''}"></span>`
      : '<span></span>')).join('');
  }
  $('calendar').innerHTML = html;
  $('cal-scale').style.background = `linear-gradient(90deg, ${rgba(up, 0.05)}, ${rgba(up, 0.95)})`;
}

// ── Figure 4: hedge ──────────────────────────────────────────────────────────
function renderHedge(scenarios, h) {
  $('hedge-lead').textContent =
    `Gas rose during ${h.crash_up} of ${scenarios.length} declines. When it worked, it worked spectacularly: in 2022 gas more than doubled while the S&P 500 lost a quarter. ` +
    `In the others (${scenarios.filter((s) => s.gas_dd <= 0).map((s) => s.peak.slice(0, 4)).join(', ')}) gas fell along with stocks, so the median decline saw gas ${pct(h.crash_median)}. ` +
    `Across every month since 2001, when the S&P 500 fell 5% or more, gas was up ${share(h.bad_up)} of the time, about the same as any month (${share(h.all_up)}).`;
  const gas = css('--gas');
  const crash = css('--crash');
  new Chart($('hedge'), {
    type: 'bar',
    data: {
      labels: scenarios.map((s) => month(s.peak)),
      datasets: [
        { label: 'S&P 500, peak to low', data: scenarios.map((s) => s.depth), backgroundColor: rgba(crash, 0.8), borderRadius: 4, maxBarThickness: 34 },
        { label: 'Natural gas, same days', data: scenarios.map((s) => s.gas_dd), backgroundColor: scenarios.map((s) => rgba(gas, s.gas_dd > 0 ? 0.95 : 0.45)), borderRadius: 4, maxBarThickness: 34 },
      ],
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      plugins: {
        legend: { align: 'start', labels: { boxWidth: 12, boxHeight: 12 } },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${pct(c.raw)}` } },
      },
      scales: {
        x: { grid: { display: false } },
        y: { type: 'linear', title: { display: true, text: 'Move from S&P peak to low' }, ticks: { callback: (v) => `${v}%` }, grid: { color: (c) => (c.tick.value === 0 ? css('--muted') : css('--line')) } },
      },
    },
  });
}

// ── Figure 5: scatter ────────────────────────────────────────────────────────
function renderScatter(scenarios, b) {
  $('scatter-lead').textContent =
    `If spikes were warnings of how bad things will get, bigger spikes would come before deeper falls. The correlation is r = ${fmt(b.r_depth, 2)} (p = ${pv(b.p_depth)}): no reliable link. ` +
    'The deepest crash of the period, 2007–09, followed one of the larger spikes; the 2010 and 2011 declines followed small ones; early 2025 had the biggest spike and a mid-sized fall.';
  const labels = { id: 'labels', afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.fillStyle = css('--fg');
    ctx.font = '500 12px Inter, system-ui, sans-serif';
    chart.getDatasetMeta(0).data.forEach((pt, i) => ctx.fillText(month(scenarios[i].peak), pt.x + pt.options.radius + 6, pt.y + 4));
    ctx.restore();
  } };
  const crash = css('--crash');
  const gas = css('--gas');
  new Chart($('scatter'), {
    type: 'bubble',
    data: {
      datasets: [{
        data: scenarios.map((s) => ({ x: s.spike_1m, y: s.depth, r: 6 + Math.sqrt(s.days) * 1.3 })),
        backgroundColor: scenarios.map((s) => rgba(s.bear ? crash : gas, 0.45)),
        borderColor: scenarios.map((s) => (s.bear ? crash : gas)),
        borderWidth: 1.5,
      }],
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      layout: { padding: { right: 80, top: 10 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => { const s = scenarios[c.dataIndex]; return ` ${month(s.peak)}: spike ${pct(s.spike_1m)}, S&P ${pct(s.depth)} over ${s.days} days`; } } },
      },
      scales: {
        x: { title: { display: true, text: 'Biggest 5-day gas spike in the month before the peak' }, ticks: { callback: (v) => `${v}%` } },
        y: { title: { display: true, text: 'S&P 500 fall, peak to low' }, ticks: { callback: (v) => `${v}%` } },
      },
    },
    plugins: [labels],
  });
}

// ── Figure 6: real-time test ─────────────────────────────────────────────────
function renderForward(rows, all) {
  const top = rows[rows.length - 1];
  const best = Math.max(...rows.map((r) => r.hit));
  $('forward-lead').textContent =
    'Crash peaks are only known afterwards. To be a usable warning, a gas spike would have to raise the odds of a crash before it happens. ' +
    `On a typical day, the odds of a 15%+ S&P fall within six months are ${share(all.hit)}. After the past month's biggest spike reached ${bucketName(top)} they were ${share(top.hit)} (p = ${pv(top.hit_p)}). ` +
    (best < all.hit * 1.5 ? 'Bigger spikes do not raise the odds: a single spike, on its own, is not a crash warning.' : '');
  const gas = css('--gas');
  const baseline = { id: 'baseline', afterDatasetsDraw(chart) {
    const { ctx, chartArea: a, scales: { y } } = chart;
    const py = y.getPixelForValue(all.hit);
    ctx.save();
    ctx.strokeStyle = css('--fg');
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke();
    ctx.fillStyle = css('--fg');
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`All days ${share(all.hit)}`, a.right - 4, py - 6);
    ctx.restore();
  } };
  new Chart($('forward'), {
    type: 'bar',
    data: {
      labels: rows.map(bucketName),
      datasets: [{
        data: rows.map((r) => r.hit),
        backgroundColor: (c) => {
          const { ctx, chartArea: a } = c.chart;
          if (!a) return gas;
          const g = ctx.createLinearGradient(0, a.top, 0, a.bottom);
          g.addColorStop(0, rgba(gas, 0.95));
          g.addColorStop(1, rgba(gas, 0.35));
          return g;
        },
        borderRadius: 8,
        maxBarThickness: 90,
      }],
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${share(c.raw)} of ${rows[c.dataIndex].days.toLocaleString()} days (p = ${pv(rows[c.dataIndex].hit_p)})` } } },
      scales: {
        x: { title: { display: true, text: "Biggest 5-day gas spike over the past month" }, grid: { display: false } },
        y: { beginAtZero: true, suggestedMax: Math.ceil(best / 10) * 10 + 5, title: { display: true, text: 'Followed by a 15%+ fall in 6 months' }, ticks: { callback: (v) => `${v}%` } },
      },
    },
    plugins: [baseline],
  });
}

// ── Section 8 and today ──────────────────────────────────────────────────────
function renderScore(tests) {
  $('score').innerHTML = tests.map((t) => `<tr>
    <td class="q"><span class="label ${t.role === 'Hedge' ? 'neg' : 'gas'}" style="display:block;margin-bottom:4px">${t.role}</span>${t.q}</td>
    <td><span class="chip ${t.pass ? 'pass' : 'fail'}">${t.pass ? 'Supported' : 'Not supported'}</span></td>
    <td class="ev">${t.ev}</td>
  </tr>`).join('');
}

function renderToday(data) {
  const { latest: l, forward: f, forward_all: all, params } = data;
  const b = f[l.bucket];
  $('today').innerHTML = `
    <div class="big ${l.spike_1m >= params.spike ? 'gas' : ''}">${pct(l.spike_1m)}</div>
    <p>Biggest 5-day natural gas move of the past month, to ${day(l.date)} (gas at $${l.ng.toFixed(2)}). ${l.spike_1m >= params.spike ? 'That counts as a spike.' : 'No spike.'} The S&amp;P 500 is ${pct(l.sp_off_high)} from its high.
    Historically, after a month like this, a 15%+ fall followed within six months ${share(b.hit)} of the time, against ${share(all.hit)} on all days.</p>`;
}

main().catch((e) => {
  console.error(e);
  $('verdict').textContent = 'Could not load natgas_data.json';
});
