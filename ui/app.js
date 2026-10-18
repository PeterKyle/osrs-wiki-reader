'use strict';

const WIKI = 'https://oldschool.runescape.wiki';
const EXTERNAL_NS = /^(File|Special|Category|Template|Module|User|User talk|Talk|MediaWiki|Help|Map|Property|Exchange|RuneScape|Transcript):/i;

const QUICK = [
  ['Quests', 'Quest_point_icon.png'],
  ['Optimal quest guide', 'Quest_list_icon.png'],
  ['Money making guide', 'Coins_10000.png'],
  ['Slayer task', 'Slayer_icon.png'],
  ['Treasure Trails', 'Clue_scroll_(elite).png'],
  ['Achievement Diary', 'Achievement_Diaries_icon.png'],
  ['Combat Achievements', 'Combat_achievements_icon.png'],
  ['Grand Exchange', 'Grand_Exchange_icon.png'],
  ['Skills', 'Stats_icon.png'],
  ['Farming training', 'Farming_icon.png'],
];

const $ = (id) => document.getElementById(id);
const els = {
  scroller: $('scroller'), home: $('home'), article: $('article'), error: $('error'), errorMsg: $('errorMsg'), char: $('char'),
  search: $('search'), suggest: $('suggest'), progress: $('progress'), pageTitle: $('pageTitle'),
  back: $('btnBack'), fwd: $('btnFwd'), toc: $('btnToc'), ext: $('btnExt'), pin: $('btnPin'),
  tocPop: $('tocPop'), tocList: $('tocList'), setPop: $('setPop'),
};

let api = null;
let state = {};
const nav = { stack: [], idx: -1 };   // entries: { kind: 'home'|'page'|'char'|'compare', title, scroll }
let loadToken = 0;
let lastFailed = null;

/* ---------------- startup ---------------- */

window.addEventListener('pywebviewready', async () => {
  api = window.pywebview.api;
  state = await api.get_state();
  applyTheme(state.theme);
  applyZoom(state.zoom);
  els.pin.classList.toggle('on', state.pinned);
  $('ver').textContent = 'v' + state.version;
  renderHotkey();
  renderHome();
  goHome(true);
  focusSearch();
});

window.focusSearch = function () {
  els.search.focus();
  els.search.select();
};

/* ---------------- window chrome ---------------- */

// Pressing the title bar hands the drag to Windows (Snap Layouts bar, edge snapping). Windows then owns the
// mouse, so a double-click is spotted from two quick presses rather than the dblclick event.
let lastPress = { t: 0, x: 0, y: 0 };
$('titlebar').addEventListener('mousedown', (e) => {
  if (e.button !== 0 || e.target.closest('button') || !api) return;
  const double = e.timeStamp - lastPress.t < 450 && Math.abs(e.screenX - lastPress.x) < 6 && Math.abs(e.screenY - lastPress.y) < 6;
  lastPress = double ? { t: 0, x: 0, y: 0 } : { t: e.timeStamp, x: e.screenX, y: e.screenY };
  if (double && !isMini()) toggleMax();
  else api.start_drag();
});
document.querySelectorAll('.grips > div').forEach((g) => {
  g.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    api && api.start_resize(g.dataset.edge);
  });
});
$('btnMin').onclick = () => api.minimize();
$('btnClose').onclick = () => api.close();

// maximize / restore: the button, or double-click the title bar (like any Windows app)
window.onMaxState = function (maxed) {
  const b = $('btnMax');
  b.querySelector('use').setAttribute('href', maxed ? '#i-restore' : '#i-max');
  b.title = maxed ? 'Restore' : 'Maximize';
  document.body.classList.toggle('maxed', maxed);
};
const toggleMax = async () => onMaxState(await api.toggle_maximize());
$('btnMax').onclick = toggleMax;
window.addEventListener('pywebviewready', () => setTimeout(async () => onMaxState(await api.is_maximized()), 300));
// Windows can maximize/restore it too (Win+Up/Down, Snap Assist): re-check after the window settles
let maxCheck = null;
window.addEventListener('resize', () => {
  clearTimeout(maxCheck);
  maxCheck = setTimeout(async () => { if (api) onMaxState(await api.is_maximized()); }, 150);
});
els.pin.onclick = async () => els.pin.classList.toggle('on', await api.toggle_pin());

/* ---------------- navigation ---------------- */

function saveScroll() {
  if (nav.idx >= 0) nav.stack[nav.idx].scroll = els.scroller.scrollTop;
}

function pushEntry(kind, title = null) {
  saveScroll();
  nav.stack = nav.stack.slice(0, nav.idx + 1);
  nav.stack.push({ kind, title, scroll: 0 });
  nav.idx = nav.stack.length - 1;
  updateNavButtons();
}

function updateNavButtons() {
  els.back.disabled = nav.idx <= 0;
  els.fwd.disabled = nav.idx >= nav.stack.length - 1;
}

function show(which) {
  els.home.hidden = which !== 'home';
  els.article.hidden = which !== 'article';
  els.error.hidden = which !== 'error';
  els.char.hidden = which !== 'char';
  const onArticle = which === 'article';
  els.toc.disabled = !onArticle;
  els.ext.disabled = !onArticle;
  $('btnChar').classList.toggle('on', which === 'char');
  if (window.updateBookmarkBtn) updateBookmarkBtn();
  if (window.renderCtx) renderCtx();   // keep the chat's "current page" chip in step with what's on screen
}

function goHome(push = true) {
  if (push) pushEntry('home');
  loadToken++;
  setLoading(false);
  closePops();
  renderRecent();
  if (window.renderHomeExtras) renderHomeExtras();
  els.pageTitle.textContent = '';
  show('home');
  els.scroller.scrollTop = 0;
  refreshFind();
}

async function openPage(title, { push = true, anchor = '', scroll = 0 } = {}) {
  if (!title) return;
  closePops();
  hideSuggest();
  const token = ++loadToken;
  setLoading(true);
  const res = await api.page(title);
  if (token !== loadToken) return;          // a newer navigation won
  setLoading(false);

  if (res.error) {
    lastFailed = { title, anchor };
    if (push) pushEntry('page', title);
    els.pageTitle.textContent = title;
    els.errorMsg.textContent = res.error;
    show('error');
    return;
  }
  if (push) pushEntry('page', res.title);
  else nav.stack[nav.idx].title = res.title;
  renderArticle(res);
  state.recent = [res.title, ...(state.recent || []).filter((t) => t !== res.title)].slice(0, 12);

  if (anchor) scrollToAnchor(anchor);
  else els.scroller.scrollTop = scroll;
  refreshFind();
}

function navTo(i) {
  if (i < 0 || i >= nav.stack.length) return;
  saveScroll();
  nav.idx = i;
  updateNavButtons();
  const e = nav.stack[i];
  if (e.kind === 'home') goHome(false);
  else if (e.kind === 'char') openCharacter(e.title, { push: false, scroll: e.scroll });
  else if (e.kind === 'compare') openCompare(...e.title.split('\n'), { push: false, scroll: e.scroll });
  else openPage(e.title, { push: false, scroll: e.scroll });
}

els.back.onclick = () => navTo(nav.idx - 1);
els.fwd.onclick = () => navTo(nav.idx + 1);
$('btnHome').onclick = () => goHome(true);
$('btnRetry').onclick = () => lastFailed && openPage(lastFailed.title, { push: false, anchor: lastFailed.anchor });
$('btnRandom').onclick = async () => {
  setLoading(true);
  const t = await api.random();
  if (t) openPage(t); else setLoading(false);
};
els.ext.onclick = () => {
  const e = nav.stack[nav.idx];
  if (e && e.kind === 'page') api.open_external(WIKI + '/w/' + encodeURIComponent(e.title.replace(/ /g, '_')));
};

function setLoading(on) {
  els.progress.classList.toggle('on', on);
  els.scroller.classList.toggle('loading', on);
}

function scrollToAnchor(anchor) {
  const id = decodeURIComponent(anchor.replace(/^#/, ''));
  const target = document.getElementById(id) || document.getElementById(id.replace(/ /g, '_'));
  if (target && els.article.contains(target)) target.scrollIntoView({ block: 'start' });
}

/* ---------------- article rendering ---------------- */

function abs(url) {
  return url && url.startsWith('/') && !url.startsWith('//') ? WIKI + url : url;
}

function fixMedia(root) {
  root.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src');
    if (src) img.setAttribute('src', abs(src));
    const set = img.getAttribute('srcset');
    if (set) img.setAttribute('srcset', set.replace(/(^|,\s*)\/(?!\/)/g, '$1' + WIKI + '/'));
    img.loading = 'lazy';
  });
}

function renderArticle(res) {
  const a = els.article;
  a.innerHTML = '';
  const h = document.createElement('h1');
  h.className = 'page-heading';
  h.textContent = res.title;
  a.appendChild(h);
  const body = document.createElement('div');
  body.innerHTML = res.html;
  a.appendChild(body);

  fixMedia(a);
  wrapTables(a);
  setupSortable(a);
  setupCollapsible(a);
  setupInfoboxSwitch(a);

  els.pageTitle.textContent = res.title;
  buildToc();
  show('article');
  if (window.checkRequirements) checkRequirements(res.title);
  if (window.showPrice) showPrice(res.title);
  if (window.showCalculator) showCalculator(res.title);
  if (window.updateBookmarkBtn) updateBookmarkBtn();
}

function wrapTables(root) {
  root.querySelectorAll('table.wikitable, table.lighttable').forEach((t) => {
    if (t.closest('.infobox') || t.parentElement.classList.contains('table-wrap')) return;
    const w = document.createElement('div');
    w.className = 'table-wrap';
    t.parentNode.insertBefore(w, t);
    w.appendChild(t);
    w.addEventListener('scroll', () => tableEdges(w), { passive: true });
  });
  requestAnimationFrame(() => root.querySelectorAll('.table-wrap').forEach(tableEdges));
}

// Mark which sides of a too-wide table have more columns to scroll to (the CSS fades those edges).
function tableEdges(w) {
  const more = w.scrollWidth - w.clientWidth;
  w.classList.toggle('more-l', more > 1 && w.scrollLeft > 1);
  w.classList.toggle('more-r', more > 1 && w.scrollLeft < more - 1);
}
// the page column changes width with the window and the docked chat
new ResizeObserver(() => els.article.querySelectorAll('.table-wrap').forEach(tableEdges)).observe(els.article);

function cellValue(cell) {
  if (!cell) return '';
  const v = cell.getAttribute('data-sort-value') ?? cell.textContent.trim();
  const frac = v.match(/^~?\s*([\d.,]+)\s*\/\s*([\d.,]+)/);
  if (frac) return parseFloat(frac[1].replace(/,/g, '')) / parseFloat(frac[2].replace(/,/g, ''));
  const n = v.replace(/,/g, '').match(/^-?[\d.]+(e-?\d+)?/i);
  if (n && /^[\s\d.,%+\-–xk()e]*$/i.test(v.replace(/[a-z]+$/i, ''))) return parseFloat(n[0]);
  return v.toLowerCase();
}

function columnCell(row, col) {
  let c = 0;
  for (const cell of row.cells) {
    c += cell.colSpan || 1;
    if (c > col) return cell;
  }
  return null;
}

function setupSortable(root) {
  root.querySelectorAll('table.sortable').forEach((table) => {
    const body = table.tBodies[0];
    if (!body || !body.rows.length) return;
    const headRow = body.rows[0];
    if (![...headRow.cells].every((c) => c.tagName === 'TH')) return;
    let col = 0;
    [...headRow.cells].forEach((th) => {
      const myCol = col;
      col += th.colSpan || 1;
      if (th.classList.contains('unsortable') || th.colSpan > 1) return;
      th.classList.add('sortable-th');
      th.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
        headRow.querySelectorAll('th').forEach((o) => delete o.dataset.dir);
        th.dataset.dir = dir;
        const rows = [...body.rows].slice(1).filter((r) => r.cells.length > 1);
        const mul = dir === 'asc' ? 1 : -1;
        rows.sort((r1, r2) => {
          const a = cellValue(columnCell(r1, myCol)), b = cellValue(columnCell(r2, myCol));
          if (typeof a === 'number' && typeof b === 'number') return (a - b) * mul;
          if (typeof a === 'number') return -1;
          if (typeof b === 'number') return 1;
          return String(a).localeCompare(String(b)) * mul;
        });
        rows.forEach((r) => body.appendChild(r));
      });
    });
  });
}

function setupCollapsible(root) {
  root.querySelectorAll('table.mw-collapsible').forEach((table) => {
    const body = table.tBodies[0];
    if (!body || body.rows.length < 2) return;
    const firstCell = body.rows[0].cells[body.rows[0].cells.length - 1];
    if (!firstCell) return;
    const btn = document.createElement('button');
    btn.className = 'collapse-toggle';
    const set = (collapsed) => {
      [...body.rows].slice(1).forEach((r) => r.classList.toggle('collapsed-row', collapsed));
      btn.textContent = collapsed ? 'show' : 'hide';
      btn.dataset.collapsed = collapsed ? '1' : '';
    };
    btn.addEventListener('click', (e) => { e.stopPropagation(); set(!btn.dataset.collapsed); });
    firstCell.appendChild(btn);
    set(table.classList.contains('mw-collapsed'));
  });
}

function setupInfoboxSwitch(root) {
  root.querySelectorAll('table.infobox-switch').forEach((box) => {
    const resSel = box.getAttribute('data-resource-class');
    const res = resSel && root.querySelector(resSel);
    const buttons = [...box.querySelectorAll('.infobox-buttons .button')];
    if (!res || !buttons.length) return;
    const select = (btn) => {
      const idx = btn.getAttribute('data-switch-index');
      buttons.forEach((b) => b.classList.toggle('selected', b === btn));
      res.querySelectorAll(':scope > [data-attr-param]').forEach((param) => {
        const name = param.getAttribute('data-attr-param');
        const val = param.querySelector(`:scope > [data-attr-index="${idx}"]`)
          || param.querySelector(':scope > [data-attr-index="0"]');
        if (!val) return;
        box.querySelectorAll(`[data-attr-param="${CSS.escape(name)}"]`).forEach((t) => {
          t.innerHTML = val.innerHTML;
          fixMedia(t);
        });
      });
    };
    buttons.forEach((b) => b.addEventListener('click', () => select(b)));
    buttons[0].classList.add('selected');
  });
}

/* ---------------- links ---------------- */

document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  const raw = a.getAttribute('href');
  if (!raw) return;
  e.preventDefault();

  if (a.hasAttribute('data-ext')) return api.open_external(a.href);
  if (raw.startsWith('#')) return scrollToAnchor(raw);

  let url;
  try { url = new URL(raw, WIKI); } catch { return; }
  if (url.origin === WIKI && url.pathname.startsWith('/w/') && !url.search) {
    const title = decodeURIComponent(url.pathname.slice(3)).replace(/_/g, ' ');
    if (!EXTERNAL_NS.test(title)) {
      const cur = nav.stack[nav.idx];
      if (cur && cur.kind === 'page' && cur.title === title && url.hash) return scrollToAnchor(url.hash);
      return openPage(title, { anchor: url.hash });
    }
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') api.open_external(url.href);
});

// mouse back/forward buttons
window.addEventListener('mouseup', (e) => {
  if (e.button === 3) { e.preventDefault(); navTo(nav.idx - 1); }
  if (e.button === 4) { e.preventDefault(); navTo(nav.idx + 1); }
});

/* ---------------- search ---------------- */

let suggestTimer = null;
let suggestions = [];
let active = -1;
let searchSeq = 0;

els.search.addEventListener('input', () => {
  clearTimeout(suggestTimer);
  const q = els.search.value.trim();
  if (!q) return hideSuggest();
  suggestTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    const list = await api.search(q);
    if (seq !== searchSeq || els.search.value.trim() !== q) return;
    renderSuggest(list, q);
  }, 250);
});

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderSuggest(list, q) {
  suggestions = list;
  active = list.length ? 0 : -1;
  els.suggest.innerHTML = list.length
    ? list.map((t, i) => {
        const idx = t.toLowerCase().indexOf(q.toLowerCase());
        const html = idx >= 0
          ? escapeHtml(t.slice(0, idx)) + '<b>' + escapeHtml(t.slice(idx, idx + q.length)) + '</b>' + escapeHtml(t.slice(idx + q.length))
          : escapeHtml(t);
        return `<li role="option" data-i="${i}" class="${i === 0 ? 'active' : ''}">${html}</li>`;
      }).join('')
    : '<li class="empty">No matching pages</li>';
  els.suggest.hidden = false;
  if (window.onSuggestChange) onSuggestChange();
}

function hideSuggest() {
  els.suggest.hidden = true;
  suggestions = [];
  active = -1;
  if (window.onSuggestChange) onSuggestChange();
}

function setActive(i) {
  const items = els.suggest.querySelectorAll('li[data-i]');
  if (!items.length) return;
  active = (i + items.length) % items.length;
  items.forEach((li, j) => li.classList.toggle('active', j === active));
}

function submitSearch(title) {
  if (!title) return;
  els.search.value = '';
  hideSuggest();
  els.search.blur();
  if (window.isMini && isMini()) return miniShow(title);
  openPage(title);
}

els.suggest.addEventListener('mousedown', (e) => {
  const li = e.target.closest('li[data-i]');
  if (li) { e.preventDefault(); submitSearch(suggestions[+li.dataset.i]); }
});

els.search.addEventListener('keydown', async (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
  else if (e.key === 'Escape') { els.search.value = ''; hideSuggest(); els.search.blur(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(suggestTimer);
    const q = els.search.value.trim();
    if (!q) return;
    if (!els.suggest.hidden && active >= 0 && suggestions[active]) return submitSearch(suggestions[active]);
    const list = await api.search(q);
    submitSearch(list[0] || q);
  }
});
els.search.addEventListener('blur', () => setTimeout(hideSuggest, 120));

/* ---------------- home ---------------- */

function renderHome() {
  $('quick').innerHTML = QUICK.map(([title, icon]) =>
    `<button class="qcard" data-title="${escapeHtml(title)}"><span class="qi"><img src="${WIKI}/images/${encodeURIComponent(icon)}" alt=""></span><span>${escapeHtml(title)}</span></button>`
  ).join('');
  $('quick').onclick = (e) => {
    const b = e.target.closest('.qcard');
    if (b) openPage(b.dataset.title);
  };
}

function renderRecent() {
  const list = state.recent || [];
  $('recentWrap').hidden = !list.length;
  $('recent').innerHTML = list.map((t) => `<button class="chip" data-title="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('');
}
$('recent').onclick = (e) => {
  const b = e.target.closest('.chip');
  if (b) openPage(b.dataset.title);
};

/* ---------------- sections popover ---------------- */

function buildToc() {
  const heads = [...els.article.querySelectorAll('h2, h3, h4')].filter((h) => h.id);
  els.tocList.innerHTML = heads.map((h, i) =>
    `<li class="l${h.tagName[1]}" data-i="${i}">${escapeHtml(h.textContent)}</li>`).join('');
  els.tocList.onclick = (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    heads[+li.dataset.i].scrollIntoView({ block: 'start' });
    closePops();
  };
  els.toc.disabled = !heads.length;
}

/* ---------------- popovers & settings ---------------- */

function closePops() {
  els.tocPop.hidden = true;
  els.setPop.hidden = true;
  els.toc.classList.remove('on');
  $('btnSettings').classList.remove('on');
}
function togglePop(pop, btn) {
  const open = pop.hidden;
  closePops();
  pop.hidden = !open;
  btn.classList.toggle('on', open);
}
els.toc.onclick = (e) => { e.stopPropagation(); togglePop(els.tocPop, els.toc); };
$('btnSettings').onclick = (e) => { e.stopPropagation(); togglePop(els.setPop, $('btnSettings')); };
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.pop, #btnToc, #btnSettings')) closePops();
});

// 'auto' follows the Windows light/dark setting, live
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme(t) {
  if (t === 'parchment') t = 'light';   // older settings
  const resolved = t === 'auto' ? (systemDark.matches ? 'dark' : 'light') : t;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePref = t;
  $('themeSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === t));
}
systemDark.addEventListener('change', () => {
  if (document.documentElement.dataset.themePref === 'auto') applyTheme('auto');
});
function applyZoom(z) {
  els.article.style.setProperty('--zoom', z / 100);
  $('zoomVal').textContent = z + '%';
}
async function setZoom(z) {
  state = await api.set_pref('zoom', z);
  applyZoom(state.zoom);
}

$('themeSeg').onclick = async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state = await api.set_pref('theme', b.dataset.v);
  applyTheme(state.theme);
};
$('zoomIn').onclick = () => setZoom(state.zoom + 10);
$('zoomOut').onclick = () => setZoom(state.zoom - 10);
$('btnClearRecent').onclick = async () => {
  state = await api.set_pref('clear_recent', true);
  renderRecent();
};

/* ---------------- custom show/hide hotkey ---------------- */

// KeyboardEvent.code -> [Windows virtual-key code, label, usable without Ctrl/Alt/Win?]
function keyInfo(code) {
  let m;
  if ((m = code.match(/^Key([A-Z])$/))) return [m[1].charCodeAt(0), m[1], false];
  if ((m = code.match(/^Digit(\d)$/))) return [0x30 + +m[1], m[1], false];
  if ((m = code.match(/^F(\d{1,2})$/)) && +m[1] >= 1 && +m[1] <= 24) return [0x6F + +m[1], code, true];
  if ((m = code.match(/^Numpad(\d)$/))) return [0x60 + +m[1], 'Num ' + m[1], false];
  const named = {
    Space: [0x20, 'Space'], Backquote: [0xC0, '`'], Minus: [0xBD, '-'], Equal: [0xBB, '='], BracketLeft: [0xDB, '['],
    BracketRight: [0xDD, ']'], Backslash: [0xDC, '\\'], Semicolon: [0xBA, ';'], Quote: [0xDE, "'"], Comma: [0xBC, ','],
    Period: [0xBE, '.'], Slash: [0xBF, '/'], Tab: [0x09, 'Tab'], Enter: [0x0D, 'Enter'], Backspace: [0x08, 'Backspace'],
    Insert: [0x2D, 'Insert', true], Delete: [0x2E, 'Delete'], Home: [0x24, 'Home'], End: [0x23, 'End'],
    PageUp: [0x21, 'Page Up'], PageDown: [0x22, 'Page Down'], ArrowUp: [0x26, 'Up'], ArrowDown: [0x28, 'Down'],
    ArrowLeft: [0x25, 'Left'], ArrowRight: [0x27, 'Right'], Pause: [0x13, 'Pause', true], ScrollLock: [0x91, 'Scroll Lock', true],
    NumpadMultiply: [0x6A, 'Num *'], NumpadAdd: [0x6B, 'Num +'], NumpadSubtract: [0x6D, 'Num -'],
    NumpadDecimal: [0x6E, 'Num .'], NumpadDivide: [0x6F, 'Num /'],
  };
  return named[code] ? [named[code][0], named[code][1], !!named[code][2]] : null;
}

// Two global hotkeys share one recorder: "show" (show/hide the reader) and "ask" (open the Wise Old Man).
const HK = {
  show: { btn: $('hkKey'), clear: $('hkClear'), label: () => state.hotkey, ok: () => state.hotkeyOk, what: 'Show / hide' },
  ask: { btn: $('hkKeyAsk'), clear: $('hkClearAsk'), label: () => state.askHotkey, ok: () => state.askHotkeyOk, what: 'Wise Old Man' },
};
const hk = { btn: null, kind: null, note: $('hotkeyNote'), recording: false };

function hkNote(text) {
  hk.note.classList.remove('hint');
  hk.note.textContent = text || '';
  hk.note.hidden = !text;
}

function renderHotkey() {
  let problem = '';
  for (const k of Object.values(HK)) {
    const label = k.label() || 'Off';
    k.btn.classList.remove('rec');
    k.btn.textContent = label === 'Off' ? 'Off (click to set)' : label.replace(/\+/g, ' + ');
    k.clear.hidden = label === 'Off';
    if (label !== 'Off' && !k.ok()) problem = k === HK.ask && label === state.hotkey
      ? `${label} is already your show / hide hotkey. Click the Wise Old Man one to pick a different combination.`
      : `${label} is already used by another app. Click it to pick a different one.`;
  }
  if (problem) hkNote(problem);
}

async function startRecording(kind) {
  if (hk.recording) await stopRecording();
  hk.kind = kind;
  hk.btn = HK[kind].btn;
  hk.recording = true;
  hk.btn.classList.add('rec');
  hk.btn.textContent = 'Press keys…';
  hkNote('');
  hk.note.hidden = false;
  hk.note.classList.add('hint');
  hk.note.textContent = 'Press the combination you want, e.g. Ctrl + Shift + Q or F9. Esc cancels.';
  await api.pause_hotkey(true);   // so pressing the current hotkey doesn't hide the window
}

async function stopRecording() {
  if (!hk.recording) return;
  hk.recording = false;
  await api.pause_hotkey(false);   // re-registers the saved hotkey
  if (hk.note.classList.contains('hint')) hkNote('');
  renderHotkey();
}

window.addEventListener('keydown', async (e) => {
  if (!hk.recording) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.repeat) return;
  const mods = (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.shiftKey ? 4 : 0) | (e.metaKey ? 8 : 0);
  const names = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Win'].filter(Boolean);
  if (e.key === 'Escape' && !mods) { stopRecording(); return; }
  if (['Control', 'Alt', 'Shift', 'Meta', 'OS'].includes(e.key)) {
    hk.btn.textContent = names.join(' + ') + ' + …';
    return;
  }
  const info = keyInfo(e.code);
  if (!info) { hkNote("That key can't be used for a hotkey. Try a letter, number or F-key."); return; }
  const [vk, keyName, alone] = info;
  if (!alone && !(mods & (1 | 2 | 8))) {
    hkNote('Hold Ctrl, Alt or Win as well, so the hotkey doesn’t get in the way of typing. F-keys work on their own.');
    return;
  }
  hk.recording = false;
  const kind = hk.kind;
  state = await api.set_hotkey([...names, keyName].join('+'), mods, vk, kind);   // re-registers (also ends the pause)
  renderHotkey();
  if (state.error) hkNote(state.error);
  else toast(`${HK[kind].what} hotkey set to ${HK[kind].label().replace(/\+/g, ' + ')}`);
}, true);

for (const [kind, k] of Object.entries(HK)) {
  k.btn.onclick = () => (hk.recording && hk.kind === kind ? stopRecording() : startRecording(kind));
  k.btn.onblur = () => { if (hk.kind === kind) stopRecording(); };
  k.clear.onclick = async () => {
    state = await api.clear_hotkey(kind);
    hkNote('');
    renderHotkey();
  };
}

// the "ask" hotkey (from anywhere): Python shows the window, then calls this
window.openAskFromHotkey = async function () {
  if (isMini()) await setMini(false);
  if (chat.pop.hidden) openAsk();
  else chat.input.focus();
};

/* ---------------- find on page (Ctrl+F) ---------------- */

const find = { bar: $('findBar'), input: $('findInput'), count: $('findCount'), ranges: [], cur: -1, timer: null };
const BLOCK = 'p, li, td, th, h1, h2, h3, h4, h5, h6, dd, dt, caption, figcaption, blockquote, pre, div, section, button';

function findRoot() {
  return [els.article, els.char, els.home].find((el) => !el.hidden) || null;
}

function runFind(keepPosition = false) {
  const q = find.input.value.trim().toLowerCase();
  find.lastQ = q;
  const prevRange = keepPosition ? find.ranges[find.cur] : null;
  find.ranges = [];
  find.cur = -1;
  const root = findRoot();
  if (q && root) {
    // Concatenate visible text, with a separator between blocks so matches can't jump across cells.
    const nodes = [];
    let text = '', lastBlock = null;
    const visible = new Map();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const p = n.parentElement;
      if (!n.data || !p) continue;
      if (!visible.has(p)) visible.set(p, p.checkVisibility());
      if (!visible.get(p)) continue;
      const block = p.closest(BLOCK);
      if (block !== lastBlock) { text += '\u0000'; lastBlock = block; }
      nodes.push({ n, start: text.length });
      text += n.data.toLowerCase();
    }
    const locate = (pos) => {        // binary search: node containing text offset
      let lo = 0, hi = nodes.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (nodes[mid].start <= pos) lo = mid; else hi = mid - 1;
      }
      return nodes[lo];
    };
    for (let i = text.indexOf(q); i !== -1 && find.ranges.length < 2000; i = text.indexOf(q, i + q.length)) {
      const a = locate(i), b = locate(i + q.length - 1);
      const r = new Range();
      r.setStart(a.n, i - a.start);
      r.setEnd(b.n, i + q.length - b.start);
      find.ranges.push(r);
    }
  }
  if (find.ranges.length) {
    let idx = 0;
    if (prevRange) {
      idx = find.ranges.findIndex((r) => r.compareBoundaryPoints(Range.START_TO_START, prevRange) >= 0);
      if (idx < 0) idx = 0;
    } else {
      // start from the first match below the current scroll position
      const top = els.scroller.getBoundingClientRect().top;
      idx = Math.max(0, find.ranges.findIndex((r) => r.getBoundingClientRect().top >= top));
    }
    setFindCurrent(idx);
  } else {
    paintFind();
  }
}

function paintFind() {
  CSS.highlights.set('find', new Highlight(...find.ranges));
  if (find.cur >= 0) CSS.highlights.set('find-current', new Highlight(find.ranges[find.cur]));
  else CSS.highlights.delete('find-current');
  const q = find.input.value.trim();
  find.count.textContent = !q ? '' : find.ranges.length ? `${find.cur + 1} / ${find.ranges.length}` : 'No results';
  find.count.classList.toggle('none', !!q && !find.ranges.length);
}

function setFindCurrent(i) {
  if (!find.ranges.length) return;
  find.cur = (i + find.ranges.length) % find.ranges.length;
  paintFind();
  const r = find.ranges[find.cur].getBoundingClientRect();
  const view = els.scroller.getBoundingClientRect();
  if (r.top < view.top + 40 || r.bottom > view.bottom - 20) {
    els.scroller.scrollTop += r.top - view.top - view.height / 3;
  }
  const scrollX = find.ranges[find.cur].startContainer.parentElement.closest('.table-wrap');
  if (scrollX) {
    const w = scrollX.getBoundingClientRect();
    if (r.left < w.left || r.right > w.right) scrollX.scrollLeft += r.left - w.left - w.width / 3;
  }
}

function openFind() {
  closePops();
  find.bar.hidden = false;
  const sel = String(window.getSelection() || '').trim();
  if (sel && sel.length < 80 && !sel.includes('\n')) find.input.value = sel;
  find.input.focus();
  find.input.select();
  runFind();
}

function closeFind() {
  find.bar.hidden = true;
  find.ranges = [];
  find.cur = -1;
  CSS.highlights.clear();
}

// re-run after the content changes (new page, infobox switch, etc.)
function refreshFind() {
  if (!find.bar.hidden) runFind();
}

find.input.addEventListener('input', () => {
  clearTimeout(find.timer);
  find.timer = setTimeout(() => runFind(), 120);
});
find.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(find.timer);
    if (find.input.value.trim().toLowerCase() !== find.lastQ) runFind();   // typed faster than the debounce
    else setFindCurrent(find.cur + (e.shiftKey ? -1 : 1));
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeFind();
  }
});
$('findNext').onclick = () => setFindCurrent(find.cur + 1);
$('findPrev').onclick = () => setFindCurrent(find.cur - 1);
$('findClose').onclick = closeFind;
els.article.addEventListener('click', (e) => {
  if (e.target.closest('.infobox-buttons .button, .collapse-toggle, th.sortable-th')) {
    setTimeout(() => { if (!find.bar.hidden) runFind(true); }, 0);
  }
});

/* ---------------- keyboard ---------------- */

document.addEventListener('keydown', (e) => {
  const typing = e.target.matches('input, select, textarea, [contenteditable]');   // let text fields keep their keys
  if (e.ctrlKey && e.key === 'f') {
    e.preventDefault();
    openFind();
  } else if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    if (window.newChat) newChat();
  } else if (e.key === 'F3') {
    e.preventDefault();
    if (find.bar.hidden) openFind(); else setFindCurrent(find.cur + (e.shiftKey ? -1 : 1));
  } else if ((e.ctrlKey && (e.key === 'k' || e.key === 'l')) || (e.key === '/' && !typing)) {
    e.preventDefault();
    focusSearch();
  } else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); navTo(nav.idx - 1); }
  else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); navTo(nav.idx + 1); }
  else if (e.key === 'Backspace' && !typing) { e.preventDefault(); navTo(nav.idx - 1); }
  else if (e.ctrlKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(state.zoom + 10); }
  else if (e.ctrlKey && e.key === '-') { e.preventDefault(); setZoom(state.zoom - 10); }
  else if (e.ctrlKey && e.key === '0') { e.preventDefault(); setZoom(100); }
  else if (e.key === 'Escape' && !typing) { closePops(); if (!find.bar.hidden) closeFind(); }
});
