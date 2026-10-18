'use strict';
/* Mini mode: a slim always-on-top search strip with a short preview of the picked page. */

let mini = false;
let miniToken = 0;
const miniBox = $('miniPreview');

window.isMini = () => mini;

async function setMini(on) {
  mini = on;
  document.body.classList.toggle('mini', on);
  if (window.updateDock) updateDock();   // the small-window Ask bar hides in mini mode
  closePops();
  hideSuggest();
  miniBox.hidden = true;
  miniBox.innerHTML = '';
  $('btnMini').title = on ? 'Back to the full reader' : 'Mini mode: a small always-on-top search bar';
  $('btnMini').querySelector('use').setAttribute('href', on ? '#i-expand' : '#i-mini');
  await api.set_mini(on);
  if (on) { focusSearch(); fitMini(); }
}

function fitMini() {
  if (!mini) return;
  requestAnimationFrame(() => {
    const top = document.querySelector('.titlebar').offsetHeight + document.querySelector('.toolbar').offsetHeight + 2;
    let h = top;
    if (!els.suggest.hidden) h = Math.max(h, top + els.suggest.offsetHeight + 12);
    if (!miniBox.hidden) h += miniBox.scrollHeight;
    api.mini_height(h + 2);
  });
}
window.onSuggestChange = fitMini;

function firstParagraph(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('.infobox, table, .hatnote, .messagebox, sup, .navbox, figure').forEach((n) => n.remove());
  const p = [...doc.querySelectorAll('p')].map((x) => x.textContent.trim()).find((t) => t.length > 40);
  return p ? (p.length > 420 ? p.slice(0, 400).replace(/\s+\S*$/, '') + '…' : p) : '';
}

function infoboxImage(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const img = doc.querySelector('.infobox .infobox-image img, .infobox img');
  return img ? abs(img.getAttribute('src')) : null;
}

window.miniShow = async function (title) {
  const token = ++miniToken;
  miniBox.hidden = false;
  miniBox.innerHTML = `<div class="mp-loading">Loading ${escapeHtml(title)}…</div>`;
  fitMini();
  const [res, price] = await Promise.all([api.page(title), api.item_price(title)]);
  if (token !== miniToken || !mini) return;
  if (res.error) {
    miniBox.innerHTML = `<div class="mp-loading">${escapeHtml(res.error)}</div>`;
    fitMini();
    return;
  }
  const img = infoboxImage(res.html);
  const text = firstParagraph(res.html);
  const priceLine = price && !price.error && price.high
    ? `<div class="mp-price"><b>${fmt(price.high)}</b> gp ${changeHtml(price.high, price.avgHigh24)}<span class="dim">instant buy</span></div>` : '';
  miniBox.innerHTML = `
    <div class="mp">
      ${img ? `<img src="${img}" alt="">` : ''}
      <div class="mp-body">
        <div class="mp-title">${escapeHtml(res.title)}</div>
        ${priceLine}
        <p>${escapeHtml(text || 'No summary available.')}</p>
      </div>
    </div>
    <div class="mp-actions">
      <button class="btn small" id="mpOpen">${svgIcon('i-expand')} Open full page</button>
      <button class="btn small" id="mpClose">Close</button>
    </div>`;
  $('mpOpen').onclick = async () => { await setMini(false); openPage(res.title); };
  $('mpClose').onclick = () => { miniBox.hidden = true; fitMini(); focusSearch(); };
  miniBox.querySelectorAll('img').forEach((i) => i.addEventListener('load', fitMini, { once: true }));
  fitMini();
};

$('btnMini').onclick = () => setMini(!mini);

/* ---------------- auto-update ---------------- */

let pendingUpdate = null;
let installing = false;
const fmtDate = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

async function checkForUpdate(manual = false) {
  $('updStatus').textContent = manual ? 'checking…' : '';
  const u = await api.check_update();
  if (!u.available) {
    $('updStatus').textContent = manual ? 'you have the latest version' : '';
    return;
  }
  pendingUpdate = u;
  $('updStatus').textContent = `v${u.version} available`;
  showUpdateBanner(u);
  if (!isMini()) openUpdateModal(u);
}

// small reminder on the home screen, for after "Later"
function showUpdateBanner(u) {
  const b = $('updateBanner');
  b.hidden = false;
  b.innerHTML = `
    <span class="ub-icon">${svgIcon('i-refresh')}</span>
    <span class="ub-text"><b>Version ${escapeHtml(u.version)} is available</b><span>You have ${escapeHtml(state.version)}.</span></span>
    <button class="btn small" id="ubOpen">See what's new</button>
    <button class="ub-x" id="ubLater" title="Hide">${svgIcon('i-x')}</button>`;
  $('ubOpen').onclick = () => openUpdateModal(u);
  $('ubLater').onclick = () => { b.hidden = true; };
}

function openUpdateModal(u) {
  closePops();
  $('updSub').innerHTML = `Version <b>${escapeHtml(u.version)}</b> is ready. You have ${escapeHtml(state.version)}.`;
  $('updNotes').innerHTML = (u.releases || []).map((r, i) => `
    <div class="rel-head"><b>What's new in ${escapeHtml(r.version)}</b>${i === 0 ? '<span class="new">Latest</span>' : ''}<span>${escapeHtml(fmtDate(r.date))}</span></div>
    ${renderMarkdown(r.notes.replace(/^##\s*/gm, '#### ')) || '<p>Small fixes and improvements.</p>'}`).join('');
  $('updProgress').hidden = true;
  $('updProgress').firstElementChild.style.width = '0';
  $('updMsg').textContent = u.canInstall ? 'Takes a few seconds. Your settings are kept.' : '';
  $('updMsg').classList.remove('err');
  const now = $('updNow');
  now.disabled = false;
  now.textContent = u.canInstall ? 'Update now' : 'Download';
  $('updLater').disabled = false;
  $('updModal').hidden = false;
  now.focus();
}
function closeUpdateModal() {
  if (!installing) $('updModal').hidden = true;
}

window.updateProgress = function (p) {
  $('updProgress').hidden = false;
  $('updProgress').firstElementChild.style.width = `${Math.round(p * 100)}%`;
  $('updMsg').textContent = `Downloading… ${Math.round(p * 100)}%`;
};

$('updNow').onclick = async () => {
  const u = pendingUpdate;
  if (!u) return;
  if (!u.canInstall) { api.open_external(u.page); return; }
  installing = true;
  $('updNow').disabled = true;
  $('updLater').disabled = true;
  $('updNow').textContent = 'Updating…';
  updateProgress(0);
  const r = await api.install_update();
  if (r.error) {
    installing = false;
    $('updNow').disabled = false;
    $('updLater').disabled = false;
    $('updNow').textContent = 'Try again';
    $('updMsg').textContent = r.error;
    $('updMsg').classList.add('err');
    return;
  }
  updateProgress(1);
  $('updMsg').textContent = 'Restarting with the new version…';
};
$('updLater').onclick = closeUpdateModal;
$('updModal').addEventListener('mousedown', (e) => { if (e.target === $('updModal')) closeUpdateModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('updModal').hidden) { e.stopPropagation(); closeUpdateModal(); }
}, true);
$('btnCheckUpdate').onclick = () => checkForUpdate(true);
window.addEventListener('pywebviewready', () => setTimeout(() => checkForUpdate(false), 4000));
document.addEventListener('keydown', (e) => {
  if (mini && e.key === 'Escape' && !miniBox.hidden && e.target !== els.search) {
    miniBox.hidden = true;
    fitMini();
  }
});
