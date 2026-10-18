'use strict';
/* "Ask" chat: questions answered by Gemini (user's own free key) using OSRS Wiki pages. */

const AI_STUDIO = 'https://aistudio.google.com/apikey';
const chat = { pop: $('askPop'), body: $('askBody'), input: $('askInput'), history: [], busy: false, convId: null };
const newChatId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Small, safe Markdown subset: paragraphs, lists, tables, bold/italic/code, [[wiki links]] and [text](https://…)
const HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const unescapeHtml = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (m, e) => HTML_ENTITIES[e]);

// Links in AI answers only open official OSRS sites. Wiki pages can be edited by anyone, so a planted
// "go to this site" instruction can't turn into a clickable phishing link.
const TRUSTED_HOSTS = ['runescape.wiki', 'runescape.com', 'jagex.com', 'runelite.net', 'wiseoldman.net'];
function trustedLink(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && TRUSTED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch (e) { return false; }
}

function renderMarkdown(src) {
  const inline = (s) => escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // the title is already HTML-escaped here; un-escape it before building the URL ("Ava's device", "A & B")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, t, label) => `<a href="${wikiHref(unescapeHtml(t.trim()))}">${label || t}</a>`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, label, url) => (trustedLink(unescapeHtml(url))
      ? `<a href="${url}" data-ext>${label}</a>`
      : `<span class="link-blocked" title="Not opened: links in answers only go to official OSRS sites">${label}</span>`))
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  const lines = src.replace(/\r/g, '').split('\n');
  let html = '', list = null, para = [];
  const flushPara = () => { if (para.length) { html += `<p>${para.map(inline).join('<br>')}</p>`; para = []; } };
  const flushList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {   // table
      flushPara(); flushList();
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
      html += '<div class="table-wrap"><table class="wikitable"><tr>' + cells(line).map((c) => `<th>${c}</th>`).join('') + '</tr>';
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) { html += '<tr>' + cells(lines[i]).map((c) => `<td>${c}</td>`).join('') + '</tr>'; i++; }
      html += '</table></div>';
      i--;
    } else if ((m = line.match(/^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/))) {
      flushPara();
      const type = m[1] ? 'ol' : 'ul';
      if (list !== type) { flushList(); html += `<${type}>`; list = type; }
      html += `<li>${inline(m[2])}</li>`;
    } else if ((m = line.match(/^\s*#{1,6}\s+(.*)$/))) {
      flushPara(); flushList();
      html += `<h4>${inline(m[1])}</h4>`;
    } else if (!line.trim()) {
      flushPara(); flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara(); flushList();
  return html;
}

function scrollChat() { chat.body.scrollTop = chat.body.scrollHeight; }

function setupHtml(error = '') {
  return `
    <div class="ask-setup">
      <h3>Ask the Wise Old Man</h3>
      <p>He's an AI helper (Google's Gemini) who reads the matching OSRS Wiki pages before answering. It's <b>free</b>: you connect your own free Gemini key from your Google account.</p>
      <ol>
        <li><button class="btn small" id="askStudio">Open Google AI Studio</button> and sign in with your Google (Gmail) account. Accept the terms if it asks.</li>
        <li>Click <b>Create API key</b>. If it asks for a project, pick the suggested one or create a new one.</li>
        <li>In the list of keys, check its tier says <b>Free</b>.</li>
        <li>Copy the key and paste it here:</li>
      </ol>
      <form class="ask-keyform" id="askKeyForm">
        <input id="askKey" type="password" placeholder="Paste your whole key (starts with AQ. or AIza)" autocomplete="off" spellcheck="false">
        <button class="btn small" type="submit">Save</button>
      </form>
      ${error ? `<p class="ask-err">${escapeHtml(error)}</p>` : ''}
      <p class="ask-free"><b>Keep it free:</b> in AI Studio, never click <b>Set up billing</b> or <b>Upgrade</b>, and never add a card. A key without billing can't be charged; if you use up the free amount, it just pauses until the next day. If Google won't give you a key without adding billing, stop there.</p>
      <p class="dim">Your key is stored encrypted on this PC only. On Google's free tier, Google may use your questions to improve its products, so don't include personal info. Free use has limits per minute and per day. If you reach them, just wait; it never charges you.</p>
    </div>`;
}

function showSetup(error) {
  chat.body.innerHTML = setupHtml(error);
  $('askInputRow').hidden = true;
  $('askStudio').onclick = () => api.open_external(AI_STUDIO);
  $('askKeyForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'Checking…';
    const r = await api.gemini_set_key($('askKey').value);
    if (r.error) { showSetup(r.error); return; }
    showChat();
    toast('Gemini connected. Ask away!');
  };
  setTimeout(() => $('askKey') && $('askKey').focus(), 50);
}

function welcomeHtml() {
  const examples = ['How do I get a fire cape?', 'What should I train next for quests?', 'Best money making at my levels?', 'Open the Dragon Slayer II walkthrough'];
  return `<div class="ask-welcome"><p>Greetings, adventurer! Ask me anything about Old School RuneScape. I'll check the wiki before I answer.${state.me ? ` I'll keep <b>${escapeHtml(state.me)}</b>'s levels in mind.` : ''} <span id="askModeNote">${modeNote()}</span></p>
    <div class="ask-ex">${examples.map((x) => `<button class="chip" data-q="${escapeHtml(x)}">${escapeHtml(x)}</button>`).join('')}</div></div>`;
}

/* ---------------- context: the page you're on + what you highlighted (like an IDE's file/selection) ---------------- */

chat.ctx = { pageOff: null, sel: null };   // pageOff: a page title you removed; sel: { text, page }

function ctxPage() {
  const cur = nav.stack[nav.idx];
  return cur && cur.kind === 'page' && !els.article.hidden ? cur.title : null;
}
function activeContext() {
  const page = ctxPage();
  if (chat.ctx.sel && chat.ctx.sel.page !== page) chat.ctx.sel = null;   // highlight from a page you've left
  return { page: page && chat.ctx.pageOff !== page ? page : null, selection: chat.ctx.sel ? chat.ctx.sel.text : null };
}
const snip = (t, n) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);

window.renderCtx = function () {
  const box = $('askCtx');
  if (!box || chat.pop.hidden) return;
  const page = ctxPage();
  const c = activeContext();
  let html = '';
  if (c.page) {
    html += `<span class="ctx-chip" title="This page is sent to the Wise Old Man with your question">${svgIcon('i-doc')}
      <span>${escapeHtml(c.page)}</span><button type="button" data-x="page" title="Don't include this page">${svgIcon('i-x')}</button></span>`;
  } else if (page) {
    html += `<button type="button" class="ctx-add" data-add="page" title="Include the page you're reading">+ ${escapeHtml(snip(page, 40))}</button>`;
  }
  if (c.selection) {
    html += `<span class="ctx-chip quote" title="${escapeHtml(snip(c.selection, 400))}">${svgIcon('i-quote')}
      <span>${escapeHtml(snip(c.selection, 60))}</span><button type="button" data-x="sel" title="Remove the highlighted text">${svgIcon('i-x')}</button></span>`;
  }
  box.innerHTML = html;
  box.hidden = !html;
  chat.input.placeholder = c.selection ? 'Ask about the highlighted text…'
    : c.page ? `Ask about ${snip(c.page, 34)}… (Enter to send)` : 'Ask a question… (Enter to send)';
};
$('askCtx').onclick = (e) => {
  const x = e.target.closest('[data-x]'), add = e.target.closest('[data-add]');
  if (x && x.dataset.x === 'page') chat.ctx.pageOff = ctxPage();
  if (x && x.dataset.x === 'sel') chat.ctx.sel = null;
  if (add) chat.ctx.pageOff = null;
  renderCtx();
  chat.input.focus();
};

// highlight text in an article -> remember it, and offer a floating "Ask about this" button
const selBtn = $('askSelBtn');
function hideSelBtn() { selBtn.hidden = true; }
function articleSelection() {
  const s = window.getSelection();
  if (!s || s.isCollapsed || !s.rangeCount || els.article.hidden || !els.article.contains(s.anchorNode)) return null;
  return s;
}
// keep the button next to the highlight (pages shift as images load, and you can scroll)
function placeSelBtn() {
  const s = articleSelection();
  if (!s || !chat.pop.hidden || isMini()) { hideSelBtn(); return; }
  const r = s.getRangeAt(s.rangeCount - 1).getBoundingClientRect();
  const top = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--chrome-h'), 10) || 94;
  if ((!r.width && !r.height) || r.bottom < top + 8 || r.top > window.innerHeight - 8) { hideSelBtn(); return; }
  selBtn.hidden = false;
  const w = selBtn.offsetWidth || 150;
  selBtn.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w / 2))}px`;
  selBtn.style.top = `${r.top - 42 > top + 6 ? r.top - 42 : r.bottom + 10}px`;
}
document.addEventListener('selectionchange', () => {
  const s = articleSelection();
  const text = s ? s.toString().replace(/\s+/g, ' ').trim() : '';
  if (text.length < 3) { hideSelBtn(); return; }
  chat.ctx.sel = { text: text.slice(0, 2000), page: ctxPage() };
  renderCtx();
  placeSelBtn();
});
els.article.addEventListener('mousedown', (e) => {   // clicking elsewhere in the article drops the old highlight
  if (!e.target.closest('.sel-ask')) { chat.ctx.sel = null; renderCtx(); }
});
els.scroller.addEventListener('scroll', () => { if (!selBtn.hidden) placeSelBtn(); }, { passive: true });
selBtn.addEventListener('mousedown', (e) => e.preventDefault());   // keep the highlight while clicking
selBtn.onclick = () => { hideSelBtn(); openAsk(); };

function showChat() {
  $('askInputRow').hidden = false;
  chat.body.innerHTML = chat.history.length ? '' : welcomeHtml();
  chat.history.forEach((m) => addBubble(m.role, m.text, m.sources, false, m.ctx));
  if (chat.pending && chat.pendingFor === chat.history) {   // an answer is on its way for this chat: keep it on screen
    addBubble('user', chat.pendingQ, [], false, chat.pendingCtx);
    chat.body.appendChild(chat.pending);
  }
  renderCtx();
  scrollChat();
  chat.input.focus();
}

function addBubble(role, text, sources = [], scroll = true, ctx = null) {
  const welcome = chat.body.querySelector('.ask-welcome');
  if (welcome) welcome.remove();
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'me' : 'ai');
  if (role === 'user') {
    div.textContent = text;
    if (ctx && (ctx.page || ctx.selection)) {   // show what was attached to this question
      const tags = document.createElement('div');
      tags.className = 'msg-ctx';
      tags.innerHTML = (ctx.page ? `<span>${svgIcon('i-doc')}${escapeHtml(snip(ctx.page, 40))}</span>` : '') +
        (ctx.selection ? `<span title="${escapeHtml(snip(ctx.selection, 400))}">${svgIcon('i-quote')}${escapeHtml(snip(ctx.selection, 36))}</span>` : '');
      div.appendChild(tags);
    }
  } else {
    div.innerHTML = `<div class="wiki md">${renderMarkdown(text)}</div>` +
      (sources && sources.length ? `<div class="ask-src"><span>Wiki pages used:</span>${sources.map((s) => `<a class="chip" href="${wikiHref(s)}">${escapeHtml(s)}</a>`).join('')}</div>` : '');
  }
  chat.body.appendChild(div);
  if (scroll) scrollChat();
  return div;
}

async function send(question) {
  question = question.trim();
  if (!question) return;
  if (chat.busy) { toast('The Wise Old Man is still answering. Ask again in a moment.'); return; }
  chat.busy = true;
  const hist = chat.history;   // the answer belongs to this chat, even if you switch to another meanwhile
  if (!chat.convId) chat.convId = newChatId();
  const convId = chat.convId;
  chat.pendingFor = hist;
  chat.pendingConvId = convId;
  chat.input.value = '';
  autoGrow();
  const ctx = activeContext();
  addBubble('user', question, [], true, ctx);
  chat.pendingCtx = ctx;
  chat.ctx.sel = null;          // a highlight is used once; the page stays while you're on it
  renderCtx();
  const thinking = document.createElement('div');
  thinking.className = 'msg ai thinking';
  thinking.innerHTML = '<span class="dots"><i></i><i></i><i></i></span> <span class="status">Reading the wiki…</span>';
  chat.body.appendChild(thinking);
  chat.pending = thinking;
  chat.pendingQ = question;
  scrollChat();
  let r;
  try {
    r = await api.ask(question, hist.map(({ role, text, sources }) => ({ role, text, sources })), ctx);
  } catch (err) {
    r = { error: 'Something went wrong sending that. Please try again.' };
  } finally {
    thinking.remove();
    chat.pending = null;
    chat.busy = false;   // never leave the chat stuck if a request fails
  }
  const current = chat.history === hist;
  if (r.needKey) { if (current) showSetup(r.error); return; }
  if (r.error) {
    if (!current) return;
    const d = addBubble('model', '');
    d.classList.add('err');
    d.textContent = r.error;
    return;
  }
  const answer = r.answer || (r.open ? `Opening ${r.open.title}${r.open.anchor ? ` (${r.open.anchor})` : ''}.` : '');
  hist.push({ role: 'user', text: question, ctx }, { role: 'model', text: answer, sources: r.sources });
  if (hist.length > 100) hist.splice(0, hist.length - 100);
  api.chat_save(convId, hist);   // chat history: the last 10 chats are kept on this PC
  if (!current) return;          // you've moved to another chat; this one is saved for later
  $('askModel').textContent = r.model ? `AI · ${r.model.replace(/^gemini-([\d.]+)-flash(-lite)?$/, (m, v, l) => `Gemini ${v} Flash${l ? '-Lite' : ''}`)}` : '';
  addBubble('model', answer, r.sources);
  // keep a long session light: only the last 50 exchanges stay on screen
  const bubbles = chat.body.querySelectorAll('.msg');
  for (let i = 0; i < bubbles.length - 100; i++) bubbles[i].remove();
  if (r.open) {
    // Gemini asked to open a page: show it (scrolled to the section) and tuck the chat away. ✦ brings it back.
    closeAsk();
    await openPage(r.open.title, { anchor: r.open.anchor ? '#' + r.open.anchor.replace(/ /g, '_') : '' });
    toast(`Opened ${r.open.title}${r.open.anchor ? ' → ' + r.open.anchor : ''}. Press ✦ to go back to the chat.`);
  }
}

// Called from Python while an answer is on its way
window.askStatus = function (text) {
  const s = chat.pending && chat.pending.querySelector('.status');
  if (s) s.textContent = text;
};
window.askStream = function (text) {
  const el = chat.pending;
  if (!el) return;
  const nearBottom = chat.body.scrollHeight - chat.body.scrollTop - chat.body.clientHeight < 60;
  el.classList.remove('thinking');
  el.innerHTML = `<div class="wiki md">${renderMarkdown(text.replace(/^\s*\**\s*OPEN:.*$/gm, ''))}</div>`;
  if (nearBottom) scrollChat();
};

function autoGrow() {
  chat.input.style.height = 'auto';
  chat.input.style.height = Math.min(chat.input.scrollHeight, 120) + 'px';
}

/* "Playing as": Auto (from the account set as "This is me") or a fixed account type */
const MODES = [   // value, name, short label, one-line description
  ['regular', 'Main', 'Main', 'Normal advice, Grand Exchange allowed'],
  ['ironman', 'Ironman', 'Ironman', 'No Grand Exchange or trading'],
  ['hardcore', 'Hardcore Ironman', 'Hardcore', 'Ironman rules, plus warnings about risky content'],
  ['ultimate', 'Ultimate Ironman', 'Ultimate', 'Ironman rules, and no bank'],
  ['group', 'Group Ironman', 'Group Iron', 'Trade only within your group, group storage'],
  ['hcgim', 'Hardcore Group Ironman', 'HC Group Iron', 'Group rules, plus shared lives'],
];
const MODE_INFO = Object.fromEntries(MODES.map(([v, name, short, desc]) => [v, { name, short, desc }]));
const MODE_NOTES = {
  ironman: 'Advice is for an <b>Ironman</b>: no Grand Exchange or trading.',
  hardcore: 'Advice is for a <b>Hardcore Ironman</b>: no Grand Exchange or trading, and I’ll warn you about risky content.',
  ultimate: 'Advice is for an <b>Ultimate Ironman</b>: no Grand Exchange, trading or bank.',
  group: 'Advice is for a <b>Group Ironman</b>: trading only within your group, no Grand Exchange.',
  hcgim: 'Advice is for a <b>Hardcore Group Ironman</b>: group-only trading, and I’ll warn you about risky content.',
};
chat.mode = 'regular';
let modeInfo = { mode: 'auto' };
function modeNote() { return MODE_NOTES[chat.mode] || ''; }

const modeBtn = $('askModeBtn'), modeMenu = $('askModeMenu');

function renderModeMenu() {
  const autoDesc = modeInfo.me
    ? `From ${escapeHtml(modeInfo.me)}: ${MODE_INFO[modeInfo.detected || 'regular'].name}`
    : 'Set your account in the Character tab first';
  const item = (v, name, desc) => `<li role="option" data-v="${v}" aria-selected="${modeInfo.mode === v}">
      <b>${name}</b><small>${desc}</small><svg class="ic"><use href="#i-check"/></svg></li>`;
  modeMenu.innerHTML = item('auto', 'Auto', autoDesc) + '<li class="sep"></li>' +
    MODES.map(([v, name, , desc]) => item(v, name, desc)).join('');
}

async function refreshMode() {
  modeInfo = await api.ask_mode_info();
  chat.mode = modeInfo.mode === 'auto' ? (modeInfo.detected || 'regular') : modeInfo.mode;
  $('askModeLabel').textContent = modeInfo.mode === 'auto' && modeInfo.me
    ? `Auto · ${MODE_INFO[chat.mode].short}` : modeInfo.mode === 'auto' ? 'Auto' : MODE_INFO[chat.mode].short;
  modeBtn.classList.toggle('iron', chat.mode !== 'regular');
  renderModeMenu();
  const note = $('askModeNote');
  if (note) note.innerHTML = modeNote();
}

function openModeMenu() {
  closeHistMenu();
  renderModeMenu();
  modeMenu.hidden = false;
  modeBtn.setAttribute('aria-expanded', 'true');
  const sel = modeMenu.querySelector('[aria-selected="true"]');
  if (sel) sel.classList.add('focus');
}
function closeModeMenu() {
  modeMenu.hidden = true;
  modeBtn.setAttribute('aria-expanded', 'false');
}
async function chooseMode(v) {
  closeModeMenu();
  await api.set_ask_mode(v);
  await refreshMode();
  toast(chat.mode === 'regular' ? 'The Wise Old Man will give normal (main account) advice.'
    : `The Wise Old Man will answer for a${/^[aeiou]/i.test(MODE_INFO[chat.mode].name) ? 'n' : ''} ${MODE_INFO[chat.mode].name}.`);
}
modeBtn.onclick = (e) => { e.stopPropagation(); modeMenu.hidden ? openModeMenu() : closeModeMenu(); };
modeMenu.onclick = (e) => {
  const li = e.target.closest('li[data-v]');
  if (li) chooseMode(li.dataset.v);
};
document.addEventListener('mousedown', (e) => {
  if (!modeMenu.hidden && !e.target.closest('.ask-mode')) closeModeMenu();
});
document.addEventListener('keydown', (e) => {
  if (modeMenu.hidden) return;
  const items = [...modeMenu.querySelectorAll('li[data-v]')];
  let i = items.findIndex((li) => li.classList.contains('focus'));
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeModeMenu(); modeBtn.focus(); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    i = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((li, j) => li.classList.toggle('focus', j === i));
  } else if (e.key === 'Enter' && i >= 0) { e.preventDefault(); chooseMode(items[i].dataset.v); }
}, true);

// Docked side panel: the page narrows to sit beside the chat when there's room for both; otherwise it floats.
const DOCK = { minPage: 480, minW: 340, maxW: 760 };
let askW = 420;
try { askW = Number(localStorage.getItem('askWidth')) || 420; } catch (e) { /* no storage: default width */ }
function updateDock() {
  const docked = !chat.pop.hidden && !isMini() && window.innerWidth >= DOCK.minW + DOCK.minPage;
  if (docked) {
    const w = Math.round(Math.max(DOCK.minW, Math.min(askW, DOCK.maxW, window.innerWidth - DOCK.minPage)));
    document.documentElement.style.setProperty('--ask-w', w + 'px');
  }
  document.body.classList.toggle('ask-docked', docked);
}
window.addEventListener('resize', updateDock);
const askResize = $('askResize');
askResize.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  askResize.setPointerCapture(e.pointerId);
  askResize.classList.add('drag');
  document.body.classList.add('ask-resizing');
});
let resizeFrame = 0;
askResize.addEventListener('pointermove', (e) => {
  if (!askResize.hasPointerCapture(e.pointerId)) return;
  askW = window.innerWidth - e.clientX;
  if (!resizeFrame) resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; updateDock(); });   // once per frame
});
const endResize = (e) => {
  if (!askResize.hasPointerCapture(e.pointerId)) return;
  askResize.releasePointerCapture(e.pointerId);
  askResize.classList.remove('drag');
  document.body.classList.remove('ask-resizing');
  askW = Math.round(Math.max(DOCK.minW, Math.min(askW, DOCK.maxW)));
  try { localStorage.setItem('askWidth', String(askW)); } catch (err) { /* not remembered */ }
};
askResize.addEventListener('pointerup', endResize);
askResize.addEventListener('pointercancel', endResize);

async function openAsk() {
  closePops();
  hideSelBtn();
  chat.pop.hidden = false;
  updateDock();
  $('btnAsk').classList.add('on');
  refreshMode();   // may look up your account type; doesn't hold up the chat
  const st = await api.gemini_status();
  if (!st.hasKey) showSetup(); else showChat();
}
function closeAsk() {
  chat.pop.hidden = true;
  updateDock();
  $('btnAsk').classList.remove('on');
}

// Daily question limit (Settings): an extra cap on top of Google's free tier
const LIMIT_STEPS = [0, 10, 25, 50, 100, 200, 300, 500, 1000];
function showAskLimit(st) {
  $('askLimVal').textContent = st.limit ? st.limit : 'Off';
  $('askUsed').textContent = `(${st.usedToday} used today)`;
}
async function stepAskLimit(dir) {
  const st = await api.gemini_status();
  const i = Math.max(0, LIMIT_STEPS.findIndex((v) => v >= (st.limit || 0)));
  const next = LIMIT_STEPS[Math.max(0, Math.min(LIMIT_STEPS.length - 1, i + dir))];
  showAskLimit(await api.set_ask_limit(next));
}
$('askLimDown').onclick = () => stepAskLimit(-1);
$('askLimUp').onclick = () => stepAskLimit(1);
$('btnSettings').addEventListener('click', async () => showAskLimit(await api.gemini_status()));

$('btnAsk').onclick = () => (chat.pop.hidden ? openAsk() : closeAsk());
$('askClose').onclick = closeAsk;
// New chat (button or Ctrl+N): the current one is already saved in the history
window.newChat = async function () {
  closeHistMenu();
  chat.history = [];
  chat.convId = null;
  if (isMini()) await setMini(false);
  if (chat.pop.hidden) openAsk(); else showChat();
};
$('askClear').onclick = () => newChat();

// Chat history: your last 10 chats, newest first. Click one to carry on with it.
const histBtn = $('askHistBtn'), histMenu = $('askHistMenu');
function ago(t) {
  const s = Date.now() / 1000 - t;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
async function openHistMenu() {
  closeModeMenu();
  const list = await api.chats_list();
  histMenu.innerHTML = list.length
    ? list.map((c) => `<li role="option" data-id="${escapeHtml(c.id)}" aria-selected="${c.id === chat.convId}">
        <b>${escapeHtml(c.title)}</b><small>${ago(c.updated)} · ${c.questions} question${c.questions === 1 ? '' : 's'}</small>
        <button class="hist-del" type="button" data-del="${escapeHtml(c.id)}" title="Delete this chat">${svgIcon('i-close')}</button></li>`).join('') +
      '<li class="hist-note">Your last 10 chats, saved on this PC only.</li>'
    : '<li class="hist-empty">No saved chats yet. Ask the Wise Old Man something and it will show up here.</li>';
  histMenu.hidden = false;
  histBtn.setAttribute('aria-expanded', 'true');
}
function closeHistMenu() {
  histMenu.hidden = true;
  histBtn.setAttribute('aria-expanded', 'false');
}
async function loadChat(id) {
  if (chat.busy && id === chat.pendingConvId) {   // its answer is still coming: keep the live copy, not the file's
    chat.history = chat.pendingFor;
    chat.convId = id;
    showChat();
    return;
  }
  const c = await api.chat_load(id);
  if (!c) { toast('That chat is no longer saved.'); return; }
  chat.history = c.messages;
  chat.convId = c.id;
  const st = await api.gemini_status();
  if (st.hasKey) showChat(); else showSetup();
}
histBtn.onclick = (e) => { e.stopPropagation(); histMenu.hidden ? openHistMenu() : closeHistMenu(); };
histMenu.onclick = async (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    e.stopPropagation();
    await api.chat_delete(del.dataset.del);
    if (del.dataset.del === chat.convId) chat.convId = null;   // still on screen; a new question saves it as a new chat
    openHistMenu();
    return;
  }
  const li = e.target.closest('li[data-id]');
  if (li) { closeHistMenu(); loadChat(li.dataset.id); }
};
document.addEventListener('mousedown', (e) => {
  if (!histMenu.hidden && !e.target.closest('.ask-hist')) closeHistMenu();
});
document.addEventListener('keydown', (e) => {
  if (!histMenu.hidden && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeHistMenu(); histBtn.focus(); }
}, true);
$('askKeyBtn').onclick = async () => {
  if (!confirm('Remove your saved Gemini key from this PC? You can add a new one right after.')) return;
  await api.gemini_clear_key();
  showSetup();
};
$('askForm').onsubmit = (e) => { e.preventDefault(); send(chat.input.value); };
chat.input.addEventListener('input', autoGrow);
chat.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(chat.input.value); }
  if (e.key === 'Escape') closeAsk();
});
chat.body.addEventListener('click', (e) => {
  const ex = e.target.closest('[data-q]');
  if (ex) send(ex.dataset.q);
  // following a wiki link (handled by the app's global link handler) shows the page, so get out of the way
  if (e.target.closest('a[href^="/w/"]')) closeAsk();
});
