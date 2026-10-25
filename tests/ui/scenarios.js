'use strict';
/* UI harness scenarios. The page is opened as harness.html?mode=<name>[&other params]; once the app has started,
   the matching function below drives the real UI (opens pages, clicks buttons, sends chat messages), then a
   JSON summary of what's on screen is written into document.title. tests/run_ui.py reads that title back
   (headless Edge --dump-dom) and compares it with the scenario's expected values.

   Every summary has: mode, view (home|article|char|error|web), page (title bar text), askOpen, docked, errors
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
  async tabber() {   // a wiki tab group (Vorkath/Strategies' gear setups): tab buttons, one panel at a time
    await openPage('Vorkath tabs'); await wait(800);
    const t = els.article.querySelector('.tabber');
    const tabs = [...t.querySelectorAll('.tabber-nav button')];
    const shown = () => [...t.querySelectorAll(':scope > .tabbertab')].filter((x) => !x.hidden).map((x) => x.dataset.title);
    const first = shown();
    tabs[2].click(); await wait(200);
    const third = shown();
    tabs[0].click(); await wait(200);
    const eq = t.querySelector('.equipment-div'), head = t.querySelector('.equipment-head'), ring = t.querySelector('.equipment-ring');
    const pouch = t.querySelector('.runepouchtable');
    if (QS.get('scroll')) await scrollTo(pouch, +QS.get('scroll'));
    return { tabs: tabs.map((b) => b.textContent), first, third, on: tabs.findIndex((b) => b.classList.contains('on')),
      eqW: eq ? rect(eq).width : 0, slotsPlaced: !!(head && ring && ring.getBoundingClientRect().top - head.getBoundingClientRect().top > 100),
      floated: getComputedStyle(t.querySelector('.equipment')).float, pouchRunes: pouch ? pouch.querySelectorAll('img').length : 0 };
  },
  async table() {
    await openPage(QS.get('p') || 'Optimal quest guide'); await wait(500);
    if (!QS.get('nochat')) await openChat();
    const wrap = [...document.querySelectorAll('.table-wrap')][+(QS.get('i') || 0)];
    await scrollTo(wrap, 120);
    const cell = wrap.querySelector('td');
    return { tableWidth: wrap.clientWidth, tableScroll: wrap.scrollWidth, cellPad: getComputedStyle(cell).paddingLeft,
      compact: getComputedStyle(cell).paddingLeft === '8px', fadeRight: wrap.classList.contains('more-r'), pageRight: rect(els.scroller).right,
      bleed: wrap.parentElement.classList.contains('bleed'), colW: Math.round(pageWidths.col) };
  },
  // the extra profile sections, with real data for Clyde Lives
  async tabs() {   // the profile in tabs: which tabs show, switching, the bar staying in view, the last tab remembered
    try { localStorage.removeItem('charTab'); } catch (e) { /* */ }
    await openCharacter('Clyde Lives'); await wait(1500);
    const shown = () => [...document.querySelectorAll('#charTabs [data-tab]:not([hidden])')].map((b) => b.dataset.tab);
    const active = () => (document.querySelector('#charTabs .on') || {}).dataset.tab;
    const first = { tabs: shown(), active: active(), panels: [...document.querySelectorAll('.c-panel:not([hidden])')].length };
    const tab = QS.get('tab');
    if (tab) setCharTab(tab); await wait(300);
    if (QS.get('scroll')) { els.scroller.scrollTop = 900; await wait(200); }
    const bar = $id('charTabs').getBoundingClientRect();
    const chromeBottom = document.querySelector('.chrome, header') ? els.scroller.getBoundingClientRect().top + parseFloat(getComputedStyle(els.scroller).paddingTop) : 0;
    await openCharacter('Woox'); await wait(800); await openCharacter('Clyde Lives'); await wait(1200);
    return { first, after: active(), barTop: Math.round(bar.top), chromeBottom: Math.round(chromeBottom), remembered: active() };
  },
  async group() {   // the Group tab: member cards with each profile, and everyone combined
    await openCharacter('Clyde Lives'); await wait(1500);
    setCharTab('group'); await wait(600);
    if (QS.get('down')) { await scrollTo(document.querySelectorAll('#gimMore .home-h')[+QS.get('down')], 110); await wait(200); }
    const t = (s) => [...document.querySelectorAll(s)].map((x) => x.textContent.replace(/\s+/g, ' ').trim());
    return { cards: document.querySelectorAll('.gim-card').length, statCards: document.querySelectorAll('.gim-card .gim-stats').length,
      unranked: document.querySelectorAll('.gim-card .gim-note').length, skillTiles: document.querySelectorAll('.gim-skills .sk').length,
      heads: t('#gimMore .home-h').map((h) => h.split(' ')[0]), firstBoss: t('.gim-bosses .row')[0] || null };
  },
  async profile() {
    await openCharacter('Clyde Lives'); await wait(1500);
    const q = (s) => els.char.querySelector(s);
    return {
      goals: !!q('.goals .goal-top'), closest99s: els.char.querySelectorAll('.goals h3').length,
      milestones: els.char.querySelectorAll('.milestones li').length, records: els.char.querySelectorAll('.records > div').length,
      chartLine: !!q('#xpcBox path.ln'), groupMembers: els.char.querySelectorAll('.gim-card').length,
      groupMeHighlighted: !!q('.gim-card.me'), shareButton: !!$id('btnShare'),
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
    return { groupMembers: els.char.querySelectorAll('.gim-card').length };
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
  async ca() {
    await openCharacter('Clyde Lives'); await wait(1500);
    const box = $id('pxCA'); box.scrollIntoView(); els.scroller.scrollTop -= 80; await wait(300);
    const q = (s) => (box.querySelector(s) || {}).textContent || '';
    return { since: q('.since'), unlocked: q('.ca-top b'), next: q('.ca-next .dim').replace(/\s+/g, ' ').trim(), tiers: box.querySelectorAll('.ca-tiers .goal').length };
  },
  async bank() {
    state.me = 'Clyde Lives';
    for (const m of ['save_account', 'set_me']) {   // the fake backend's saved state names another account as "you"
      const real = api[m];
      api[m] = async (...args) => ({ ...(await real(...args)), me: 'Clyde Lives' });
    }
    await openCharacter('Clyde Lives'); await wait(1200);
    const before = ($id('pxBank').textContent || '').includes('Import your bank');
    window.__CLIP = 'Item id\tItem name\tItem quantity\n4151\tAbyssal whip\t1\n21012\tDragon hunter crossbow\t1\n27235\tMasori mask (f)\t1\n995\tCoins\t5000000\n1275\tRune pickaxe\t1\n6739\tDragon axe\t1\n8778\tOak plank\t3\n';
    $id('bankImport').click(); await wait(300);
    $id('bankPaste').click(); await wait(600);
    await wait(400);
    const card = ($id('pxBank').querySelector('.bank-card') || {}).textContent || '';
    const value = (($id('bankValue') || {}).textContent || '').split('Most valuable')[0].replace(/\s+/g, ' ').trim();
    await openPage('Abyssal whip'); await wait(900);
    const inbank = (els.article.querySelector('.inbank') || {}).textContent || '';
    await openPage('Vorkath'); await wait(1000);
    const gear = els.article.querySelector('.gear:not(.bestset)');
    return {
      importPromptFirst: before, card: card.replace(/\s+/g, ' ').includes('7 different items'), inbank: inbank.trim(), value,
      cheapest: gear ? ((gear.querySelector('.gear-cheap') || {}).textContent || '').replace(/\s+/g, ' ').trim() : null,
      gearTabs: gear ? gear.querySelectorAll('.gear-tabs button').length : 0,
      owned: gear ? (gear.querySelector('.gear-own') || {}).textContent : null,
      ownedLinks: gear ? [...gear.querySelectorAll('a.own')].map((a) => a.textContent.trim()) : [],
      guideTicks: await (async () => { await openPage('Vorkath/Strategies'); await wait(900);
        return [...new Set([...els.article.querySelectorAll('table a.own')].map((a) => a.textContent.trim()))]; })(),
      questItems: await (async () => { await openPage('Dragon Slayer II'); await wait(900);
        const rows = [...els.article.querySelectorAll('table.questdetails a.own')].map((a) => a.textContent.trim());
        const some = [...els.article.querySelectorAll('table.questdetails .bank-some')].map((x) => x.textContent.trim());
        return { ticked: rows, some }; })(),
    };
  },
  async bankmore() {
    state.me = 'Clyde Lives';
    for (const m of ['save_account', 'set_me']) { const real = api[m]; api[m] = async (...a) => ({ ...(await real(...a)), me: 'Clyde Lives' }); }
    window.__BANK = { 'Abyssal whip': 1, 'Dragon hunter crossbow': 1, 'Masori mask (f)': 1, "Black d'hide body": 1, 'Dragon axe': 1, 'Rune pickaxe': 1, Coins: 5000000 };
    await openCharacter('Clyde Lives'); await wait(1300);
    const input = $id('bankSearch'); input.value = 'ax'; input.dispatchEvent(new Event('input')); await wait(300);
    const hits = [...$id('bankHits').querySelectorAll('a')].map((a) => a.textContent);
    const det = $id('bankMake'); det.open = true; det.dispatchEvent(new Event('toggle')); await wait(500);
    const makeXp = [...det.querySelectorAll('.make-rows a')].map((a) => a.textContent).slice(0, 2);
    det.querySelector('.make-tabs button[data-i="1"]').click(); await wait(200);
    const makeProfit = [...det.querySelectorAll('.make-rows a')].map((a) => a.textContent).slice(0, 1);
    await openPage('Vorkath'); await wait(1200);
    const where = [...els.article.querySelectorAll('.gear .where')].find((b) => b.dataset.item === "Karil's leathertop");
    if (where) { where.click(); await wait(400); }
    return { hits, makeXp, makeProfit, where: ((els.article.querySelector('.where-info') || {}).textContent || '').trim() };
  },
  async gearscape() {   // monster pages: a card above the strategy guide's gear that opens Gearscape inside the reader
    await openPage('Vorkath'); await wait(1200);
    const card = els.article.querySelector('.gs-link');
    const wiki = els.article.querySelector('.gear');
    const out = { card: !!card, aboveWiki: !!(card && wiki && (card.compareDocumentPosition(wiki) & Node.DOCUMENT_POSITION_FOLLOWING)),
      wikiOpen: wiki ? wiki.open : null };
    if (!card) return out;
    card.click(); await wait(300);
    const frame = els.web.querySelector('iframe');
    Object.assign(out, { webView: !els.web.hidden, src: frame && frame.src, frameH: frame ? rect(frame).height : 0,
      extOn: !els.ext.disabled, webTitle: els.pageTitle.textContent });
    $id('btnBack').click(); await wait(600);
    out.backTo = els.article.hidden ? null : nav.stack[nav.idx].title;
    $id('btnFwd').click(); await wait(300);
    out.sameFrame = els.web.querySelectorAll('iframe').length === 1 && !els.web.hidden;
    $id('btnBack').click(); await wait(600);
    return out;
  },
  async setprog() {
    state.me = 'Clyde Lives';
    for (const m of ['save_account', 'set_me']) { const real = api[m]; api[m] = async (...a) => ({ ...(await real(...a)), me: 'Clyde Lives' }); }
    window.__BANK = { "Karil's leathertop": 1, "Karil's leatherskirt": 1, "Karil's crossbow": 1 };
    window.__BANK_UPDATED = Date.now() / 1000 - 10 * 86400;   // imported 10 days ago
    await openPage("Karil's leathertop"); await wait(1000);
    const row = els.article.querySelector('.setprog-row');
    await openCharacter('Clyde Lives'); await wait(1300);
    return { set: row ? row.firstElementChild.textContent.replace(/\s+/g, ' ').trim() : null,
      stale: (($id('pxBank').querySelector('.bank-stale') || {}).textContent || '').trim() };
  },
  async clog() {
    state.me = 'Clyde Lives';
    for (const m of ['save_account', 'set_me']) { const real = api[m]; api[m] = async (...a) => ({ ...(await real(...a)), me: 'Clyde Lives' }); }
    await openCharacter('Clyde Lives'); await wait(1300);
    const card = (($id('pxClog') || {}).textContent || '').replace(/\s+/g, ' ');
    // pretend Clyde has Pet Kraken, to check the "you have it" paths
    window.__PROFILE.player.clog.items.push('Pet Kraken');
    await openCharacter('Woox'); await wait(400); await openCharacter('Clyde Lives'); await wait(1300);
    const ownedChip = (($id('pxPets').querySelector('.pets-owned') || {}).textContent || '').trim();
    const oddsHasKraken = [...$id('pxPets').querySelectorAll('.goal .gn b')].some((b) => b.textContent === 'Pet Kraken');
    await openPage('Kraken'); await wait(1200);
    const petLine = ((els.article.querySelector('.mykc-pet') || {}).textContent || '').replace(/\s+/g, ' ').trim();
    const tentacle = ((els.article.querySelector('.mykc-loot .loot a') || {}).textContent || '').trim();
    await openPage('Abyssal whip'); await wait(900);
    const itemChips = [...els.article.querySelectorAll('.inbank-row .inbank')].map((x) => x.textContent.trim());
    return { card: card.includes('275 / 1,721 slots'), ownedChip, oddsHasKraken, petLine, tentacle, itemChips };
  },
  async pets() {
    await openCharacter('Clyde Lives'); await wait(1500);
    const box = $id('pxPets'); box.scrollIntoView(); els.scroller.scrollTop -= 80; await wait(300);
    const rows = [...box.querySelectorAll('.goal')].map((r) => r.querySelector('.gn b').textContent + ' ' + r.querySelector('.gv').textContent);
    return { top3: rows.slice(0, 3), rows: rows.length };
  },
  async switcherview() {   // held open, for the screenshot
    await openPage('Abyssal whip'); await wait(400); await openPage('Agility'); await wait(400);
    await openCharacter('Woox'); await wait(600); await openPage('Optimal quest guide'); await wait(600);
    key(document.body, { key: 'Tab', ctrlKey: true }); await wait(200);
    return { rows: document.querySelectorAll('.switcher .sw-row').length };
  },
  async switcher() {
    await openPage('Abyssal whip'); await wait(500);
    await openPage('Agility'); await wait(500);
    await openCharacter('Woox'); await wait(800);
    key(document.body, { key: 'Tab', ctrlKey: true }); await wait(100);
    const first = (document.querySelector('.switcher .sw-row.on span') || {}).textContent;
    key(document.body, { key: 'Tab', ctrlKey: true }); await wait(100);
    const second = (document.querySelector('.switcher .sw-row.on span') || {}).textContent;
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', bubbles: true })); await wait(900);
    return { first, second, opened: nav.stack[nav.idx].title, closed: document.querySelector('.switcher').hidden };
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
  async wood() {   // Woodcutting trees table: two floated music players above it used to squeeze it into tall rows with empty picture columns
    await openPage('Woodcutting'); await wait(1500);
    const a = [...els.article.querySelectorAll('td a')].find((x) => x.textContent.trim() === 'Bloodwood tree');
    const tr = a && a.closest('tr'); const wrap = tr && tr.closest('.table-wrap');
    if (tr) await scrollTo(tr, 40);
    const cells = tr ? [...tr.children].map((c) => Math.round(c.getBoundingClientRect().width)) : [];
    const imgs = tr ? [...tr.querySelectorAll('img')].map((i) => [i.getAttribute('width'), i.getAttribute('height'), Math.round(i.getBoundingClientRect().width), Math.round(i.getBoundingClientRect().height), getComputedStyle(i).display]) : [];
    return { rowH: tr ? Math.round(tr.getBoundingClientRect().height) : null, cells, imgs,
      wrapW: wrap ? Math.round(wrap.clientWidth) : null, tableW: wrap ? Math.round(wrap.scrollWidth) : null,
      article: Math.round(els.article.clientWidth) };
  },
  async tablenav() {   // wide tables: arrows on the edges, a scrollbar kept at the bottom of the window, the first column pinned
    await openPage('Mastering Mixology'); await wait(1500);
    const a = [...els.article.querySelectorAll('td a')].find((x) => x.textContent.trim() === 'Apprentice potion pack');
    const tr = a.closest('tr'), wrap = tr.closest('.table-wrap'), box = wrap.parentElement;
    await scrollTo(tr, 260); await wait(300);
    floatBar.update();   // headless Edge doesn't run animation frames reliably, so update it directly
    wrap.scrollBy = (o) => { wrap.scrollLeft += o.left; };   // ...nor smooth scrolling
    const fbar = document.querySelector('.float-hbar');
    const floatShown = !fbar.hidden;
    const floatAboveAsk = floatShown && fbar.getBoundingClientRect().bottom <= $id('askBar').getBoundingClientRect().top;
    tr.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    const right = box.querySelector('.tbl-arrow.r');
    const nameLeft = tr.children[1].getBoundingClientRect().left;
    right.click(); await wait(900);
    const afterArrow = wrap.scrollLeft;
    fbar.scrollLeft = 0; fbar.dispatchEvent(new Event('scroll')); await wait(200);
    const viaFloat = wrap.scrollLeft;
    wrap.scrollLeft = 400; wrap.dispatchEvent(new Event('scroll')); await wait(300);
    const followed = Math.round(fbar.scrollLeft) === Math.round(wrap.scrollLeft);   // (the table's end may come before 400)
    // the arrows' smooth scroll: the table moves on, then the bar's (late) echo of our own update arrives;
    // it must not pull the table back (that cancelled the smooth scroll)
    wrap.scrollLeft = 200; wrap.dispatchEvent(new Event('scroll'));
    wrap.scrollLeft = 260; fbar.dispatchEvent(new Event('scroll'));
    const arrowKept = Math.round(wrap.scrollLeft);
    // dragging the bar: the table's late scroll event must not push the bar back under the mouse
    await wait(300);
    fbar.scrollLeft = 100; fbar.dispatchEvent(new Event('scroll'));
    fbar.scrollLeft = 140; wrap.dispatchEvent(new Event('scroll'));
    const barKept = Math.round(fbar.scrollLeft);
    return { followed, arrowKept, barKept, box: box.classList.contains('table-box'), wide: box.classList.contains('wide'), floatShown, floatAboveAsk,
      afterArrow: Math.round(afterArrow), viaFloat: Math.round(viaFloat), floatFollows: followed,
      pinned: [...tr.children].slice(0, 3).map((c) => c.classList.contains('pin')),
      nameStays: Math.abs(tr.children[1].getBoundingClientRect().left - nameLeft) <= 1,
      leftFadeOff: getComputedStyle(wrap).maskImage === 'none' || getComputedStyle(wrap).webkitMaskImage === 'none' || !getComputedStyle(wrap).maskImage.includes('to left') };
  },
  async media() {   // gallery videos and level-up music clips point at the wiki's files (they were relative, so empty)
    await openPage('Mastering Mixology'); await wait(1200);
    const v = els.article.querySelector('video');
    const video = v ? { poster: v.getAttribute('poster'), src: v.querySelector('source').getAttribute('src'), preload: v.preload } : null;
    await openPage('Woodcutting'); await wait(1200);
    const au = els.article.querySelector('audio source');
    return { video, audio: au ? au.getAttribute('src') : null, videos: null };
  },
  async volume() {   // Settings > Volume: players on screen follow the slider, new pages' players start at it, it's saved
    await openPage('Mastering Mixology'); await wait(1200);
    $id('btnSettings').click(); await wait(200);
    const before = $id('volVal').textContent;
    const r = $id('volRange'); r.value = 40; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); await wait(200);
    const onScreen = [...els.article.querySelectorAll('video')].map((v) => Math.round(v.volume * 100));
    await openPage('Woodcutting'); await wait(1200);
    const fresh = Math.round(els.article.querySelector('audio').volume * 100);
    r.value = 0; r.dispatchEvent(new Event('input')); await wait(100);
    return { before, label: $id('volVal').textContent, onScreen: [...new Set(onScreen)], fresh, saved: (await api.get_state()).volume };
  },
  async mixology() {   // Mastering Mixology rewards: 11 columns too wide for the page, with a Notes column of sentences
    await openPage('Mastering Mixology'); await wait(1500);
    const a = [...els.article.querySelectorAll('td a')].find((x) => x.textContent.trim() === 'Apprentice potion pack');
    const tr = a && a.closest('tr'); const wrap = tr && tr.closest('.table-wrap');
    if (tr) await scrollTo(tr, 140);
    if (wrap && QS.get('right')) { wrap.scrollLeft = wrap.scrollWidth; await wait(200); }
    const notes = tr && tr.lastElementChild;
    return { notesAlign: notes ? getComputedStyle(notes).textAlign : null, nameAlign: tr ? getComputedStyle(tr.children[1]).textAlign : null,
      rowH: tr ? Math.round(tr.getBoundingClientRect().height) : null, notesW: notes ? Math.round(notes.getBoundingClientRect().width) : null,
      scrolls: wrap ? wrap.scrollWidth > wrap.clientWidth : null };
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
  async boldlinks() {   // names the AI put in bold without linking them become links when the wiki has the page
    await openChat(); await send('Best ironman reward for Mastering Mixology?'); await wait(500);
    const last = [...document.querySelectorAll('#askBody .msg.ai')].pop();
    return { links: [...last.querySelectorAll('.md a')].map((a) => a.textContent),
      plain: [...last.querySelectorAll('.md b')].filter((b) => !b.querySelector('a')).map((b) => b.textContent.trim()),
      colonKept: [...last.querySelectorAll('.md b')].some((b) => b.textContent.trim() === 'Chugging barrel:') };
  },
  async askbar() {   // small window: the chat waits as a bar at the bottom, asking opens it as a sheet, tapping the page folds it
    const still = document.createElement('style');   // headless Edge doesn't advance animations: the sheet would stay mid-slide
    still.textContent = '*, *::before, *::after { animation: none !important; }';
    document.head.append(still);
    await openPage('Abyssal whip'); await wait(400);
    const bar = $id('askBar');
    const before = { bar: visible(bar), pop: visible(chat.pop), narrow: document.body.classList.contains('ask-narrow'), placeholder: $id('askBarInput').placeholder };
    $id('askBarInput').value = 'How do I get a fire cape?';
    bar.requestSubmit(); await wait(700);
    const r = chat.pop.getBoundingClientRect();
    const open = { bar: visible(bar), pop: visible(chat.pop), msgs: msgCount(), atBottom: Math.abs(r.bottom - innerHeight) <= 1 && r.left <= 1 && Math.abs(r.right - innerWidth) <= 1,
      emptied: $id('askBarInput').value === '' };
    open.docked = document.body.classList.contains('ask-docked');
    if (QS.get('fold')) { els.scroller.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await wait(300); }
    const folded = { bar: visible(bar), pop: visible(chat.pop) };
    closeAsk(); await wait(100);
    const closed = visible(bar);
    goHome(); await wait(300);
    return { before, open, folded, closedOnPage: closed, onHome: visible(bar) };
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
  const view = ['home', 'article', 'char', 'error', 'web'].find((v) => !els[v].hidden) || null;
  document.title = JSON.stringify({ mode: MODE, view, page: els.pageTitle.textContent, askOpen: !chat.pop.hidden,
    docked: document.body.classList.contains('ask-docked'), width: window.innerWidth, ...extra, errors });
}
window.addEventListener('load', () => setTimeout(main, 0));
})();
