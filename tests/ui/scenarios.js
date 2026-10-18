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
  // the extra profile sections, with real data for Clyde Lives
  async profile() {
    await openCharacter('Clyde Lives'); await wait(1500);
    const q = (s) => els.char.querySelector(s);
    return {
      goals: !!q('.goals .goal-top'), closest99s: els.char.querySelectorAll('.goals h3').length,
      milestones: els.char.querySelectorAll('.milestones li').length, records: els.char.querySelectorAll('.records > div').length,
      chartLine: !!q('#xpcBox path.ln'), groupMembers: els.char.querySelectorAll('.gim .row').length,
      groupMeHighlighted: !!q('.gim .row.me'), shareButton: !!$id('btnShare'),
    };
  },
  async profilegoals() {
    await openCharacter('Clyde Lives'); await wait(1200);
    els.char.querySelector('.goals').scrollIntoView(); els.scroller.scrollTop -= 70; await wait(300);
    return { goals: !!els.char.querySelector('.goals .goal-top') };
  },
  async profilegroup() {
    await openCharacter('Clyde Lives'); await wait(1500);
    $id('pxGroup').scrollIntoView(); els.scroller.scrollTop -= 420; await wait(300);
    return { groupMembers: els.char.querySelectorAll('.gim .row').length };
  },
  async profilechart() {
    await openCharacter('Clyde Lives'); await wait(1200);
    const box = $id('xpcBox'); box.closest('.c-card').scrollIntoView(); await wait(300);
    return { chartLine: !!box.querySelector('path.ln'), summary: (box.querySelector('.xpc-sum') || {}).textContent || '' };
  },
  async share() {
    await openCharacter('Clyde Lives'); await wait(1200);
    $id('btnShare').click(); await wait(1500);
    const img = document.querySelector('#shareModal .share-img');
    return { modal: visible($id('shareModal')), image: !!img && img.naturalWidth === 1200 && img.naturalHeight === 675 };
  },
  async kc() {
    state.me = 'Clyde Lives';
    await openPage('Hespori'); await wait(1200);
    const box = els.article.querySelector('.mykc');
    return { banner: !!box, text: box ? box.textContent.replace(/\s+/g, ' ').trim() : '' };
  },
  async homeupdate() {
    await wait(1200);
    const c = document.querySelector('#homeUpdate .upd-name');
    const fact = document.querySelector('#homeFact .fact-card p');
    const first = fact ? fact.textContent : '';
    if ($id('factNext')) { $id('factNext').click(); await wait(400); }
    const second = (document.querySelector('#homeFact .fact-card p') || {}).textContent || '';
    return { update: c ? c.textContent : null, fact: !!fact, anotherFactIsDifferent: !!second && second !== first };
  },
  async cando() {
    state.me = 'Clyde Lives';
    await openPage('Abyssal demon'); await wait(1000);
    const parts = () => [...(els.article.querySelector('.cando') || { children: [] }).children].map((x) => x.textContent.trim()).join(' | ');
    const slayer = parts();
    await openPage('Ice Barrage'); await wait(1000);
    const magic = parts();
    return { slayer: slayer.replace(/\s+/g, ' ').trim(), magic: magic.replace(/\s+/g, ' ').trim() };
  },
  async homegoal() {
    state.me = 'Clyde Lives';
    await openCharacter('Clyde Lives'); await wait(1200);
    els.char.querySelector('.goals .pin-goal').click(); await wait(500);
    const pinnedOn = els.char.querySelector('.goals .pin-goal').classList.contains('on');
    state.me = 'Clyde Lives';   // the fake backend's saved state names another account as "you"
    goHome(); await wait(1200);
    const g = document.querySelector('#homeGoal .upd-name'), r = document.querySelector('#homeRecap .recap-nums');
    return { pinnedOn, goal: g ? g.textContent : null, recap: r ? r.textContent.replace(/\s+/g, ' ').trim() : null };
  },
  async petluck() {
    state.me = 'Clyde Lives';
    await openPage('Kraken'); await wait(1200);
    const pet = els.article.querySelector('.mykc-pet');
    const loot = [...els.article.querySelectorAll('.mykc-loot .loot')].map((r) => [...r.children].map((c) => c.textContent.trim()).join(' | '));
    return { pet: pet ? pet.textContent.replace(/\s+/g, ' ').trim() : null, loot };
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
  // first launch: the guided tour starts by itself
  async guide() {
    await wait(1500);
    const card = document.querySelector('.tour-card h3');
    return { tourOpen: !!document.querySelector('.tour-layer'), tourTitle: card ? card.textContent : null };
  },
  // F1: the Quick guide reference card
  async guidecard() { await wait(600); key(document.body, { key: 'F1' }); await wait(500); return { guideOpen: visible($id('guideModal')) }; },
  // a new player (no account, no key): the tour waits for each action, then moves on by itself
  async tour() {
    await wait(600);
    // a brand-new player, and no animations (headless Edge doesn't advance them, so they'd freeze mid-way)
    const still = document.createElement('style');
    still.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
    document.head.appendChild(still);
    state.me = null;   // looking players up mustn't set an account for this new player
    for (const m of ['save_account', 'player']) {
      const real = api[m];
      api[m] = async (...args) => { const r = await real(...args); if (r && 'me' in r) r.me = null; return r; };
    }
    await startTour(); await wait(300);
    const title = () => tour.steps[tour.i].title;
    const ringOnTarget = () => {
      const r = document.querySelector('.tour-ring').getBoundingClientRect();
      const t = tourRect(tour.steps[tour.i].target);
      return !!t && Math.abs(r.left + 6 - t.left) < 2 && Math.abs(r.top + 6 - t.top) < 2;
    };
    const out = { steps: tour.steps.length };
    await tourGo(2); await wait(400);
    out.ringOnPersonIcon = ringOnTarget();
    $id('btnChar').click(); await wait(900);
    out.afterPersonIcon = title();
    await openCharacter('Woox'); await wait(900);
    out.afterLookup = title();
    await tourGo(5); await wait(400);
    $id('btnAsk').click(); await wait(900);
    out.afterWiseOldMan = title();
    await tourGo(10); await wait(400);
    $id('btnSettings').click(); await wait(900);
    out.afterGear = title();
    out.ringOnHotkeys = ringOnTarget();
    key(document.body, { key: 'Escape' }); await wait(300);
    out.closedByEsc = !document.querySelector('.tour-layer');
    out.guideSeen = state.guideSeen;
    return out;
  },

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
