'use strict';
/* Mini mode: a slim always-on-top search strip with a short preview of the picked page. */

let mini = false;
let miniToken = 0;
const miniBox = $('miniPreview');

window.isMini = () => mini;

async function setMini(on) {
  mini = on;
  document.body.classList.toggle('mini', on);
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

async function checkForUpdate(manual = false) {
  $('updStatus').textContent = manual ? 'checking…' : '';
  const u = await api.check_update();
  if (!u.available) {
    $('updStatus').textContent = manual ? 'you have the latest version' : '';
    return;
  }
  $('updStatus').textContent = `v${u.version} available`;
  const b = $('updateBanner');
  b.hidden = false;
  b.innerHTML = `
    <span class="ub-icon">${svgIcon('i-refresh')}</span>
    <span class="ub-text"><b>Version ${escapeHtml(u.version)} is available</b><span>You have ${escapeHtml(state.version)}.</span></span>
    ${u.canInstall ? '<button class="btn small" id="ubInstall">Update now</button>' : `<a href="${escapeHtml(u.page || '')}" data-ext>Download</a>`}
    <button class="ub-x" id="ubLater" title="Later">${svgIcon('i-x')}</button>`;
  $('ubLater').onclick = () => { b.hidden = true; };
  const inst = $('ubInstall');
  if (inst) inst.onclick = async () => {
    inst.disabled = true;
    inst.textContent = 'Downloading…';
    const r = await api.install_update();
    if (r.error) { toast(r.error); inst.disabled = false; inst.textContent = 'Update now'; return; }
    inst.textContent = 'Restarting…';
  };
  if (manual) goHome(true);
}
$('btnCheckUpdate').onclick = () => checkForUpdate(true);
window.addEventListener('pywebviewready', () => setTimeout(() => checkForUpdate(false), 4000));
document.addEventListener('keydown', (e) => {
  if (mini && e.key === 'Escape' && !miniBox.hidden && e.target !== els.search) {
    miniBox.hidden = true;
    fitMini();
  }
});
