'use strict';
/* XP calculator panel on skill pages. */

const MAX_XP = 200e6;

function loadXpPerAction(skill) {
  try { return parseFloat(localStorage.getItem('xpa:' + skill)) || ''; } catch { return ''; }
}
function saveXpPerAction(skill, v) {
  try { localStorage.setItem('xpa:' + skill, v); } catch { /* storage unavailable */ }
}

window.showCalculator = async function (pageTitle) {
  if (!SKILL_GRID.includes(pageTitle)) return;
  const skill = pageTitle;
  const heading = els.article.querySelector('.page-heading');
  if (!heading) return;

  const panel = document.createElement('section');
  panel.className = 'xp-calc';
  heading.after(panel);
  panel.innerHTML = `
    <div class="ge-head"><img src="${skillIcon(skill)}" alt=""><span class="ge-title">XP calculator</span><span class="ge-upd" id="xcSrc"></span></div>
    <div class="xc-grid">
      <label>Current XP<input id="xcCur" type="number" min="0" max="${MAX_XP}" step="1" value="0"><span id="xcCurLv"></span></label>
      <label>Target level<input id="xcTgt" type="number" min="2" max="126" step="1" value="2"><span id="xcTgtXp"></span></label>
      <label>XP per action<input id="xcXpa" type="number" min="0" step="any" placeholder="e.g. 175" value="${loadXpPerAction(skill)}"><span>from the tables below</span></label>
    </div>
    <div class="xc-out" id="xcOut"></div>
    <details class="xc-methods" id="xcMethods">
      <summary>Training methods <span class="dim" id="xcCount"></span></summary>
      <div class="xc-mtools">
        <input id="xcFilter" type="text" placeholder="Filter methods" autocomplete="off" spellcheck="false">
        <label class="xc-chk"><input type="checkbox" id="xcCanDo" checked> Only what I can do</label>
      </div>
      <div class="xc-list" id="xcList"><div class="dim">Loading…</div></div>
    </details>`;

  const cur = $('xcCur'), tgt = $('xcTgt'), xpa = $('xcXpa');
  let chosen = null;   // name of the picked training method, if any
  let methods = null;
  const update = () => {
    const c = Math.max(0, Math.min(MAX_XP, Math.floor(+cur.value || 0)));
    const lv = virtualLevel(c);
    const t = Math.max(2, Math.min(126, Math.floor(+tgt.value || 2)));
    const targetXp = XP_TABLE[t];
    const left = Math.max(0, targetXp - c);
    const per = parseFloat(xpa.value);
    $('xcCurLv').textContent = `Level ${lv}${lv > 99 ? ' (virtual)' : ''}`;
    $('xcTgtXp').textContent = `${fmt(targetXp)} XP`;
    const startXp = XP_TABLE[Math.min(lv, t)];
    const pct = targetXp > startXp ? Math.min(100, ((c - startXp) / (targetXp - startXp)) * 100) : 100;
    $('xcOut').innerHTML = left === 0
      ? `<div class="xc-done">${svgIcon('i-check')} Already at level ${t}</div>`
      : `<div class="xc-res"><div><b>${fmt(left)}</b><span>XP to level ${t}</span></div>
           <div><b>${per > 0 ? fmt(Math.ceil(left / per)) : '–'}</b><span>${per > 0 ? (chosen ? `× ${escapeHtml(chosen)} (${fmt(per)} XP)` : `actions at ${fmt(per)} XP`) : 'enter XP per action or pick a method'}</span></div></div>
         <div class="prog-bar" title="${pct.toFixed(1)}% of the way from level ${Math.min(lv, t)}"><span style="width:${pct}%"></span></div>`;
  };
  const renderMethods = () => {
    const list = $('xcList');
    if (!list || !methods) return;
    const q = $('xcFilter').value.trim().toLowerCase();
    const myLevel = virtualLevel(+cur.value || 0);
    const canDo = $('xcCanDo').checked;
    let rows = methods.filter((m) => (!q || m.name.toLowerCase().includes(q) || m.note.toLowerCase().includes(q))
      && (!canDo || m.level <= myLevel));
    rows = canDo ? rows.sort((a, b) => b.level - a.level || b.xp - a.xp) : rows;
    $('xcCount').textContent = `· ${fmt(methods.length)}`;
    if (!rows.length) {
      list.innerHTML = `<div class="dim">${methods.length ? 'No matching methods.' : 'No method data for this skill.'}</div>`;
      return;
    }
    const shown = rows.slice(0, 150);
    list.innerHTML = shown.map((m, i) => `
      <button class="xc-m${m.level > myLevel ? ' locked' : ''}${m.name === chosen && String(m.xp) === xpa.value ? ' on' : ''}" data-i="${i}">
        ${m.image ? `<img src="${itemIcon(m.image)}" alt="" loading="lazy">` : '<span class="xc-noimg"></span>'}
        <span class="xc-mn"><span>${escapeHtml(m.name)}</span>${m.note ? `<small>${escapeHtml(m.note)}</small>` : ''}</span>
        <span class="xc-lv">Lv ${m.level}</span><b>${fmt(m.xp)} XP</b>
      </button>`).join('') +
      (rows.length > shown.length ? `<div class="dim xc-more">Showing ${shown.length} of ${fmt(rows.length)}. Type to narrow it down.</div>` : '');
    list.onclick = (e) => {
      const b = e.target.closest('.xc-m');
      if (!b) return;
      const m = shown[+b.dataset.i];
      chosen = m.name;
      xpa.value = m.xp;
      saveXpPerAction(skill, m.xp);
      list.querySelectorAll('.xc-m').forEach((x) => x.classList.toggle('on', x === b));
      update();
    };
  };
  $('xcFilter').oninput = renderMethods;
  $('xcCanDo').onchange = renderMethods;
  $('xcMethods').addEventListener('toggle', async () => {
    if (!$('xcMethods').open || methods) return;
    methods = await api.training_methods(skill);
    renderMethods();
  });

  cur.oninput = () => { update(); renderMethods(); };
  tgt.oninput = update;
  xpa.oninput = () => { chosen = null; saveXpPerAction(skill, xpa.value); update(); };

  const setFrom = (xp) => {
    cur.value = xp;
    const lv = virtualLevel(xp);
    tgt.value = lv < 99 ? lv + 1 : Math.min(126, lv + 1);
    update();
    renderMethods();
  };
  setFrom(0);

  if (!state.me) {
    $('xcSrc').textContent = 'set your account in the Character tab to fill this in';
    return;
  }
  $('xcSrc').textContent = `loading ${state.me}…`;
  const p = await api.player(state.me);
  if (!panel.isConnected) return;
  const s = !p.error && p.skills.find((x) => x.name === skill);
  if (s && s.xp >= 0) {
    setFrom(s.xp);
    $('xcSrc').textContent = `${p.name}'s XP from the hiscores`;
  } else {
    $('xcSrc').textContent = p.error ? 'couldn’t load your stats' : `${state.me} isn't ranked in ${skill}`;
  }
};
