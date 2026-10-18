'use strict';
/* Extra profile sections on the Character tab: goals, Wise Old Man milestones & records, an XP-over-time chart,
   the Group Ironman group, and a shareable profile card. renderPlayer() (char.js) adds the placeholders. */

const XP_99 = 13034431;
const metricName = (m) => (m === 'runecrafting' ? 'Runecraft' : m === 'overall' ? 'Total' : m.charAt(0).toUpperCase() + m.slice(1));
const shortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/* ---------------- goals (from the hiscores, plus Wise Old Man's time to max) ---------------- */

function goalsHtml(p) {
  const skills = SKILL_GRID.map((n) => p.skills.find((s) => s.name === n)).filter((s) => s && s.xp >= 0);
  if (!skills.length) return '';
  const under99 = skills.filter((s) => s.level < 99);
  const closest99 = [...under99].sort((a, b) => b.xp - a.xp).slice(0, 3);
  const nextLevels = [...under99].sort((a, b) => (XP_TABLE[a.level + 1] - a.xp) - (XP_TABLE[b.level + 1] - b.xp)).slice(0, 3);
  const maxed = skills.filter((s) => s.level >= 99);
  const virtualTotal = skills.reduce((t, s) => t + virtualLevel(s.xp), 0);
  const ttm = p.wom && p.wom.ttm;
  const bar = (frac) => `<span class="gtrack"><span style="width:${Math.max(3, Math.min(100, frac * 100))}%"></span></span>`;
  const row = (s, right, frac, extra = '', goal = null) => `<div class="goal"><img src="${skillIcon(s.name)}" alt=""><span class="gn">${escapeHtml(s.name)}${extra}</span>${bar(frac)}<span class="gv">${right}</span>${pinButton(goal)}</div>`;

  let html = `<h2 class="home-h">Goals</h2><div class="c-card goals">`;
  html += `<div class="goal-top">`;
  if (under99.length === 0) html += `<div><b>Maxed!</b><span>Every skill is 99</span></div>`;
  else if (ttm > 0) html += `<div><b>≈ ${fmt(Math.round(ttm))} h</b><span>to max, efficient play (Wise Old Man)</span></div>`;
  html += `<div><b>${maxed.length} / ${skills.length}</b><span>skills at 99</span></div>`;
  const realTotal = skills.reduce((t, s) => t + s.level, 0);
  if (virtualTotal > realTotal) html += `<div><b>${fmt(virtualTotal)}</b><span>virtual total level</span></div>`;
  html += `</div>`;
  if (closest99.length) {
    html += `<h3>Closest 99s</h3>` + closest99.map((s) => row(s, `${fmtShort(XP_99 - s.xp)} XP left`, s.xp / XP_99, ` <span class="dim">${s.level}</span>`,
      { rsn: p.name, type: 'level', name: s.name, target: 99, label: `99 ${s.name}` })).join('');
  }
  if (nextLevels.length) {
    html += `<h3>Next level-ups</h3>` + nextLevels.map((s) => {
      const from = XP_TABLE[s.level], to = XP_TABLE[s.level + 1];
      return row(s, `${fmt(to - s.xp)} XP`, (s.xp - from) / (to - from), ` <span class="dim">${s.level} → ${s.level + 1}</span>`,
        { rsn: p.name, type: 'level', name: s.name, target: s.level + 1, label: `${s.level + 1} ${s.name}` });
    }).join('');
  }
  const top = [...maxed].sort((a, b) => b.xp - a.xp)[0];
  if (top && virtualLevel(top.xp) > 99) {
    html += `<p class="dim goal-note">Highest virtual level: ${escapeHtml(top.name)} ${virtualLevel(top.xp)}${top.xp >= 200e6 ? ' (200M XP!)' : ''}</p>`;
  }
  return html + `</div>`;
}

/* ---------------- pinned goal (shown on the home screen) ---------------- */

const sameGoal = (a, b) => !!a && !!b && a.rsn.toLowerCase() === b.rsn.toLowerCase() && a.type === b.type && a.name === b.name && a.target === b.target;
function pinButton(goal) {
  if (!goal) return '<span></span>';
  const on = sameGoal(goal, state.goal);
  return `<button class="pin-goal${on ? ' on' : ''}" data-goal="${escapeHtml(JSON.stringify(goal))}" title="${on ? 'Unpin from the home screen' : 'Pin this goal to the home screen'}">${svgIcon('i-pin')}</button>`;
}
// Wise Old Man milestone -> a goal the hiscores can track (skill XP or boss kills; not "base 70 stats")
function milestoneGoal(p, c) {
  if (c.measure === 'experience' && c.metric !== 'overall') {
    return { rsn: p.name, type: 'xp', name: metricName(c.metric), target: c.threshold, label: c.name };
  }
  if (c.measure === 'kills') {
    const a = p.activities.find((x) => womKey(x.name) === c.metric);
    if (a) return { rsn: p.name, type: 'kills', name: a.name, target: c.threshold, label: c.name };
  }
  return null;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('.pin-goal');
  if (!b) return;
  const goal = JSON.parse(b.dataset.goal);
  const on = b.classList.contains('on');
  state = await api.set_goal(on ? null : goal);
  document.querySelectorAll('.pin-goal').forEach((x) => {
    const pinned = !on && sameGoal(JSON.parse(x.dataset.goal), goal);
    x.classList.toggle('on', pinned);
    x.title = pinned ? 'Unpin from the home screen' : 'Pin this goal to the home screen';
  });
  toast(on ? 'Goal unpinned.' : `Pinned “${goal.label}” to your home screen.`);
});

// progress towards the pinned goal, from the hiscores
function goalProgress(g, p) {
  if (g.type === 'kills') {
    const a = p.activities.find((x) => x.name === g.name);
    const n = a ? Math.max(0, a.score) : 0;
    return { frac: n / g.target, done: n >= g.target, detail: `${fmt(n)} / ${fmt(g.target)} kills` };
  }
  const s = p.skills.find((x) => x.name === g.name);
  const xp = s ? Math.max(0, s.xp) : 0;
  const need = g.type === 'level' ? XP_TABLE[g.target] : g.target;
  const left = Math.max(0, need - xp);
  return { frac: xp / need, done: left === 0,
    detail: g.type === 'level' ? `Level ${s ? s.level : 1} → ${g.target} · ${fmt(left)} XP left` : `${fmtShort(xp)} / ${fmtShort(need)} XP · ${fmt(left)} left` };
}

window.renderPinnedGoal = async function () {
  const box = $('homeGoal');
  if (!box) return;
  const g = state.goal;
  if (!g) { box.hidden = true; box.innerHTML = ''; return; }
  const p = await api.player(g.rsn);
  if (!box.isConnected || !p || p.error) return;
  const pr = goalProgress(g, p);
  box.innerHTML = `<div class="c-card goal-card"><div class="upd-label">Pinned goal <span class="dim">· ${escapeHtml(p.name)}</span></div>
    <div class="goal-head"><span class="upd-name">${escapeHtml(g.label)}</span><b class="${pr.done ? 'done' : ''}">${pr.done ? 'Reached!' : `${Math.floor(Math.min(1, pr.frac) * 100)}%`}</b></div>
    <span class="gtrack big"><span style="width:${Math.max(2, Math.min(1, pr.frac) * 100)}%"></span></span>
    <div class="goal-foot"><span class="dim">${pr.detail}</span><span><button class="linkbtn" id="goalOpen">Profile</button> · <button class="linkbtn" id="goalUnpin">Unpin</button></span></div></div>`;
  box.hidden = false;
  $('goalOpen').onclick = () => openCharacter(p.name);
  $('goalUnpin').onclick = async () => { state = await api.set_goal(null); renderPinnedGoal(); };
};

/* ---------------- home: this week (your account) ---------------- */

window.renderWeeklyRecap = async function () {
  const box = $('homeRecap');
  if (!box) return;
  if (!state.me) { box.hidden = true; return; }
  const p = await api.player(state.me);
  if (!box.isConnected || !p || p.error || !p.wom || !p.wom.gains) { box.hidden = true; return; }
  const g = p.wom.gains;
  const total = g.skills.overall || 0;
  const levels = (g.levels && g.levels.overall) || 0;
  const kills = Object.values(g.bosses || {}).reduce((t, n) => t + Math.max(0, n), 0);
  const top = SKILL_GRID.map((n) => [n, g.skills[n === 'Runecraft' ? 'runecrafting' : n.toLowerCase()] || 0]).filter(([, x]) => x > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
  box.innerHTML = `<div class="c-card recap-card"><div class="upd-label">This week <span class="dim">· ${escapeHtml(p.name)}</span></div>
    ${total > 0 ? `<div class="recap-nums"><div><b>+${fmtShort(total)}</b><span>XP</span></div><div><b>${fmt(levels)}</b><span>level-up${levels === 1 ? '' : 's'}</span></div><div><b>${fmt(kills)}</b><span>boss kill${kills === 1 ? '' : 's'}</span></div></div>
      <div class="recap-top">${top.map(([n, x]) => `<span><img src="${skillIcon(n)}" alt="">${escapeHtml(n)} <b>+${fmtShort(x)}</b></span>`).join('')}</div>`
      : '<p class="dim">No XP tracked yet this week. Press <b>Update</b> on your profile after playing.</p>'}
    <button class="linkbtn" id="recapOpen">Open your profile</button></div>`;
  box.hidden = false;
  $('recapOpen').onclick = () => openCharacter(p.name);
};

/* ---------------- your bank (imported from RuneLite's Bank Memory plugin; stays on this PC) ---------------- */

async function renderBank(p) {
  const box = $('pxBank');
  if (!box) return;
  const info = await api.bank_info(p.name);
  const isMe = state.me && state.me.toLowerCase() === p.name.toLowerCase();
  if (!box.isConnected || (!isMe && !info.imported)) { box.innerHTML = ''; return; }
  box.innerHTML = `<h2 class="home-h">Bank</h2><div class="c-card bank-card">` + (info.imported
    ? `<div><b>${fmt(info.different)}</b> different items <span class="dim">· imported ${timeAgo(info.updated * 1000)}</span>
        ${bankAgeDays(info.updated) >= BANK_STALE_DAYS ? `<div class="bank-stale">Your bank was imported ${bankAgeDays(info.updated)} days ago. Re-import it so the ticks stay right.</div>` : ''}
        <div id="bankValue" class="bank-value"></div>
        <p class="dim">Item pages show how many you have, boss pages tick the recommended gear you own.</p>
        <input id="bankSearch" class="bank-search" placeholder="Search your bank" autocomplete="off" spellcheck="false">
        <div id="bankHits" class="bank-hits"></div>
        <details id="bankMake" class="bank-make"><summary>What can I make from my bank?</summary><div id="bankMakeBox"></div></details></div>
        <div class="bank-actions"><button class="btn small" id="bankImport">Update</button><button class="linkbtn" id="bankClear">Remove</button></div>`
    : `<div><b>Import your bank</b><p class="dim">Then item pages show how many you have, and boss pages tick the recommended gear you own. It stays on this PC.</p></div>
        <div class="bank-actions"><button class="btn small" id="bankImport">Import bank</button></div>`) + `</div>`;
  $('bankImport').onclick = () => openBankImport(p);
  if (info.imported && isMe) { renderBankValue(); bindBankSearch(); bindCanMake(); }
  const clear = $('bankClear');
  if (clear) clear.onclick = async () => { await api.clear_bank(p.name); renderBank(p); toast('Bank removed from this PC.'); };
}

// search your bank: filtered locally as you type
async function bindBankSearch() {
  const input = $('bankSearch'), hits = $('bankHits');
  if (!input) return;
  let items = null;
  input.oninput = async () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { hits.innerHTML = ''; return; }
    items = items || (await api.bank_items()) || [];
    const found = items.filter((x) => x.name.toLowerCase().includes(q));
    hits.innerHTML = found.length
      ? found.slice(0, 30).map((x) => `<div><a href="${wikiHref(x.name)}">${escapeHtml(x.name)}</a><b>${fmt(x.qty)}</b></div>`).join('') +
        (found.length > 30 ? `<p class="dim">…and ${found.length - 30} more</p>` : '')
      : `<p class="dim">Nothing called “${escapeHtml(input.value.trim())}” in your bank.</p>`;
  };
}

// what you could make right now from your bank, with your levels (loaded when opened)
function bindCanMake() {
  const det = $('bankMake');
  if (!det) return;
  det.ontoggle = async () => {
    const box = $('bankMakeBox');
    if (!det.open || box.dataset.done) return;
    box.innerHTML = '<div class="dim qs-loading">Checking every recipe on the wiki against your bank and levels…</div>';
    const r = await api.can_make();
    if (!box.isConnected) return;
    if (!r || r.error) { box.innerHTML = `<p class="dim">${escapeHtml((r && r.error) || 'Couldn’t work it out right now.')}</p>`; return; }
    box.dataset.done = '1';
    const list = (rows, val) => rows.length ? `<div class="make-rows">${rows.map((x) => `<div><a href="${wikiHref(x.name)}">${escapeHtml(x.name)}</a>
        <span class="dim">x${fmt(Math.floor(x.n))}${x.skill ? ` · ${escapeHtml(x.skill)}` : ''}</span><b>${val(x)}</b></div>`).join('')}</div>` : '<p class="dim">Nothing yet.</p>';
    const panels = [list(r.xp, (x) => `${fmtShort(Math.round(x.xp))} XP`), list(r.profit, (x) => `+${fmtShort(Math.round(x.profit))}`)];
    box.innerHTML = `<p class="dim">${fmt(r.count)} things you could make right now. Tools and furnaces aren't checked.</p>
      <div class="seg make-tabs"><button class="on" data-i="0">Most XP</button><button data-i="1">Most profit</button></div><div class="make-panel">${panels[0]}</div>`;
    box.querySelector('.make-tabs').onclick = (e) => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      box.querySelectorAll('.make-tabs button').forEach((x) => x.classList.toggle('on', x === b));
      box.querySelector('.make-panel').innerHTML = panels[+b.dataset.i];
    };
  };
}

async function renderBankValue() {
  const box = $('bankValue');
  if (!box) return;
  const v = await api.bank_value();
  if (!box.isConnected || !v || !v.imported) return;
  if (v.error) { box.innerHTML = `<span class="dim">${escapeHtml(v.error)}</span>`; return; }
  box.innerHTML = `Worth about <b>${fmtShort(v.total)}</b> on the Grand Exchange` +
    (v.top.length ? `<details><summary>Most valuable</summary><ol>${v.top.map((r) =>
      `<li><a href="${wikiHref(r.name)}">${escapeHtml(r.name)}</a>${r.qty > 1 ? ` <span class="dim">x${fmt(r.qty)}</span>` : ''}<b>${fmtShort(r.value)}</b></li>`).join('')}</ol></details>` : '');
}

function openBankImport(p) {
  let m = $('bankModal');
  if (!m) {
    m = document.createElement('div');
    m.className = 'modal-scrim'; m.id = 'bankModal';
    m.innerHTML = `<div class="modal bank-modal" role="dialog" aria-modal="true" aria-labelledby="bankTitle">
      <h2 id="bankTitle">Import your bank</h2>
      <ol class="bank-steps">
        <li>In RuneLite, install <b>Bank Memory</b> from the Plugin Hub (the plug icon in the sidebar).</li>
        <li>Log in and open your bank once, so the plugin can see it.</li>
        <li>Open the Bank Memory panel in the sidebar, right-click your bank, and pick <b>Copy item data to clipboard</b>.</li>
        <li>Come back here and press <b>Paste from clipboard</b>.</li>
      </ol>
      <textarea id="bankText" rows="5" placeholder="Or paste the export here (Bank Memory or Data Export)" spellcheck="false"></textarea>
      <p class="modal-msg" id="bankMsg"></p>
      <div class="modal-actions"><button class="btn small" id="bankPaste">Paste from clipboard</button><button class="btn" id="bankGo">Import</button></div>
      <p class="dim bank-note">Only item names and amounts are saved, on this PC. Re-import whenever your bank changes.</p></div>`;
    document.body.appendChild(m);
    m.addEventListener('mousedown', (e) => { if (e.target === m) m.hidden = true; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !m.hidden) { e.stopPropagation(); m.hidden = true; } }, true);
  }
  const msg = $('bankMsg');
  msg.textContent = ''; msg.classList.remove('err');
  $('bankText').value = '';
  const doImport = async (text) => {
    msg.textContent = 'Importing…'; msg.classList.remove('err');
    const r = await api.import_bank(p.name, text);
    if (r.error) { msg.textContent = r.error; msg.classList.add('err'); return; }
    m.hidden = true;
    toast(`Bank imported: ${fmt(r.different)} different items.`);
    renderBank(p);
  };
  $('bankPaste').onclick = async () => {
    const t = await api.clipboard_text();
    if (!t) { msg.textContent = 'The clipboard is empty. Copy the item data in Bank Memory first.'; msg.classList.add('err'); return; }
    $('bankText').value = t.slice(0, 5000) + (t.length > 5000 ? '\n…' : '');
    doImport(t);
  };
  $('bankGo').onclick = () => doImport($('bankText').value);
  m.hidden = false;
  $('bankPaste').focus();
}

// item pages: how many you have
window.showInBank = async function (title) {
  if (!state.me) return;
  const [isItem, have, logged] = await Promise.all([api.is_item_page(title), api.bank_has([title]), api.clog_has([title])]);
  const article = els.article;
  if (!isItem || (!have && !logged) || article.hidden || nav.stack[nav.idx].title !== title || article.querySelector('.inbank')) return;
  const box = document.createElement('div');
  box.className = 'inbank-row';
  const parts = [];
  if (have) {
    const n = have[title] || 0;
    parts.push(`<span class="inbank${n ? ' yes' : ''}">${n ? `${svgIcon('i-check')}In your bank: <b>${fmt(n)}</b>` : 'Not in your bank'}</span>`);
  }
  if (logged && logged[title]) parts.push(`<span class="inbank yes">${svgIcon('i-check')}In your collection log</span>`);
  if (!parts.length) return;
  box.innerHTML = parts.join('');
  const after = article.querySelector('.mykc') || article.querySelector('h1');
  if (after) after.after(box); else article.prepend(box);
};

// quest pages: tick the required / recommended items you have enough of ("3/8" if you have some)
async function markQuestItems(title) {
  const rows = [...els.article.querySelectorAll('table.questdetails tr')].filter((tr) => /items required|recommended/i.test((tr.querySelector('th') || {}).textContent || ''));
  const links = rows.flatMap((tr) => [...tr.querySelectorAll('td a[href^="/w/"][title]')]).filter((a) => !a.querySelector('img'));
  const names = [...new Set(links.map((a) => a.getAttribute('title')))].slice(0, 200);
  if (!names.length) return;
  const owned = await api.bank_has(names, true);
  if (!owned || nav.stack[nav.idx].title !== title) return;
  links.forEach((a) => {
    const have = owned[a.getAttribute('title')] || 0;
    if (!have || a.dataset.bank) return;
    const li = a.closest('li');
    const m = li && li.textContent.match(/^\s*(?:at least\s+)?([\d,]+)\s/i);
    const need = m ? +m[1].replace(/,/g, '') : 1;
    a.dataset.bank = '1';
    if (have >= need) { a.classList.add('own'); a.insertAdjacentHTML('beforeend', svgIcon('i-check')); a.title = `${a.getAttribute('title')} (you have ${fmt(have)})`; }
    else a.insertAdjacentHTML('afterend', ` <span class="bank-some">${fmt(have)}/${fmt(need)}</span>`);
  });
}

// strategy guides: tick the gear in their equipment tables that's in your bank (a local lookup, no wiki requests)
window.markOwnedLinks = async function (title) {
  if (state.me && els.article.querySelector('table.questdetails')) markQuestItems(title);
  if (!state.me || !/\/Strategies$/.test(title)) return;
  const links = [...els.article.querySelectorAll('table a[href^="/w/"][title]')].filter((a) => !a.querySelector('img'));
  const names = [...new Set(links.map((a) => a.getAttribute('title')))].slice(0, 300);
  if (!names.length) return;
  const owned = await api.bank_has(names);
  if (!owned || nav.stack[nav.idx].title !== title) return;
  let n = 0;
  links.forEach((a) => {
    if (owned[a.getAttribute('title')] && !a.classList.contains('own')) {
      a.classList.add('own');
      a.insertAdjacentHTML('beforeend', svgIcon('i-check'));
      a.title = a.getAttribute('title') + ' (in your bank)';
      n++;
    }
  });
  if (n) toast(`Ticked the gear in your bank on this guide.`);
};

// "Drops from X (1/400), sold by Y (8,100 coins), made with 93 Magic, from quest Z"
function sourcesText(src) {
  if (!src) return '';
  const parts = [];
  if (src.drops.length) parts.push('drops from ' + src.drops.map((d) => `<a href="${wikiHref(d.source)}">${escapeHtml(d.source)}</a> <span class="dim">(${escapeHtml(d.rate)})</span>`).join(', '));
  if (src.shops.length) parts.push('sold by ' + src.shops.map((s) => `<a href="${wikiHref(s.seller)}">${escapeHtml(s.seller)}</a>${s.price ? ` <span class="dim">(${fmt(+s.price || 0)} ${escapeHtml(s.currency.toLowerCase())})</span>` : ''}`).join(', '));
  if (src.made) parts.push('made with ' + src.made.skills.map(([k, lv]) => `${lv} ${escapeHtml(k)}`).join(' + ') +
    (src.made.mats.length ? ` from ${src.made.mats.map(([m, q]) => `${q > 1 ? `${fmt(q)} ` : ''}<a href="${wikiHref(m)}">${escapeHtml(m)}</a>`).join(', ')}` : ''));
  if (src.quest) parts.push(`from the quest <a href="${wikiHref(src.quest)}">${escapeHtml(src.quest)}</a>`);
  return parts.join('; ');
}

// item set pages and their pieces: which pieces of the set are in your bank
window.showSetProgress = async function (title) {
  if (!state.me) return;
  const sets = await api.set_progress(title);
  const article = els.article;
  if (!sets || !sets.length || article.hidden || nav.stack[nav.idx].title !== title || article.querySelector('.setprog')) return;
  const box = document.createElement('div');
  box.className = 'setprog';
  box.innerHTML = sets.map((s) => {
    const n = s.pieces.filter((x) => x.have).length;
    const missing = s.pieces.filter((x) => !x.have);
    const head = s.owned ? `You have the whole <b>${escapeHtml(s.set)}</b> (as a set)`
      : `<a href="${wikiHref(s.set)}">${escapeHtml(s.set)}</a>: <b>${n}/${s.pieces.length}</b> pieces in your bank` +
        (missing.length && missing.length < s.pieces.length ? `, missing ${missing.map((x) => escapeHtml(x.name)).join(', ')}` : '');
    return `<div class="setprog-row"><div>${head}</div><div class="setprog-pieces">${s.pieces.map((x) =>
      `<a href="${wikiHref(x.name)}" class="${x.have || s.owned ? 'own' : ''}">${x.have || s.owned ? svgIcon('i-check') : ''}${escapeHtml(x.name)}</a>`).join('')}</div></div>`;
  }).join('');
  const after = article.querySelector('.inbank-row') || article.querySelector('.mykc') || article.querySelector('h1');
  if (after) after.after(box); else article.prepend(box);
};

// an old import makes the ticks wrong: nudge after a week
const BANK_STALE_DAYS = 7;
const bankAgeDays = (updated) => Math.floor((Date.now() / 1000 - (updated || 0)) / 86400);

/* ---------------- boss pages: recommended gear (best and budget per slot) ---------------- */

const SLOT_NAMES = { head: 'Head', cape: 'Cape', neck: 'Neck', ammo: 'Ammo', weapon: 'Weapon', body: 'Body', shield: 'Shield',
  legs: 'Legs', hands: 'Hands', feet: 'Feet', ring: 'Ring', special: 'Special' };

window.showGear = async function (title) {
  const setups = await api.recommended_gear(title);
  const article = els.article;
  if (!setups || !setups.length || article.hidden || nav.stack[nav.idx].title !== title || article.querySelector('.gear')) return;
  // with an imported bank, tick the gear you already own
  const names = [...new Set(setups.flatMap((s) => Object.values(s.slots).flatMap((v) => [...v.best, ...v.budget].map((x) => x.name))))];
  const owned = (state.me && (await api.bank_has(names))) || null;
  const own = (it) => !!(owned && owned[it.name]);
  const item = (it) => `<a href="${wikiHref(it.name)}" class="${own(it) ? 'own' : ''}" title="${escapeHtml(it.name)}${own(it) ? ' (in your bank)' : ''}"><img src="${itemIcon(it.file)}" data-stack="${escapeHtml(itemIcon(it.name + ' 5.png'))}" alt="" loading="lazy">${escapeHtml(it.name)}${own(it) ? svgIcon('i-check') : ''}</a>`;
  const ownCount = (i) => { const sl = Object.values(setups[i].slots); return [sl.filter((v) => v.best.some(own)).length, sl.length]; };
  const ups = owned ? await api.gear_upgrades(title) : null;
  const gp = (n) => (n == null ? '<span class="dim">untradeable</span>' : `${fmtShort(n)}`);
  const upgradesHtml = (i) => {
    const u = ups && ups[i];
    if (!u || !u.upgrades.length) return owned ? '<div class="gear-ups done">You own a best pick in every slot of this setup.</div>' : '';
    const cheap = u.cheapest ? `<div class="gear-cheap">Cheapest upgrade: <b>${escapeHtml(u.cheapest[2])}</b> for your ${SLOT_NAMES[u.cheapest[1]] || u.cheapest[1]}, about <b>${fmtShort(u.cheapest[0])}</b></div>` : '';
    return `<div class="gear-ups"><div class="gear-h">Your next upgrades</div>${cheap}` + u.upgrades.map((x) => `<div class="gear-up">
        <span class="gear-slot">${SLOT_NAMES[x.slot] || x.slot}</span>
        <span>${x.have ? `<span class="dim">${escapeHtml(x.have)} →</span> ` : '<span class="dim">nothing yet →</span> '}${x.next.slice(0, 2).map((n) => `${item(n)} <span class="gear-price">${gp(n.price)}</span> <button class="linkbtn where" data-item="${escapeHtml(n.name)}">Where?</button>`).join('<span class="dim"> or </span>')}</span></div>`).join('') + `</div>`;
  };
  const opts = (list) => (list.length ? list.slice(0, 2).map(item).join('<span class="dim"> or </span>') : '<span class="dim">–</span>');
  const bankInfo = owned ? await api.bank_info() : null;
  const stale = bankInfo && bankInfo.imported && bankAgeDays(bankInfo.updated) >= BANK_STALE_DAYS
    ? ` <span class="bank-stale-inline">(bank imported ${bankAgeDays(bankInfo.updated)} days ago; re-import on your profile)</span>` : '';
  const panel = (i) => (owned ? `<div class="gear-own">You own ${ownCount(i)[0]} of the ${ownCount(i)[1]} best picks for this setup.${stale}</div>` : '') +
    `<div class="gear-grid"><span class="gear-h"></span><span class="gear-h">Best</span><span class="gear-h">Budget</span>` +
    Object.entries(setups[i].slots).map(([slot, v]) => `<span class="gear-slot">${SLOT_NAMES[slot] || slot}</span><span>${opts(v.best)}</span><span>${opts(v.budget)}</span>`).join('') + `</div>` +
    upgradesHtml(i);
  const box = document.createElement('details');
  box.className = 'gear';
  box.open = true;
  box.innerHTML = `<summary>Recommended gear <span class="dim">from the strategy guide</span></summary>
    ${setups.length > 1 ? `<div class="seg gear-tabs">${setups.map((s, i) => `<button data-i="${i}" class="${i ? '' : 'on'}">${escapeHtml(s.style)}</button>`).join('')}</div>`
      : `<div class="dim gear-style">${escapeHtml(setups[0].style)}</div>`}
    <div class="gear-panel">${panel(0)}</div>
    <button class="linkbtn gear-more">Full strategy guide</button>`;
  box.querySelector('.gear-more').onclick = () => openPage(title + '/Strategies');
  box.addEventListener('click', async (e) => {   // "Where?": how to get an upgrade (looked up only when asked)
    const b = e.target.closest('.where');
    if (!b) return;
    const row = b.closest('.gear-up');
    const old = row.querySelector('.where-info');
    if (old && old.dataset.item === b.dataset.item) { old.remove(); return; }
    if (old) old.remove();
    b.textContent = '…';
    const src = await api.item_sources(b.dataset.item);
    b.textContent = 'Where?';
    const info = document.createElement('div');
    info.className = 'where-info';
    info.dataset.item = b.dataset.item;
    info.innerHTML = `<b>${escapeHtml(b.dataset.item)}</b>: ` + (sourcesText(src) || 'the wiki has no drop, shop or recipe for it; see its page.');
    row.after(info);
  });
  const tabs = box.querySelector('.gear-tabs');
  if (tabs) tabs.onclick = (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    tabs.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    box.querySelector('.gear-panel').innerHTML = panel(+b.dataset.i);
    fixIcons();
  };
  // stackable items (bolts, darts...) are pictured as a stack: "Ruby bolts (e) 5.png"; otherwise drop the icon
  const fixIcons = () => box.querySelectorAll('.gear-grid img, .gear-ups img').forEach((img) => {
    img.onerror = () => { if (img.dataset.stack) { img.src = img.dataset.stack; img.dataset.stack = ''; } else img.remove(); };
  });
  fixIcons();
  const ours = article.querySelector('.bestset');
  if (ours) { box.open = false; ours.after(box); return; }
  const after = article.querySelector('.cando') || article.querySelector('.mykc') || article.querySelector('h1');
  if (after) after.after(box); else article.prepend(box);
};

/* ---------------- monster pages: the best setup you own (from your bank; maths in dps.py) ---------------- */

const BS_KEY = 'bestsetOpts';
const bsOpts = () => { try { return JSON.parse(localStorage.getItem(BS_KEY)) || {}; } catch (e) { return {}; } };
const bsSave = (o) => { try { localStorage.setItem(BS_KEY, JSON.stringify(o)); } catch (e) { /* private window */ } };
const BS_STYLES = { melee: 'Melee', ranged: 'Ranged', magic: 'Magic' };
const BS_ORDER = ['head', 'cape', 'neck', 'ammo', 'weapon', 'shield', 'body', 'legs', 'hands', 'feet', 'ring'];   // in pairs: weapon beside shield...
const BS_ATTRS = { dragon: 'Dragon', demon: 'Demon', undead: 'Undead', kalphite: 'Kalphite', vampyre1: 'Vampyre', vampyre2: 'Vampyre',
  vampyre3: 'Vampyre', fiery: 'Fiery', spectral: 'Spectral', leafy: 'Leafy', golem: 'Golem', xerician: 'Xerician', penance: 'Penance',
  shade: 'Shade', rat: 'Rat', icy: 'Icy' };
const bsThumb = (file) => { const f = encodeURIComponent(file.replace(/ /g, '_')); return `${WIKI}/images/thumb/${f}/240px-${f}`; };
const bsTime = (s) => (s == null ? '–' : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`
  : s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);

window.showBestSetup = async function (title, version) {
  if (!state.me) return;
  const article = els.article;
  const res = await api.best_setup(title, { ...bsOpts(), version: version || 0 });
  if (!res || article.hidden || nav.stack[nav.idx].title !== title) return;
  let box = article.querySelector('.bestset');
  if (!box) {
    if (res.error) return;
    box = document.createElement('details');
    box.className = 'gear bestset';
    box.open = true;
    const wiki = article.querySelector('.gear');   // the strategy guide's list: below ours, folded
    if (wiki) { wiki.before(box); wiki.open = false; } else {
      const after = article.querySelector('.cando') || article.querySelector('.mykc') || article.querySelector('h1');
      if (after) after.after(box); else article.prepend(box);
    }
  }
  renderBestSetup(box, res, title);
};

function renderBestSetup(box, res, title) {
  const o = res.opts || {};
  const styles = res.styles || [];
  const bestI = styles.reduce((b, s, i) => (s.dps > styles[b].dps ? i : b), 0);
  const want = styles.findIndex((s) => s.style === box.dataset.style);
  const cur = want >= 0 ? want : bestI;
  const chip = (k, label) => `<label class="bs-chip"><input type="checkbox" data-k="${k}"${o[k] ? ' checked' : ''}>${label}</label>`;
  const item = (n) => `<a href="${wikiHref(n)}" title="${escapeHtml(n)}"><img src="${itemIcon(n + '.png')}" data-stack="${escapeHtml(itemIcon(n + ' 5.png'))}" alt="" loading="lazy">${escapeHtml(n)}</a>`;
  const panel = (i) => {
    const s = styles[i];
    const twoH = s.slots.weapon && !s.slots.shield && s.twoHanded;
    return `<div class="bs-stats">
        <div><b>${s.max}${s.hits > 1 ? ` <small>×${s.hits}</small>` : ''}</b><span>Max hit</span></div>
        <div><b>${Math.round(s.acc * 100)}%</b><span>Accuracy</span></div>
        <div><b>${s.dps.toFixed(2)}</b><span>Damage a second</span></div>
        <div><b>${bsTime(s.ttk)}</b><span>Time to kill</span></div></div>
      <div class="bs-how">${escapeHtml(s.how)}<span class="dim"> · ${s.prayer ? escapeHtml(s.prayer) : 'no prayer'} · ${s.potion ? escapeHtml(s.potion) : 'no potion'}</span></div>
      <div class="gear-grid bs-grid">` + BS_ORDER.map((slot) => `<span class="gear-slot">${SLOT_NAMES[slot] || slot}</span><span>${
        s.slots[slot] ? item(s.slots[slot]) : `<span class="dim">${slot === 'shield' && twoH ? 'two-handed weapon' : 'anything'}</span>`}</span>`).join('') + `</div>` +
      (s.notes && s.notes.length ? `<ul class="bs-notes">${s.notes.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : '');
  };
  const mon = res.monster;
  const verSel = res.versions.length > 1 ? `<select class="bs-ver" title="Which version of the monster">${res.versions.map((v, i) => `<option value="${i}"${i === res.version ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('')}</select>` : '';
  const tags = (mon.attrs || []).filter((a) => BS_ATTRS[a]).map((a) => `<span class="bs-tag">${BS_ATTRS[a]}</span>`).join('') +
    (mon.weak ? `<span class="bs-tag weak el-${escapeHtml(mon.weak)}">Weak to ${escapeHtml(mon.weak)}${mon.weakpct ? ` +${mon.weakpct}%` : ''}</span>` : '');
  const hero = `<div class="bs-hero">
      ${mon.image ? `<div class="bs-art"><img src="${bsThumb(mon.image)}" data-full="${escapeHtml(itemIcon(mon.image))}" alt=""></div>` : ''}
      <div class="bs-info">
        <div class="bs-name"><span>${escapeHtml(mon.name)}</span>${verSel}</div>
        <div class="bs-meta">${mon.combat ? `<span><b>${fmt(mon.combat)}</b> combat</span>` : ''}<span><b>${fmt(mon.hp)}</b> hitpoints</span>${mon.size > 1 ? `<span><b>${mon.size}×${mon.size}</b> size</span>` : ''}${mon.maxhit ? `<span>hits up to <b>${fmt(mon.maxhit)}</b></span>` : ''}</div>
        ${mon.attacks && mon.attacks.length ? `<div class="bs-attacks">Attacks with ${mon.attacks.map(escapeHtml).join(', ')}</div>` : ''}
        ${tags ? `<div class="bs-tags">${tags}</div>` : ''}
      </div></div>`;
  box.innerHTML = `<summary>Your best setup <span class="dim">from your bank, with your levels</span></summary>
    ${hero}
    <div class="bs-opts">
      ${mon.slayer ? chip('task', 'On a slayer task') : ''}${chip('potions', 'Potions')}${chip('prayers', 'Prayers')}${chip('rigour', 'Rigour &amp; Augury unlocked')}
    </div>` +
    (res.error ? `<p class="dim">${escapeHtml(res.error)}</p>` : !styles.length
      ? '<p class="dim">Nothing in your imported bank can fight this.</p>'
      : `<div class="seg gear-tabs bs-tabs">${styles.map((s, i) => `<button data-i="${i}" class="${i === cur ? 'on' : ''}">${BS_STYLES[s.style]} <small>${s.dps.toFixed(2)}</small>${i === bestI && styles.length > 1 ? ' <span class="bs-best">best</span>' : ''}</button>`).join('')}</div>
        <div class="bs-panel">${panel(cur)}</div>`) +
    `<p class="dim bs-foot">Damage a second is an estimate from your hiscores levels and imported bank. Gear you're wearing isn't in a bank export, so bank it first. Special attacks, bolt effects and wield requirements aren't counted.</p>`;
  const fixIcons = () => box.querySelectorAll('.bs-grid img').forEach((img) => {
    img.onerror = () => { if (img.dataset.stack) { img.src = img.dataset.stack; img.dataset.stack = ''; } else img.remove(); };
  });
  fixIcons();
  const art = box.querySelector('.bs-art img');   // a small thumbnail, or the full picture if the wiki has none that size
  if (art) art.onerror = () => { if (art.dataset.full) { art.src = art.dataset.full; art.dataset.full = ''; } else art.parentElement.remove(); };
  const tabs = box.querySelector('.bs-tabs');
  if (tabs) tabs.onclick = (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    tabs.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    box.dataset.style = styles[+b.dataset.i].style;
    box.querySelector('.bs-panel').innerHTML = panel(+b.dataset.i);
    fixIcons();
  };
  const reload = () => { box.classList.add('loading'); showBestSetup(title, +((box.querySelector('.bs-ver') || {}).value || 0)).then(() => box.classList.remove('loading')); };
  box.querySelectorAll('.bs-chip input').forEach((c) => {
    c.onchange = () => { bsSave({ ...bsOpts(), [c.dataset.k]: c.checked }); reload(); };
  });
  const ver = box.querySelector('.bs-ver');
  if (ver) ver.onchange = reload;
}

/* ---------------- article pages: can you kill / cast this? ---------------- */

window.showCanDo = async function (title) {
  if (!state.me) return;
  const [req, p] = await Promise.all([api.page_requirements(title), api.player(state.me)]);
  const article = els.article;
  if (!req || (!req.monster && !req.spell) || !p || p.error || article.hidden || nav.stack[nav.idx].title !== title || article.querySelector('.cando')) return;
  const lvl = (n) => { const s = p.skills.find((x) => x.name === n); return s && s.xp >= 0 ? s.level : 1; };
  const parts = [];
  if (req.monster) {
    const m = req.monster;
    if (m.slayer > 1) {
      const have = lvl('Slayer');
      parts.push(have >= m.slayer
        ? `<span class="ok">${svgIcon('i-check')}Slayer ${m.slayer}: you have ${have}</span>`
        : `<span class="no">Needs ${m.slayer} Slayer: you have ${have} (${m.slayer - have} to go)</span>`);
    }
    if (m.assignedBy && m.assignedBy.length) parts.push(`<span class="dim">Assigned by ${m.assignedBy.map(escapeHtml).join(', ')}</span>`);
  }
  if (req.spell) {
    const have = lvl('Magic');
    const book = req.spell.spellbook ? ` (${escapeHtml(req.spell.spellbook)} spellbook)` : '';
    parts.push(have >= req.spell.level
      ? `<span class="ok">${svgIcon('i-check')}Magic ${req.spell.level}${book}: you have ${have}</span>`
      : `<span class="no">Needs ${req.spell.level} Magic${book}: you have ${have} (${req.spell.level - have} to go)</span>`);
  }
  if (!parts.length) return;
  const box = document.createElement('div');
  box.className = 'cando';
  box.innerHTML = parts.join('');
  const after = article.querySelector('.mykc') || article.querySelector('h1');
  if (after) after.after(box); else article.prepend(box);
};

/* ---------------- milestones & records (Wise Old Man) ---------------- */

async function renderExtras(p) {
  const box = $('pxExtras');
  if (!box || !p.wom) return;
  box.innerHTML = '<div class="dim qs-loading">Loading milestones and records…</div>';
  const x = await api.player_extras(p.name);
  if (!box.isConnected) return;
  if (!x || x.error) { box.innerHTML = ''; return; }
  let html = '';
  const ms = x.milestones || [];
  if (ms.length) {
    const item = (m) => `<li><span class="ms-dot"></span><span class="ms-name">${escapeHtml(m.name)}</span><span class="ms-date">${m.date ? shortDate(m.date) : 'before tracking'}</span></li>`;
    html += `<h2 class="home-h">Milestones <span class="since">${ms.length} reached</span></h2><div class="c-card milestones"><ul>${ms.slice(0, 6).map(item).join('')}</ul>` +
      (ms.length > 6 ? `<details><summary>Show all ${ms.length}</summary><ul>${ms.slice(6).map(item).join('')}</ul></details>` : '') + `</div>`;
  }
  if ((x.closest || []).length) {
    html += `<h2 class="home-h">Almost there</h2><div class="c-card goals">` + x.closest.map((c) => `<div class="goal">
        <span class="gn wide">${escapeHtml(c.name)}</span>
        <span class="gtrack"><span style="width:${Math.max(3, c.progress * 100)}%"></span></span><span class="gv">${Math.floor(c.progress * 100)}%</span>${pinButton(milestoneGoal(p, c))}</div>`).join('') + `</div>`;
  }
  const r = x.records || {};
  const periods = [['day', 'Best day'], ['week', 'Best week'], ['month', 'Best month'], ['year', 'Best year']].filter(([k]) => r[k] && r[k].overall);
  if (periods.length) {
    html += `<h2 class="home-h">Records <span class="since">most XP ever gained</span></h2><div class="c-card records">` +
      periods.map(([k, label]) => `<div><span>${label}</span><b>${fmtShort(r[k].overall.value)} XP</b>${r[k].overall.date ? `<small>${shortDate(r[k].overall.date)}</small>` : ''}</div>`).join('') + `</div>`;
    const sd = r.day && r.day.skill;
    if (sd) html += `<p class="dim goal-note">Biggest single-skill day: <b>${fmtShort(sd.value)} ${metricName(sd.metric)} XP</b>${sd.date ? ` on ${shortDate(sd.date)}` : ''}.</p>`;
  }
  box.innerHTML = html;
}

/* ---------------- XP over time (Wise Old Man snapshots) ---------------- */

const xpChart = { metric: 'overall', period: 'month' };

function chartHtml(p) {
  if (!p.wom) return '';
  const opts = ['overall', ...SKILL_GRID.map((n) => (n === 'Runecraft' ? 'runecrafting' : n.toLowerCase()))]
    .map((m) => `<option value="${m}"${m === xpChart.metric ? ' selected' : ''}>${m === 'overall' ? 'Total XP' : metricName(m)}</option>`).join('');
  return `<h2 class="home-h">XP over time</h2><div class="c-card xpc">
    <div class="xpc-bar"><select id="xpcMetric" aria-label="Skill">${opts}</select>
      <div class="seg" id="xpcPeriod">${['week', 'month', 'year'].map((k) => `<button data-v="${k}" class="${k === xpChart.period ? 'on' : ''}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div></div>
    <div id="xpcBox" class="xpc-box"></div></div>`;
}

async function drawXpChart(p) {
  const box = $('xpcBox');
  if (!box) return;
  box.innerHTML = '<div class="dim qs-loading">Loading…</div>';
  const res = await api.xp_timeline(p.name, xpChart.metric, xpChart.period);
  if (!box.isConnected) return;
  const pts = (res && res.points) || [];
  if (res.error || pts.length < 2) {
    box.innerHTML = `<div class="dim qs-loading">${res.error ? escapeHtml(res.error) : 'Not enough Wise Old Man updates in this period yet. Press Update after playing.'}</div>`;
    return;
  }
  const W = Math.max(300, box.clientWidth), H = 190, L = 54, R = 12, T = 12, B = 26;
  const t0 = Date.parse(pts[0].t), t1 = Date.parse(pts[pts.length - 1].t);
  let lo = Math.min(...pts.map((q) => q.v)), hi = Math.max(...pts.map((q) => q.v));
  if (hi === lo) { hi += 1; lo -= 1; }
  const x = (t) => L + ((Date.parse(t) - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const line = pts.map((q, i) => `${i ? 'L' : 'M'}${x(q.t).toFixed(1)},${y(q.v).toFixed(1)}`).join('');
  const area = `${line}L${x(pts[pts.length - 1].t).toFixed(1)},${H - B}L${L},${H - B}Z`;
  const ticks = [lo, (lo + hi) / 2, hi];
  const gained = pts[pts.length - 1].v - pts[0].v;
  box.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="XP over the last ${xpChart.period}">
      <defs><linearGradient id="xpcFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
      ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${fmtShort(Math.round(v))}</text>`).join('')}
      <path d="${area}" fill="url(#xpcFill)"/><path d="${line}" class="ln"/>
      <text x="${L}" y="${H - 6}">${shortDate(pts[0].t)}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${shortDate(pts[pts.length - 1].t)}</text>
    </svg><div class="xpc-sum">+${fmt(gained)} XP over this ${xpChart.period}</div>`;
}

function bindXpChart(p) {
  const sel = $('xpcMetric'), seg = $('xpcPeriod');
  if (!sel) return;
  sel.onchange = () => { xpChart.metric = sel.value; drawXpChart(p); };
  seg.onclick = (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    xpChart.period = b.dataset.v;
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    drawXpChart(p);
  };
  drawXpChart(p);
}

/* ---------------- combat achievements (WikiSync + the wiki's task list) ---------------- */

const CA_TIERS = [['Easy', 1], ['Medium', 2], ['Hard', 3], ['Elite', 4], ['Master', 5], ['Grandmaster', 6]];

async function renderCombatAchievements(p) {
  const box = $('pxCA');
  const ids = p.sync && p.sync.combatAchievements;
  if (!box || !ids) return;   // needs WikiSync
  const d = await api.ca_data();
  if (!box.isConnected || !d || !Object.keys(d.tasks || {}).length) return;
  const total = {}, done = {};
  Object.values(d.tasks).forEach(([tier]) => { total[tier] = (total[tier] || 0) + 1; });
  ids.forEach((id) => { const t = d.tasks[String(id)]; if (t) done[t[0]] = (done[t[0]] || 0) + 1; });
  const points = CA_TIERS.reduce((sum, [t, pts]) => sum + (done[t] || 0) * pts, 0);
  const th = d.thresholds || {};
  const reached = CA_TIERS.filter(([t]) => th[t] && points >= th[t]).pop();
  const next = CA_TIERS.find(([t]) => th[t] && points < th[t]);
  const doneCount = Object.values(done).reduce((a, b) => a + b, 0);
  let html = `<h2 class="home-h">Combat achievements <span class="since">${fmt(doneCount)} tasks · ${fmt(points)} points</span></h2><div class="c-card ca">`;
  html += `<div class="ca-top"><div><span class="dim">Rewards unlocked</span><b>${reached ? reached[0] : 'None yet'}</b></div>`;
  if (next) {
    const to = th[next[0]];
    html += `<div class="ca-next"><span class="dim">${fmt(to - points)} points to <b>${next[0]}</b> rewards</span>
      <span class="gtrack big"><span style="width:${Math.max(2, (points / to) * 100)}%"></span></span>
      <small class="dim">${fmt(points)} / ${fmt(to)}</small></div>`;
  } else html += `<div class="ca-next"><b class="done">Every reward tier unlocked!</b></div>`;
  html += `</div><div class="ca-tiers">` + CA_TIERS.filter(([t]) => total[t]).map(([t, pts]) => `<div class="goal">
      <span class="gn wide">${t} <span class="dim">· ${pts} pt${pts > 1 ? 's' : ''} each</span></span>
      <span class="gtrack"><span style="width:${Math.max(2, ((done[t] || 0) / total[t]) * 100)}%"></span></span>
      <span class="gv">${done[t] || 0} / ${total[t]}</span><span></span></div>`).join('') +
    `</div><button class="linkbtn ca-link" id="caWiki">Combat achievements on the wiki</button></div>`;
  box.innerHTML = html;
  $('caWiki').onclick = () => openPage('Combat Achievements');
}

/* ---------------- collection log (WikiSync: the player presses its button in the in-game log) ---------------- */

async function renderCollectionLog(p) {
  const box = $('pxClog');
  if (!box) return;
  if (!p.clog) {
    box.innerHTML = p.sync ? `<h2 class="home-h">Collection log</h2><div class="c-card c-note">Not synced yet. In game, open your
      <b>collection log</b> and press the <b>WikiSync</b> button in it. Then pets, logged drops and your progress show up here and on boss pages.</div>` : '';
    return;
  }
  const pets = await api.pet_rates();
  if (!box.isConnected) return;
  const petNames = new Set(Object.values(pets || {}).map((v) => v.pet.toLowerCase()));
  const myPets = p.clog.items.filter((n) => petNames.has(n.toLowerCase()));
  const pct = p.clog.total ? p.clog.count / p.clog.total : 0;
  box.innerHTML = `<h2 class="home-h">Collection log <span class="since">synced through WikiSync</span></h2><div class="c-card clog">
    <div class="clog-top"><b>${fmt(p.clog.count)}</b><span class="dim"> / ${p.clog.total ? fmt(p.clog.total) : '?'} slots</span>
      ${p.clog.total ? `<span class="gtrack big"><span style="width:${Math.max(2, pct * 100)}%"></span></span><small class="dim">${(pct * 100).toFixed(1)}%</small>` : ''}</div>
    <div class="clog-pets">${myPets.length ? `Pets: ${myPets.map((n) => `<a href="${wikiHref(n)}" class="pet-own">${svgIcon('i-check')}${escapeHtml(n)}</a>`).join('')}` : '<span class="dim">No boss pets yet.</span>'}</div>
    <p class="dim clog-note">To update it, press the WikiSync button in your in-game collection log again.</p>
    <button class="linkbtn" id="clogWiki">Collection log on the wiki</button></div>`;
  $('clogWiki').onclick = () => openPage('Collection log');
}

/* ---------------- pet chances: every boss pet you could have by now ---------------- */

async function renderPetChances(p) {
  const box = $('pxPets');
  if (!box) return;
  const pets = await api.pet_rates();
  if (!box.isConnected || !pets) return;
  const petFor = Object.fromEntries(Object.entries(pets).map(([k, v]) => [k.toLowerCase(), v]));
  const logged = new Set(((p.clog && p.clog.items) || []).map((n) => n.toLowerCase()));
  const ownedPets = [...new Set(Object.values(pets).map((v) => v.pet))].filter((n) => logged.has(n.toLowerCase()));
  // luck for a pet you have: from the boss with the most kills that drops it
  const ownedLuck = (name) => {
    const src = p.activities.filter((a) => a.score > 0 && petFor[a.name.toLowerCase()] && petFor[a.name.toLowerCase()].pet === name)
      .sort((x, y) => y.score - x.score)[0];
    if (!src) return '';
    const pct = (1 - Math.pow(1 - 1 / petFor[src.name.toLowerCase()].rate, src.score)) * 100;
    const [word, cls] = luckTag(pct, true);
    return ` <span class="luck ${cls}" title="${Math.round(pct)}% of players would have it by ${fmt(src.score)} kills">${word}</span>`;
  };
  const rows = p.activities.filter((a) => a.score > 0 && petFor[a.name.toLowerCase()] && !logged.has(petFor[a.name.toLowerCase()].pet.toLowerCase())).map((a) => {
    const pet = petFor[a.name.toLowerCase()];
    return { a, pet, pct: (1 - Math.pow(1 - 1 / pet.rate, a.score)) * 100 };
  }).sort((x, y) => y.pct - x.pct);
  if (!rows.length && !ownedPets.length) return;
  const shown = (x) => (x < 1 ? '<1%' : x > 99 ? '>99%' : `${Math.round(x)}%`);
  box.innerHTML = `<h2 class="home-h">Pet chances <span class="since">how many players would have each pet by your kill count</span></h2>
    <div class="c-card goals pets">` +
    (ownedPets.length ? `<div class="pets-owned">You have: ${ownedPets.map((n) => `<a href="${wikiHref(n)}" class="pet-own">${svgIcon('i-check')}${escapeHtml(n)}</a>${ownedLuck(n)}`).join('')}</div>` : '') +
    rows.map(({ a, pet, pct }) => `<div class="goal">
      <span class="gn wide"><b>${escapeHtml(pet.pet)}</b> <a class="dim" href="${wikiHref(KC_PAGES[a.name] || a.name)}">${escapeHtml(a.name)}</a>
        <span class="dim">· ${fmt(a.score)} at 1/${fmt(pet.rate)}</span></span>
      <span class="gtrack"><span style="width:${Math.max(2, pct)}%"></span></span><span class="gv">${shown(pct)}</span><span></span></div>`).join('') +
    (p.clog ? `<p class="dim goal-note">Pets you have come from your collection log (WikiSync); the rest are odds.</p></div>`
      : `<p class="dim goal-note">These are only the odds. Sync your collection log with WikiSync to tick the pets you have.</p></div>`);
}

// Settings: keep Wise Old Man updated (on by default)
function renderWomAuto() {
  $('womAutoSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b.dataset.v === '1') === (state.womAuto !== false)));
}
$('womAutoSeg').onclick = async (e) => {
  const b = e.target.closest('button[data-v]');
  if (!b) return;
  state = await api.set_pref('wom_auto', b.dataset.v === '1');
  renderWomAuto();
};
$('btnSettings').addEventListener('click', renderWomAuto);

// Wise Old Man was refreshed in the background (app.py): redraw what uses it
window.onWomAutoUpdated = function () {
  const cur = nav.stack[nav.idx];
  if (cur && cur.kind === 'home') { renderPinnedGoal(); renderWeeklyRecap(); }
};

/* ---------------- Group Ironman group (official GIM hiscores) ---------------- */

async function renderGroup(p) {
  const box = $('pxGroup');
  if (!box) return;
  const g = await api.gim_group(p.name);
  if (!box.isConnected) return;
  if (g.needName) {
    box.innerHTML = `<details class="gim-add"${g.error ? ' open' : ''}><summary>In a Group Ironman group? Add it</summary>
      <form id="gimForm" class="gim-form"><input id="gimName" maxlength="12" placeholder="Group name" autocomplete="off" spellcheck="false">
      <button class="btn small" type="submit">Show my group</button></form>
      ${g.error ? `<p class="ask-err">${escapeHtml(g.error)}</p>` : '<p class="dim">The group name from the Group Ironman hiscores (in-game, it’s your group chat channel’s name).</p>'}</details>`;
    $('gimForm').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      btn.disabled = true; btn.textContent = 'Looking…';
      const r = await api.set_gim_group(p.name, $('gimName').value);
      if (r.needName) { renderGroupResult(box, p, r); return; }
      renderGroupResult(box, p, r);
    };
    return;
  }
  renderGroupResult(box, p, g);
}

function renderGroupResult(box, p, g) {
  if (g.needName) { renderGroup(p); if (g.error) toast(g.error); return; }
  if (g.error) { box.innerHTML = `<h2 class="home-h">Group: ${escapeHtml(g.group)}</h2><div class="c-card c-note">${escapeHtml(g.error)}</div>`; return; }
  const members = [...g.members].sort((a, b) => b.xp - a.xp);
  const totalXp = members.reduce((t, m) => t + m.xp, 0);
  const lv = (m, k) => m.skills[k] || 1;
  const combat = (m) => combatLevel({ Attack: lv(m, 'attack'), Strength: lv(m, 'strength'), Defence: lv(m, 'defence'), Hitpoints: lv(m, 'hitpoints') || 10,
    Ranged: lv(m, 'ranged'), Magic: lv(m, 'magic'), Prayer: lv(m, 'prayer') });
  box.innerHTML = `<h2 class="home-h">Group: ${escapeHtml(g.group)} <span class="since">${members.length} members · ${fmtShort(totalXp)} XP together</span>
      <button class="linkbtn" id="gimChange">Change</button></h2>
    <div class="c-card rows gim">${members.map((m) => `<div class="row${m.name.toLowerCase() === p.name.toLowerCase() ? ' me' : ''}">
      <button class="linkbtn" data-acct="${escapeHtml(m.name)}">${escapeHtml(m.name)}</button>
      <span class="dim">Combat ${combat(m)}</span><span class="dim">Total ${fmt(m.total)}</span><b>${fmtShort(m.xp)} XP</b></div>`).join('')}</div>`;
  box.querySelectorAll('[data-acct]').forEach((b) => (b.onclick = () => openCharacter(b.dataset.acct)));
  $('gimChange').onclick = async () => { await api.set_gim_group(p.name, ''); renderGroup(p); };
}

/* ---------------- shareable profile card (canvas → copy / save) ---------------- */

async function openShareCard(p) {
  toast('Making your profile card…');
  const levels = levelsFrom(p);
  const overall = p.skills.find((s) => s.name === 'Overall');
  const bySkill = Object.fromEntries(p.skills.map((s) => [s.name, s]));
  const icons = await api.image_data(SKILL_GRID.map((n) => skillIcon(n)));
  const imgs = {};
  await Promise.all(SKILL_GRID.map((n) => new Promise((done) => {
    const src = icons[skillIcon(n)];
    if (!src) return done();
    const im = new Image();
    im.onload = () => { imgs[n] = im; done(); };
    im.onerror = () => done();
    im.src = src;
  })));
  let latest = null;
  try { const x = await api.player_extras(p.name); latest = x && x.milestones && x.milestones.find((m) => m.date); } catch (e) { /* no milestone line */ }

  const W = 1200, H = 675, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const font = (w, size) => `${w} ${size}px "Segoe UI Variable Display", "Segoe UI", sans-serif`;
  const round = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#1d1a16'); bg.addColorStop(1, '#121110');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W - 120, 40, 10, W - 120, 40, 520);
  glow.addColorStop(0, 'rgba(226,178,89,.16)'); glow.addColorStop(1, 'rgba(226,178,89,0)');
  g.fillStyle = glow; g.fillRect(0, 0, W, H);

  // name, account type and headline numbers
  g.fillStyle = '#f3efe8'; g.font = font(700, 54); g.textBaseline = 'alphabetic';
  g.fillText(p.name, 56, 104);
  const type = ACCOUNT_TYPES[p.accountType || (p.wom && p.wom.type)];
  if (type) {
    const tw = g.measureText(p.name).width;
    g.font = font(600, 20);
    const bw = g.measureText(type).width + 28;
    round(56 + tw + 18, 74, bw, 36, 18); g.fillStyle = 'rgba(226,178,89,.16)'; g.fill();
    g.fillStyle = '#e2b259'; g.fillText(type, 56 + tw + 32, 99);
  }
  const stats = [['Combat', String(combatLevel(levels))], ['Total level', overall && overall.level > 0 ? fmt(overall.level) : '–'],
    ['Total XP', overall && overall.xp > 0 ? fmtShort(overall.xp) : '–']];
  if (p.wom && p.wom.ehp != null) stats.push(['EHP', fmt(Math.round(p.wom.ehp))]);
  stats.forEach(([k, v], i) => {
    const x = 56 + i * 132;
    round(x, 136, 120, 84, 16); g.fillStyle = 'rgba(255,255,255,.05)'; g.fill();
    g.fillStyle = '#f3efe8'; g.font = font(700, 30); g.fillText(v, x + 16, 180);
    g.fillStyle = '#a39d93'; g.font = font(500, 16); g.fillText(k, x + 16, 205);
  });

  // top bosses
  const acts = p.activities.filter((a) => a.score > 0);
  const lastMisc = p.activities.findIndex((a) => a.name === 'Collections Logged');
  const bosses = acts.filter((a) => p.activities.indexOf(a) > lastMisc).sort((a, b) => b.score - a.score).slice(0, 4);
  g.fillStyle = '#a39d93'; g.font = font(600, 16);
  g.fillText(bosses.length ? 'TOP BOSSES' : 'BOSSES', 56, 270);
  if (!bosses.length) { g.fillStyle = '#6f6a62'; g.font = font(500, 20); g.fillText('No boss kills on the hiscores yet', 56, 304); }
  bosses.forEach((b, i) => {
    const y = 300 + i * 46;
    g.fillStyle = '#f3efe8'; g.font = font(600, 22); g.fillText(b.name, 56, y);
    g.fillStyle = '#e2b259'; g.font = font(700, 22); g.textAlign = 'right'; g.fillText(fmt(b.score), 500, y); g.textAlign = 'left';
  });
  if (p.clog) {
    g.fillStyle = '#a39d93'; g.font = font(600, 16); g.fillText('COLLECTION LOG', 56, 470);
    g.fillStyle = '#f3efe8'; g.font = font(600, 22);
    g.fillText(`${fmt(p.clog.count)}${p.clog.total ? ` / ${fmt(p.clog.total)}` : ''} slots`, 56, 500);
  }
  if (latest) {
    g.fillStyle = '#a39d93'; g.font = font(600, 16); g.fillText('LATEST MILESTONE', 56, 540);
    g.fillStyle = '#f3efe8'; g.font = font(600, 22); g.fillText(`${latest.name}  ·  ${shortDate(latest.date)}`, 56, 570);
  }

  // skills: the in-game 3-column layout
  const gx = 590, gy = 56, cw = 182, ch = 66;
  SKILL_GRID.forEach((n, i) => {
    const col = i % 3, rowI = Math.floor(i / 3), x = gx + col * (cw + 10), y = gy + rowI * (ch + 7);
    const s = bySkill[n], lvl = s && s.xp >= 0 ? s.level : (n === 'Hitpoints' ? 10 : 1);
    round(x, y, cw, ch, 14); g.fillStyle = lvl >= 99 ? 'rgba(226,178,89,.14)' : 'rgba(255,255,255,.05)'; g.fill();
    if (imgs[n]) { const im = imgs[n], k = 30 / Math.max(im.width, im.height); g.drawImage(im, x + 16, y + (ch - im.height * k) / 2, im.width * k, im.height * k); }
    g.fillStyle = lvl >= 99 ? '#e2b259' : '#f3efe8'; g.font = font(700, 28); g.textAlign = 'right';
    g.fillText(String(lvl), x + cw - 18, y + 44); g.textAlign = 'left';
  });

  // footer
  g.fillStyle = '#6f6a62'; g.font = font(500, 16);
  g.fillText(`OSRS Wiki Reader  ·  ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`, 56, H - 40);

  showShareModal(c, p.name);
}

// A device-independent bitmap of the canvas (what Windows apps paste), as base64
function canvasToDib(canvas) {
  const { width: w, height: h } = canvas;
  const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const buf = new Uint8Array(40 + w * h * 4);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, 40, true); dv.setInt32(4, w, true); dv.setInt32(8, h, true);   // bottom-up rows
  dv.setUint16(12, 1, true); dv.setUint16(14, 32, true); dv.setUint32(20, w * h * 4, true);
  let o = 40;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) { buf[o++] = px[i + 2]; buf[o++] = px[i + 1]; buf[o++] = px[i]; buf[o++] = px[i + 3]; }
  }
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

function showShareModal(canvas, name) {
  const png = canvas.toDataURL('image/png');
  let m = $('shareModal');
  if (!m) {
    m = document.createElement('div');
    m.className = 'modal-scrim'; m.id = 'shareModal';
    m.innerHTML = `<div class="modal share" role="dialog" aria-modal="true" aria-labelledby="shareTitle">
      <h2 id="shareTitle">Your profile card</h2><p class="modal-sub">Copy it and paste it into Discord, or save it as a picture.</p>
      <img class="share-img" alt="Profile card">
      <div class="modal-actions"><button class="btn small" id="shareSave">Save picture</button><button class="btn" id="shareCopy">Copy picture</button></div>
      <p class="modal-msg" id="shareMsg"></p></div>`;
    document.body.appendChild(m);
    m.addEventListener('mousedown', (e) => { if (e.target === m) m.hidden = true; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !m.hidden) { e.stopPropagation(); m.hidden = true; } }, true);
  }
  m.querySelector('.share-img').src = png;
  $('shareMsg').textContent = '';
  $('shareCopy').onclick = async () => {
    $('shareMsg').textContent = 'Copying…';
    const r = await api.copy_image(canvasToDib(canvas), png);
    $('shareMsg').textContent = r && r.ok ? 'Copied! Paste it with Ctrl + V.' : (r && r.error) || 'Couldn’t copy it.';
  };
  $('shareSave').onclick = async () => {
    const r = await api.save_image(png, name);
    $('shareMsg').textContent = r && r.path ? 'Saved to your Pictures folder.' : (r && r.error) || 'Couldn’t save it.';
  };
  m.hidden = false;
  $('shareCopy').focus();
}

/* ---------------- your kill count on boss, clue and minigame pages ---------------- */

// hiscores names whose wiki page has a different title
const KC_PAGES = {
  'Clue Scrolls (beginner)': 'Clue scroll (beginner)', 'Clue Scrolls (easy)': 'Clue scroll (easy)',
  'Clue Scrolls (medium)': 'Clue scroll (medium)', 'Clue Scrolls (hard)': 'Clue scroll (hard)',
  'Clue Scrolls (elite)': 'Clue scroll (elite)', 'Clue Scrolls (master)': 'Clue scroll (master)',
  'Clue Scrolls (all)': 'Treasure Trails', 'LMS - Rank': 'Last Man Standing', 'PvP Arena - Rank': 'PvP Arena',
  'Soul Wars Zeal': 'Soul Wars', 'Rifts closed': 'Guardians of the Rift', 'Colosseum Glory': 'Fortis Colosseum',
  'Collections Logged': 'Collection log', 'Bounty Hunter - Hunter': 'Bounty Hunter', 'Bounty Hunter - Rogue': 'Bounty Hunter',
  'Chambers of Xeric: Challenge Mode': 'Chambers of Xeric', 'Theatre of Blood: Hard Mode': 'Theatre of Blood',
  'Tombs of Amascut: Expert Mode': 'Tombs of Amascut', 'Lunar Chests': 'Lunar Chest', 'Deadman Points': 'Deadman Mode',
};

// How lucky (or dry) a drop is, judged at your current kill count: pct = share of players who'd have it by now.
// Got it while few would have: lucky. Haven't got it while most would: dry. (The game doesn't say at which kill
// count a drop came, so the current count is the best we can do.)
function luckTag(pct, have) {
  if (have) return pct < 10 ? ['very lucky', 'lucky'] : pct < 33 ? ['lucky', 'lucky'] : ['on rate', 'ok'];
  return pct > 90 ? ['very dry', 'dry'] : pct > 75 ? ['dry', 'dry'] : pct > 50 ? ['getting dry', 'meh'] : ['on rate', 'ok'];
}

// Chance of having the pet after n kills at 1/rate: 1 - (1 - 1/rate)^n, shown as "x% of players would have it"
function petLuckHtml(a, pet, have) {
  if (have) {
    const pct = (1 - Math.pow(1 - 1 / pet.rate, a.score)) * 100;
    const [word, cls] = luckTag(pct, true);
    return `<div class="mykc-pet"><b>${escapeHtml(pet.pet)}</b> <span class="luck ok">${svgIcon('i-check')}you have it</span>
      <span class="dim">· 1/${fmt(pet.rate)} · only ${pct < 1 ? '<1%' : `${Math.round(pct)}%`} of players would have it by ${fmt(a.score)} kills</span>
      <span class="luck ${cls}">${word}</span></div>`;
  }
  const pct = (1 - Math.pow(1 - 1 / pet.rate, a.score)) * 100;
  const shown = pct < 1 ? '<1%' : pct > 99 ? '>99%' : `${Math.round(pct)}%`;
  const [verdict, cls] = pct < 50 ? ['on rate', 'ok'] : pct < 75 ? ['getting dry', 'meh'] : pct < 90 ? ['dry', 'dry'] : ['very dry', 'dry'];
  const unit = /clue/i.test(a.name) ? 'clues' : 'kills';
  return `<div class="mykc-pet"><b>${escapeHtml(pet.pet)}</b> <span class="dim">1/${fmt(pet.rate)}${pet.note ? ` (${escapeHtml(pet.note)})` : ''}</span>
    · after ${fmt(a.score)} ${unit}, <b>${shown}</b> of players would have it by now <span class="luck ${cls}">${verdict}</span></div>`;
}

// Expected collection log drops by your kill count: kills x chance, and the chance of having at least one
function lootHtml(kc, drops, owned, logged) {
  if (!drops || !drops.length || kc <= 0) return '';
  const exp = (x) => (x < 0.1 ? '<0.1' : x < 10 ? x.toFixed(1) : fmt(Math.round(x)));
  const pct = (x) => (x < 1 ? '<1%' : x > 99 ? '>99%' : `${Math.round(x)}%`);
  return `<details class="mykc-loot" open><summary>Expected loot by your ${fmt(kc)} kills</summary><div class="loot-rows">` +
    drops.map((d) => {
      const chance = (1 - Math.pow(1 - d.p, kc)) * 100;
      const got = !!(logged && logged[d.item]);
      const [word, cls] = logged ? luckTag(chance, got) : [null, null];
      return `<div class="loot"><a href="${wikiHref(d.item)}">${escapeHtml(d.item)}${got ? ' <span class="loot-own logged">logged</span>' : ''}${owned && owned[d.item] ? ' <span class="loot-own">in bank</span>' : ''}</a><span class="dim">${escapeHtml(d.rate)}</span>
      <span><b>${exp(kc * d.p)}</b> expected</span><span class="dim">${pct(chance)} would have one${word ? ` <span class="luck ${cls}">${word}</span>` : ''}</span></div>`;
    }).join('') +
    `</div>${logged ? '<p class="dim loot-note">Luck is judged at your current kill count; the game doesn\'t record the kill count each drop came at.</p>' : ''}</details>`;
}

window.showMyKc = async function (title) {
  if (!state.me) return;
  const [p, pets, drops] = await Promise.all([api.player(state.me), api.pet_rates().catch(() => ({})),
    api.rare_drops(title).catch(() => [])]);
  const owned = drops && drops.length ? await api.bank_has(drops.map((d) => d.item)) : null;
  const logged = new Set(((p && p.clog && p.clog.items) || []).map((n) => n.toLowerCase()));
  const loggedMap = drops && drops.length && p && p.clog ? Object.fromEntries(drops.map((d) => [d.item, logged.has(d.item.toLowerCase())])) : null;
  const petFor = Object.fromEntries(Object.entries(pets || {}).map(([k, v]) => [k.toLowerCase(), v]));
  if (!p || p.error || nav.stack[nav.idx].title !== title) return;
  const t = title.toLowerCase();
  const hits = p.activities.filter((a) => a.score > 0 && ((KC_PAGES[a.name] || a.name).toLowerCase() === t));
  const article = els.article;
  if (!hits.length || article.hidden || article.querySelector('.mykc')) return;
  const gains = p.wom && p.wom.gains;
  const box = document.createElement('div');
  box.className = 'mykc';
  box.innerHTML = `<span class="mykc-who">${escapeHtml(p.name)}</span>` + hits.map((a) => {
    const g = gains && gains.bosses[womKey(a.name)];
    const label = hits.length > 1 || KC_PAGES[a.name] ? `${escapeHtml(a.name)}: ` : '';
    return `<span class="mykc-item">${label}<b>${fmt(a.score)}</b>${a.name.includes('Clue') || a.name.includes('Rank') || a.name.includes('Zeal') || a.name.includes('Glory') || a.name.includes('Points') || a.name.includes('Logged') || a.name.includes('Rifts') ? '' : ' kills'}
      <span class="dim">· rank #${fmt(a.rank)}</span>${g > 0 ? ` <span class="gain">+${fmt(g)} this week</span>` : ''}</span>`;
  }).join('') + hits.map((a) => { const pet = petFor[a.name.toLowerCase()]; return pet ? petLuckHtml(a, pet, logged.has(pet.pet.toLowerCase())) : ''; }).join('') +
    (hits.length === 1 && !KC_PAGES[hits[0].name] ? lootHtml(hits[0].score, drops, owned, loggedMap) : '');   // one boss = one kill count to go on
  const h1 = article.querySelector('h1');
  if (h1) h1.after(box); else article.prepend(box);
};

/* ---------------- home: Did you know? (the wiki team's Fun Facts series) ---------------- */

let lastFact = -1;
window.renderFunFact = async function (again) {
  const box = $('homeFact');
  if (!box || (box.dataset.done && !again)) return;
  const facts = await api.fun_facts();
  if (!facts || !facts.length || !box.isConnected) return;
  let i = Math.floor(Math.random() * facts.length);
  if (facts.length > 1 && i === lastFact) i = (i + 1) % facts.length;
  lastFact = i;
  const f = facts[i];
  const text = f.text.charAt(0).toUpperCase() + f.text.slice(1);
  box.dataset.done = '1';
  box.innerHTML = `<div class="c-card fact-card"><div class="upd-label">Did you know?${f.n ? ` <span class="dim">· Wiki Fun Fact #${f.n}</span>` : ''}</div>
    <p>${escapeHtml(text)}</p>
    <div class="fact-actions"><button class="btn small" id="factNext">Another fact</button>
      <button class="linkbtn" id="factMore">More fun facts</button></div></div>`;
  box.hidden = false;
  $('factNext').onclick = () => renderFunFact(true);
  $('factMore').onclick = () => openPage(f.page || 'RuneScape:Wiki Fun Facts');
};

/* ---------------- home: the newest game update ---------------- */

window.renderLatestUpdate = async function () {
  const box = $('homeUpdate');
  if (!box || box.dataset.done) return;
  const u = await api.latest_update();
  if (!u || !box.isConnected) return;
  box.dataset.done = '1';
  box.innerHTML = `<div class="c-card upd-card"><div class="upd-label">Latest game update${u.date ? ` · ${escapeHtml(u.date)}` : ''}</div>
    <div class="upd-name">${escapeHtml(u.name)}</div>${u.summary ? `<p>${escapeHtml(u.summary)}</p>` : ''}
    <button class="btn small" id="updRead">Read the update</button></div>`;
  box.hidden = false;
  $('updRead').onclick = () => openPage(u.title);
};
