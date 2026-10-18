'use strict';
/* "Ask" chat: questions answered by Gemini (user's own free key) using OSRS Wiki pages. */

const AI_STUDIO = 'https://aistudio.google.com/apikey';
const chat = { pop: $('askPop'), body: $('askBody'), input: $('askInput'), history: [], busy: false };

// Small, safe Markdown subset: paragraphs, lists, tables, bold/italic/code, [[wiki links]] and [text](https://…)
function renderMarkdown(src) {
  const inline = (s) => escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, t, label) => `<a href="${wikiHref(t.trim())}">${label || t}</a>`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, label, url) => `<a href="${url}" data-ext>${label}</a>`)
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
      <h3>Ask anything about OSRS</h3>
      <p>Answers come from Google's Gemini, using the OSRS Wiki pages that match your question. It's <b>free</b>: you connect your own free Gemini key from your Google account.</p>
      <ol>
        <li><button class="btn small" id="askStudio">Open Google AI Studio</button> and sign in with your Gmail.</li>
        <li>Click <b>Create API key</b>. No credit card is needed. Don't add billing, so it stays free.</li>
        <li>Copy the key and paste it here:</li>
      </ol>
      <form class="ask-keyform" id="askKeyForm">
        <input id="askKey" type="password" placeholder="Paste your whole key (starts with AQ. or AIza)" autocomplete="off" spellcheck="false">
        <button class="btn small" type="submit">Save</button>
      </form>
      ${error ? `<p class="ask-err">${escapeHtml(error)}</p>` : ''}
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
  return `<div class="ask-welcome"><p>Ask a question about Old School RuneScape.${state.me ? ` Answers take <b>${escapeHtml(state.me)}</b>'s levels into account.` : ''}</p>
    <div class="ask-ex">${examples.map((x) => `<button class="chip" data-q="${escapeHtml(x)}">${escapeHtml(x)}</button>`).join('')}</div></div>`;
}

function showChat() {
  $('askInputRow').hidden = false;
  chat.body.innerHTML = chat.history.length ? '' : welcomeHtml();
  chat.history.forEach((m) => addBubble(m.role, m.text, m.sources, false));
  scrollChat();
  chat.input.focus();
}

function addBubble(role, text, sources = [], scroll = true) {
  const welcome = chat.body.querySelector('.ask-welcome');
  if (welcome) welcome.remove();
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'me' : 'ai');
  if (role === 'user') div.textContent = text;
  else {
    div.innerHTML = `<div class="wiki md">${renderMarkdown(text)}</div>` +
      (sources && sources.length ? `<div class="ask-src"><span>Wiki pages used:</span>${sources.map((s) => `<a class="chip" href="${wikiHref(s)}">${escapeHtml(s)}</a>`).join('')}</div>` : '');
  }
  chat.body.appendChild(div);
  if (scroll) scrollChat();
  return div;
}

async function send(question) {
  question = question.trim();
  if (!question || chat.busy) return;
  chat.busy = true;
  chat.input.value = '';
  autoGrow();
  addBubble('user', question);
  const thinking = document.createElement('div');
  thinking.className = 'msg ai thinking';
  thinking.innerHTML = '<span class="dots"><i></i><i></i><i></i></span> Reading the wiki…';
  chat.body.appendChild(thinking);
  scrollChat();
  let r;
  try {
    r = await api.ask(question, chat.history.map(({ role, text, sources }) => ({ role, text, sources })));
  } catch (err) {
    r = { error: 'Something went wrong sending that. Please try again.' };
  } finally {
    thinking.remove();
    chat.busy = false;   // never leave the chat stuck if a request fails
  }
  if (r.needKey) { showSetup(r.error); return; }
  if (r.error) {
    const d = addBubble('model', '');
    d.classList.add('err');
    d.textContent = r.error;
    return;
  }
  const answer = r.answer || (r.open ? `Opening ${r.open.title}${r.open.anchor ? ` (${r.open.anchor})` : ''}.` : '');
  chat.history.push({ role: 'user', text: question }, { role: 'model', text: answer, sources: r.sources });
  $('askModel').textContent = r.model ? `Gemini · ${r.model}` : '';
  addBubble('model', answer, r.sources);
  if (r.open) {
    // Gemini asked to open a page: show it (scrolled to the section) and tuck the chat away. ✦ brings it back.
    closeAsk();
    await openPage(r.open.title, { anchor: r.open.anchor ? '#' + r.open.anchor.replace(/ /g, '_') : '' });
    toast(`Opened ${r.open.title}${r.open.anchor ? ' → ' + r.open.anchor : ''}. Press ✦ to go back to the chat.`);
  }
}

function autoGrow() {
  chat.input.style.height = 'auto';
  chat.input.style.height = Math.min(chat.input.scrollHeight, 120) + 'px';
}

async function openAsk() {
  closePops();
  chat.pop.hidden = false;
  $('btnAsk').classList.add('on');
  const st = await api.gemini_status();
  if (!st.hasKey) showSetup(); else showChat();
}
function closeAsk() {
  chat.pop.hidden = true;
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
$('askClear').onclick = () => { chat.history = []; showChat(); };
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
