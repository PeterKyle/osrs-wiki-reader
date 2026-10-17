'use strict';
/* Live Grand Exchange prices (prices.runescape.wiki), the watchlist and bookmarks. */

const RANGES = {            // label -> [timestep, days shown]
  '1W': ['1h', 7],
  '1M': ['6h', 30],
  '3M': ['6h', 91],
  '1Y': ['24h', 365],
};
const itemIcon = (icon) => `${WIKI}/images/${encodeURIComponent(icon.replace(/ /g, '_'))}`;
const gp = (n) => (n == null ? '–' : fmt(n));

// GE tax: 2% of the sale price, capped at 5M, nothing on items under 50 gp
const geTax = (price) => (price < 50 ? 0 : Math.min(Math.floor(price * 0.02), 5e6));

function changeHtml(now, ref) {
  if (!now || !ref) return '<span class="chg flat">–</span>';
  const pct = ((now - ref) / ref) * 100;
  if (Math.abs(pct) < 0.05) return '<span class="chg flat">0.0%</span>';
  const up = pct > 0;
  return `<span class="chg ${up ? 'up' : 'down'}" title="vs. 24h average">${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%</span>`;
}

// "850k", "1.2m", "2,500,000" -> number
function parseGp(text) {
  const m = String(text).trim().toLowerCase().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*([kmb])?(?:\s*gp)?$/);
  if (!m) return null;
  const v = parseFloat(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[m[2]] || 1);
  return v > 0 ? Math.round(v) : null;
}

// Called from Python when alerts trigger
window.onAlertsFired = function (fired) {
  const done = new Set(fired.map((a) => a.id + a.dir));
  state.alerts = (state.alerts || []).filter((a) => !done.has(a.id + a.dir));
  fired.forEach((a) => toast(`${a.name} has ${a.dir === 'above' ? 'risen above' : 'dropped below'} ${fmt(a.price)} gp`));
  const panel = els.article.querySelector('.ge-panel');
  if (panel && panel.renderItemAlerts) panel.renderItemAlerts();
  if (!els.home.hidden) renderHomeExtras();
};

/* ---------------- price panel on item pages ---------------- */

window.showPrice = async function (pageTitle) {
  const info = await api.item_price(pageTitle);
  const cur = nav.stack[nav.idx];
  if (!info || !cur || cur.kind !== 'page' || cur.title !== pageTitle) return;
  const heading = els.article.querySelector('.page-heading');
  if (!heading) return;

  const panel = document.createElement('section');
  panel.className = 'ge-panel';
  heading.after(panel);
  if (info.error) {
    panel.innerHTML = `<div class="ge-head"><span class="ge-title">Grand Exchange</span><span class="ge-upd">${escapeHtml(info.error)}</span></div>`;
    return;
  }

  const watching = (state.watchlist || []).includes(info.id);
  const margin = info.high && info.low ? info.high - info.low - geTax(info.high) : null;
  const lastTrade = Math.max(info.highTime || 0, info.lowTime || 0);
  const alchDiff = info.highalch && info.high ? info.highalch - info.high : null;

  panel.innerHTML = `
    <div class="ge-head">
      ${info.icon ? `<img src="${itemIcon(info.icon)}" alt="">` : ''}
      <span class="ge-title">Grand Exchange</span>
      <span class="ge-upd">${lastTrade ? 'last trade ' + timeAgo(lastTrade) : ''}</span>
      <button class="cbtn" id="geAlertBtn" title="Get a Windows notification when the price crosses a target">${svgIcon('i-bell')}<span>Alert</span></button>
      <button class="cbtn${watching ? ' on' : ''}" id="geWatch" title="Show this item's price on the home screen">${svgIcon('i-star')}<span>${watching ? 'Watching' : 'Watch'}</span></button>
    </div>
    <div class="ge-alert" id="geAlert" hidden>
      <form class="ge-alert-form" id="geAlertForm">
        <span>Notify me when the price goes</span>
        <select id="geAlertDir"><option value="above">above</option><option value="below">below</option></select>
        <input id="geAlertPrice" type="text" inputmode="decimal" value="${info.high ? fmt(info.high) : ''}" autocomplete="off" spellcheck="false">
        <span>gp</span>
        <button class="btn small" type="submit">Set alert</button>
      </form>
      <div id="geAlertList"></div>
      <p class="dim">Checked every 5 minutes while the reader is running (even when it's hidden).</p>
    </div>
    <div class="ge-stats">
      <div><b>${gp(info.high)}</b><span>Instant buy</span></div>
      <div><b>${gp(info.low)}</b><span>Instant sell</span></div>
      <div><b class="${margin > 0 ? 'pos' : margin < 0 ? 'neg' : ''}">${margin == null ? '–' : fmt(margin)}</b><span>Margin after tax</span></div>
      <div><b>${fmt(info.volume24)}</b><span>Traded in 24h</span></div>
    </div>
    <div class="ge-sub">
      ${changeHtml(info.high, info.avgHigh24)} vs. 24h average
      ${info.limit ? ` · Buy limit ${fmt(info.limit)}` : ''}
      ${info.highalch ? ` · High alch ${fmt(info.highalch)}${alchDiff > 0 ? ` <span class="pos">(+${fmtShort(alchDiff)} vs GE)</span>` : ''}` : ''}
    </div>
    <div class="ge-chart-head">
      <span>Average price</span>
      <div class="seg" id="geRange">${Object.keys(RANGES).map((r) => `<button data-r="${r}"${r === '1M' ? ' class="on"' : ''}>${r}</button>`).join('')}</div>
    </div>
    <div class="ge-chart" id="geChart"><div class="ge-empty">Loading chart…</div></div>`;

  const watchBtn = $('geWatch');
  const setWatching = (on) => {
    watchBtn.classList.toggle('on', on);
    watchBtn.querySelector('span').textContent = on ? 'Watching' : 'Watch';
  };
  watchBtn.onclick = async () => {
    const on = await api.toggle_watch(info.id);
    state = await api.get_state();
    setWatching(on);
    renderItemAlerts();
  };

  const renderItemAlerts = () => {
    const mine = (state.alerts || []).filter((a) => a.id === info.id);
    $('geAlertBtn').classList.toggle('on', mine.length > 0);
    $('geAlertList').innerHTML = mine.map((a) => `
      <span class="alert-chip">${svgIcon('i-bell')} ${a.dir === 'above' ? 'Above' : 'Below'} ${fmt(a.price)} gp
        <button data-dir="${a.dir}" title="Remove alert">${svgIcon('i-x')}</button></span>`).join('');
  };
  panel.renderItemAlerts = renderItemAlerts;
  renderItemAlerts();
  $('geAlertBtn').onclick = () => {
    $('geAlert').hidden = !$('geAlert').hidden;
    if (!$('geAlert').hidden) $('geAlertPrice').focus();
  };
  $('geAlertForm').onsubmit = async (e) => {
    e.preventDefault();
    const price = parseGp($('geAlertPrice').value);
    if (!price) { toast('Enter a price, like 850,000 or 850k.'); return; }
    state = await api.set_alert(info.id, $('geAlertDir').value, price);
    setWatching(true);
    renderItemAlerts();
    toast(`You'll get a notification when ${info.name} goes ${$('geAlertDir').value} ${fmt(price)} gp.`);
  };
  $('geAlertList').onclick = async (e) => {
    const b = e.target.closest('button[data-dir]');
    if (!b) return;
    state = await api.remove_alert(info.id, b.dataset.dir);
    renderItemAlerts();
  };

  const chart = $('geChart');
  let range = '1M';
  let series = [];
  const load = async () => {
    const [step, days] = RANGES[range];
    chart.classList.add('stale');
    const raw = await api.price_history(info.id, step);
    if (!chart.isConnected) return;
    const cutoff = Date.now() / 1000 - days * 86400;
    series = raw.filter((d) => d[0] >= cutoff)
      .map(([t, hi, lo]) => ({ t, hi, lo, v: hi && lo ? (hi + lo) / 2 : hi || lo }))
      .filter((d) => d.v);
    chart.classList.remove('stale');
    drawChart(chart, series, range);
  };
  $('geRange').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.r === range) return;
    range = b.dataset.r;
    $('geRange').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    load();
  };
  new ResizeObserver(() => series.length && drawChart(chart, series, range)).observe(chart);
  load();
};

function niceTicks(min, max) {
  const span = max - min || max || 1;
  const step0 = span / 3;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const lo = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = lo; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function drawChart(box, data, range) {
  if (data.length < 2) {
    box.innerHTML = '<div class="ge-empty">Not enough trades to chart this range.</div>';
    return;
  }
  const W = box.clientWidth, H = 150, padL = 46, padR = 8, padT = 8, padB = 22;
  const vals = data.map((d) => d.v);
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const t0 = data[0].t, t1 = data[data.length - 1].t;
  const x = (t) => padL + ((t - t0) / (t1 - t0 || 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - y0) / (y1 - y0 || 1)) * (H - padT - padB);
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(d.t).toFixed(1)},${y(d.v).toFixed(1)}`).join('');
  const area = `${line}L${x(t1).toFixed(1)},${H - padB}L${x(t0).toFixed(1)},${H - padB}Z`;
  const dateFmt = { month: 'short', day: 'numeric', ...(range === '1Y' ? { year: '2-digit' } : {}) };
  const dstr = (t) => new Date(t * 1000).toLocaleDateString(undefined, dateFmt);

  box.innerHTML = `
    <svg width="${W}" height="${H}" role="img" aria-label="Average GE price over the last ${range}">
      <defs><linearGradient id="geFill" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="var(--chart)" stop-opacity=".28"/><stop offset="1" stop-color="var(--chart)" stop-opacity="0"/>
      </linearGradient></defs>
      ${ticks.map((v) => `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>
        <text class="axis" x="${padL - 6}" y="${y(v) + 3.5}" text-anchor="end">${fmtShort(v)}</text>`).join('')}
      <text class="axis" x="${padL}" y="${H - 6}">${dstr(t0)}</text>
      <text class="axis" x="${W - padR}" y="${H - 6}" text-anchor="end">${dstr(t1)}</text>
      <path d="${area}" fill="url(#geFill)"/>
      <path d="${line}" class="ln"/>
      <g class="hover" visibility="hidden"><line class="xh" y1="${padT}" y2="${H - padB}"/><circle r="4"/></g>
      <rect class="hit" x="${padL}" y="0" width="${W - padL - padR}" height="${H}" tabindex="0"/>
    </svg>
    <div class="ge-tip" hidden></div>`;

  const svg = box.querySelector('svg'), hover = svg.querySelector('.hover'), tip = box.querySelector('.ge-tip');
  const hit = svg.querySelector('.hit');
  const showAt = (i) => {
    const d = data[i];
    const px = x(d.t), py = y(d.v);
    hover.setAttribute('visibility', 'visible');
    hover.querySelector('.xh').setAttribute('x1', px);
    hover.querySelector('.xh').setAttribute('x2', px);
    hover.querySelector('circle').setAttribute('cx', px);
    hover.querySelector('circle').setAttribute('cy', py);
    const when = new Date(d.t * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: range === '1Y' ? undefined : 'numeric', year: range === '1Y' ? 'numeric' : undefined });
    tip.innerHTML = '';
    const v = document.createElement('b'); v.textContent = fmt(Math.round(d.v)) + ' gp';
    const w = document.createElement('span'); w.textContent = when;
    const bs = document.createElement('small'); bs.textContent = `Buy ${gp(d.hi)} · Sell ${gp(d.lo)}`;
    tip.append(v, w, bs);
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = Math.min(Math.max(px - tw / 2, 0), W - tw) + 'px';
  };
  const nearest = (clientX) => {
    const r = svg.getBoundingClientRect();
    const t = t0 + ((clientX - r.left - padL) / (W - padL - padR)) * (t1 - t0);
    let best = 0;
    data.forEach((d, i) => { if (Math.abs(d.t - t) < Math.abs(data[best].t - t)) best = i; });
    return best;
  };
  let focusIdx = data.length - 1;
  hit.addEventListener('pointermove', (e) => showAt((focusIdx = nearest(e.clientX))));
  hit.addEventListener('pointerleave', () => { hover.setAttribute('visibility', 'hidden'); tip.hidden = true; });
  hit.addEventListener('focus', () => showAt(focusIdx));
  hit.addEventListener('blur', () => { hover.setAttribute('visibility', 'hidden'); tip.hidden = true; });
  hit.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      focusIdx = Math.max(0, Math.min(data.length - 1, focusIdx + (e.key === 'ArrowRight' ? 1 : -1)));
      showAt(focusIdx);
    }
  });
}

/* ---------------- home: watchlist + bookmarks ---------------- */

let watchToken = 0;
window.renderHomeExtras = async function () {
  if (window.renderTimers) renderTimers();
  const marks = state.bookmarks || [];
  $('bookmarksWrap').hidden = !marks.length;
  $('bookmarks').innerHTML = marks.map((t) =>
    `<button class="chip bm" data-title="${escapeHtml(t)}">${svgIcon('i-bookmark')}${escapeHtml(t)}</button>`).join('');

  const wrap = $('watchWrap'), box = $('watch');
  if (!(state.watchlist || []).length) { wrap.hidden = true; return; }
  wrap.hidden = false;
  if (!box.children.length) box.innerHTML = '<div class="row"><span class="dim">Loading prices…</span></div>';
  const token = ++watchToken;
  const items = await api.watchlist();
  if (token !== watchToken) return;
  if (items.error) { box.innerHTML = `<div class="row"><span class="dim">${escapeHtml(items.error)}</span></div>`; return; }
  box.innerHTML = items.map((it) => {
    const al = (state.alerts || []).filter((a) => a.id === it.id)
      .map((a) => `${a.dir === 'above' ? '≥' : '≤'} ${fmtShort(a.price)}`).join(', ');
    return `
    <div class="row witem" data-title="${escapeHtml(it.name)}">
      <span class="wname">${it.icon ? `<img src="${itemIcon(it.icon)}" alt="">` : ''}<span>${escapeHtml(it.name)}</span>${al ? `<small class="walert" title="Price alert">${svgIcon('i-bell')}${al}</small>` : ''}</span>
      ${changeHtml(it.high, it.avgHigh24)}
      <b>${gp(it.high)}</b>
      <button class="wx" data-id="${it.id}" title="Remove from watchlist">${svgIcon('i-x')}</button>
    </div>`;
  }).join('');
};

$('bookmarks').onclick = (e) => {
  const b = e.target.closest('.chip');
  if (b) openPage(b.dataset.title);
};
$('watch').onclick = async (e) => {
  const x = e.target.closest('.wx');
  if (x) {
    e.stopPropagation();
    await api.toggle_watch(+x.dataset.id);
    state = await api.get_state();
    renderHomeExtras();
    return;
  }
  const row = e.target.closest('.witem');
  if (row) openPage(row.dataset.title);
};

/* ---------------- bookmark button ---------------- */

const bmBtn = $('btnBookmark');
window.updateBookmarkBtn = function () {
  const cur = nav.stack[nav.idx];
  const onPage = cur && cur.kind === 'page' && !els.article.hidden;
  bmBtn.disabled = !onPage;
  const on = onPage && (state.bookmarks || []).includes(cur.title);
  bmBtn.classList.toggle('on', on);
  bmBtn.title = on ? 'Remove bookmark' : 'Bookmark this page';
};
bmBtn.onclick = async () => {
  const cur = nav.stack[nav.idx];
  if (!cur || cur.kind !== 'page') return;
  state = await api.toggle_bookmark(cur.title);
  updateBookmarkBtn();
};
