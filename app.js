// Natural Gas Shock Monitor: renders natgas_data.json (built by fetch_data.py).

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const $ = (id) => document.getElementById(id);
const fmt = (x, d = 1) => (x == null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d)}`);
const pct = (x, d = 1) => (x == null ? '—' : `${fmt(x, d)}%`);
const signed = (x, d = 1) => (x == null ? '—' : `<span class="${x >= 0 ? 'pos' : 'neg'}">${pct(x, d)}</span>`);
const pval = (p) => (p == null ? '' : `<span class="sub">p = ${p < 0.001 ? '<0.001' : p.toFixed(2)}</span>`);
const day = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

async function main() {
  const data = await (await fetch('natgas_data.json', { cache: 'no-cache' })).json();

  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = css('--muted');
  Chart.defaults.borderColor = css('--line');

  renderHero(data);
  renderStudy(data.path);
  renderHistory(data.series, data.events);
  renderResults(data.results);
  renderRobustness(data.robustness);
  renderEvents(data.events);
  $('m-z').textContent = data.params.z_spike;

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => location.reload());
}

function renderHero(data) {
  const { latest: l, params: p, sample: s } = data;
  const active = l.days_since_event != null && l.days_since_event <= p.refractory;
  $('hero-date').textContent = `Close of ${day(l.date)}`;
  $('hero-state').textContent = active ? 'Gas spike' : 'No gas spike';
  $('hero-dot').style.background = css(active ? '--gas' : '--muted');

  const r = data.results.find((x) => x.horizon === '3m');
  const significant = data.results.some((x) => x.ret_p_vix != null && x.ret_p_vix < 0.05);
  $('hero-desc').textContent =
    `In the 3 months after a spike the S&P 500 returned ${pct(r.ret_event)} on average, against ${pct(r.ret_all)} for a typical day. ` +
    (significant
      ? 'At some horizons the gap is larger than chance would usually produce; see the table below.'
      : 'The gap is well within chance: on this evidence a gas spike says nothing about where stocks go next.');

  $('kpi-gas').textContent = pct(l.ng_5d);
  $('kpi-gas-sub').textContent = `${fmt(l.z)} standard deviations; a spike is ≥ ${p.z_spike}`;
  $('kpi-vix').textContent = l.vix.toFixed(1);
  $('kpi-last').textContent = l.last_event ? day(l.last_event) : '—';
  $('kpi-last-sub').textContent = l.days_since_event == null ? '' : `${l.days_since_event} trading days ago`;
  $('hero-note').textContent = `${s.events} spikes since ${day(s.start)}. Henry Hub front-month future at $${l.ng.toFixed(2)}.`;
  $('updated').textContent = `Data refreshed ${day(data.generated_at.slice(0, 10))}`;
}

// ── Event study ───────────────────────────────────────────────────────────────
function renderStudy(path) {
  const line = (key, color, extra = {}) => ({ data: path.map((d) => d[key]), borderColor: color, borderWidth: 2, pointRadius: 0, ...extra });
  new Chart($('study'), {
    type: 'line',
    data: {
      labels: path.map((d) => d.k),
      datasets: [
        line('event', css('--gas'), { label: 'After a gas spike' }),
        line('all', css('--muted'), { label: 'All days', borderWidth: 1.5, borderDash: [4, 3] }),
        line('lo', 'transparent', { label: 'Placebo 5%', borderWidth: 0 }),
        line('hi', 'transparent', { label: 'Placebo 95%', borderWidth: 0, fill: '-1', backgroundColor: css('--band') }),
      ],
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { filter: (item) => item.datasetIndex < 2, boxHeight: 1 } },
        tooltip: { callbacks: { title: (items) => `Day ${fmt(+items[0].label, 0)}`, label: (c) => `${c.dataset.label}: ${pct(c.raw)}` } },
      },
      scales: {
        x: { title: { display: true, text: 'Trading days from spike' }, grid: { color: (c) => (path[c.index]?.k === 0 ? css('--muted') : 'transparent') }, ticks: { maxRotation: 0, autoSkip: false, callback: (v, i) => (path[i].k % 21 === 0 ? path[i].k : null) } },
        y: { title: { display: true, text: 'S&P 500, % from day 0' } },
      },
    },
  });
}

// ── History chart ─────────────────────────────────────────────────────────────
function renderHistory(series, events) {
  const spikes = new Map(events.map((e) => [e.date, e]));
  const year = (i) => series.dates[i].slice(0, 4);
  const chart = new Chart($('history'), {
    type: 'line',
    data: {
      labels: series.dates,
      datasets: [
        {
          label: 'Spike',
          data: series.dates.map((d, i) => (spikes.has(d) ? series.ng[i] : null)),
          showLine: false,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: css('--down'),
          pointBorderColor: css('--surface'),
          yAxisID: 'y',
        },
        { label: 'Natural gas', data: series.ng, borderColor: css('--gas'), borderWidth: 1.5, pointRadius: 0, yAxisID: 'y' },
        { label: 'S&P 500', data: series.sp, borderColor: css('--muted'), borderWidth: 1, pointRadius: 0, yAxisID: 'sp', hidden: true },
      ],
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (c) => c.datasetIndex > 0,
          callbacks: {
            title: (items) => day(items[0].label),
            afterTitle: (items) => {
              const e = spikes.get(items[0].label);
              return e ? `Spike: gas ${pct(e.ng_5d)} in 5 days (z ${fmt(e.z)})` : '';
            },
            label: (c) => (c.dataset.yAxisID === 'sp' ? `S&P 500: ${c.raw?.toLocaleString()}` : `Natural gas: $${c.raw?.toFixed(2)}`),
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: false, callback: (v, i) => (i > 0 && year(i) !== year(i - 1) && +year(i) % 5 === 0 ? year(i) : null) } },
        y: { type: 'logarithmic', title: { display: true, text: 'Henry Hub, $/MMBtu (log)' }, ticks: { callback: (v) => ([1, 2, 5, 10, 15].includes(v) ? `$${v}` : null) } },
        sp: { type: 'logarithmic', position: 'right', display: false, grid: { display: false }, ticks: { callback: (v) => ([1000, 2000, 5000, 10000].includes(v) ? v.toLocaleString() : null) } },
      },
    },
  });

  $('sp-toggle').addEventListener('change', (e) => {
    chart.data.datasets[2].hidden = !e.target.checked;
    chart.options.scales.sp.display = e.target.checked;
    chart.update();
  });

  $('legend').innerHTML =
    `<span><i style="background:${css('--gas')}"></i>Natural gas (NG=F)</span>` +
    `<span><i style="background:${css('--down')};border-radius:50%"></i>Spike</span>` +
    `<span><i style="background:${css('--muted')}"></i>S&P 500 (toggle)</span>`;
}

// ── Tables ────────────────────────────────────────────────────────────────────
const HORIZON = { '1m': '1 month', '3m': '3 months', '6m': '6 months' };
const share = (x) => (x == null ? '—' : `${x.toFixed(0)}%`);

function renderResults(rows) {
  $('results-table').querySelector('tbody').innerHTML = rows
    .map((r) => `<tr>
      <td>${HORIZON[r.horizon]}<span class="sub">${r.days} trading days</span></td>
      <td class="r">${r.n}</td>
      <td class="r">${signed(r.ret_event)}</td>
      <td class="r">${pct(r.ret_all)}</td>
      <td class="r">${fmt(r.ret_diff)} pp${pval(r.ret_p)}</td>
      <td class="r">${fmt(r.ret_diff_vix)} pp${pval(r.ret_p_vix)}</td>
      <td class="r">${share(r.dd_event)}${pval(r.dd_p_vix)}</td>
      <td class="r">${share(r.dd_all)}</td>
    </tr>`)
    .join('');
}

function renderRobustness(rows) {
  $('robust-table').querySelector('tbody').innerHTML = rows
    .map((r) => `<tr>
      <td>${r.label}</td>
      <td class="r">${r.n}</td>
      <td class="r">${signed(r.ret_event)}</td>
      <td class="r">${pct(r.ret_all)}</td>
      <td class="r">${fmt(r.ret_diff)} pp${pval(r.ret_p)}</td>
      <td class="r">${fmt(r.ret_diff_vix)} pp${pval(r.ret_p_vix)}</td>
      <td class="r">${share(r.dd_event)} / ${share(r.dd_all)}</td>
    </tr>`)
    .join('');
}

function renderEvents(events) {
  $('events-table').querySelector('tbody').innerHTML = [...events]
    .reverse()
    .map((e) => `<tr>
      <td>${day(e.date)}</td>
      <td class="r">$${e.ng.toFixed(2)}</td>
      <td class="r">${pct(e.ng_5d)}</td>
      <td class="r">${fmt(e.z)}</td>
      <td class="r">${e.vix.toFixed(1)}</td>
      <td class="r">${signed(e.sp_1m)}</td>
      <td class="r">${signed(e.sp_3m)}</td>
      <td class="r">${signed(e.sp_6m)}</td>
      <td class="r">${pct(e.mdd_3m)}</td>
    </tr>`)
    .join('');
}

main().catch((e) => {
  console.error(e);
  $('hero-date').textContent = 'Could not load natgas_data.json';
});
