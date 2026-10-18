'use strict';
/* Ctrl+Tab: flip between recent pages and profiles, like browser tabs. Keep Ctrl held and press Tab again to go
   further back (Shift+Tab goes the other way); let go of Ctrl to open it, Esc to cancel. */

const mru = [];   // most recently viewed first: { kind: 'page' | 'char', title }
const sw = { el: null, i: 0, open: false };

window.trackMru = function () {
  const cur = nav.stack[nav.idx];
  if (!cur || !cur.title || (cur.kind !== 'page' && cur.kind !== 'char')) return;
  const i = mru.findIndex((e) => e.kind === cur.kind && e.title === cur.title);
  if (i >= 0) mru.splice(i, 1);
  mru.unshift({ kind: cur.kind, title: cur.title });
  if (mru.length > 9) mru.length = 9;
};

function swRender() {
  if (!sw.el) {
    sw.el = document.createElement('div');
    sw.el.className = 'switcher';
    sw.el.setAttribute('role', 'listbox');
    sw.el.addEventListener('mousedown', (e) => {
      const row = e.target.closest('[data-i]');
      if (!row) return;
      e.preventDefault();
      sw.i = +row.dataset.i;
      swClose(true);
    });
    document.body.appendChild(sw.el);
  }
  sw.el.innerHTML = '<div class="sw-h">Recent <span>Ctrl + Tab</span></div>' + mru.map((e, i) =>
    `<div class="sw-row${i === sw.i ? ' on' : ''}" role="option" aria-selected="${i === sw.i}" data-i="${i}">
      ${svgIcon(e.kind === 'char' ? 'i-user' : 'i-doc')}<span>${escapeHtml(e.title)}</span>${i === 0 ? '<small>current</small>' : ''}</div>`).join('');
  sw.el.hidden = false;
}

function swClose(go) {
  if (!sw.open) return;
  sw.open = false;
  if (sw.el) sw.el.hidden = true;
  const t = go && sw.i > 0 ? mru[sw.i] : null;
  if (t) (t.kind === 'char' ? openCharacter(t.title) : openPage(t.title));
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && e.ctrlKey) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!sw.open) {
      if (mru.length < 2) { toast('Open a couple of pages first, then Ctrl + Tab flips between them.'); return; }
      sw.open = true;
      sw.i = e.shiftKey ? mru.length - 1 : 1;
    } else {
      sw.i = (sw.i + (e.shiftKey ? -1 : 1) + mru.length) % mru.length;
    }
    swRender();
  } else if (sw.open && e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    swClose(false);
  }
}, true);
document.addEventListener('keyup', (e) => { if (sw.open && e.key === 'Control') swClose(true); }, true);
window.addEventListener('blur', () => swClose(false));   // Ctrl released in another window
