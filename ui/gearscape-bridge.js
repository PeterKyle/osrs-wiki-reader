'use strict';
/* Runs inside the Gearscape frame (app.py registers it with WebView2, which runs it in every document; it does
   nothing anywhere else). The reader posts your imported bank in Bank Memory's format and this hands it to
   Gearscape's own "RuneLite > Bank Memory" import, so its best setup only picks gear you own. Gearscape's include
   list for gear and boosts is cleared first, so it matches your bank rather than piling up old items. */
(() => {
  if (location.hostname !== 'www.gearscape.net' || window.top === window) return;
  const reply = (msg) => window.parent.postMessage({ osrsReader: true, ...msg }, '*');

  // Gearscape's import dialog component (it's on the page from the start, just not shown)
  const findImporter = () => {
    const walk = (vm) => {
      if (vm.$options.methods && vm.$options.methods.importBankMemory) return vm;
      for (const c of vm.$children) { const hit = walk(c); if (hit) return hit; }
      return null;
    };
    return window.$nuxt ? walk(window.$nuxt.$root) : null;
  };
  // the import matches your items against Gearscape's equipment list, which loads after the page
  const ready = async () => {
    for (let i = 0; i < 120; i++) {
      const vm = findImporter();
      const data = window.$nuxt && window.$nuxt.$store.state.data;
      if (vm && data && data.equipment && Object.keys(data.equipment).length) return vm;
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  };

  window.addEventListener('message', async (e) => {
    if (e.source !== window.parent || !e.data || e.data.osrsReader !== 'bank') return;
    const vm = await ready();
    if (!vm) { reply({ type: 'bank-done', ok: false }); return; }
    const store = window.$nuxt.$store;
    store.commit('calculator/setSpecificWhitelist', { type: 'gear', list: [] });
    store.commit('calculator/setSpecificWhitelist', { type: 'boosts', list: [] });
    const overview = vm.downloadOverviewFile;
    vm.downloadOverviewFile = false;   // Gearscape would otherwise save a "Bank Memory - Overview.txt" file
    vm.importMode = 0;
    vm.loading = false;
    vm.bankMemoryExport = e.data.text;
    let ok = false;
    try { ok = await vm.importBankMemory(); } catch (err) { ok = false; }
    vm.downloadOverviewFile = overview;
    vm.bankMemoryExport = '';
    if (ok && e.data.first) {   // the first time only: show the include list and use only those items
      store.commit('calculator/setExcludeMode', 1);
      store.commit('calculator/setIncludeOnly', true);
    }
    const wl = store.state.calculator.whitelist;
    reply({ type: 'bank-done', ok: !!ok, gear: wl.gear.length, boosts: wl.boosts.length });
  });
})();
