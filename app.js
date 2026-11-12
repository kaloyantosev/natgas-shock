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

async function main() {
  const data = await (await fetch('natgas_data.json', { cache: 'no-cache' })).json();

  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = css('--muted');
  Chart.defaults.borderColor = css('--line');

  renderHero(data);
  renderForward(data.forward, data.forward_all);
  renderBackward(data.backward, data.scenarios);
  renderGasPath(data.gas_path);
  renderMultiples(data.scenarios);
  renderScatter(data.scenarios, data.backward);

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => location.reload());
}

function renderHero(data) {
  const { latest: l, forward: f, forward_all: all } = data;
  const b = f[l.bucket];
  const hot = b.dd10 > all.dd10 * 1.3;
  $('hero-state').textContent = l.gas_1m >= 10 ? 'Gas is running up' : 'No gas run-up';
  $('hero-dot').style.background = css(hot ? '--down' : l.gas_1m >= 10 ? '--gas' : '--muted');
  const top = f[f.length - 1];
  $('hero-desc').textContent =
    `Gas rose in the month before ${data.backward.rose} of the last ${data.backward.n} S&P 500 corrections. ` +
    `In real time, after gas gained ${bucketName(top)} in a month, a 10%+ fall followed within 3 months ${share(top.dd10)} of the time, against ${share(all.dd10)} for all days (p = ${pv(top.dd10_p)}). Smaller moves told you nothing.`;
  $('kpi-gas').textContent = pct(l.gas_1m);
  $('kpi-gas-sub').textContent = `bucket ${bucketName(b)}`;
  $('kpi-odds').textContent = share(b.dd10);
  $('kpi-odds-sub').textContent = `historically, vs ${share(all.dd10)} all days`;
  $('kpi-sp').textContent = pct(l.sp_off_high);
  $('kpi-sp-sub').textContent = `close of ${day(l.date)}`;
  $('updated').textContent = `Data refreshed ${day(data.generated_at.slice(0, 10))}`;
}

// ── Forward test ─────────────────────────────────────────────────────────────
function renderForward(rows, all) {
  const flagged = (r) => r.dd10_p < 0.05 && r.dd10 > all.dd10;
  const baseline = { id: 'baseline', afterDatasetsDraw(chart) {
    const { ctx, chartArea: a, scales: { y } } = chart;
    const py = y.getPixelForValue(all.dd10);
    ctx.save();
    ctx.strokeStyle = css('--muted');
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke();
    ctx.restore();
  } };
  new Chart($('forward'), {
    type: 'bar',
    data: {
      labels: rows.map(bucketName),
      datasets: [{ data: rows.map((r) => r.dd10), backgroundColor: rows.map((r) => css(flagged(r) ? '--down' : '--gas')), borderRadius: 4 }],
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${share(c.raw)} of ${rows[c.dataIndex].days} days (p = ${pv(rows[c.dataIndex].dd10_p)})` } } },
      scales: {
        x: { title: { display: true, text: 'Gas move over the past month' }, grid: { display: false } },
        y: { beginAtZero: true, title: { display: true, text: 'Followed by a 10%+ fall' }, ticks: { callback: (v) => `${v}%` } },
      },
    },
    plugins: [baseline],
  });

  $('forward-table').querySelector('tbody').innerHTML = rows
    .map((r) => `<tr>
      <td>${bucketName(r)}</td>
      <td class="r">${r.days}<span class="sub">${share(r.share)} of days</span></td>
      <td class="r ${flagged(r) ? 'neg' : ''}">${share(r.dd10)}<span class="sub">p = ${pv(r.dd10_p)}</span></td>
      <td class="r">${pct(r.mdd)}</td>
    </tr>`)
    .join('') +
    `<tr><td><b>All days</b></td><td class="r"></td><td class="r"><b>${share(all.dd10)}</b></td><td class="r"><b>${pct(all.mdd)}</b></td></tr>`;
}

// ── Backward test ────────────────────────────────────────────────────────────
function renderBackward(b, scenarios) {
  const big = scenarios.filter((s) => s.gas_1m >= 5).length;
  $('back-lead').textContent =
    `Gas rose in the month before ${b.rose} of ${b.n} peaks, against ${share(b.rose_all)} of all months (p = ${pv(b.rose_p)}). ` +
    `The direction is consistent, but the size is not: only ${big} of the run-ups exceeded 5%, and the average (${pct(b.gas_mean)}) is not clearly above normal (p = ${pv(b.gas_p)}).`;
  $('back-kpis').innerHTML = [
    ['Gas rose before', `${b.rose} of ${b.n}`, `vs ${share(b.rose_all)} of all months`],
    ['Median run-up', pct(b.gas_median), `average ${pct(b.gas_mean)}`],
    ['Average fall', pct(b.depth_mean), 'peak to low'],
    ['Median time to low', `${b.days_median} days`, 'trading days'],
  ].map(([t, v, s]) => `<div><dt>${t}</dt><dd>${v}</dd><span class="muted small">${s}</span></div>`).join('');
}

function renderGasPath(path) {
  const line = (key, extra) => ({ data: path.map((d) => d[key]), borderWidth: 2, pointRadius: 0, ...extra });
  new Chart($('gas-path'), {
    type: 'line',
    data: {
      labels: path.map((d) => d.k),
      datasets: [
        line('event', { label: 'Gas around an S&P peak', borderColor: css('--gas') }),
        line('all', { label: 'All days', borderColor: css('--muted'), borderWidth: 1.5, borderDash: [4, 3] }),
        line('lo', { borderColor: 'transparent', borderWidth: 0 }),
        line('hi', { borderColor: 'transparent', borderWidth: 0, fill: '-1', backgroundColor: css('--band') }),
      ],
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { filter: (item) => item.datasetIndex < 2, boxHeight: 1 } },
        tooltip: { filter: (c) => c.datasetIndex < 2, callbacks: { title: (items) => `Day ${fmt(+items[0].label, 0)}`, label: (c) => `${c.dataset.label}: ${pct(c.raw)}` } },
      },
      scales: {
        x: { title: { display: true, text: 'Trading days from S&P peak' }, grid: { color: (c) => (path[c.index]?.k === 0 ? css('--muted') : 'transparent') }, ticks: { maxRotation: 0, autoSkip: false, callback: (v, i) => (path[i].k % 21 === 0 ? path[i].k : null) } },
        y: { title: { display: true, text: 'Natural gas, % from day 0' } },
      },
    },
  });
}

// ── One chart per correction ─────────────────────────────────────────────────
function renderMultiples(scenarios) {
  const shade = { id: 'shade', beforeDatasetsDraw(chart) {
    const { ctx, chartArea: a, scales: { x } } = chart;
    const ks = chart.data.labels;
    const x0 = x.getPixelForValue(ks.indexOf(-21));
    const x1 = x.getPixelForValue(ks.indexOf(0));
    ctx.save();
    ctx.fillStyle = css('--band');
    ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
    ctx.restore();
  } };
  const list = [...scenarios].reverse();
  $('multiples').innerHTML = list.map((s, i) => `
    <figure class="card mult">
      <figcaption><b>${month(s.peak)}</b> <span class="muted">· ${s.bear ? 'bear market' : 'correction'}</span>
        <span class="mult-stats"><span class="neg">S&amp;P ${pct(s.depth)}</span> in ${s.days} trading days · <span style="color:${css('--gas')}">gas ${pct(s.gas_1m)}</span> in the month before</span></figcaption>
      <div class="mult-box"><canvas id="mult-${i}" aria-label="Natural gas and S&amp;P 500 around the ${month(s.peak)} peak"></canvas></div>
    </figure>`).join('');
  list.forEach((s, i) => {
    new Chart($(`mult-${i}`), {
      type: 'line',
      data: {
        labels: s.k,
        datasets: [
          { label: 'Natural gas', data: s.gas, borderColor: css('--gas'), borderWidth: 1.5, pointRadius: 0, yAxisID: 'g' },
          { label: 'S&P 500', data: s.sp, borderColor: css('--fg'), borderWidth: 1.5, pointRadius: 0, yAxisID: 's' },
        ],
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: (items) => `Day ${fmt(+items[0].label, 0)} from peak`, label: (c) => `${c.dataset.label}: ${pct(c.raw)}` } } },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: false, callback: (v, j) => (s.k[j] % 63 === 0 ? s.k[j] : null) } },
          g: { position: 'left', ticks: { color: css('--gas'), callback: (v) => `${v}%` }, grid: { color: (c) => (c.tick.value === 0 ? css('--line') : 'transparent') } },
          s: { position: 'right', ticks: { callback: (v) => `${v}%` }, grid: { display: false } },
        },
      },
      plugins: [shade],
    });
  });
}

// ── Run-up size against fall ─────────────────────────────────────────────────
function renderScatter(scenarios, b) {
  const strong = Math.abs(b.r_depth) >= 0.5 && b.p_depth < 0.05;
  $('scatter-lead').textContent =
    `${strong ? 'Possibly.' : 'No.'} Correlation between the gas move in the month before the peak and the depth of the fall: r = ${fmt(b.r_depth, 2)} (p = ${pv(b.p_depth)}); rank correlation ${fmt(b.rho_depth, 2)}. ` +
    `Against the time to the low: r = ${fmt(b.r_days, 2)} (p = ${pv(b.p_days)}). Red dots are bear markets (20%+).`;
  const labels = { id: 'labels', afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.fillStyle = css('--muted');
    ctx.font = '12px system-ui, sans-serif';
    chart.getDatasetMeta(0).data.forEach((pt, i) => ctx.fillText(month(scenarios[i].peak), pt.x + 8, pt.y + 4));
    ctx.restore();
  } };
  new Chart($('scatter'), {
    type: 'scatter',
    data: { datasets: [{ data: scenarios.map((s) => ({ x: s.gas_1m, y: s.depth })), pointRadius: 6, backgroundColor: scenarios.map((s) => css(s.bear ? '--down' : '--gas')) }] },
    options: {
      animation: false,
      maintainAspectRatio: false,
      layout: { padding: { right: 60 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${month(scenarios[c.dataIndex].peak)}: gas ${pct(c.raw.x)}, S&P ${pct(c.raw.y)}` } } },
      scales: {
        x: { title: { display: true, text: 'Gas move in the month before the peak' }, ticks: { callback: (v) => `${v}%` } },
        y: { title: { display: true, text: 'S&P 500 fall, peak to low' }, ticks: { callback: (v) => `${v}%` } },
      },
    },
    plugins: [labels],
  });
}

main().catch((e) => {
  console.error(e);
  $('hero-state').textContent = 'Could not load natgas_data.json';
});
