// Natural Gas Shock Monitor: renders natgas_data.json (built by fetch_data.py).

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const $ = (id) => document.getElementById(id);
const fmt = (x, d = 1) => (x == null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d)}`);
const pct = (x, d = 1) => (x == null ? '—' : `${fmt(x, d)}%`);
const share = (x) => (x == null ? '—' : `${x.toFixed(0)}%`);
const pv = (p) => (p < 0.001 ? '<0.001' : p.toFixed(p < 0.01 ? 3 : 2));
const day = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const month = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
const bucketName = (b) => (b.lo == null ? `below ${b.hi}%` : b.hi == null ? `+${b.lo}% or more` : `${fmt(b.lo, 0)}% to ${fmt(b.hi, 0)}%`);

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
  renderTimeline(data.series, data.scenarios, data.params.runup);
  renderCases(data.scenarios, data.backward);
  renderGasPath(data.gas_path, data.backward);
  renderCalendar(data.monthly);
  renderScatter(data.scenarios, data.backward);
  renderForward(data.forward, data.forward_all);
  renderScore(tests);
  renderToday(data);

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => location.reload());
}

// ── Verdict ──────────────────────────────────────────────────────────────────
function verdictTests(data) {
  const b = data.backward;
  const top = data.forward[data.forward.length - 1];
  const all = data.forward_all;
  const best = data.forward.reduce((x, y) => (y.hit_p < x.hit_p && y.hit > all.hit ? y : x), top);
  return [
    {
      q: 'Natural gas rose in the month before every major decline',
      pass: b.rose_p < 0.05,
      ev: `${b.rose} of ${b.n} peaks, against ${share(b.rose_all)} of all months (p = ${pv(b.rose_p)}). Random timing would rarely line up this well.`,
    },
    {
      q: 'The rallies were unusually large',
      pass: b.gas_p < 0.05,
      ev: `Median run-up ${pct(b.gas_median)}, average ${pct(b.gas_mean)}, against ${pct(b.gas_all)} on a typical month (p = ${pv(b.gas_p)}). Most were small; one or two large rallies pull the average up.`,
    },
    {
      q: 'A bigger gas rally means a deeper crash',
      pass: b.p_depth < 0.05 && b.r_depth > 0,
      ev: `Correlation r = ${fmt(b.r_depth, 2)} (p = ${pv(b.p_depth)}). Against the time to the low: r = ${fmt(b.r_days, 2)}.`,
    },
    {
      q: 'A gas rally warns of a crash in real time',
      pass: best.hit_p < 0.05 && best.hit > all.hit,
      ev: `After gas gained ${bucketName(top)} in a month, a 15%+ fall followed within 6 months ${share(top.hit)} of the time, against ${share(all.hit)} on all days (p = ${pv(top.hit_p)}).`,
    },
  ];
}

function renderHeader(data, tests) {
  const b = data.backward;
  const passed = tests.filter((t) => t.pass).length;
  $('updated').textContent = `Data through ${day(data.latest.date)}`;
  $('byline').innerHTML =
    `<span><b>${b.n}</b> major declines since ${new Date(data.sample_start).getFullYear()}</span>` +
    `<span><b>${data.series.dates.length.toLocaleString()}</b> trading days</span>` +
    `<span>Refreshed every trading day</span>`;
  $('verdict').textContent = passed === 0
    ? 'The hypothesis fails every test.'
    : passed === tests.length
      ? 'The hypothesis survives every test.'
      : tests[0].pass
        ? 'Gas does rise before major crashes, but not by enough to warn you.'
        : 'The evidence is mixed.';
  $('abstract').textContent =
    `Gas rose in the month before all ${b.rose === b.n ? '' : `but ${b.n - b.rose} of the `}${b.n} major S&P 500 declines since 2001, a pattern random timing rarely produces (p = ${pv(b.rose_p)}). ` +
    `But the rises were mostly small, their size says nothing about how deep the fall was, and the same rallies happen all the time without a crash. ` +
    `${passed} of ${tests.length} tests ${passed === 1 ? 'supports' : 'support'} the idea. The likeliest reading: gas rallies with everything else late in a bull market, which is a description of tops, not a forecast of them.`;
  $('stats').innerHTML = [
    [`${b.rose}/${b.n}`, 'crashes preceded by a gas rise in the month before'],
    [pct(b.gas_median), 'median gas run-up before a crash peak'],
    [`r = ${fmt(b.r_depth, 2)}`, 'correlation of run-up size with crash depth'],
  ].map(([v, s]) => `<div><b>${v}</b><span>${s}</span></div>`).join('');
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
        ctx.textAlign = 'left';
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

// ── Section 2: one chart per crash ───────────────────────────────────────────
function renderCases(scenarios, b) {
  const gas = css('--gas');
  const crash = css('--crash');
  const big = scenarios.filter((s) => s.gas_1m >= 5).length;
  $('cases-lead').textContent =
    `Gas rose before all ${b.rose === b.n ? b.n : `${b.rose} of ${b.n}`}, but look at the size: only ${big} of the run-ups exceeded 5%, and three were under 1%. ` +
    'The percentile is where that month\'s gas move ranks among all months since 2001: 50 is an ordinary month.';
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
        <span>Gas <b class="gas">${pct(s.gas_1m)}</b> in the month before</span>
        <span>${s.pctile}th percentile</span>
      </div>
      <div class="case-box"><canvas id="case-${i}" aria-label="Natural gas and S&amp;P 500 around the ${month(s.peak)} peak"></canvas></div>
    </figure>`).join('');
  scenarios.forEach((s, i) => {
    new Chart($(`case-${i}`), {
      type: 'line',
      data: {
        labels: s.k,
        datasets: [
          { label: 'Natural gas', data: s.gas, borderColor: gas, borderWidth: 2, pointRadius: 0, yAxisID: 'g', fill: 'origin', backgroundColor: fade(gas, 0.25) },
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

// ── Figure 2: average gas path ───────────────────────────────────────────────
function renderGasPath(path, b) {
  const at21 = path.find((d) => d.k === -21);
  $('path-lead').textContent =
    `Averaged across the ${b.n} peaks, gas was ${pct(-at21.event)} higher at the top than a month earlier. ` +
    `The direction is consistent, but the size of that average move is ${at21.event < at21.lo ? 'outside' : 'inside'} the range random dates produce: ${at21.event < at21.lo ? 'unusually large' : 'an ordinary month for gas'}.`;
  const gas = css('--gas');
  const line = (key, extra) => ({ data: path.map((d) => d[key]), borderWidth: 2, pointRadius: 0, ...extra });
  const zero = { id: 'zero', beforeDatasetsDraw(chart) {
    const { ctx, chartArea: a, scales: { x } } = chart;
    const i0 = path.findIndex((d) => d.k === -21);
    const i1 = path.findIndex((d) => d.k === 0);
    ctx.save();
    ctx.fillStyle = rgba(gas, 0.12);
    ctx.fillRect(x.getPixelForValue(i0), a.top, x.getPixelForValue(i1) - x.getPixelForValue(i0), a.bottom - a.top);
    ctx.strokeStyle = css('--crash');
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(x.getPixelForValue(i1), a.top); ctx.lineTo(x.getPixelForValue(i1), a.bottom); ctx.stroke();
    ctx.fillStyle = css('--crash');
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    ctx.fillText('S&P peak', x.getPixelForValue(i1) + 6, a.top + 12);
    ctx.restore();
  } };
  new Chart($('gas-path'), {
    type: 'line',
    data: {
      labels: path.map((d) => d.k),
      datasets: [
        line('event', { label: 'Gas around a crash peak', borderColor: gas, borderWidth: 3 }),
        line('all', { label: 'Any day', borderColor: css('--muted'), borderWidth: 1.5, borderDash: [5, 4] }),
        line('lo', { borderColor: 'transparent', borderWidth: 0 }),
        line('hi', { label: 'Random dates, 5–95%', borderColor: 'transparent', borderWidth: 0, fill: '-1', backgroundColor: css('--band') }),
      ],
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { align: 'start', labels: { filter: (item) => item.datasetIndex !== 2, boxHeight: 8, boxWidth: 18 } },
        tooltip: { filter: (c) => c.datasetIndex < 2, callbacks: { title: (items) => `Day ${fmt(+items[0].label, 0)}`, label: (c) => ` ${c.dataset.label}  ${pct(c.raw)}` } },
      },
      scales: {
        x: { title: { display: true, text: 'Trading days from S&P peak' }, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: false, callback: (v, i) => (path[i].k % 21 === 0 ? path[i].k : null) } },
        y: { title: { display: true, text: 'Natural gas, % from peak day' }, ticks: { callback: (v) => `${v}%` }, grid: { color: (c) => (c.tick.value === 0 ? css('--muted') : css('--line')) } },
      },
    },
    plugins: [zero],
  });
}

// ── Figure 3: calendar ───────────────────────────────────────────────────────
function renderCalendar(monthly) {
  const up = css('--gas');
  const down = css('--cool');
  const color = (r) => (r == null ? 'transparent' : rgba(r >= 0 ? up : down, 0.08 + Math.min(Math.abs(r), 30) / 30 * 0.85));
  const byYear = new Map();
  monthly.forEach((m) => {
    if (!byYear.has(m.y)) byYear.set(m.y, Array(12).fill(null));
    byYear.get(m.y)[m.m - 1] = m;
  });
  const names = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  let html = '<span></span>' + names.map((n) => `<span class="h">${n}</span>`).join('');
  for (const [y, months] of byYear) {
    html += `<span class="y">${y}</span>` + months.map((m, i) => (m
      ? `<span class="c${m.pre ? ' pre' : ''}" style="background:${color(m.r)}" title="${names[i] === 'M' ? '' : ''}${new Date(y, i).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}: ${pct(m.r)}${m.pre ? ' · run-up or peak month' : ''}"></span>`
      : '<span></span>')).join('');
  }
  $('calendar').innerHTML = html;
  $('cal-scale').style.background = `linear-gradient(90deg, ${rgba(down, 0.93)}, ${rgba(down, 0.08)}, ${rgba(up, 0.08)}, ${rgba(up, 0.93)})`;
}

// ── Figure 4: scatter ────────────────────────────────────────────────────────
function renderScatter(scenarios, b) {
  $('scatter-lead').textContent =
    `If gas were driving the damage, bigger rallies should come before deeper falls. They do not: r = ${fmt(b.r_depth, 2)} (p = ${pv(b.p_depth)}). ` +
    'The deepest crash of the period, 2007–09, followed a modest rise; the largest rally, early 2025, came before one of the shallower declines.';
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
        data: scenarios.map((s) => ({ x: s.gas_1m, y: s.depth, r: 6 + Math.sqrt(s.days) * 1.3 })),
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
        tooltip: { callbacks: { label: (c) => { const s = scenarios[c.dataIndex]; return ` ${month(s.peak)}: gas ${pct(s.gas_1m)}, S&P ${pct(s.depth)} over ${s.days} days`; } } },
      },
      scales: {
        x: { title: { display: true, text: 'Gas move in the month before the peak' }, ticks: { callback: (v) => `${v}%` }, grid: { color: (c) => (c.tick.value === 0 ? css('--muted') : css('--line')) } },
        y: { title: { display: true, text: 'S&P 500 fall, peak to low' }, ticks: { callback: (v) => `${v}%` } },
      },
    },
    plugins: [labels],
  });
}

// ── Figure 5: real-time test ─────────────────────────────────────────────────
function renderForward(rows, all) {
  const top = rows[rows.length - 1];
  const best = Math.max(...rows.map((r) => r.hit));
  $('forward-lead').textContent =
    'Crash peaks are only known afterwards. To be useful, a gas rally would have to raise the odds of a crash before it happens. ' +
    `On a typical day, the odds of a 15%+ S&P fall within six months are ${share(all.hit)}. After a gas rally of ${bucketName(top)} they were ${share(top.hit)} (p = ${pv(top.hit_p)}). ` +
    (best < all.hit * 1.5 ? 'No bucket comes close to doubling the base rate: a gas rally is not a crash warning.' : '');
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
        x: { title: { display: true, text: 'Gas move over the past month' }, grid: { display: false } },
        y: { beginAtZero: true, suggestedMax: Math.ceil(best / 10) * 10 + 5, title: { display: true, text: 'Followed by a 15%+ fall in 6 months' }, ticks: { callback: (v) => `${v}%` } },
      },
    },
    plugins: [baseline],
  });
}

// ── Section 7 and today ──────────────────────────────────────────────────────
function renderScore(tests) {
  $('score').innerHTML = tests.map((t) => `<tr>
    <td class="q">${t.q}</td>
    <td><span class="chip ${t.pass ? 'pass' : 'fail'}">${t.pass ? 'Supported' : 'Not supported'}</span></td>
    <td class="ev">${t.ev}</td>
  </tr>`).join('');
}

function renderToday(data) {
  const { latest: l, forward: f, forward_all: all } = data;
  const b = f[l.bucket];
  $('today').innerHTML = `
    <div class="big ${l.gas_1m >= 0 ? 'gas' : ''}">${pct(l.gas_1m)}</div>
    <p>Natural gas over the past month, to ${day(l.date)} ($${l.ng.toFixed(2)}). The S&amp;P 500 is ${pct(l.sp_off_high)} from its high.
    Historically, after a gas move of ${bucketName(b)}, a 15%+ fall followed within six months ${share(b.hit)} of the time, against ${share(all.hit)} on all days.</p>`;
}

main().catch((e) => {
  console.error(e);
  $('verdict').textContent = 'Could not load natgas_data.json';
});
