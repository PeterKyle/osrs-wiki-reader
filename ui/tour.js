'use strict';
/* Guided tour: one step at a time. Each step opens the right screen, dims everything except what to click,
   and says what to do; steps that need you to do something move on by themselves once it's done.
   Starts by itself on first launch; "Take the tour" in the Quick guide (F1) runs it again. */

const tour = { i: -1, steps: [], raf: 0, timer: 0, rectKey: '', layer: null, card: null, dims: [], ring: null };

const tourOpen = (id) => { const el = $(id); return !!el && !el.hidden; };
const keysHtml = (label) => (label && label !== 'Off'
  ? label.split('+').map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join(' + ') : '<i>not set</i>');

function tourSteps(hadMe, hasKey) {
  const steps = [
    { title: 'Welcome to OSRS Wiki Reader',
      text: 'This short tour shows you around and gets you set up. It takes about a minute. You can leave any time with <kbd>Esc</kbd>.',
      next: 'Start the tour' },
    { target: '#searchWrap', prepare: () => { closePops(); closeAsk(); },
      title: 'Search the wiki',
      text: 'Type any quest, item, monster or skill here and pick a result. Press <kbd>Ctrl</kbd> + <kbd>K</kbd> to jump here any time.' },
    { target: '#btnChar', prepare: () => closePops(),
      title: 'Your account', text: 'Click the <b>person icon</b> to open the Character tab.',
      done: () => tourOpen('char') },
  ];
  if (!hadMe) {
    steps.push(
      { target: '#charForm', prepare: async () => { if (!tourOpen('char')) await openCharacter(null); },
        title: 'Look yourself up', text: 'Type your RuneScape name and press <b>Look up</b>.',
        done: () => !!$('btnMe') },
      { target: '#btnMe', prepare: async () => { if (!tourOpen('char')) await openCharacter(null); },
        title: 'Tell the app it’s you',
        text: 'Press <b>This is me</b>. Quest and skill pages will tick off what you meet, and the Wise Old Man will know your levels.',
        done: () => !!state.me });
  } else {
    steps.push({ target: '#btnMe', prepare: async () => { if (!$('btnMe')) await openCharacter(state.me); },
      title: 'Your account is set',
      text: `The app knows you’re <b>${escapeHtml(state.me)}</b>. Quest and skill pages tick off what you meet. Look up anyone else here too.` });
  }
  steps.push(
    { target: '#btnAsk', prepare: () => closePops(),
      title: 'Meet the Wise Old Man',
      text: 'He’s an AI helper that answers OSRS questions using the wiki and your levels. <b>Click him</b> to open the chat.',
      done: () => !chat.pop.hidden });
  if (!hasKey) {
    steps.push(
      { target: '#askStudio', prepare: () => { if (chat.pop.hidden) openAsk(); },
        title: 'Get a free key (1 minute)',
        text: 'Click <b>Open Google AI Studio</b>. Sign in with your Google account, click <b>Create API key</b>, check its tier says <b>Free</b>, then copy the key.' +
          '<span class="tour-warn"><b>Keep it free:</b> never click <b>Set up billing</b> or <b>Upgrade</b>, and never add a card.</span>',
        next: 'I have my key' },
      { target: '#askKeyForm', prepare: () => { if (chat.pop.hidden) openAsk(); },
        title: 'Paste your key', text: 'Paste the key into this box and press <b>Save</b>.',
        done: () => !$('askKeyForm') });
  }
  steps.push(
    { target: '#askForm', prepare: () => { if (chat.pop.hidden) openAsk(); },
      title: 'Ask anything',
      text: 'Type a question and press <kbd>Enter</kbd>. He sees the page you’re reading. Highlight text on any page and an <b>Ask about this</b> button appears.' },
    { target: '#askHistBtn, #askClear', prepare: () => { if (chat.pop.hidden) openAsk(); },
      title: 'Your chats',
      text: 'The clock shows your last 10 chats. The pencil (or <kbd>Ctrl</kbd> + <kbd>N</kbd>) starts a new one.' },
    { target: '#btnSettings', prepare: () => { closeAsk(); closePops(); },
      title: 'Settings', text: 'Click the <b>gear</b> to open Settings.',
      done: () => tourOpen('setPop') },
    { target: '#hkKey, #hkKeyAsk', prepare: () => { if (!tourOpen('setPop')) $('btnSettings').click(); },
      title: 'Hotkeys that work in-game',
      text: `${keysHtml(state.hotkey)} shows or hides the reader and ${keysHtml(state.askHotkey)} opens the Wise Old Man, from anywhere. ` +
        'If one clashes with your game, click it and press new keys.' },
    { target: '#btnPin, #btnMini', prepare: () => closePops(),
      title: 'Keep it handy',
      text: 'The <b>pin</b> keeps the reader above your game. <b>Mini mode</b> shrinks it to a small search bar.' },
    { title: 'You’re all set!',
      text: 'Press <kbd>F1</kbd> any time for the shortcuts and tips, or to take this tour again.',
      next: 'Finish', extra: ['Show shortcuts', () => openGuide()] });
  return steps;
}

function tourBuild() {
  const layer = document.createElement('div');
  layer.className = 'tour-layer';
  layer.innerHTML = '<div class="tour-dim"></div><div class="tour-dim"></div><div class="tour-dim"></div><div class="tour-dim"></div>' +
    '<div class="tour-ring"></div><div class="tour-card" role="dialog" aria-modal="true" aria-live="polite"></div>';
  document.body.appendChild(layer);
  tour.layer = layer;
  tour.dims = [...layer.querySelectorAll('.tour-dim')];
  tour.ring = layer.querySelector('.tour-ring');
  tour.card = layer.querySelector('.tour-card');
  tour.card.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.t === 'next') tourGo(tour.i + 1);
    else if (b.dataset.t === 'back') tourGo(tour.i - 1);
    else if (b.dataset.t === 'exit') endTour();
    else if (b.dataset.t === 'extra') { const fn = tour.steps[tour.i].extra[1]; endTour(); fn(); }
  });
}

function tourCard(step) {
  const n = tour.steps.length, i = tour.i;
  const counted = i > 0 && i < n - 1;   // welcome and finish aren't numbered
  tour.card.innerHTML = `
    <div class="tour-top">${counted ? `<span>Step ${i} of ${n - 2}</span>` : '<span></span>'}
      <button class="fbtn tour-x" data-t="exit" title="Leave the tour (Esc)">${svgIcon('i-close')}</button></div>
    <h3>${step.title}</h3><p>${step.text}</p>
    ${step.done ? '<div class="tour-wait"><i></i>Do it in the highlighted spot and the tour moves on by itself.</div>' : ''}
    <div class="tour-actions">
      ${i > 0 && i < n - 1 ? '<button class="btn small" data-t="back">Back</button>' : '<span></span>'}
      <div>${step.extra ? `<button class="btn small" data-t="extra">${step.extra[0]}</button>` : ''}
        <button class="btn ${step.done ? 'small' : ''}" data-t="next">${step.next || (step.done ? 'Skip this step' : 'Next')}</button></div>
    </div>`;
  tour.rectKey = '';
}

function tourRect(sel) {
  const rects = [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height);
  if (!rects.length) return null;
  return rects.reduce((a, b) => ({ left: Math.min(a.left, b.left), top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) }));
}

// Keeps the spotlight and the card on the target, even while the layout moves (pages load, panels open).
function tourPlace() {
  const step = tour.steps[tour.i];
  const r = step.target ? tourRect(step.target) : null;
  const W = innerWidth, H = innerHeight;
  const key = r ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)},${W},${H}` : `c${W},${H}`;
  if (key === tour.rectKey) return;
  tour.rectKey = key;
  const [d1, d2, d3, d4] = tour.dims;
  const set = (el, l, t, w, h) => Object.assign(el.style, { left: l + 'px', top: t + 'px', width: Math.max(0, w) + 'px', height: Math.max(0, h) + 'px' });
  const card = tour.card, cw = card.offsetWidth, ch = card.offsetHeight, gap = 14, m = 12;
  if (!r) {   // nothing to point at: dim everything, card in the middle
    set(d1, 0, 0, W, H); [d2, d3, d4].forEach((d) => set(d, 0, 0, 0, 0));
    tour.ring.style.opacity = '0';
    card.style.left = Math.round((W - cw) / 2) + 'px';
    card.style.top = Math.round((H - ch) / 2) + 'px';
    return;
  }
  const p = 6, L = Math.max(0, r.left - p), T = Math.max(0, r.top - p), R = Math.min(W, r.right + p), B = Math.min(H, r.bottom + p);
  set(d1, 0, 0, W, T); set(d2, 0, B, W, H - B); set(d3, 0, T, L, B - T); set(d4, R, T, W - R, B - T);
  set(tour.ring, L, T, R - L, B - T);
  tour.ring.style.opacity = '1';
  // card: below the target if it fits, else above, else beside it; always kept on screen
  let top, left = (L + R) / 2 - cw / 2;
  if (B + gap + ch <= H - m) top = B + gap;
  else if (T - gap - ch >= m) top = T - gap - ch;
  else {
    top = (T + B) / 2 - ch / 2;
    left = R + gap + cw <= W - m ? R + gap : L - gap - cw;
  }
  card.style.left = Math.round(Math.max(m, Math.min(left, W - cw - m))) + 'px';
  card.style.top = Math.round(Math.max(m, Math.min(top, H - ch - m))) + 'px';
}

function tourLoop() {
  if (tour.i < 0) return;
  tourPlace();
  tour.raf = requestAnimationFrame(tourLoop);
}

// Did the player do what the step asked? Then on to the next one. (A timer, not the frame loop, so it keeps
// working even if the page's frames are throttled.)
function tourCheck() {
  if (tour.i >= 0) tourPlace();   // also keeps the spotlight right if the frame loop is throttled
  const step = tour.i >= 0 && tour.steps[tour.i];
  if (step && step.done && !tour.going) {
    try { if (step.done()) tourGo(tour.i + 1); } catch (e) { /* keep waiting */ }
  }
}

async function tourGo(i) {
  if (i >= tour.steps.length) { endTour(); return; }
  if (i < 0) return;
  tour.i = i;
  const step = tour.steps[i];
  tourCard(step);
  tour.card.classList.add('moving');
  tour.going = true;   // don't check "done" while the step is still opening its screen
  try { if (step.prepare) await step.prepare(); } catch (e) { /* show the step anyway */ }
  tour.going = false;
  if (tour.i !== i) return;   // moved on meanwhile
  tourPlace();                // place it now; the frame loop then keeps it on the target as the layout moves
  setTimeout(() => tour.card && tour.card.classList.remove('moving'), 60);
  const next = tour.card.querySelector('[data-t="next"]');
  if (next) next.focus({ preventScroll: true });
}
window.tourGo = tourGo;

window.startTour = async function () {
  if (tour.i >= 0) endTour();
  if (isMini()) await setMini(false);
  if (!$('guideModal').hidden) closeGuide();
  let hasKey = false;
  try { hasKey = !!(await api.gemini_status()).hasKey; } catch (e) { /* treat as not connected */ }
  tour.steps = tourSteps(!!state.me, hasKey);
  tourBuild();
  tour.raf = requestAnimationFrame(tourLoop);
  tour.timer = setInterval(tourCheck, 250);
  tourGo(0);
};

function endTour() {
  if (tour.i < 0) return;
  tour.i = -1;
  cancelAnimationFrame(tour.raf);
  clearInterval(tour.timer);
  if (tour.layer) tour.layer.remove();
  tour.layer = tour.card = tour.ring = null;
  if (!state.guideSeen) {   // runs by itself only once
    state.guideSeen = true;
    api.set_pref('guide_seen', true);
  }
}

document.addEventListener('keydown', (e) => {
  if (tour.i >= 0 && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); endTour(); }
}, true);
