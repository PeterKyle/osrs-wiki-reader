'use strict';
/* Fake window.pywebview.api for the UI harness: every method app.py exposes, answered from the fixtures
   (tests/ui/fixtures/*.js) and a little in-memory state. Loaded after the fixtures and before ui/app.js.
   Query params read here: mode (see scenarios.js), theme, nokey, aged.
   Everything is inside a function so no top-level name can clash with the app's own globals (state, $, ...). */
(() => {
const QS = new URLSearchParams(location.search);
const MODE = QS.get('mode') || 'home';
const now = () => Date.now() / 1000;
const clone = (o) => JSON.parse(JSON.stringify(o));

const __st = {
  version: 'test', pinned: false, theme: QS.get('theme') || 'dark', zoom: 100, volume: 100,
  hotkey: 'Ctrl+Alt+W', hotkeyOk: true, askHotkey: 'Ctrl+Alt+Q', askHotkeyOk: true,
  guideSeen: MODE !== 'guide',   // the first-launch guide only opens in the "guide" scenario
  recent: [], accounts: ['Lynx Titan', 'Woox'], me: 'Lynx Titan', bookmarks: ['Abyssal whip'],
  watchlist: [4151, 11832, 560, 13652],
  timers: [
    { id: 1, label: 'Herbs', minutes: 80, ends: now() + 2900, notified: false },
    { id: 2, label: 'Birdhouses', minutes: 50, ends: now() - 60, notified: true },
    { id: 3, label: 'Magic tree', minutes: 480, ends: now() + 20000, notified: false },
  ],
  alerts: [
    { id: 4151, name: 'Abyssal whip', dir: 'above', price: 850000 },
    { id: 4151, name: 'Abyssal whip', dir: 'below', price: 700000 },
  ],
  now: now(),
};
const state = () => ({ ...__st, now: now() });

const MIXOLOGY = "As an ironman, the best rewards from [[Mastering Mixology]] are its utility items.\n\n- **Chugging barrel:** drink several potions at once.\n- **Prescription goggles:** a chance to save secondaries.\n- **[[Alchemist's amulet]]:** already linked.\n- **Not a page at all:** stays plain.";
const FIRE_CAPE = "To get a **fire cape** you need to complete the [[TzHaar Fight Cave]] and defeat [[TzTok-Jad]] at the end of wave 63.\n\nWith your levels (99 Ranged, 99 Defence) you're well set. Recommended setup:\n\n- **Ranged**: [[Toxic blowpipe]] or a [[Rune crossbow]] with ruby/diamond bolts (e)\n- **Prayer**: Protect from Missiles, swap to Magic for Jad's mage attack\n- **Supplies**: ~15 [[Saradomin brew]]s, 6 [[Super restore]]s\n\n| Wave | Notes |\n|---|---|\n| 1-62 | Use safespots |\n| 63 | TzTok-Jad: switch prayers on his animation |\n\nSee the strategy guide for safespots.";
const SPEC = "The **special attack** (Energy Drain) drains 10% of the target's run energy and gives it to you.";

// Chat history, mirroring app.py's chats_list / chat_load / chat_save / chat_delete (newest first, max 10).
// With ?aged=1 each new chat is dated a couple of hours older than the last, to show the time labels.
const __chats = [];
const chatTitle = (msgs) => {
  const t = ((msgs.find((m) => m.role === 'user') || {}).text || 'Chat').replace(/\s+/g, ' ').trim();
  return t.length <= 60 ? t : t.slice(0, 57).trimEnd() + '…';
};

const UPDATE = {
  available: true, version: '1.3.2', canInstall: true, page: 'https://github.com',
  releases: [
    { version: '1.3.2', date: '2026-10-18', notes: "## What's new\n- **A proper update pop-up** with patch notes, so you never miss what changed\n- **Download progress** while updating\n\n## Fixed\n- Small polish and stability fixes" },
    { version: '1.3.1', date: '2026-10-18', notes: 'Maintenance release: same features as 1.3.0. Nothing you need to do.' },
  ],
};

window.__calls = [];   // every API call, for scenarios that want to check what the page asked for
const API = {
  // settings / window
  get_state: async () => state(),
  set_pref: async (k, v) => { if (k === 'theme') __st.theme = v; if (k === 'zoom') __st.zoom = v; if (k === 'volume') __st.volume = v; if (k === 'guide_seen') __st.guideSeen = !!v; if (k === 'clear_recent') __st.recent = []; return state(); },
  toggle_pin: async () => { __st.pinned = !__st.pinned; return state(); },
  minimize: async () => null, close: async () => null, toggle_maximize: async () => false, is_maximized: async () => false,
  start_drag: async () => null, start_resize: async () => null, open_external: async () => null,
  set_mini: async () => true, mini_height: async () => null,
  pause_hotkey: async () => null,
  set_hotkey: async (label, mods, vk, kind = 'show') => { if (kind === 'ask') __st.askHotkey = label; else __st.hotkey = label; return state(); },
  clear_hotkey: async (kind = 'show') => { if (kind === 'ask') __st.askHotkey = 'Off'; else __st.hotkey = 'Off'; return state(); },
  check_update: async () => (['update', 'updprog'].includes(MODE) ? clone(UPDATE) : { available: false }),
  install_update: async () => { for (let i = 1; i <= 6; i++) { await new Promise((r) => setTimeout(r, 150)); window.updateProgress(i * 0.1); } return { ok: true }; },

  // wiki
  page: async (t) => (window.__PAGES[t] ? clone(window.__PAGES[t]) : { error: 'Page not found (no fixture for "' + t + '").' }),
  search: async () => [], random: async () => 'Abyssal whip',

  // accounts / character
  save_account: async () => state(), set_me: async () => state(), remove_account: async () => state(),
  toggle_bookmark: async () => state(),
  player: async (n) => clone(String(n).toLowerCase() === 'woox' ? window.__BUDDY
    : String(n).toLowerCase() === 'clyde lives' ? window.__PROFILE.player : window.__PLAYER),
  player_extras: async () => clone(window.__PROFILE.extras),
  xp_timeline: async (n, metric, period) => ({ ...clone(window.__PROFILE.timeline), metric, period }),
  gim_group: async (n) => (String(n).toLowerCase() === 'clyde lives' ? clone(window.__PROFILE.gim) : { needName: true }),
  set_gim_group: async () => clone(window.__PROFILE.gim),
  group_overview: async (n) => (String(n).toLowerCase() === 'clyde lives' && window.__GROUP_OVERVIEW ? clone(window.__GROUP_OVERVIEW) : { needName: true }),
  latest_update: async () => clone(window.__PROFILE.update),
  pet_rates: async () => clone(window.__PROFILE.pets),
  ca_data: async () => clone(window.__PROFILE.ca),
  recommended_gear: async (t) => clone(((window.__PROFILE.gear || {})[t]) || []),
  // an in-memory bank (the real one parses Bank Memory's TSV in app.py; tests/test_bank.py covers that)
  import_bank: async (rsn, text) => {
    const items = {};
    String(text).split(/\r?\n/).slice(1).forEach((l) => { const c = l.split('\t'); if (c.length >= 3) items[c[1]] = (items[c[1]] || 0) + +c[2]; });
    if (!Object.keys(items).length) return { error: "That doesn't look like a bank export." };
    window.__BANK = items;
    return { rsn, imported: true, updated: Date.now() / 1000, different: Object.keys(items).length, total: Object.values(items).reduce((a, b) => a + b, 0) };
  },
  clear_bank: async (rsn) => { window.__BANK = null; return { rsn, imported: false }; },
  bank_info: async (rsn) => (window.__BANK ? { rsn, imported: true, updated: window.__BANK_UPDATED || Date.now() / 1000, different: Object.keys(window.__BANK).length } : { rsn, imported: false }),
  clog_has: async (names) => {
    const p = window.__PROFILE.player;
    if (!p.clog) return null;
    const got = new Set(p.clog.items.map((n) => n.toLowerCase()));
    return Object.fromEntries(names.map((n) => [n, got.has(n.toLowerCase())]));
  },
  set_progress: async (t) => (window.__BANK ? clone(((window.__PROFILE.setProgress || {})[t]) || []) : null),
  bank_has: async (names, generic) => {
    if (!window.__BANK) return null;
    const have = Object.fromEntries(Object.entries(window.__BANK).map(([k, v]) => [k.toLowerCase(), v]));
    const count = (n) => have[n.toLowerCase()] || (generic ? Object.entries(have).filter(([k]) => k.endsWith(' ' + n.toLowerCase())).reduce((t, [, v]) => t + v, 0) : 0);
    return Object.fromEntries(names.map((n) => [n, count(n)]));
  },
  bank_value: async () => (window.__BANK ? clone(window.__PROFILE.bankValue) : { imported: false }),
  // the Gearscape frame's helper needs the real WebView2 (checked by hand), so the harness has none
  web_bridge: async () => false,
  bank_export: async () => null,
  gear_upgrades: async (t) => (window.__BANK ? clone(((window.__PROFILE.upgrades || {})[t]) || null) : null),
  clipboard_text: async () => window.__CLIP || '',
  bank_items: async () => (window.__BANK ? Object.entries(window.__BANK).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty) : null),
  can_make: async () => (window.__BANK ? clone(window.__PROFILE.canMake) : null),
  item_sources: async (n) => clone((window.__PROFILE.sources || {})[n] || { drops: [], shops: [], made: null, quest: null }),
  is_item_page: async (t) => t === 'Abyssal whip',
  rare_drops: async (t) => clone(((window.__PROFILE.drops || {})[t]) || []),
  page_requirements: async (t) => clone((window.__PROFILE.reqs || {})[t] || {}),
  set_goal: async (g) => { __st.goal = g; return state(); },
  fun_facts: async () => clone(window.__PROFILE.facts),
  image_data: async () => ({}),
  copy_image: async () => ({ ok: true }),
  save_image: async () => ({ path: 'C:\Users\you\Pictures\OSRS Wiki Reader\card.png' }),
  wom_update: async () => ({ ok: true }),
  training_methods: async () => clone(window.__METHODS),
  quest_requirements: async () => clone(window.__QUESTS),

  // Grand Exchange
  item_price: async (t) => (t === 'Abyssal whip' ? clone(window.__GE.price) : null),
  price_history: async (id, series) => clone(window.__GE.hist[series]),
  watchlist: async () => clone(window.__GE.watch), toggle_watch: async () => true,
  set_alert: async () => state(), remove_alert: async () => state(),
  add_timer: async () => state(), remove_timer: async () => state(), restart_timer: async () => state(),

  // Wise Old Man
  gemini_status: async () => ({ hasKey: MODE !== 'setup' && !QS.get('nokey'), model: null, limit: 300, usedToday: 3 }),
  gemini_set_key: async () => ({ ok: true }), gemini_clear_key: async () => ({ ok: true }),
  set_ask_limit: async (n) => ({ hasKey: true, model: null, limit: n, usedToday: 3 }),
  ask_mode_info: async () => ({ mode: window.__mode || 'auto', detected: 'regular', detectedLabel: 'main account', me: 'Lynx Titan' }),
  set_ask_mode: async (v) => { window.__mode = v; return API.ask_mode_info(); },
  ask: async (q, hist, ctx) => {
    window.__sentCtx = ctx;
    if (/mixology/i.test(q)) return { model: 'gemini-3.8-flash', sources: ['Mastering Mixology'], answer: MIXOLOGY };
    return MODE.startsWith('ctx')
      ? { model: 'gemini-3.5-flash-lite', sources: ['Abyssal whip'], answer: SPEC }
      : { model: 'gemini-3.8-flash', sources: ['Fire cape', 'TzHaar Fight Cave', 'TzHaar Fight Cave/Strategies'], answer: FIRE_CAPE };
  },
  wiki_titles: async (names) => Object.fromEntries(names.filter((n) => !/not a page/i.test(n)).map((n) => [n, n[0].toUpperCase() + n.slice(1)])),
  chats_list: async () => [...__chats].sort((a, b) => b.updated - a.updated)
    .map((c) => ({ id: c.id, title: c.title, updated: c.updated, questions: c.messages.filter((m) => m.role === 'user').length })),
  chat_load: async (id) => { const c = __chats.find((x) => x.id === id); return c ? clone(c) : null; },
  chat_save: async (id, msgs) => {
    const i = __chats.findIndex((c) => c.id === id);
    const aged = QS.get('aged') && i < 0 ? 7200 * (__chats.length + 1) : 0;
    const c = { id, title: chatTitle(msgs), updated: now() - aged, messages: clone(msgs) };
    if (i >= 0) __chats[i] = c; else __chats.push(c);
    __chats.sort((a, b) => b.updated - a.updated);
    __chats.splice(10);
    return true;
  },
  chat_delete: async (id) => { const i = __chats.findIndex((c) => c.id === id); if (i >= 0) __chats.splice(i, 1); return API.chats_list(); },
};

// Log each call; a method the UI uses but this file lacks shows up as a console error instead of a silent hang.
window.pywebview = {
  api: new Proxy(API, {
    get(target, name) {
      if (typeof name !== 'string' || name === 'then') return undefined;
      const fn = target[name];
      if (!fn) return async () => { console.error('mock_api: no fake for api.' + name); return null; };
      return (...args) => { window.__calls.push(name); return fn(...args); };
    },
  }),
};
setTimeout(() => window.dispatchEvent(new Event('pywebviewready')), 50);
window.__mock = { state: __st, chats: __chats, QS, MODE };
})();
