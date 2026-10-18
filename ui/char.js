'use strict';
/* Character tab (hiscores + Wise Old Man + WikiSync) and the quest requirement checker. */

// Same layout as the in-game skills tab
const SKILL_GRID = [
  'Attack', 'Hitpoints', 'Mining', 'Strength', 'Agility', 'Smithing', 'Defence', 'Herblore', 'Fishing',
  'Ranged', 'Thieving', 'Cooking', 'Prayer', 'Crafting', 'Firemaking', 'Magic', 'Fletching', 'Woodcutting',
  'Runecraft', 'Slayer', 'Farming', 'Construction', 'Hunter', 'Sailing',
];
const ACCOUNT_TYPES = { ironman: 'Ironman', hardcore: 'Hardcore Ironman', ultimate: 'Ultimate Ironman' };

// XP_TABLE[level] = XP needed for that level (virtual levels up to 126)
const XP_TABLE = (() => {
  const t = [0, 0];
  let points = 0;
  for (let l = 1; l < 126; l++) {
    points += Math.floor(l + 300 * Math.pow(2, l / 7));
    t[l + 1] = Math.floor(points / 4);
  }
  return t;
})();

function virtualLevel(xp) {
  let l = 1;
  while (l < 126 && XP_TABLE[l + 1] <= xp) l++;
  return l;
}

const fmt = (n) => Number(n).toLocaleString('en-US');
function fmtShort(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 1 : 2).replace(/\.?0+$/, '') + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (a >= 1e4) return Math.round(n / 1e3) + 'k';
  return fmt(n);
}
function timeAgo(when) {
  if (!when) return '';
  const t = typeof when === 'number' ? when * 1000 : Date.parse(when);
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}
const womKey = (name) => name.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const wikiHref = (title) => '/w/' + encodeURIComponent(title.replace(/ /g, '_'));
const skillIcon = (skill) => `${WIKI}/images/${encodeURIComponent(skill)}_icon.png`;
const svgIcon = (id) => `<svg class="ic"><use href="#${id}"/></svg>`;

function levelsFrom(p) {
  const levels = {};
  p.skills.forEach((s) => { if (s.xp >= 0 && s.name !== 'Overall') levels[s.name] = s.level; });
  if (levels.Hitpoints === undefined) levels.Hitpoints = 10;
  if (p.sync) Object.assign(levels, p.sync.levels);
  return levels;
}

function combatLevel(lv) {
  const g = (k, d = 1) => lv[k] ?? d;
  const base = 0.25 * (g('Defence') + g('Hitpoints', 10) + Math.floor(g('Prayer') / 2));
  const melee = 0.325 * (g('Attack') + g('Strength'));
  const range = 0.325 * Math.floor(g('Ranged') * 1.5);
  const mage = 0.325 * Math.floor(g('Magic') * 1.5);
  return Math.floor(base + Math.max(melee, range, mage));
}

/* ---------------- character view ---------------- */

let charToken = 0;

async function openCharacter(name, { push = true, scroll = 0 } = {}) {
  closePops();
  hideSuggest();
  loadToken++;                      // cancel any article load in flight
  if (push) pushEntry('char', name || null);
  show('char');
  els.pageTitle.textContent = name || 'Character';
  const token = ++charToken;

  if (!name) {
    els.char.innerHTML = pickerHtml() + introHtml();
    bindPicker();
    els.scroller.scrollTop = 0;
    refreshFind();
    return;
  }
  els.char.innerHTML = pickerHtml(name) + `<div class="c-loading">Looking up <b>${escapeHtml(name)}</b>…</div>`;
  bindPicker();
  setLoading(true);
  const p = await api.player(name);
  if (token !== charToken) return;
  setLoading(false);
  if (p.error) {
    els.char.innerHTML = pickerHtml(name) + `<div class="c-card c-error">${escapeHtml(p.error)}</div>`;
    bindPicker();
    return;
  }
  state = await api.save_account(p.name);
  nav.stack[nav.idx].title = p.name;
  els.pageTitle.textContent = p.name;
  renderPlayer(p);
  els.scroller.scrollTop = scroll;
  refreshFind();
}

$('btnChar').onclick = () => openCharacter(state.me || null);

function pickerHtml(current = '') {
  const chips = (state.accounts || []).map((a) => {
    const me = state.me && a.toLowerCase() === state.me.toLowerCase();
    const on = current && a.toLowerCase() === current.toLowerCase();
    return `<span class="acct${on ? ' on' : ''}"><button class="acct-name" data-acct="${escapeHtml(a)}">${me ? svgIcon('i-star') : ''}${escapeHtml(a)}</button><button class="acct-x" data-remove="${escapeHtml(a)}" title="Remove">${svgIcon('i-x')}</button></span>`;
  }).join('');
  return `
    <form class="c-search" id="charForm">
      <input id="charInput" maxlength="12" placeholder="RuneScape name" value="${escapeHtml(current)}" autocomplete="off" spellcheck="false">
      <button class="btn" type="submit">Look up</button>
    </form>
    ${chips ? `<div class="accts">${chips}</div>` : ''}`;
}

function introHtml() {
  return `
    <div class="c-card c-intro">
      <h2>Look up any account</h2>
      <p>See levels, boss kill counts and clue totals from the official hiscores, plus weekly gains from Wise Old Man.</p>
      <p>Set one account as <b>yours</b> and quest pages will tick off the requirements you already meet.</p>
      <p class="dim">Quest and achievement diary progress needs the free <b>WikiSync</b> plugin enabled in RuneLite.</p>
    </div>`;
}

function bindPicker() {
  const form = $('charForm');
  form.onsubmit = (e) => {
    e.preventDefault();
    const v = $('charInput').value.trim();
    if (v) openCharacter(v);
  };
  els.char.querySelectorAll('[data-acct]').forEach((b) => (b.onclick = () => openCharacter(b.dataset.acct)));
  els.char.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = async () => {
    state = await api.remove_account(b.dataset.remove);
    const cur = nav.stack[nav.idx];
    openCharacter(cur && cur.title, { push: false });
  }));
}

function renderPlayer(p) {
  const levels = levelsFrom(p);
  const overall = p.skills.find((s) => s.name === 'Overall');
  const bySkill = Object.fromEntries(p.skills.map((s) => [s.name, s]));
  const wom = p.wom;
  const gains = wom && wom.gains;
  const isMe = state.me && state.me.toLowerCase() === p.name.toLowerCase();
  const acctType = p.accountType || (wom && wom.type);
  const type = ACCOUNT_TYPES[acctType];

  const statBits = [
    ['Combat', combatLevel(levels)],
    ['Total level', overall && overall.level > 0 ? fmt(overall.level) : '–'],
    ['Total XP', overall && overall.xp > 0 ? fmtShort(overall.xp) : '–'],
  ];
  if (wom && wom.ehp != null) statBits.push(['EHP', fmt(Math.round(wom.ehp))]);
  if (wom && wom.ehb != null) statBits.push(['EHB', fmt(Math.round(wom.ehb))]);

  const tiles = SKILL_GRID.map((name) => {
    const s = bySkill[name];
    const ranked = s && s.xp >= 0;
    const lvl = ranked ? s.level : (p.sync && p.sync.levels[name]) || (name === 'Hitpoints' ? 10 : 1);
    const vl = ranked ? virtualLevel(s.xp) : lvl;
    const g = gains && gains.skills[name.toLowerCase()];
    let tip = name;
    if (ranked) {
      tip += `\nXP: ${fmt(s.xp)}\nRank: ${fmt(s.rank)}`;
      if (s.level < 99) tip += `\nTo level ${s.level + 1}: ${fmt(XP_TABLE[s.level + 1] - s.xp)} XP`;
      else if (vl > 99) tip += `\nVirtual level ${vl}`;
      if (s.xp < 200e6 && s.level >= 99) tip += `\nTo 200M: ${fmt(200e6 - s.xp)} XP`;
    } else tip += '\nNot ranked on the hiscores';
    if (g) tip += `\nThis week: +${fmt(g)} XP`;
    return `<a class="sk${ranked ? '' : ' unranked'}${lvl >= 99 ? ' maxed' : ''}" href="${wikiHref(name)}" title="${escapeHtml(tip)}">
      <img src="${skillIcon(name)}" alt=""><span class="lv">${lvl}</span>${g ? `<span class="gain">+${fmtShort(g)}</span>` : ''}</a>`;
  }).join('');

  let html = pickerHtml(p.name);

  html += `
  <div class="c-card c-head">
    <div class="c-title">
      <h1>${escapeHtml(p.name)}</h1>
      ${type ? `<span class="badge t-${acctType}">${type}</span>` : ''}
      <span class="spacer"></span>
      <button class="cbtn${isMe ? ' on' : ''}" id="btnMe" title="${isMe ? 'This is your account' : 'Use this account for quest requirement checks'}">${svgIcon('i-star')}<span>${isMe ? 'My account' : 'This is me'}</span></button>
      <button class="cbtn" id="btnCompare" title="Compare with another saved account">${svgIcon('i-user')}<span>Compare</span></button>
      <button class="cbtn" id="btnShare" title="A picture of this profile to paste into Discord">${svgIcon('i-share')}<span>Share</span></button>
      <button class="cbtn" id="btnUpdate" title="Refresh hiscores and update Wise Old Man">${svgIcon('i-refresh')}<span>Update</span></button>
    </div>
    <div class="c-stats">${statBits.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')}</div>
    <div class="c-meta">Hiscores ${timeAgo(p.fetchedAt)}${wom ? ` · Wise Old Man updated ${timeAgo(wom.updatedAt)}` : ''}${p.sync ? ` · WikiSync ${timeAgo(p.sync.timestamp)}` : ''}</div>
  </div>`;
  const head = html;
  html = `<div class="skills">${tiles}
    <div class="sk total"><img src="${skillIcon('Stats')}" alt=""><span>Total level</span><span class="lv">${overall && overall.level > 0 ? fmt(overall.level) : '–'}</span></div>
  </div>`;

  // weekly gains
  html += `<h2 class="home-h">This week${gains && gains.startsAt ? ` <span class="since">since ${new Date(gains.startsAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>` : ''}</h2>`;
  if (!wom) {
    html += `<div class="c-card c-note">Not tracked on Wise Old Man yet, so weekly gains aren't available.
      <button class="btn small" id="btnTrack">Start tracking</button></div>`;
  } else {
    const list = SKILL_GRID.map((n) => [n, gains ? gains.skills[n.toLowerCase()] || 0 : 0]).filter(([, g]) => g > 0).sort((a, b) => b[1] - a[1]);
    const total = gains ? gains.skills.overall || 0 : 0;
    if (!list.length) {
      html += `<div class="c-card c-note">No XP gained this week. Wise Old Man only knows about XP from its updates, so press <b>Update</b> after playing.</div>`;
    } else {
      const max = list[0][1];
      html += `<div class="c-card gains"><div class="gains-total"><b>+${fmt(total)}</b> XP total</div>` +
        list.slice(0, 8).map(([n, g]) => `<div class="gbar"><img src="${skillIcon(n)}" alt=""><span class="gn">${n}</span>
          <span class="gtrack"><span style="width:${Math.max(3, (g / max) * 100)}%"></span></span><span class="gv">+${fmtShort(g)}</span></div>`).join('') +
        `</div>`;
    }
  }

  const overview = html + goalsHtml(p);

  // quests & diaries
  html = `<h2 class="home-h">Quests &amp; diaries</h2>`;
  if (p.sync) {
    const q = Object.entries(p.sync.quests);
    const done = q.filter(([, v]) => v === 2);
    const started = q.filter(([, v]) => v === 1);
    const tiers = Object.values(p.sync.diaries).flatMap((t) => Object.values(t));
    const tiersDone = tiers.filter((t) => t.complete).length;
    const todo = q.filter(([, v]) => v !== 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    html += `<div class="c-card">
      ${progressRow('Quests', done.length, q.length, started.length ? `${started.length} in progress` : '')}
      ${tiers.length ? progressRow('Achievement diary tiers', tiersDone, tiers.length) : ''}
      <div id="questSuggest"></div>
      ${todo.length ? `<details class="todo"><summary>${todo.length} quests not finished</summary><ul>${todo.map(([n, v]) =>
        `<li><a href="${wikiHref(n)}">${escapeHtml(n)}</a>${v === 1 ? ' <span class="dim">(started)</span>' : ''}</li>`).join('')}</ul></details>` : ''}
    </div>`;
  } else {
    html += `<div class="c-card c-note">Quest and diary progress isn't public on the hiscores. Turn on the
      <a href="${wikiHref('RuneScape:WikiSync')}">WikiSync</a> plugin in RuneLite, log in once, and it'll show up here.</div>`;
  }

  const quests = html;

  // bosses, clues and other activities
  const acts = p.activities.filter((a) => a.score > 0);
  const lastMisc = p.activities.findIndex((a) => a.name === 'Collections Logged');
  const isBoss = (a) => p.activities.indexOf(a) > lastMisc;
  const bosses = acts.filter(isBoss).sort((a, b) => b.score - a.score);
  const other = acts.filter((a) => !isBoss(a));
  html = '';
  if (bosses.length) {
    html += `<h2 class="home-h">Bosses <span class="since">${bosses.length} with kills</span></h2><div class="c-card rows">` +
      bosses.map((b) => {
        const g = gains && gains.bosses[womKey(b.name)];
        return `<div class="row"><a href="${wikiHref(b.name)}">${escapeHtml(b.name)}</a>${g > 0 ? `<span class="gain">+${fmt(g)}</span>` : ''}<b>${fmt(b.score)}</b><span class="rank">#${fmt(b.rank)}</span></div>`;
      }).join('') + `</div>`;
  }
  html += '<div id="pxCA"></div>';   // combat achievements (profile.js)
  if (other.length) {
    html += `<h2 class="home-h">Clues &amp; activities</h2><div class="c-card rows">` +
      other.map((a) => `<div class="row"><span>${escapeHtml(a.name)}</span><b>${fmt(a.score)}</b><span class="rank">#${fmt(a.rank)}</span></div>`).join('') + `</div>`;
  }
  // the sections filled in later by profile.js (#px...) live in their tab; a tab with nothing in it stays hidden
  const tabs = [
    ['overview', 'Overview', overview],
    ['progress', 'Progress', chartHtml(p) + '<div id="pxExtras"></div>'],
    ['bosses', `Bosses${bosses.length ? ` <small>${bosses.length}</small>` : ''}`, html],
    ['collection', 'Collection', '<div id="pxClog"></div><div id="pxPets"></div>'],
    ['quests', 'Quests', quests],
    ['bank', 'Bank', '<div id="pxBank"></div>'],
    ['group', 'Group', '<div id="pxGroup"></div>'],
  ];
  els.char.innerHTML = head +
    `<nav class="c-tabs" id="charTabs" role="tablist">${tabs.map(([id, label]) => `<button role="tab" data-tab="${id}" hidden>${label}</button>`).join('')}</nav>` +
    tabs.map(([id, , body]) => `<section class="c-panel" data-panel="${id}" role="tabpanel" hidden>${body}</section>`).join('') +
    `<p class="credit">Data from the official OSRS hiscores, <a href="https://wiseoldman.net" data-ext>Wise Old Man</a> and WikiSync.</p>`;
  bindPicker();
  initCharTabs(acctType !== 'regular');

  $('btnMe').onclick = async () => {
    state = await api.set_me(isMe ? null : p.name);
    renderPlayer(p);
  };
  const update = async (btn) => {
    btn.disabled = true;
    btn.classList.add('spin');
    const res = await api.wom_update(p.name);
    if (res.error) {
      btn.disabled = false;
      btn.classList.remove('spin');
      toast(res.error);
      return;
    }
    if (nav.stack[nav.idx].kind === 'char') renderPlayer(res);
  };
  $('btnUpdate').onclick = (e) => update(e.currentTarget);
  $('btnCompare').onclick = () => startCompare(p.name);
  $('btnShare').onclick = () => openShareCard(p);
  bindXpChart(p);
  renderExtras(p);
  renderGroup(p);
  renderCombatAchievements(p);
  renderBank(p);
  renderPetChances(p);
  renderCollectionLog(p);
  if (p.sync) renderQuestSuggestions(p, levels);
  const track = $('btnTrack');
  if (track) track.onclick = () => update(track);
}

/* ---------------- quests you can do now ---------------- */

const DIFFICULTY = ['Novice', 'Intermediate', 'Experienced', 'Master', 'Grandmaster', 'Special'];
const LENGTH = ['Very Short', 'Short', 'Medium', 'Long', 'Very Long'];
const rank = (list, v) => { const i = list.indexOf(v); return i < 0 ? list.length : i; };

async function renderQuestSuggestions(p, levels) {
  const box = $('questSuggest');
  if (!box) return;
  box.innerHTML = '<div class="dim qs-loading">Working out which quests you can start…</div>';
  const all = await api.quest_requirements();
  if (!box.isConnected) return;
  if (!all.length) { box.innerHTML = ''; return; }

  const lv = { ...levels, 'Combat level': combatLevel(levels) };
  const status = p.sync.quests;
  const ready = [], close = [];
  for (const q of all) {
    if (!(q.name in status) || status[q.name] === 2) continue;
    if (q.quests.some((pre) => pre in status && status[pre] !== 2)) continue;   // a prerequisite quest isn't done
    let gap = 0;
    const missing = [];
    let qp = null;
    for (const [skill, need] of q.skills) {
      if (skill === 'Quest points') { qp = need; continue; }
      const have = lv[skill];
      if (have === undefined || have < need) {
        gap += need - (have || 1);
        missing.push(`${need} ${skill}`);
      }
    }
    const item = { ...q, qp, started: status[q.name] === 1, missing, gap };
    if (!missing.length) ready.push(item);
    else if (gap <= 10) close.push(item);
  }
  ready.sort((a, b) => b.started - a.started || rank(DIFFICULTY, a.difficulty) - rank(DIFFICULTY, b.difficulty)
    || rank(LENGTH, a.length) - rank(LENGTH, b.length) || a.name.localeCompare(b.name));
  close.sort((a, b) => a.gap - b.gap || a.name.localeCompare(b.name));

  const li = (q, extra) => `<li><a href="${wikiHref(q.name)}">${escapeHtml(q.name.replace('Recipe for Disaster/', 'RFD: '))}</a>
    <span class="dim">${[q.started ? 'started' : '', q.difficulty, q.length, q.qp ? `${q.qp} QP needed` : ''].filter(Boolean).join(' · ')}</span>${extra || ''}</li>`;
  const list = (items, n, extra) => `<ul class="qs-list">${items.slice(0, n).map((q) => li(q, extra && extra(q))).join('')}</ul>` +
    (items.length > n ? `<details class="qs-more"><summary>${items.length - n} more</summary><ul class="qs-list">${items.slice(n).map((q) => li(q, extra && extra(q))).join('')}</ul></details>` : '');

  box.innerHTML = `
    <div class="qs">
      <div class="qs-h">${svgIcon('i-check')} Ready to start <span class="dim">${ready.length}</span></div>
      ${ready.length ? list(ready, 10) : '<p class="dim">Nothing right now. Check "almost there" below.</p>'}
      ${close.length ? `<div class="qs-h">${svgIcon('i-list')} Almost there <span class="dim">${close.length}</span></div>
        ${list(close, 6, (q) => `<span class="qs-need">needs ${escapeHtml(q.missing.join(', '))}</span>`)}` : ''}
      <p class="dim qs-note">Based on skill and quest requirements. Quest points and item requirements aren't checked.</p>
    </div>`;
}

function progressRow(label, n, total, extra = '') {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return `<div class="prog"><div class="prog-top"><span>${label}</span><span><b>${n}</b> / ${total}${extra ? ` · ${extra}` : ''}</span></div>
    <div class="prog-bar"><span style="width:${pct}%"></span></div></div>`;
}

let toastTimer = null;
function toast(msg) {
  let t = $('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.querySelector('.app').appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
}

/* ---------------- quest requirement checker ---------------- */

function addMark(el, kind, tip) {
  const s = document.createElement('span');
  s.className = 'qc-mark qc-' + kind;
  s.title = tip;
  s.innerHTML = kind === 'yes' ? svgIcon('i-check') : kind === 'no' ? svgIcon('i-x') : '?';
  if (el.tagName === 'TD' || el.tagName === 'TH') el.append(s);
  else el.after(s);
}

// Marks one skill requirement; returns 'yes' | 'no' | 'unknown' | null (not checkable)
function markSkill(el, skill, need, levels) {
  if (!need || skill === 'Quest points') return null;   // quest points aren't available from any API
  const have = levels[skill];
  if (have === undefined) {
    addMark(el, 'unknown', `${skill}: not ranked on the hiscores, so your level is unknown`);
    return 'unknown';
  }
  addMark(el, have >= need ? 'yes' : 'no', `You have ${have} ${skill}`);
  return have >= need ? 'yes' : 'no';
}

function markDiaries(p) {
  const tables = els.article.querySelectorAll('table.diary-table[data-diary-name][data-diary-tier]');
  tables.forEach((table) => {
    const tier = p.sync && (p.sync.diaries[table.dataset.diaryName] || {})[table.dataset.diaryTier];
    if (!tier) return;
    const rows = [...table.tBodies[0].rows].slice(1);
    let done = 0, known = 0;
    rows.forEach((row, i) => {
      const t = tier.tasks[i];
      if (t === undefined || t === null) return;
      known++;
      if (t) done++;
      row.classList.add(t ? 'diary-done' : 'diary-todo');
      const cell = row.cells[0];
      if (cell) {
        const s = document.createElement('span');
        s.className = 'qc-mark qc-' + (t ? 'yes' : 'no');
        s.title = t ? 'Task completed' : 'Not completed yet';
        s.innerHTML = svgIcon(t ? 'i-check' : 'i-x');
        cell.prepend(s);
      }
    });
    if (!known) return;
    const note = document.createElement('div');
    note.className = 'qc-banner diary-note ' + (tier.complete ? 'good' : 'todo');
    note.innerHTML = `<span class="qc-icon">${svgIcon(tier.complete ? 'i-check' : 'i-list')}</span>
      <span><b>${escapeHtml(p.name)}</b>: ${done}/${rows.length} ${escapeHtml(table.dataset.diaryTier)} tasks done${tier.complete ? ' · tier complete' : ''}</span>`;
    (table.closest('.table-wrap') || table).before(note);
  });
}

window.checkRequirements = async function (pageTitle) {
  const zones = [...els.article.querySelectorAll('.qc-active')];
  const isQuest = !!els.article.querySelector('table.questdetails');
  const hasScp = !!els.article.querySelector('.scp[data-skill][data-level], [data-skill][data-skill-level]');
  if (!zones.length && !hasScp) return;

  let banner = null;
  if (isQuest && zones.length) {
    banner = document.createElement('div');
    banner.className = 'qc-banner';
    (els.article.querySelector('table.questdetails') || zones[0]).before(banner);
  }
  if (!state.me) {
    if (banner) {
      banner.innerHTML = `<span>Want to see which of these requirements you meet?</span><button class="btn small" id="qcSetup">Set your account</button>`;
      $('qcSetup').onclick = () => openCharacter(null);
    }
    return;
  }
  const me = state.me;
  if (banner) banner.innerHTML = `<span>Checking requirements for <b>${escapeHtml(me)}</b>…</span>`;
  const p = await api.player(me);
  const cur = nav.stack[nav.idx];
  if (!cur || cur.kind !== 'page' || cur.title !== pageTitle) return;
  if (p.error) {
    if (banner) banner.innerHTML = `<span>Couldn't check requirements: ${escapeHtml(p.error)}</span>`;
    return;
  }

  const levels = levelsFrom(p);
  levels['Combat level'] = levels.Combat = combatLevel(levels);
  const total = p.skills.find((s) => s.name === 'Overall');
  if (total && total.level > 0) levels['Total level'] = total.level;
  let sMet = 0, sTotal = 0, unknown = 0, qMet = 0, qTotal = 0;

  // skill levels anywhere on the page; only the quest's own requirement boxes count toward the banner
  els.article.querySelectorAll('.scp[data-skill][data-level]').forEach((el) => {
    const r = markSkill(el, el.dataset.skill, parseInt(el.dataset.level, 10), levels);
    if (!r || !isQuest || !el.closest('.qc-active')) return;
    sTotal++;
    if (r === 'yes') sMet++;
    if (r === 'unknown') unknown++;
  });
  // diary skill requirement tables
  els.article.querySelectorAll('.skill-table [data-skill][data-skill-level]').forEach((el) => {
    markSkill(el, el.dataset.skill, parseInt(el.dataset.skillLevel, 10), levels);
  });
  markDiaries(p);
  if (!banner) return;

  zones.forEach((zone) => {
    if (p.sync) {
      zone.querySelectorAll('a').forEach((a) => {
        if (a.closest('.scp')) return;
        const status = p.sync.quests[a.textContent.trim()];
        if (status === undefined) return;
        qTotal++;
        if (status === 2) qMet++;
        addMark(a, status === 2 ? 'yes' : 'no', status === 2 ? 'Completed' : status === 1 ? 'Started, not finished' : 'Not started');
      });
    }
  });

  const parts = [];
  if (sTotal) parts.push(`<b>${sMet}/${sTotal}</b> skill requirements met${unknown ? ` (${unknown} unknown)` : ''}`);
  if (p.sync && qTotal) parts.push(`<b>${qMet}/${qTotal}</b> required quests done`);
  const ownStatus = p.sync && p.sync.quests[pageTitle];
  let head = `<b>${escapeHtml(p.name)}</b>`;
  if (ownStatus === 2) head += ' has completed this quest';
  else if (ownStatus === 1) head += ' has started this quest';
  const ready = sMet === sTotal && (!p.sync || qMet === qTotal) && !unknown;
  banner.classList.add(ownStatus === 2 || ready ? 'good' : 'todo');
  banner.innerHTML = `<span class="qc-icon">${svgIcon(ownStatus === 2 || ready ? 'i-check' : 'i-list')}</span>
    <span>${head}${parts.length ? ': ' + parts.join(' · ') : ''}${!p.sync ? `<br><span class="dim">Quest progress needs the <a href="${wikiHref('RuneScape:WikiSync')}">WikiSync</a> RuneLite plugin.</span>` : ''}</span>`;
};

/* ---------------- profile tabs ---------------- */

const CHAR_TAB_KEY = 'charTab';
let charTabObserver = null;
// Shows one tab's panel. Tabs whose panel is still empty (sections that load later, or don't apply) stay hidden
// until something arrives; the tab you used last is reopened once it has content.
function initCharTabs(groupish) {
  const bar = $('charTabs');
  if (!bar) return;
  let want = 'overview';
  try { want = localStorage.getItem(CHAR_TAB_KEY) || 'overview'; } catch (e) { /* default */ }
  let picked = false;
  const btn = (id) => bar.querySelector(`[data-tab="${id}"]`);
  const panel = (id) => els.char.querySelector(`[data-panel="${id}"]`);
  const current = () => (bar.querySelector('[data-tab].on') || {}).dataset;
  const set = (id, user) => {
    bar.querySelectorAll('[data-tab]').forEach((b) => { b.classList.toggle('on', b.dataset.tab === id); b.setAttribute('aria-selected', b.dataset.tab === id); });
    els.char.querySelectorAll('[data-panel]').forEach((x) => (x.hidden = x.dataset.panel !== id));
    if (!user) return;
    picked = true;
    try { localStorage.setItem(CHAR_TAB_KEY, id); } catch (e) { /* not remembered */ }
    const chrome = els.scroller.getBoundingClientRect().top + parseFloat(getComputedStyle(els.scroller).paddingTop);
    const top = bar.getBoundingClientRect().top;
    if (top < chrome) els.scroller.scrollTop += top - chrome - 6;   // scrolled past the tabs: bring them back
    if (typeof refreshFind === 'function') refreshFind();
  };
  const sync = () => {
    bar.querySelectorAll('[data-tab]').forEach((b) => {
      const x = panel(b.dataset.tab);
      const empty = !x.textContent.trim() && !x.querySelector('img, canvas, svg, form, input');
      b.hidden = empty || (b.dataset.tab === 'group' && !groupish && !x.querySelector('.gim'));
    });
    const cur = current();
    if (!picked && !btn(want).hidden && (!cur || cur.tab !== want)) set(want);
    else if (!cur || btn(cur.tab).hidden) set('overview');
  };
  bar.onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) set(b.dataset.tab, true); };
  bar.onkeydown = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const vis = [...bar.querySelectorAll('[data-tab]:not([hidden])')];
    const i = vis.findIndex((b) => b.classList.contains('on'));
    const n = vis[(i + (e.key === 'ArrowRight' ? 1 : -1) + vis.length) % vis.length];
    if (n) { e.preventDefault(); set(n.dataset.tab, true); n.focus(); }
  };
  if (charTabObserver) charTabObserver.disconnect();
  let queued = false;
  charTabObserver = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (bar.isConnected) sync(); });
  });
  els.char.querySelectorAll('[data-panel]').forEach((x) => charTabObserver.observe(x, { childList: true, subtree: true, characterData: true }));
  sync();
}
window.setCharTab = (id) => { const b = document.querySelector(`#charTabs [data-tab="${id}"]`); if (b) b.click(); };
