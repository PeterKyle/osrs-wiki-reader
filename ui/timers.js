'use strict';
/* Farm run timers. Growth times (minutes) from the wiki's Seeds and Bird house trapping pages. */

const FARM_PRESETS = {
  Allotments: [['Potato / Onion / Cabbage / Tomato', 40], ['Sweetcorn / Strawberry', 60], ['Snape grass', 70], ['Watermelon', 80]],
  Trees: [['Oak', 160], ['Willow', 240], ['Maple', 320], ['Yew', 400], ['Magic', 480]],
  'Fruit trees': [['Fruit tree (any)', 960]],
  Hardwood: [['Teak', 4480], ['Mahogany / Camphor / Ironwood', 5120], ['Rosewood', 6400]],
  'Special trees': [['Calquat', 1280], ['Crystal tree', 480], ['Celastrus', 800], ['Spirit tree', 3840], ['Redwood', 6400]],
  Bushes: [['Redberry', 100], ['Cadavaberry', 120], ['Dwellberry', 140], ['Jangerberry / Whiteberry / Poison ivy', 160]],
  Hops: [['Barley / Hammerstone', 40], ['Asgarnian / Jute', 50], ['Yanillian / Flax', 60], ['Krandorian', 70], ['Wildblood / Hemp', 80], ['Cotton', 100]],
  Other: [['Grapes', 35], ['Mushroom', 240], ['Belladonna', 320], ['Cactus', 560], ['Potato cactus', 70], ['Coral', 160], ['Hespori', 1920], ['Anima', 5120]],
};
const QUICK_TIMERS = [['Herbs', 80], ['Birdhouses', 50], ['Allotments', 40], ['Flowers', 20], ['Giant seaweed', 40], ['Fruit trees', 960]];

function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

function renderTimers() {
  const list = state.timers || [];
  const box = $('timers');
  box.hidden = !list.length;
  box.innerHTML = list.map((t) => `
    <div class="trow" data-id="${t.id}">
      <span class="tlabel">${escapeHtml(t.label)}</span>
      <span class="tleft"></span>
      <button class="tbtn-s" data-act="restart" title="Restart (same duration)">${svgIcon('i-refresh')}</button>
      <button class="tbtn-s" data-act="remove" title="Remove">${svgIcon('i-x')}</button>
      <span class="tbar"><span></span></span>
    </div>`).join('');
  tickTimers();
}

function tickTimers() {
  const now = Date.now() / 1000;
  (state.timers || []).forEach((t) => {
    const row = els.home.querySelector(`.trow[data-id="${t.id}"]`);
    if (!row) return;
    const left = t.ends - now, total = t.minutes * 60;
    const done = left <= 0;
    row.classList.toggle('done', done);
    row.querySelector('.tleft').textContent = done ? 'Ready!' : fmtDuration(left);
    row.querySelector('.tbar > span').style.width = `${Math.min(100, Math.max(0, (1 - left / total) * 100))}%`;
  });
}
setInterval(() => { if (!els.home.hidden && (state.timers || []).length) tickTimers(); }, 1000);

window.onTimersDone = function (ids) {
  (state.timers || []).forEach((t) => { if (ids.includes(t.id)) t.notified = true; });
  ids.forEach((id) => {
    const t = (state.timers || []).find((x) => x.id === id);
    if (t) toast(`${t.label} ready!`);
  });
  if (!els.home.hidden) tickTimers();
};

async function startTimer(label, minutes) {
  state = await api.add_timer(label, minutes);
  $('timerAdd').hidden = true;
  renderTimers();
  toast(`Timer started: ${label}, ${fmtDuration(minutes * 60)}. You'll get a notification when it's done.`);
}

function buildTimerAdd() {
  $('timerQuick').innerHTML = QUICK_TIMERS.map(([n, m]) =>
    `<button class="chip" data-label="${escapeHtml(n)}" data-min="${m}">${escapeHtml(n)} <span class="dim">${fmtDuration(m * 60)}</span></button>`).join('');
  $('timerPreset').innerHTML = '<option value="">More patches…</option>' + Object.entries(FARM_PRESETS).map(([group, items]) =>
    `<optgroup label="${escapeHtml(group)}">${items.map(([n, m]) =>
      `<option value="${m}" data-label="${escapeHtml(n)}">${escapeHtml(n)} (${fmtDuration(m * 60)})</option>`).join('')}</optgroup>`).join('');
}

$('timerQuick').onclick = (e) => {
  const b = e.target.closest('.chip');
  if (b) startTimer(b.dataset.label, +b.dataset.min);
};
$('timerPreset').onchange = (e) => {
  const opt = e.target.selectedOptions[0];
  if (opt && opt.value) startTimer(opt.dataset.label, +opt.value);
  e.target.value = '';
};
$('timerCustom').onsubmit = (e) => {
  e.preventDefault();
  const mins = (+$('timerH').value || 0) * 60 + (+$('timerM').value || 0);
  if (mins <= 0) { toast('Enter how long the timer should run.'); return; }
  startTimer($('timerLabel').value.trim() || 'Timer', mins);
  $('timerLabel').value = ''; $('timerH').value = ''; $('timerM').value = '';
};
const toggleAdd = () => { $('timerAdd').hidden = !$('timerAdd').hidden; };
$('btnAddTimer').onclick = toggleAdd;
$('btnAddTimer2').onclick = toggleAdd;
$('timers').onclick = async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const id = +b.closest('.trow').dataset.id;
  state = b.dataset.act === 'remove' ? await api.remove_timer(id) : await api.restart_timer(id);
  renderTimers();
};
buildTimerAdd();
