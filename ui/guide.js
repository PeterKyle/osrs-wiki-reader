'use strict';
/* Quick guide: set-up steps, keyboard shortcuts and tips. Opens once on first launch, then from F1 or Settings. */

const guideModal = $('guideModal');

// Keys as arrays so "Ctrl" + "+" shows as two keys; the two global hotkeys come from your own settings.
function guideKeyRows() {
  const own = (label) => (label && label !== 'Off' ? label.split('+') : null);
  return [
    [own(state.hotkey), 'Show or hide the reader from anywhere, even in-game'],
    [own(state.askHotkey), 'Open the Wise Old Man from anywhere'],
    [['Ctrl', 'K'], 'Search the wiki (or just press /)'],
    [['Ctrl', 'F'], 'Find text on the page (Enter for the next match)'],
    [['Ctrl', 'N'], 'Start a new Wise Old Man chat'],
    [['Alt', '←'], 'Back (Alt + → goes forward; mouse side buttons work too)'],
    [['Ctrl', '+'], 'Bigger text (Ctrl + − smaller, Ctrl + 0 resets)'],
    [['Esc'], 'Close menus or the chat'],
    [['F1'], 'Open this guide'],
  ];
}

function renderGuideKeys() {
  $('guideKeys').innerHTML = guideKeyRows().map(([keys, what]) => `<tr>
    <td>${keys ? keys.map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join('<span class="plus">+</span>')
      : '<span class="dim">Off (set one in Settings)</span>'}</td>
    <td>${escapeHtml(what)}</td></tr>`).join('');
}

function setGuideStep(step, doneText) {
  const li = guideModal.querySelector(`[data-step="${step}"]`);
  li.classList.toggle('done', !!doneText);
  li.querySelector('.guide-done').textContent = doneText || '';
}

window.openGuide = async function () {
  closePops();
  renderGuideKeys();
  setGuideStep('char', state.me ? `Done: ${state.me}` : '');
  setGuideStep('ask', '');
  guideModal.hidden = false;
  $('guideDone').focus();
  try {
    const st = await api.gemini_status();
    setGuideStep('ask', st.hasKey ? 'Connected' : '');
  } catch (e) { /* leave the step as not done */ }
};

function closeGuide() {
  guideModal.hidden = true;
  if (!state.guideSeen) {   // shown once automatically; F1 / Settings open it after that
    state.guideSeen = true;
    api.set_pref('guide_seen', true);
  }
}

$('guideDone').onclick = closeGuide;
guideModal.addEventListener('mousedown', (e) => { if (e.target === guideModal) closeGuide(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !guideModal.hidden) { e.stopPropagation(); closeGuide(); }
}, true);
guideModal.querySelector('.guide-steps').addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (!go) return;
  closeGuide();
  if (go.dataset.go === 'char') openCharacter(state.me || null);
  else if (go.dataset.go === 'ask') openAsk();
  else if (go.dataset.go === 'hotkeys') $('btnSettings').click();
});
$('btnGuide').onclick = () => openGuide();
$('guideTour').onclick = () => { closeGuide(); startTour(); };
