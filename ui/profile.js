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
  if (latest) {
    g.fillStyle = '#a39d93'; g.font = font(600, 16); g.fillText('LATEST MILESTONE', 56, 520);
    g.fillStyle = '#f3efe8'; g.font = font(600, 22); g.fillText(`${latest.name}  ·  ${shortDate(latest.date)}`, 56, 552);
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

// Chance of having the pet after n kills at 1/rate: 1 - (1 - 1/rate)^n, shown as "x% of players would have it"
function petLuckHtml(a, pet) {
  const pct = (1 - Math.pow(1 - 1 / pet.rate, a.score)) * 100;
  const shown = pct < 1 ? '<1%' : pct > 99 ? '>99%' : `${Math.round(pct)}%`;
  const [verdict, cls] = pct < 50 ? ['on rate', 'ok'] : pct < 75 ? ['getting dry', 'meh'] : pct < 90 ? ['dry', 'dry'] : ['very dry', 'dry'];
  const unit = /clue/i.test(a.name) ? 'clues' : 'kills';
  return `<div class="mykc-pet"><b>${escapeHtml(pet.pet)}</b> <span class="dim">1/${fmt(pet.rate)}${pet.note ? ` (${escapeHtml(pet.note)})` : ''}</span>
    · after ${fmt(a.score)} ${unit}, <b>${shown}</b> of players would have it by now <span class="luck ${cls}">${verdict}</span></div>`;
}

// Expected collection log drops by your kill count: kills x chance, and the chance of having at least one
function lootHtml(kc, drops) {
  if (!drops || !drops.length || kc <= 0) return '';
  const exp = (x) => (x < 0.1 ? '<0.1' : x < 10 ? x.toFixed(1) : fmt(Math.round(x)));
  const pct = (x) => (x < 1 ? '<1%' : x > 99 ? '>99%' : `${Math.round(x)}%`);
  return `<details class="mykc-loot" open><summary>Expected loot by your ${fmt(kc)} kills</summary><div class="loot-rows">` +
    drops.map((d) => `<div class="loot"><a href="${wikiHref(d.item)}">${escapeHtml(d.item)}</a><span class="dim">${escapeHtml(d.rate)}</span>
      <span><b>${exp(kc * d.p)}</b> expected</span><span class="dim">${pct((1 - Math.pow(1 - d.p, kc)) * 100)} would have one</span></div>`).join('') +
    `</div></details>`;
}

window.showMyKc = async function (title) {
  if (!state.me) return;
  const [p, pets, drops] = await Promise.all([api.player(state.me), api.pet_rates().catch(() => ({})),
    api.rare_drops(title).catch(() => [])]);
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
  }).join('') + hits.map((a) => (petFor[a.name.toLowerCase()] ? petLuckHtml(a, petFor[a.name.toLowerCase()]) : '')).join('') +
    (hits.length === 1 && !KC_PAGES[hits[0].name] ? lootHtml(hits[0].score, drops) : '');   // one boss = one kill count to go on
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
