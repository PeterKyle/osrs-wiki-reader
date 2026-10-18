'use strict';
/* Side-by-side account comparison. Series colours (--cmp-a / --cmp-b) are validated in prices.css. */

let cmpToken = 0;

function skillLevel(p, name) {
  const s = p.skills.find((x) => x.name === name);
  if (s && s.xp >= 0) return { level: s.level, xp: s.xp, ranked: true };
  const synced = p.sync && p.sync.levels[name];
  return { level: synced || (name === 'Hitpoints' ? 10 : 1), xp: null, ranked: false };
}

async function openCompare(a, b, { push = true, scroll = 0 } = {}) {
  closePops();
  hideSuggest();
  loadToken++;
  if (push) pushEntry('compare', `${a}\n${b}`);
  show('char');
  els.pageTitle.textContent = `${a} vs ${b}`;
  const token = ++cmpToken;
  charToken++;   // cancel a profile load in flight

  els.char.innerHTML = cmpPicker(a, b) + `<div class="c-loading">Loading both accounts…</div>`;
  bindCmpPicker();
  setLoading(true);
  const [pa, pb] = await Promise.all([api.player(a), api.player(b)]);
  if (token !== cmpToken) return;
  setLoading(false);
  const err = pa.error || pb.error;
  if (err) {
    els.char.innerHTML = cmpPicker(a, b) + `<div class="c-card c-error">${escapeHtml(err)}</div>`;
    bindCmpPicker();
    return;
  }
  renderCompare(pa, pb);
  els.scroller.scrollTop = scroll;
  refreshFind();
}

function cmpPicker(a, b) {
  const names = [...new Set([...(state.accounts || []), a, b])];
  const opts = (sel) => names.map((n) => `<option${n.toLowerCase() === sel.toLowerCase() ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('');
  return `
    <div class="cmp-pick">
      <span class="key a"></span><select id="cmpA">${opts(a)}</select>
      <button class="cbtn" id="cmpSwap" title="Swap">⇄</button>
      <span class="key b"></span><select id="cmpB">${opts(b)}</select>
      <span class="spacer"></span>
      <button class="cbtn" id="cmpBack" title="Back to ${escapeHtml(a)}'s profile">${svgIcon('i-user')}<span>Profile</span></button>
    </div>`;
}

function bindCmpPicker() {
  const go = () => {
    const a = $('cmpA').value, b = $('cmpB').value;
    if (a.toLowerCase() === b.toLowerCase()) { toast('Pick two different accounts to compare.'); return; }
    openCompare(a, b);
  };
  $('cmpA').onchange = go;
  $('cmpB').onchange = go;
  $('cmpSwap').onclick = () => openCompare($('cmpB').value, $('cmpA').value);
  $('cmpBack').onclick = () => openCharacter($('cmpA').value);
}

function renderCompare(pa, pb) {
  const la = levelsFrom(pa), lb = levelsFrom(pb);
  const oa = pa.skills.find((s) => s.name === 'Overall'), ob = pb.skills.find((s) => s.name === 'Overall');
  const qDone = (p) => (p.sync ? Object.values(p.sync.quests).filter((v) => v === 2).length : null);

  const stats = [
    ['Combat level', combatLevel(la), combatLevel(lb)],
    ['Total level', oa && oa.level > 0 ? oa.level : null, ob && ob.level > 0 ? ob.level : null],
    ['Total XP', oa && oa.xp > 0 ? oa.xp : null, ob && ob.xp > 0 ? ob.xp : null, fmtShort],
    ['EHP', pa.wom && Math.round(pa.wom.ehp), pb.wom && Math.round(pb.wom.ehp)],
    ['EHB', pa.wom && Math.round(pa.wom.ehb), pb.wom && Math.round(pb.wom.ehb)],
    ['Quests done', qDone(pa), qDone(pb)],
    ['Collection log', pa.clog && pa.clog.count, pb.clog && pb.clog.count],
  ].filter(([, x, y]) => x != null || y != null);

  let aLead = 0, bLead = 0, ties = 0, maxDiff = 1;
  const rows = SKILL_GRID.map((name) => {
    const A = skillLevel(pa, name), B = skillLevel(pb, name);
    const diff = A.level - B.level;
    if (diff > 0) aLead++; else if (diff < 0) bLead++; else ties++;
    maxDiff = Math.max(maxDiff, Math.abs(diff));
    return { name, A, B, diff };
  });

  const statCell = (v, other, f = fmt) => `<b class="${v != null && other != null && v > other ? 'lead' : ''}">${v == null ? '–' : f(v)}</b>`;
  let html = cmpPicker(pa.name, pb.name);
  html += `
    <div class="c-card cmp-head">
      <div class="cmp-names"><span><span class="key a"></span>${escapeHtml(pa.name)}</span><span class="vs">vs</span><span>${escapeHtml(pb.name)}<span class="key b"></span></span></div>
      <div class="cmp-stats">${stats.map(([k, x, y, f]) => `
        <div class="cmp-stat">${statCell(x, y, f)}<span>${k}</span>${statCell(y, x, f)}</div>`).join('')}
      </div>
      <div class="cmp-sum">${escapeHtml(pa.name)} is ahead in <b>${aLead}</b> skill${aLead === 1 ? '' : 's'}, ${escapeHtml(pb.name)} in <b>${bLead}</b>${ties ? `, ${ties} tied` : ''}.</div>
    </div>
    <h2 class="home-h">Skills</h2>
    <div class="c-card cmp-skills">
      ${rows.map(({ name, A, B, diff }) => {
        const w = (Math.abs(diff) / maxDiff) * 100;
        const xpLine = (p, s) => `${p.name}: ${s.ranked ? fmt(s.xp) + ' XP' : 'not ranked'}`;
        const tip = `${name}\n${xpLine(pa, A)}\n${xpLine(pb, B)}${diff ? `\n${diff > 0 ? pa.name : pb.name} is ${Math.abs(diff)} level${Math.abs(diff) === 1 ? '' : 's'} ahead` : ''}`;
        return `<a class="cmp-row" href="${wikiHref(name)}" title="${escapeHtml(tip)}">
          <img src="${skillIcon(name)}" alt=""><span class="nm">${name}</span>
          <b class="va${diff > 0 ? ' lead' : ''}${A.ranked ? '' : ' unranked'}">${A.level}</b>
          <span class="dbar"><span class="half l">${diff > 0 ? `<span style="width:${w}%"></span>` : ''}</span><span class="half r">${diff < 0 ? `<span style="width:${w}%"></span>` : ''}</span></span>
          <b class="vb${diff < 0 ? ' lead' : ''}${B.ranked ? '' : ' unranked'}">${B.level}</b>
        </a>`;
      }).join('')}
    </div>`;

  // bosses either account has killed
  const kc = (p) => Object.fromEntries(p.activities.filter((x) => x.score > 0).map((x) => [x.name, x.score]));
  const lastMisc = pa.activities.findIndex((x) => x.name === 'Collections Logged');
  const bossNames = new Set(pa.activities.slice(lastMisc + 1).map((x) => x.name));
  const ka = kc(pa), kb = kc(pb);
  const bosses = [...new Set([...Object.keys(ka), ...Object.keys(kb)])].filter((n) => bossNames.has(n))
    .sort((x, y) => Math.max(kb[y] || 0, ka[y] || 0) - Math.max(kb[x] || 0, ka[x] || 0));
  if (bosses.length) {
    html += `<h2 class="home-h">Boss kills</h2><div class="c-card rows cmp-bosses">
      <div class="row hdr"><span></span><span>${escapeHtml(pa.name)}</span><span>${escapeHtml(pb.name)}</span></div>
      ${bosses.slice(0, 25).map((n) => `<div class="row"><a href="${wikiHref(n)}">${escapeHtml(n)}</a>
        ${statCell(ka[n] ?? null, kb[n] ?? 0)}${statCell(kb[n] ?? null, ka[n] ?? 0)}</div>`).join('')}
    </div>`;
  }
  els.char.innerHTML = html;
  bindCmpPicker();
}

function startCompare(name) {
  const other = (state.accounts || []).find((a) => a.toLowerCase() !== name.toLowerCase());
  if (!other) { toast('Look up another account first, then you can compare them.'); return; }
  openCompare(name, other);
}
