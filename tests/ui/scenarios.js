'use strict';
/* UI harness scenarios. The page is opened as harness.html?mode=<name>[&other params]; once the app has started,
   the matching function below drives the real UI (opens pages, clicks buttons, sends chat messages), then a
   JSON summary of what's on screen is written into document.title. tests/run_ui.py reads that title back
   (headless Edge --dump-dom) and compares it with the scenario's expected values.

   Every summary has: mode, view (home|article|char|error), page (title bar text), askOpen, docked, errors
   (uncaught errors / rejected promises / console.error messages), plus whatever the scenario returns.

   Add a scenario: add an async function here (return extra fields to report), then an entry in SCENARIOS
   in tests/run_ui.py. App globals such as openPage, els, chat, send, askW and updateDock are available. */
(() => {
const QS = new URLSearchParams(location.search);
const MODE = QS.get('mode') || 'home';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $id = (id) => document.getElementById(id);
const rect = (el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) }; };
const visible = (el) => !!el && !el.closest('[hidden]') && el.getBoundingClientRect().height > 0;
const key = (target, init) => target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));

const errors = [];
window.addEventListener('error', (e) => errors.push(String(e.message || e)));
window.addEventListener('unhandledrejection', (e) => errors.push('unhandled rejection: ' + String(e.reason && (e.reason.stack || e.reason))));
const consoleError = console.error.bind(console);
console.error = (...a) => { errors.push(a.map(String).join(' ')); consoleError(...a); };

async function openChat() { $id('btnAsk').click(); await wait(300); }
async function scrollTo(el, offset) { if (el) els.scroller.scrollTop = el.getBoundingClientRect().top + els.scroller.scrollTop - offset; await wait(100); }
const msgCount = () => document.querySelectorAll('#askBody .msg').length;

const S = {
  // ---- pages ----
  async home() {
    goHome(false); await wait(1500);
    return { quick: document.querySelectorAll('#quick .qcard').length, bookmarks: visible($id('bookmarksWrap')) };
  },
  async article() {
    await openPage(QS.get('p') || 'Abyssal whip'); await wait(600);
    if (QS.get('scroll')) els.scroller.scrollTop = +QS.get('scroll');
    return { heading: (els.article.querySelector('.page-heading') || {}).textContent, infobox: !!els.article.querySelector('.infobox'),
      tables: els.article.querySelectorAll('.table-wrap').length };
  },
  async table() {
    await openPage(QS.get('p') || 'Optimal quest guide'); await wait(500);
    if (!QS.get('nochat')) await openChat();
    const wrap = [...document.querySelectorAll('.table-wrap')][+(QS.get('i') || 0)];
    await scrollTo(wrap, 120);
    const cell = wrap.querySelector('td');
    return { tableWidth: wrap.clientWidth, tableScroll: wrap.scrollWidth, cellPad: getComputedStyle(cell).paddingLeft,
      compact: getComputedStyle(cell).paddingLeft === '8px', fadeRight: wrap.classList.contains('more-r'), pageRight: rect(els.scroller).right };
  },
  async char() { await openCharacter('Lynx Titan'); await wait(600); return { name: (els.char.querySelector('h1, h2') || {}).textContent }; },
  async compare() { await openCompare('Lynx Titan', 'Woox'); await wait(600); },
  async quests() { await openCharacter('Lynx Titan'); await wait(400); await scrollTo($id('questSuggest'), 160); },
  async quest() {   // a quest page: the requirement banner above the quest details
    await openPage('Dragon Slayer II'); await wait(500);
    const b = els.article.querySelector('.qc-banner'); await scrollTo(b, 60);
    return { banner: !!b };
  },
  async diary() {
    await openPage('Ardougne Diary'); await wait(400);
    const notes = document.querySelectorAll('.diary-note'); await scrollTo(notes[1], 10);
    return { diaryNotes: notes.length };
  },
  async methods() {
    await openPage('Agility'); await wait(400);
    const d = $id('xcMethods'); d.open = true; d.dispatchEvent(new Event('toggle')); await wait(300);
    const m = document.querySelector('.xc-m'); if (m) m.click(); await wait(200);
    return { methods: document.querySelectorAll('.xc-m').length };
  },
  async alert() { await openPage('Abyssal whip'); await wait(400); $id('geAlertBtn').click(); await wait(200); },

  // ---- settings / chrome ----
  async settings() {
    $id('btnSettings').click(); await wait(300);
    return { settingsOpen: visible($id('setPop')), hk: $id('hkKey').textContent, hkAsk: $id('hkKeyAsk').textContent,
      hkRow: visible($id('hkKey').closest('.row')), hkAskRow: visible($id('hkKeyAsk').closest('.row')) };
  },
  async hotkey() {   // record Ctrl+Alt+K as the show/hide hotkey
    $id('btnSettings').click(); await wait(100);
    const b = $id('hkKey'); b.focus(); b.click(); await wait(100);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', code: 'AltLeft', ctrlKey: true, altKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, altKey: true })); await wait(300);
    return { hk: $id('hkKey').textContent };
  },
  async 'hotkey-bad'() {   // a plain letter isn't allowed as a global hotkey
    $id('btnSettings').click(); await wait(100);
    const b = $id('hkKey'); b.focus(); b.click(); await wait(100);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', code: 'KeyQ' })); await wait(300);
    return { note: $id('hotkeyNote').textContent };
  },
  async mini() { $id('btnMini').click(); await wait(200); await miniShow('Abyssal whip'); await wait(300); },
  async update() { await wait(5000); return { updateModal: visible($id('updModal')) }; },
  async updprog() { await wait(5000); $id('updNow').click(); await wait(1500); },
  async guide() { await wait(1200); return { guideOpen: visible($id('guideModal')) }; },

  // ---- Wise Old Man chat ----
  async setup() { await openChat(); return { setupShown: !visible($id('askInputRow')) }; },
  async ask() {
    await openChat(); await send('How do I get a fire cape?'); await wait(200); $id('askBody').scrollTop = 0;
    return { msgs: msgCount() };
  },
  async dock() {
    await openPage('Abyssal whip'); await wait(400); await openChat();
    await send('How do I get a fire cape?'); await wait(300);
    if (QS.get('w')) { askW = +QS.get('w'); updateDock(); await wait(100); }
    return { askLeft: rect(chat.pop).left, askWidth: rect(chat.pop).width, pageRight: rect(els.scroller).right, msgs: msgCount() };
  },
  async hist() {   // two questions, Ctrl+N, a third question, then the history menu (?menu=1) or load the older chat (?load=1)
    await openPage('Abyssal whip'); await wait(400); await openChat();
    await send('How do I get a fire cape?'); await wait(200);
    await send('What gear for Jad as an ironman?'); await wait(200);
    key($id('askInput'), { key: 'n', ctrlKey: true }); await wait(300);
    const afterNew = $id('askBody').innerText.slice(0, 40);
    await send('Best money making at my levels?'); await wait(300);
    if (QS.get('menu') || QS.get('load')) { $id('askHistBtn').click(); await wait(300); }
    const items = document.querySelectorAll('#askHistMenu li[data-id]');
    const titles = [...items].map((li) => li.innerText.split('\n')[0]);
    if (QS.get('load')) { items[1].click(); await wait(400); }
    return { afterNew, items: items.length, titles, msgs: msgCount(), menuOpen: visible($id('askHistMenu')) };
  },
  async menu() {   // the "playing as" account-type menu, after picking Ultimate ironman
    await openChat();
    $id('askModeBtn').click(); await wait(100);
    document.querySelector('#askModeMenu li[data-v="ultimate"]').click(); await wait(300);
    $id('askModeBtn').click(); await wait(500);
    return { modeLabel: $id('askModeLabel').textContent };
  },
  async typing() {   // keys typed in the chat box must not trigger the page's shortcuts
    await openChat();
    const ta = $id('askInput'); ta.focus(); ta.value = 'fire cape?';
    const idx = nav.idx; const res = {};
    for (const k of ['Backspace', '/']) res[k] = key(ta, { key: k }) ? 'ok' : 'BLOCKED';
    const before = { backspace: res.Backspace, slash: res['/'], focusInChat: document.activeElement === ta, navUnchanged: nav.idx === idx };
    ta.value = 'how do i get a fire cape'; key(ta, { key: 'Enter' }); await wait(600);
    ta.focus();
    const bs = key(ta, { key: 'Backspace' }) ? 'ok' : 'BLOCKED';
    return { ...before, afterSend: { inputVisible: !$id('askInputRow').hidden, busy: chat.busy, backspace: bs, focus: document.activeElement === ta, msgs: msgCount() } };
  },
  async ctxpage() { await openPage('Abyssal whip'); await wait(400); await openChat(); return { ctxShown: visible($id('askCtx')) }; },
  async ctxsel() {   // select a paragraph: the "Ask about this" button appears next to it
    await openPage('Abyssal whip'); await wait(500);
    const p = [...els.article.querySelectorAll('p')].find((x) => x.textContent.includes('one-handed'));
    els.scroller.scrollTop = p.offsetTop - 260; await wait(150);
    const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    await wait(1500);
    const b = $id('askSelBtn');
    return { selBtn: !b.hidden, selBtnSize: rect(b).width + 'x' + rect(b).height, hasSel: !!(chat.ctx && chat.ctx.sel && chat.ctx.sel.text) };
  },
  async ctxsend() {   // ask about a selection: the page title and the selected text are sent with the question
    await openPage('Abyssal whip'); await wait(500);
    const p = [...els.article.querySelectorAll('p')].find((x) => x.textContent.includes('one-handed'));
    const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r); await wait(300);
    $id('askSelBtn').click(); await wait(500);
    await send('What does this mean for me?'); await wait(300);
    return { sentCtx: window.__sentCtx || null };
  },
};

async function main() {
  // wait for the app to finish starting (renderHome fills the quick links)
  for (let i = 0; i < 60 && !document.querySelector('#quick .qcard'); i++) await wait(50);
  await wait(200);
  let extra = {};
  const run = S[MODE];
  if (!run) errors.push('scenarios.js: unknown mode ' + MODE);
  else {
    try { extra = (await run()) || {}; } catch (e) { errors.push('scenario failed: ' + (e.stack || e)); }
  }
  await wait(200);
  const view = ['home', 'article', 'char', 'error'].find((v) => !els[v].hidden) || null;
  document.title = JSON.stringify({ mode: MODE, view, page: els.pageTitle.textContent, askOpen: !chat.pop.hidden,
    docked: document.body.classList.contains('ask-docked'), width: window.innerWidth, ...extra, errors });
}
window.addEventListener('load', () => setTimeout(main, 0));
})();
