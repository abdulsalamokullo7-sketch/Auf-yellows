/**
 * AUF'S YELLOWS — Banana business tracker
 * Pure vanilla JS + localStorage. No build step.
 */

(function () {
  'use strict';

  /** Primary + identical backup — survives bad writes / partial corruption; both persist on device across reboots */
  const STORAGE_KEY = 'auf_yellows_data';
  const STORAGE_BACKUP_KEY = 'auf_yellows_data_backup';
  const STORAGE_META_KEY = 'auf_yellows_meta';
  const PIN_STORAGE_KEY = 'auf_yellows_pin';
  const DARK_KEY = 'auf_yellows_dark';
  const SESSION_UNLOCK_KEY = 'auf_yellows_unlocked';
  const DEFAULT_PIN = null; /* No default — user creates their own on first launch */

  /** Allowed expected prices per cluster (UGX) — dropdowns only */
  const CLUSTER_PRICE_OPTIONS = [5000, 4500, 4000, 3500, 3000, 2500, 2000];

  /** @typedef {{ qty: number, pricePerCluster: number }} SaleLine */
  /** @typedef {{ qty: number, reason: string }} SpoilLine */
  /** @typedef {{ price: number, count: number }} ClusterTier */

  /**
   * @typedef {Object} Bunch
   * @property {string} id
   * @property {string} name User label (e.g. Big bunch, Small)
   * @property {string} date ISO date (yyyy-mm-dd)
   * @property {number} cost UGX capital / purchase per bunch
   * @property {number} paidWorker UGX labor per bunch
   * @property {number} transport UGX transport per bunch
   * @property {number} clustersTotal
   * @property {ClusterTier[]} clusterTiers counts per price tier (sum must equal clustersTotal)
   * @property {SaleLine[]} sales
   * @property {SpoilLine[]} spoilageRecords
   */

  /** @type {{ bunches: Bunch[] }} */
  let state = { bunches: [] };

  /** App event listeners attached once after PIN unlock */
  let appInitialized = false;

  // --- DOM refs (PIN elements are grabbed in bootPinScreen) ---
  const el = {
    appShell: document.getElementById('app-shell'),
    dashboardCards: document.getElementById('dashboard-cards'),
    bunchList: document.getElementById('bunch-list'),
    bunchEmpty: document.getElementById('bunch-empty'),
    sectionDetails: document.getElementById('section-details'),
    detailsContent: document.getElementById('details-content'),
    sectionDashboard: document.getElementById('section-dashboard'),
    sectionBunches: document.getElementById('section-bunches'),
    btnBackList: document.getElementById('btn-back-list'),
    btnOpenAddBunch: document.getElementById('btn-open-add-bunch'),
    btnDarkMode: document.getElementById('btn-dark-mode'),
    btnResetData: document.getElementById('btn-reset-data'),
    toastHost: document.getElementById('toast-host'),
    modalAddBunch: document.getElementById('modal-add-bunch'),
    formAddBunch: document.getElementById('form-add-bunch'),
    addDate: document.getElementById('add-date'),
    modalAddClose: document.getElementById('modal-add-close'),
    btnCancelAdd: document.getElementById('btn-cancel-add'),
    modalExpenses: document.getElementById('modal-expenses'),
    formExpenses: document.getElementById('form-expenses'),
    expensesBunchId: document.getElementById('expenses-bunch-id'),
    expensesName: document.getElementById('expenses-name'),
    expensesCapital: document.getElementById('expenses-capital'),
    expensesWorker: document.getElementById('expenses-worker'),
    expensesTransport: document.getElementById('expenses-transport'),
    modalExpensesClose: document.getElementById('modal-expenses-close'),
    btnCancelExpenses: document.getElementById('btn-cancel-expenses'),
    modalCluster: document.getElementById('modal-cluster'),
    formCluster: document.getElementById('form-cluster'),
    clusterBunchId: document.getElementById('cluster-bunch-id'),
    clusterTotal: document.getElementById('cluster-total'),
    clusterTiersRows: document.getElementById('cluster-tiers-rows'),
    clusterTiersHint: document.getElementById('cluster-tiers-hint'),
    btnAddTier: document.getElementById('btn-add-tier'),
    clusterPreview: document.getElementById('cluster-preview'),
    modalClusterClose: document.getElementById('modal-cluster-close'),
    btnCancelCluster: document.getElementById('btn-cancel-cluster'),
    bottomNav: document.getElementById('bottom-nav'),
    navTabHome: document.getElementById('nav-tab-home'),
    navTabBunches: document.getElementById('nav-tab-bunches'),
    navTabAdd: document.getElementById('nav-tab-add'),
    modalSale: document.getElementById('modal-sale'),
    formSale: document.getElementById('form-sale'),
    saleBunchId: document.getElementById('sale-bunch-id'),
    saleBunchLabel: document.getElementById('sale-bunch-label'),
    saleTierRows: document.getElementById('sale-tier-rows'),
    saleSummary: document.getElementById('sale-summary'),
    modalSaleClose: document.getElementById('modal-sale-close'),
    btnCancelSale: document.getElementById('btn-cancel-sale'),
    modalSpoil: document.getElementById('modal-spoil'),
    formSpoil: document.getElementById('form-spoil'),
    spoilBunchId: document.getElementById('spoil-bunch-id'),
    spoilQty: document.getElementById('spoil-qty'),
    spoilReason: document.getElementById('spoil-reason'),
    modalSpoilClose: document.getElementById('modal-spoil-close'),
    btnCancelSpoil: document.getElementById('btn-cancel-spoil'),
    modalReset: document.getElementById('modal-reset'),
    btnResetCancel: document.getElementById('btn-reset-cancel'),
    btnResetConfirm: document.getElementById('btn-reset-confirm'),
  };

  /** Current bunch id when viewing details (string | null) */
  let activeDetailId = null;

  // --- Persistence (localStorage = on-device, survives refresh & power-off unless user clears site data) ---
  function parseStateFromRaw(raw) {
    if (raw == null || typeof raw !== 'string' || raw === '') return null;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.bunches)) return null;
    const bunches = [];
    for (let i = 0; i < parsed.bunches.length; i++) {
      try {
        bunches.push(normalizeBunch(parsed.bunches[i]));
      } catch {
        /* skip one bad record; keep the rest */
      }
    }
    return { bunches };
  }

  function loadState() {
    state = { bunches: [] };

    const tryLoad = (key) => {
      try {
        const raw = localStorage.getItem(key);
        const next = parseStateFromRaw(raw);
        return next;
      } catch {
        return null;
      }
    };

    let from = tryLoad(STORAGE_KEY);
    if (from) {
      state = from;
      return;
    }

    from = tryLoad(STORAGE_BACKUP_KEY);
    if (from) {
      state = from;
      /* Repair primary from good backup */
      persistStateToDisk(false);
      return;
    }
  }

  /**
   * Writes state to disk. Dual-write: same JSON to primary + backup so one bad write can be recovered.
   * @param {boolean} showToastOnFail — if true, notify user when storage is full / blocked
   */
  function persistStateToDisk(showToastOnFail) {
    let payload;
    try {
      payload = JSON.stringify(state);
    } catch (e) {
      console.warn('AUF: could not stringify state', e);
      if (showToastOnFail) toast('Could not save data.');
      return false;
    }

    try {
      localStorage.setItem(STORAGE_KEY, payload);
      localStorage.setItem(STORAGE_BACKUP_KEY, payload);
      try {
        localStorage.setItem(STORAGE_META_KEY, JSON.stringify({ savedAt: Date.now(), v: 1 }));
      } catch {}

      /* Read-back verification: confirm what we wrote is actually stored */
      const check = localStorage.getItem(STORAGE_KEY);
      if (check !== payload) {
        console.warn('AUF: read-back mismatch on primary key');
        if (showToastOnFail) toast('Warning: data may not have saved correctly.');
        return false;
      }
      return true;
    } catch (e) {
      try { localStorage.setItem(STORAGE_KEY, payload); } catch (_) {}
      try { localStorage.setItem(STORAGE_BACKUP_KEY, payload); } catch (_) {}
      console.warn('AUF: localStorage write failed', e);
      if (showToastOnFail) toast('Storage full or blocked — free space or check browser settings.');
      return false;
    }
  }

  function saveState() {
    persistStateToDisk(false);
  }

  /** Flush when app goes to background / tab closes — extra safety for last in-memory state */
  function flushStateToStorage() {
    persistStateToDisk(false);
  }

  function initStorageLifecycle() {
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState === 'hidden') flushStateToStorage();
      },
      false
    );
    window.addEventListener('pagehide', flushStateToStorage, false);
    window.addEventListener('beforeunload', flushStateToStorage, false);
  }

  /** False in some private modes or when storage is disabled */
  function probeLocalStorage() {
    try {
      const k = '__auf_ls_probe__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  }

  /** Ensure arrays exist; migrate legacy single pricePerCluster to clusterTiers */
  function normalizeBunch(b) {
    const sales = Array.isArray(b.sales) ? b.sales.map(sanitizeSale) : [];
    const spoilageRecords = Array.isArray(b.spoilageRecords) ? b.spoilageRecords.map(sanitizeSpoil) : [];
    const sold = sales.reduce((a, s) => a + s.qty, 0);
    const spoiled = spoilageRecords.reduce((a, s) => a + s.qty, 0);
    const minClusters = sold + spoiled;

    let clustersTotal = Math.max(0, Math.floor(num(b.clustersTotal)));
    let clusterTiers = [];

    if (Array.isArray(b.clusterTiers) && b.clusterTiers.length) {
      clusterTiers = mergeTiersByPrice(b.clusterTiers.map(sanitizeClusterTier));
    } else if (clustersTotal > 0 && num(b.pricePerCluster) > 0) {
      clusterTiers = [{ price: nearestAllowedPrice(num(b.pricePerCluster)), count: clustersTotal }];
    }

    const tierSum = tierListCount(clusterTiers);
    clustersTotal = Math.max(clustersTotal, minClusters, tierSum);

    return {
      id: String(b.id || generateId()),
      name: sanitizeBunchName(b.name),
      date: typeof b.date === 'string' ? b.date : todayISO(),
      cost: num(b.cost),
      paidWorker: Math.max(0, num(b.paidWorker)),
      transport: Math.max(0, num(b.transport)),
      clustersTotal,
      clusterTiers,
      sales,
      spoilageRecords,
    };
  }

  /** Total money in per bunch (capital + worker + transport) */
  function totalCost(b) {
    return num(b.cost) + num(b.paidWorker) + num(b.transport);
  }

  function sanitizeSale(s) {
    return {
      qty: Math.max(0, Math.floor(num(s.qty))),
      pricePerCluster: Math.max(0, num(s.pricePerCluster)),
    };
  }

  function sanitizeSpoil(s) {
    return {
      qty: Math.max(0, Math.floor(num(s.qty))),
      reason: typeof s.reason === 'string' ? s.reason.slice(0, 200) : '',
    };
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function sanitizeBunchName(s) {
    return String(s ?? '')
      .trim()
      .slice(0, 80);
  }

  /** @param {Bunch} b */
  function displayBunchName(b) {
    const n = sanitizeBunchName(b.name);
    return n || 'Unnamed bunch';
  }

  function generateId() {
    return 'b_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }

  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatMoney(n) {
    return num(n).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' UGX';
  }

  function isAllowedPrice(p) {
    return CLUSTER_PRICE_OPTIONS.includes(Number(p));
  }

  function nearestAllowedPrice(p) {
    const n = num(p);
    if (CLUSTER_PRICE_OPTIONS.includes(n)) return n;
    return CLUSTER_PRICE_OPTIONS.reduce(
      (best, opt) => (Math.abs(opt - n) < Math.abs(best - n) ? opt : best),
      CLUSTER_PRICE_OPTIONS[0]
    );
  }

  /** @returns {ClusterTier} */
  function sanitizeClusterTier(t) {
    const price = isAllowedPrice(t.price) ? Number(t.price) : CLUSTER_PRICE_OPTIONS[0];
    return { price, count: Math.max(0, Math.floor(num(t.count))) };
  }

  /** Merge rows that share the same price */
  function mergeTiersByPrice(tiers) {
    const map = new Map();
    for (const t of tiers) {
      if (t.count <= 0) continue;
      if (!isAllowedPrice(t.price)) continue;
      const p = t.price;
      map.set(p, (map.get(p) || 0) + t.count);
    }
    return CLUSTER_PRICE_OPTIONS.filter((p) => map.has(p)).map((p) => ({ price: p, count: map.get(p) }));
  }

  function tierListCount(tiers) {
    if (!tiers || !tiers.length) return 0;
    return tiers.reduce((a, t) => a + t.count, 0);
  }

  // --- Derived metrics per bunch ---
  function soldClusters(b) {
    return b.sales.reduce((a, s) => a + s.qty, 0);
  }

  function spoiledClusters(b) {
    return b.spoilageRecords.reduce((a, s) => a + s.qty, 0);
  }

  /** Sold count at a given price tier (matches sales lines) */
  function soldAtPrice(b, price) {
    const p = num(price);
    return b.sales.reduce((a, s) => a + (num(s.pricePerCluster) === p ? s.qty : 0), 0);
  }

  /** Spoilage split across tiers (same proportions as tier counts; remainder to highest-price tiers) */
  function spoilByTierMap(b) {
    const m = new Map();
    if (!b.clusterTiers || !b.clusterTiers.length || b.clustersTotal <= 0) return m;
    const spoiled = spoiledClusters(b);
    b.clusterTiers.forEach((t) => {
      m.set(t.price, Math.floor((spoiled * t.count) / b.clustersTotal));
    });
    let total = 0;
    m.forEach((v) => {
      total += v;
    });
    let rem = spoiled - total;
    const sorted = [...b.clusterTiers].sort((a, c) => c.price - a.price);
    for (let i = 0; rem > 0 && i < sorted.length; i++) {
      const p = sorted[i].price;
      m.set(p, m.get(p) + 1);
      rem--;
    }
    return m;
  }

  /** Clusters still sellable at this price (tier minus sold minus allocated spoil) */
  function remainingAtTier(b, price) {
    const tier = b.clusterTiers.find((t) => t.price === price);
    if (!tier) return 0;
    const sold = soldAtPrice(b, price);
    const spoil = spoilByTierMap(b).get(price) || 0;
    return Math.max(0, tier.count - sold - spoil);
  }

  /** Map price -> remaining for validation */
  function getRemainingPerTierMap(b) {
    const map = new Map();
    if (!b.clusterTiers) return map;
    b.clusterTiers.forEach((t) => {
      map.set(t.price, remainingAtTier(b, t.price));
    });
    return map;
  }

  function revenue(b) {
    return b.sales.reduce((a, s) => a + s.qty * s.pricePerCluster, 0);
  }

  /** Weighted average expected price (for spoilage loss when tier is unknown) */
  function averageClusterPrice(b) {
    if (b.clustersTotal <= 0) return 0;
    const er = expectedRevenue(b);
    if (er <= 0) return 0;
    return er / b.clustersTotal;
  }

  /** loss_value ≈ spoiled × weighted average cluster price */
  function lossValue(b) {
    return spoiledClusters(b) * averageClusterPrice(b);
  }

  function remainingClusters(b) {
    return Math.max(0, b.clustersTotal - soldClusters(b) - spoiledClusters(b));
  }

  function profit(b) {
    return revenue(b) - totalCost(b);
  }

  function expectedRevenue(b) {
    if (b.clusterTiers && b.clusterTiers.length) {
      return b.clusterTiers.reduce((a, t) => a + t.count * t.price, 0);
    }
    return 0;
  }

  function expectedProfit(b) {
    return expectedRevenue(b) - totalCost(b);
  }

  function spoilageRatio(b) {
    if (b.clustersTotal <= 0) return 0;
    return spoiledClusters(b) / b.clustersTotal;
  }

  // --- Aggregates ---
  function computeDashboard() {
    let totalCapital = 0;
    let totalRevenue = 0;
    let totalSpoilLoss = 0;
    let totalRemaining = 0;

    state.bunches.forEach((b) => {
      totalCapital += totalCost(b);
      totalRevenue += revenue(b);
      totalSpoilLoss += lossValue(b);
      totalRemaining += remainingClusters(b);
    });

    const netProfit = totalRevenue - totalCapital;

    return {
      totalCapital,
      totalRevenue,
      totalSpoilLoss,
      netProfit,
      totalRemaining,
    };
  }

  // --- PIN ---
  function normalizePin(s) {
    return String(s ?? '')
      .trim()
      .replace(/\u200e|\u200f/g, '');
  }

  function hasStoredPin() {
    try {
      const raw = localStorage.getItem(PIN_STORAGE_KEY);
      return raw != null && normalizePin(raw).length >= 4;
    } catch {
      return false;
    }
  }

  function getStoredPin() {
    try {
      const raw = localStorage.getItem(PIN_STORAGE_KEY);
      if (raw != null && normalizePin(raw).length >= 4) return normalizePin(raw);
    } catch {}
    return null;
  }

  function setStoredPin(pin) {
    try {
      localStorage.setItem(PIN_STORAGE_KEY, normalizePin(pin));
    } catch {}
  }

  function isSessionUnlocked() {
    try {
      return sessionStorage.getItem(SESSION_UNLOCK_KEY) === '1';
    } catch {
      return false;
    }
  }

  function setSessionUnlocked() {
    try {
      sessionStorage.setItem(SESSION_UNLOCK_KEY, '1');
    } catch {}
  }

  // --- Dark mode ---
  function applyDarkMode(on) {
    document.body.classList.toggle('dark', on);
    el.btnDarkMode.textContent = on ? '☀️' : '🌙';
    localStorage.setItem(DARK_KEY, on ? '1' : '0');
  }

  function loadDarkMode() {
    applyDarkMode(localStorage.getItem(DARK_KEY) === '1');
  }

  // --- Toast ---
  function toast(message) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = message;
    el.toastHost.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transition = 'opacity 0.3s ease';
      setTimeout(() => t.remove(), 350);
    }, 2600);
  }

  // --- Modals ---
  function openModal(modalEl) {
    modalEl.hidden = false;
    /* Prevent background scroll while modal is open */
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }

  function closeModal(modalEl) {
    modalEl.hidden = true;
    /* Restore scroll if no other modals are open */
    const anyOpen = [
      el.modalAddBunch, el.modalCluster, el.modalSale,
      el.modalSpoil, el.modalReset, el.modalExpenses,
    ].some((m) => m && !m.hidden);
    if (!anyOpen) {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
  }

  function closeAllModals() {
    [
      el.modalAddBunch,
      el.modalCluster,
      el.modalSale,
      el.modalSpoil,
      el.modalReset,
      el.modalExpenses,
    ].forEach(closeModal);
  }

  // --- CRUD ---
  function addBunches(dateStr, costPerBunch, paidWorkerPerBunch, transportPerBunch, numberOfBunches, bunchName) {
    const n = Math.max(1, Math.floor(num(numberOfBunches)));
    const cost = Math.max(0, num(costPerBunch));
    const paidWorker = Math.max(0, num(paidWorkerPerBunch));
    const transport = Math.max(0, num(transportPerBunch));
    const date = dateStr || todayISO();
    const baseName = sanitizeBunchName(bunchName);

    for (let i = 0; i < n; i++) {
      const name =
        n > 1 && baseName ? `${baseName} #${i + 1}` : baseName;
      state.bunches.push({
        id: generateId(),
        name,
        date,
        cost,
        paidWorker,
        transport,
        clustersTotal: 0,
        clusterTiers: [],
        sales: [],
        spoilageRecords: [],
      });
    }
    saveState();
    renderAll();
    toast(n === 1 ? 'Bunch added' : `${n} bunches added`);
  }

  function findBunch(id) {
    return state.bunches.find((b) => b.id === id);
  }

  /**
   * @param {string} id
   * @param {string|number} clustersTotalInput
   * @param {ClusterTier[]} tiers merged tiers; sum(count) must equal clusters total
   */
  function updateClusterInfo(id, clustersTotalInput, tiers) {
    const b = findBunch(id);
    if (!b) return false;

    const sold = soldClusters(b);
    const spoiled = spoiledClusters(b);
    const total = Math.max(0, Math.floor(num(clustersTotalInput)));
    const merged = mergeTiersByPrice(Array.isArray(tiers) ? tiers.map(sanitizeClusterTier) : []);
    const tierSum = tierListCount(merged);

    if (total < sold + spoiled) {
      toast('Total clusters cannot be less than sold + spoiled.');
      return false;
    }

    if (tierSum !== total) {
      toast(`Allocated clusters (${tierSum}) must equal total (${total}).`);
      return false;
    }

    b.clustersTotal = total;
    b.clusterTiers = merged;
    saveState();
    renderAll();
    toast('Cluster info updated');
    return true;
  }

  /**
   * Record one transaction: multiple lines { qty, price } at allowed tiers.
   * @param {{ qty: number, price: number }[]} lines
   */
  function addSaleTiers(id, lines) {
    const b = findBunch(id);
    if (!b) return false;

    const remaining = getRemainingPerTierMap(b);
    const toPush = [];

    for (let i = 0; i < lines.length; i++) {
      const q = Math.max(0, Math.floor(num(lines[i].qty)));
      const price = num(lines[i].price);
      if (q <= 0) continue;
      if (!isAllowedPrice(price)) continue;
      const rem = remaining.get(price) ?? 0;
      if (q > rem) {
        toast(`Only ${rem} cluster(s) left at ${price.toLocaleString('en-US')} UGX.`);
        return false;
      }
      remaining.set(price, rem - q);
      toPush.push({ qty: q, pricePerCluster: price });
    }

    if (toPush.length === 0) {
      toast('Enter how many to sell at each price, or tap +1.');
      return false;
    }

    toPush.forEach((line) => b.sales.push(line));
    saveState();
    renderAll();
    toast('Sale recorded');
    return true;
  }

  function addSpoilage(id, qty, reason) {
    const b = findBunch(id);
    if (!b) return;

    const q = Math.max(1, Math.floor(num(qty)));
    const rem = b.clustersTotal - soldClusters(b) - spoiledClusters(b);

    if (q > rem) {
      toast(`Only ${rem} cluster(s) can be marked spoiled.`);
      return;
    }

    b.spoilageRecords.push({
      qty: q,
      reason: typeof reason === 'string' ? reason.trim().slice(0, 200) : '',
    });
    saveState();
    renderAll();
    toast('Spoilage added');
  }

  function resetAllData() {
    state = { bunches: [] };
    try {
      localStorage.removeItem(STORAGE_META_KEY);
    } catch (_) {}
    saveState();
    activeDetailId = null;
    closeModal(el.modalReset);
    showListView();
    renderAll();
    toast('All data cleared');
  }

  // --- Tab navigation ---
  /** @param {'home'|'bunches'|'details'} tab */
  function activateTab(tab) {
    el.sectionDashboard.hidden = tab !== 'home';
    el.sectionBunches.hidden   = tab !== 'bunches';
    el.sectionDetails.hidden   = tab !== 'details';
    if (el.navTabHome)    el.navTabHome.classList.toggle('is-active',    tab === 'home');
    if (el.navTabBunches) el.navTabBunches.classList.toggle('is-active', tab === 'bunches');
    window.scrollTo(0, 0);
  }

  // --- Views ---
  function showListView() {
    activeDetailId = null;
    activateTab('bunches');
  }

  function showHomeView() {
    activeDetailId = null;
    activateTab('home');
  }

  function showDetailView(id) {
    activeDetailId = id;
    activateTab('details');
    renderDetails(id);
  }

  // --- Render ---
  function renderDashboard() {
    const d = computeDashboard();
    const cards = [
      { label: 'Total invested', value: formatMoney(d.totalCapital), className: '' },
      { label: 'Total revenue', value: formatMoney(d.totalRevenue), className: '' },
      { label: 'Total spoilage loss', value: formatMoney(d.totalSpoilLoss), className: 'loss' },
      { label: 'Net profit', value: formatMoney(d.netProfit), className: d.netProfit >= 0 ? 'profit' : 'loss' },
      { label: 'Clusters remaining', value: String(d.totalRemaining), className: '', accent: true },
    ];

    el.dashboardCards.innerHTML = cards
      .map(
        (c) => `
      <article class="dash-card ${c.accent ? 'accent' : ''}">
        <p class="dash-label">${escapeHtml(c.label)}</p>
        <p class="dash-value ${c.className}">${escapeHtml(c.value)}</p>
      </article>`
      )
      .join('');
  }

  function renderBunchList() {
    if (state.bunches.length === 0) {
      el.bunchList.innerHTML = '';
      el.bunchEmpty.hidden = false;
      return;
    }

    el.bunchEmpty.hidden = true;
    el.bunchList.innerHTML = state.bunches
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .map((b) => bunchCardHtml(b))
      .join('');

    el.bunchList.querySelectorAll('[data-action="details"]').forEach((btn) => {
      btn.addEventListener('click', () => showDetailView(btn.getAttribute('data-id')));
    });
  }

  function bunchCardHtml(b) {
    const p = profit(b);
    const pClass = p >= 0 ? 'profit' : 'loss';
    const profitSign = p > 0 ? '+' : '';
    const highSpoil = spoilageRatio(b) > 0.2 && b.clustersTotal > 0;
    const sold = soldClusters(b);
    const spoiled = spoiledClusters(b);
    const rem = remainingClusters(b);
    const total = b.clustersTotal;

    let progressHtml = '';
    if (total > 0) {
      const soldPct = Math.min(100, (sold / total) * 100).toFixed(1);
      const spoilPct = Math.min(100 - parseFloat(soldPct), (spoiled / total) * 100).toFixed(1);
      progressHtml = `<div class="bc-progress" role="presentation">
        <div class="bc-progress-sold" style="width:${soldPct}%"></div>
        <div class="bc-progress-spoiled" style="width:${spoilPct}%"></div>
      </div>`;
    }

    return `
      <article class="bunch-card card">
        <div class="bc-header">
          <div>
            <p class="bc-name">${escapeHtml(displayBunchName(b))}</p>
            <p class="bc-date">${escapeHtml(b.date)}</p>
          </div>
          <span class="bc-profit-chip ${pClass}">${profitSign}${formatMoney(p)}</span>
        </div>
        ${highSpoil ? '<div class="bc-spoil-badge">⚠ High spoilage</div>' : ''}
        <div class="bc-stats-row">
          <div class="bc-stat">
            <strong>${total}</strong>
            <span>Total</span>
          </div>
          <div class="bc-stat">
            <strong>${sold}</strong>
            <span>Sold</span>
          </div>
          <div class="bc-stat${spoiled > 0 ? ' warn' : ''}">
            <strong>${spoiled}</strong>
            <span>Spoiled</span>
          </div>
          <div class="bc-stat">
            <strong${rem > 0 ? ' class="accent"' : ''}>${rem}</strong>
            <span>Left</span>
          </div>
        </div>
        ${progressHtml}
        <button type="button" class="btn btn-primary bc-btn" data-action="details" data-id="${escapeAttr(b.id)}">
          View details
        </button>
      </article>`;
  }


  function renderDetails(id) {
    const b = findBunch(id);
    if (!b) {
      showListView();
      renderAll();
      return;
    }

    const rev      = revenue(b);
    const p        = profit(b);
    const expRev   = expectedRevenue(b);
    const expProf  = expectedProfit(b);
    const sold     = soldClusters(b);
    const spoiled  = spoiledClusters(b);
    const rem      = remainingClusters(b);
    const spoilPct = spoilageRatio(b) * 100;
    const highSpoil = spoilageRatio(b) > 0.2 && b.clustersTotal > 0;
    const pClass    = p >= 0 ? 'profit' : 'loss';
    const profitSign = p > 0 ? '+' : '';

    /* Cluster tier rows */
    let tiersHtml = '';
    if (b.clusterTiers && b.clusterTiers.length) {
      tiersHtml = b.clusterTiers
        .map((t) => {
          const remT   = remainingAtTier(b, t.price);
          const soldT  = soldAtPrice(b, t.price);
          const soldPct = t.count > 0 ? Math.min(100, (soldT / t.count) * 100).toFixed(1) : 0;
          return `<div class="dct-row">
            <div class="dct-top">
              <span class="dct-price">${escapeHtml(formatMoney(t.price))}</span>
              <div class="dct-info">
                <span class="dct-total">${t.count} clusters</span>
                <span class="dct-rem ${remT > 0 ? 'has-stock' : 'no-stock'}">${remT} left</span>
              </div>
            </div>
            <div class="dct-bar-wrap"><div class="dct-bar" style="width:${soldPct}%"></div></div>
          </div>`;
        })
        .join('');
    } else {
      tiersHtml = '<p class="form-hint">No tiers set — tap Edit clusters below.</p>';
    }

    /* Spoilage notes */
    const spoilNotes = b.spoilageRecords
      .filter((r) => r.reason && r.reason.trim())
      .map((r) => `${r.qty}×: ${escapeHtml(r.reason.trim())}`)
      .join(' · ');

    el.detailsContent.innerHTML = `
      <div class="dv-wrap">
        <!-- Hero -->
        <div class="dv-hero card">
          <div class="dv-hero-top">
            <div class="dv-title-wrap">
              <h2 class="dv-title">${escapeHtml(displayBunchName(b))}</h2>
              <p class="dv-meta">${escapeHtml(b.date)}</p>
            </div>
            <div class="dv-profit-badge ${pClass}">
              <span class="dvpb-label">Profit</span>
              <span class="dvpb-value">${profitSign}${escapeHtml(formatMoney(p))}</span>
            </div>
          </div>
          ${highSpoil ? '<div class="spoil-warning" role="status">⚠ High spoilage — over 20% of clusters spoiled.</div>' : ''}
        </div>

        <!-- 2×2 action grid -->
        <div class="dv-actions">
          <button type="button" class="dv-action-btn primary" data-detail="sale" data-id="${escapeAttr(b.id)}">
            Add sale
            <span class="dva-sub">Record sold clusters</span>
          </button>
          <button type="button" class="dv-action-btn" data-detail="spoil" data-id="${escapeAttr(b.id)}">
            Spoilage
            <span class="dva-sub">Mark clusters spoiled</span>
          </button>
          <button type="button" class="dv-action-btn" data-detail="expenses" data-id="${escapeAttr(b.id)}">
            Edit info
            <span class="dva-sub">Name &amp; expenses</span>
          </button>
          <button type="button" class="dv-action-btn" data-detail="cluster" data-id="${escapeAttr(b.id)}">
            Clusters
            <span class="dva-sub">Set tiers &amp; totals</span>
          </button>
        </div>

        <!-- Investment -->
        <section class="dv-section card">
          <h3 class="dv-section-title">Investment</h3>
          <div class="dv-rows">
            <div class="dv-row"><span>Capital (purchase)</span><span>${escapeHtml(formatMoney(b.cost))}</span></div>
            <div class="dv-row"><span>Paid worker</span><span>${escapeHtml(formatMoney(b.paidWorker))}</span></div>
            <div class="dv-row"><span>Transport</span><span>${escapeHtml(formatMoney(b.transport))}</span></div>
            <div class="dv-row strong"><span>Total invested</span><span>${escapeHtml(formatMoney(totalCost(b)))}</span></div>
          </div>
        </section>

        <!-- Cluster tiers -->
        <section class="dv-section card">
          <h3 class="dv-section-title">Cluster tiers</h3>
          <div class="dv-cluster-tiers">${tiersHtml}</div>
          <div class="dv-rows" style="margin-top:0.75rem;padding-top:0.6rem;border-top:1px solid var(--border)">
            <div class="dv-row"><span>Expected revenue</span><span>${escapeHtml(formatMoney(expRev))}</span></div>
            <div class="dv-row"><span>Expected profit</span><span class="${expProf >= 0 ? 'profit' : 'loss'}">${escapeHtml(formatMoney(expProf))}</span></div>
          </div>
        </section>

        <!-- Performance -->
        <section class="dv-section card">
          <h3 class="dv-section-title">Performance</h3>
          <div class="dv-rows">
            <div class="dv-row"><span>Total clusters</span><span>${b.clustersTotal}</span></div>
            <div class="dv-row"><span>Sold</span><span class="profit">${sold}</span></div>
            <div class="dv-row"><span>Spoiled${b.clustersTotal > 0 ? ` (${spoilPct.toFixed(0)}%)` : ''}</span><span${spoiled > 0 ? ' class="loss"' : ''}>${spoiled}</span></div>
            ${spoilNotes ? `<div class="dv-row" style="flex-direction:column;align-items:flex-start;gap:0.2rem;border-bottom:none;padding-bottom:0.1rem"><span>Spoilage notes</span><span style="font-size:0.83rem;color:var(--text-muted);font-weight:400;">${spoilNotes}</span></div>` : ''}
            <div class="dv-row"><span>Remaining</span><span${rem > 0 ? ' class="profit"' : ''}>${rem}</span></div>
            <div class="dv-row"><span>Revenue (actual)</span><span>${escapeHtml(formatMoney(rev))}</span></div>
            <div class="dv-row strong"><span>Profit</span><span class="${pClass}">${profitSign}${escapeHtml(formatMoney(p))}</span></div>
          </div>
        </section>
      </div>
    `;

    el.detailsContent.querySelectorAll('[data-detail]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-detail');
        const bid = btn.getAttribute('data-id');
        if (action === 'sale') openSaleModal(bid);
        else if (action === 'spoil') openSpoilModal(bid);
        else if (action === 'expenses') openExpensesModal(bid);
        else if (action === 'cluster') openClusterModal(bid);
      });
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  function renderAll() {
    renderDashboard();
    renderBunchList();
    if (activeDetailId && findBunch(activeDetailId)) {
      renderDetails(activeDetailId);
    }
  }

  // --- Modal open helpers ---
  function tierSelectOptions(selected) {
    return CLUSTER_PRICE_OPTIONS.map(
      (p) =>
        `<option value="${p}"${Number(selected) === p ? ' selected' : ''}>${p.toLocaleString('en-US')} UGX</option>`
    ).join('');
  }

  function tierRowHtml(price, count) {
    return `
    <div class="cluster-tier-row" data-tier-row>
      <select class="input tier-price" aria-label="Price per cluster">${tierSelectOptions(price)}</select>
      <input type="number" class="input tier-count" min="0" step="1" value="${count}" aria-label="Clusters at this price" />
      <button type="button" class="btn-remove-tier" aria-label="Remove row">×</button>
    </div>`;
  }

  function tierSumFromDom() {
    let s = 0;
    el.clusterTiersRows.querySelectorAll('[data-tier-row]').forEach((row) => {
      s += Math.max(0, Math.floor(num(row.querySelector('.tier-count')?.value)));
    });
    return s;
  }

  /** Merge rows; drops zero-count lines */
  function collectAllTiersForSave() {
    const raw = [];
    el.clusterTiersRows.querySelectorAll('[data-tier-row]').forEach((row) => {
      const price = num(row.querySelector('.tier-price')?.value);
      const cnt = Math.max(0, Math.floor(num(row.querySelector('.tier-count')?.value)));
      if (!isAllowedPrice(price)) return;
      raw.push({ price, count: cnt });
    });
    return mergeTiersByPrice(raw);
  }

  function openAddBunchModal() {
    el.addDate.value = todayISO();
    openModal(el.modalAddBunch);
    setTimeout(() => el.formAddBunch.querySelector('#add-cost')?.focus(), 50);
  }

  function openClusterModal(id) {
    const b = findBunch(id);
    if (!b) return;
    el.clusterBunchId.value = id;
    el.clusterTotal.value = String(b.clustersTotal);
    const rows = el.clusterTiersRows;
    rows.innerHTML = '';
    const tiers =
      b.clusterTiers && b.clusterTiers.length
        ? b.clusterTiers
        : [{ price: CLUSTER_PRICE_OPTIONS[0], count: 0 }];
    tiers.forEach((t) => {
      rows.insertAdjacentHTML('beforeend', tierRowHtml(t.price, t.count));
    });
    updateClusterPreview();
    openModal(el.modalCluster);
  }

  function updateClusterPreview() {
    const total = num(el.clusterTotal.value);
    const tierSum = tierSumFromDom();
    const merged = collectAllTiersForSave();
    const er = merged.reduce((a, t) => a + t.count * t.price, 0);
    const b = findBunch(el.clusterBunchId.value);
    const tc = b ? totalCost(b) : 0;
    const ep = er - tc;
    const match = tierSum === total;
    if (el.clusterTiersHint) {
      el.clusterTiersHint.textContent = match
        ? `Allocated: ${tierSum} / Total: ${total} ✓`
        : `Allocated: ${tierSum} / Total: ${total} — must match`;
      el.clusterTiersHint.style.color = match ? '' : 'var(--loss)';
    }
    el.clusterPreview.textContent = `Expected revenue: ${formatMoney(er)} · Expected profit: ${formatMoney(ep)}`;
  }

  function updateSaleSummary() {
    if (!el.saleSummary || !el.saleTierRows) return;
    let totalQty = 0;
    let totalRevenue = 0;
    el.saleTierRows.querySelectorAll('[data-sale-price]').forEach((row) => {
      const price = num(row.getAttribute('data-sale-price'));
      const q = Math.max(0, Math.floor(num(row.querySelector('.sale-tier-qty')?.value)));
      totalQty += q;
      totalRevenue += q * price;
    });
    el.saleSummary.textContent =
      totalQty > 0
        ? `This sale: ${totalQty} cluster(s) · ${formatMoney(totalRevenue)}`
        : 'No clusters selected yet.';
  }

  /** @param {Bunch} b */
  function renderSaleTierRows(b) {
    if (!el.saleTierRows) return;
    const rows = [...b.clusterTiers].sort((a, c) => c.price - a.price);
    const parts = [];
    for (let i = 0; i < rows.length; i++) {
      const t = rows[i];
      const rem = remainingAtTier(b, t.price);
      if (rem <= 0) continue;
      parts.push(`
      <div class="sale-tier-row" data-sale-price="${t.price}">
        <div class="sale-tier-meta">
          <span class="sale-tier-price">${formatMoney(t.price)}</span>
          <span class="sale-tier-left">${rem} left</span>
        </div>
        <div class="sale-tier-controls">
          <input type="number" class="input sale-tier-qty" min="0" max="${rem}" step="1" value="0" inputmode="numeric" aria-label="Clusters to sell at ${t.price} UGX" />
          <button type="button" class="btn btn-secondary btn-sm" data-sale-plus1 aria-label="Add one">+1</button>
        </div>
      </div>`);
    }
    if (parts.length === 0) {
      el.saleTierRows.innerHTML =
        '<p class="form-hint" id="sale-tier-empty">No clusters left to sell at any tier.</p>';
      return;
    }
    el.saleTierRows.innerHTML = parts.join('');
  }

  function openSaleModal(id) {
    const b = findBunch(id);
    if (!b) return;
    if (!b.clusterTiers || !b.clusterTiers.length || tierListCount(b.clusterTiers) === 0) {
      toast('Set cluster info first (Edit cluster info).');
      return;
    }
    let anyLeft = false;
    for (let i = 0; i < b.clusterTiers.length; i++) {
      if (remainingAtTier(b, b.clusterTiers[i].price) > 0) {
        anyLeft = true;
        break;
      }
    }
    if (!anyLeft) {
      toast('No clusters left to sell in this bunch.');
      return;
    }
    el.saleBunchId.value = id;
    if (el.saleBunchLabel) {
      el.saleBunchLabel.textContent = `${displayBunchName(b)} · ${b.date}`;
    }
    renderSaleTierRows(b);
    updateSaleSummary();
    openModal(el.modalSale);
  }

  function openSpoilModal(id) {
    const b = findBunch(id);
    if (!b) return;
    el.spoilBunchId.value = id;
    el.spoilQty.value = '1';
    el.spoilReason.value = '';
    openModal(el.modalSpoil);
  }

  function openExpensesModal(id) {
    const b = findBunch(id);
    if (!b) return;
    el.expensesBunchId.value = id;
    if (el.expensesName) el.expensesName.value = sanitizeBunchName(b.name);
    el.expensesCapital.value = String(num(b.cost));
    el.expensesWorker.value = String(num(b.paidWorker));
    el.expensesTransport.value = String(num(b.transport));
    openModal(el.modalExpenses);
  }

  function updateBunchExpenses(id, name, capital, worker, transport) {
    const b = findBunch(id);
    if (!b) return false;
    b.name = sanitizeBunchName(name);
    b.cost = Math.max(0, num(capital));
    b.paidWorker = Math.max(0, num(worker));
    b.transport = Math.max(0, num(transport));
    saveState();
    renderAll();
    toast('Capital & expenses saved');
    return true;
  }

  // --- Init after PIN (listeners registered once) ---
  function initAppAfterUnlock() {
    if (appInitialized) return;
    appInitialized = true;

    loadState();
    loadDarkMode();
    renderAll();
    activateTab('home');

    // Bottom nav tabs
    if (el.navTabHome)    el.navTabHome.addEventListener('click',    () => activateTab('home'));
    if (el.navTabBunches) el.navTabBunches.addEventListener('click', () => activateTab('bunches'));
    if (el.navTabAdd)     el.navTabAdd.addEventListener('click',     () => openAddBunchModal());

    // Add bunch (legacy FAB ref kept for back-compat; nav tab is now primary trigger)
    el.btnOpenAddBunch && el.btnOpenAddBunch.addEventListener('click', () => openAddBunchModal());
    el.modalAddClose.addEventListener('click', () => closeModal(el.modalAddBunch));
    el.btnCancelAdd.addEventListener('click', () => closeModal(el.modalAddBunch));
    el.formAddBunch.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(el.formAddBunch);
      addBunches(
        String(fd.get('date') || ''),
        fd.get('cost'),
        fd.get('paidWorker'),
        fd.get('transport'),
        fd.get('count'),
        fd.get('bunchName')
      );
      el.formAddBunch.reset();
      el.addDate.value = todayISO();
      closeModal(el.modalAddBunch);
      activateTab('bunches');
    });

    el.modalAddBunch.addEventListener('click', (e) => {
      if (e.target === el.modalAddBunch) closeModal(el.modalAddBunch);
    });

    el.modalExpensesClose.addEventListener('click', () => closeModal(el.modalExpenses));
    el.btnCancelExpenses.addEventListener('click', () => closeModal(el.modalExpenses));
    el.formExpenses.addEventListener('submit', (e) => {
      e.preventDefault();
      const ok = updateBunchExpenses(
        el.expensesBunchId.value,
        el.expensesName ? el.expensesName.value : '',
        el.expensesCapital.value,
        el.expensesWorker.value,
        el.expensesTransport.value
      );
      if (ok) closeModal(el.modalExpenses);
    });
    el.modalExpenses.addEventListener('click', (e) => {
      if (e.target === el.modalExpenses) closeModal(el.modalExpenses);
    });

    // Back
    el.btnBackList.addEventListener('click', () => {
      showListView();
      renderAll();
    });

    // Cluster modal (tiers: price dropdown + count per row; sum = total)
    el.modalClusterClose.addEventListener('click', () => closeModal(el.modalCluster));
    el.btnCancelCluster.addEventListener('click', () => closeModal(el.modalCluster));
    el.clusterTotal.addEventListener('input', updateClusterPreview);
    el.clusterTiersRows.addEventListener('input', updateClusterPreview);
    el.clusterTiersRows.addEventListener('change', updateClusterPreview);
    el.btnAddTier.addEventListener('click', () => {
      el.clusterTiersRows.insertAdjacentHTML('beforeend', tierRowHtml(CLUSTER_PRICE_OPTIONS[0], 0));
      updateClusterPreview();
    });
    el.clusterTiersRows.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-remove-tier');
      if (!btn) return;
      const row = btn.closest('[data-tier-row]');
      const all = el.clusterTiersRows.querySelectorAll('[data-tier-row]');
      if (row && all.length > 1) row.remove();
      updateClusterPreview();
    });
    el.formCluster.addEventListener('submit', (e) => {
      e.preventDefault();
      const ok = updateClusterInfo(el.clusterBunchId.value, el.clusterTotal.value, collectAllTiersForSave());
      if (ok) closeModal(el.modalCluster);
    });
    el.modalCluster.addEventListener('click', (e) => {
      if (e.target === el.modalCluster) closeModal(el.modalCluster);
    });

    // Sale modal — quantities per price tier
    el.modalSaleClose.addEventListener('click', () => closeModal(el.modalSale));
    el.btnCancelSale.addEventListener('click', () => closeModal(el.modalSale));
    if (el.saleTierRows) {
      el.saleTierRows.addEventListener('input', () => updateSaleSummary());
      el.saleTierRows.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-sale-plus1]');
        if (!btn) return;
        const row = btn.closest('[data-sale-price]');
        if (!row) return;
        const input = row.querySelector('.sale-tier-qty');
        if (!input) return;
        const max = Math.max(0, Math.floor(num(input.getAttribute('max'))));
        const cur = Math.max(0, Math.floor(num(input.value)));
        if (cur < max) {
          input.value = String(cur + 1);
          updateSaleSummary();
        }
      });
    }
    el.formSale.addEventListener('submit', (e) => {
      e.preventDefault();
      const lines = [];
      if (el.saleTierRows) {
        el.saleTierRows.querySelectorAll('[data-sale-price]').forEach((row) => {
          const price = num(row.getAttribute('data-sale-price'));
          const q = Math.max(0, Math.floor(num(row.querySelector('.sale-tier-qty')?.value)));
          if (q > 0) lines.push({ qty: q, price });
        });
      }
      if (addSaleTiers(el.saleBunchId.value, lines)) closeModal(el.modalSale);
    });
    el.modalSale.addEventListener('click', (e) => {
      if (e.target === el.modalSale) closeModal(el.modalSale);
    });

    // Spoil modal
    el.modalSpoilClose.addEventListener('click', () => closeModal(el.modalSpoil));
    el.btnCancelSpoil.addEventListener('click', () => closeModal(el.modalSpoil));
    el.formSpoil.addEventListener('submit', (e) => {
      e.preventDefault();
      addSpoilage(el.spoilBunchId.value, el.spoilQty.value, el.spoilReason.value);
      closeModal(el.modalSpoil);
    });
    el.modalSpoil.addEventListener('click', (e) => {
      if (e.target === el.modalSpoil) closeModal(el.modalSpoil);
    });

    // Reset
    el.btnResetData.addEventListener('click', () => openModal(el.modalReset));
    el.btnResetCancel.addEventListener('click', () => closeModal(el.modalReset));
    el.btnResetConfirm.addEventListener('click', resetAllData);
    el.modalReset.addEventListener('click', (e) => {
      if (e.target === el.modalReset) closeModal(el.modalReset);
    });

    // Dark mode
    el.btnDarkMode.addEventListener('click', () => {
      applyDarkMode(!document.body.classList.contains('dark'));
    });

    // Escape closes modals
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAllModals();
    });

    initStorageLifecycle();
    if (!probeLocalStorage()) {
      toast('Storage blocked — data may not save. Use a normal browser tab (not private).');
    }
  }

  /**
   * Run when DOM is ready. If DOMContentLoaded already fired (e.g. script order /
   * dynamic injection), run immediately — otherwise the PIN handlers never attach.
   */
  function whenDomReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function bootPinScreen() {
    loadDarkMode();

    const overlay = document.getElementById('pin-overlay');
    const appShell = document.getElementById('app-shell');
    const subText = document.getElementById('pin-sub-text');

    const setupDiv = document.getElementById('pin-setup');
    const pinNew = document.getElementById('pin-new');
    const pinConfirm = document.getElementById('pin-confirm');
    const setupError = document.getElementById('pin-setup-error');
    const setupSubmit = document.getElementById('pin-setup-submit');

    const unlockDiv = document.getElementById('pin-unlock');
    const pinInput = document.getElementById('pin-input');
    const pinError = document.getElementById('pin-error');
    const pinSubmit = document.getElementById('pin-submit');

    if (!overlay || !appShell) {
      console.error("AUF'S YELLOWS: Missing DOM nodes.");
      return;
    }

    function showSetupError(msg) {
      if (!setupError) return;
      setupError.textContent = msg || '';
      setupError.hidden = !msg;
    }

    function showUnlockError(msg) {
      if (!pinError) return;
      pinError.textContent = msg || '';
      pinError.hidden = !msg;
    }

    function dismiss() {
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      appShell.hidden = false;
      appShell.removeAttribute('hidden');
      setSessionUnlocked();
      initAppAfterUnlock();
    }

    /* Already unlocked this session */
    if (isSessionUnlocked() && hasStoredPin()) {
      dismiss();
      return;
    }

    overlay.hidden = false;
    overlay.removeAttribute('hidden');

    /* First time: no PIN stored — show setup */
    if (!hasStoredPin()) {
      subText.textContent = 'Create your PIN to get started';
      setupDiv.hidden = false;
      unlockDiv.hidden = true;

      function doSetup() {
        const a = normalizePin(pinNew.value);
        const b = normalizePin(pinConfirm.value);
        if (a.length < 4) {
          showSetupError('PIN must be at least 4 digits.');
          pinNew.focus();
          return;
        }
        if (!/^\d+$/.test(a)) {
          showSetupError('PIN must be digits only.');
          pinNew.focus();
          return;
        }
        if (a !== b) {
          showSetupError('PINs do not match.');
          pinConfirm.focus();
          return;
        }
        showSetupError('');
        setStoredPin(a);
        dismiss();
      }

      setupSubmit.addEventListener('click', doSetup);
      pinConfirm.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); doSetup(); }
      });
      return;
    }

    /* Returning user: unlock */
    subText.textContent = 'Enter your PIN to continue';
    setupDiv.hidden = true;
    unlockDiv.hidden = false;

    function doUnlock() {
      const entered = normalizePin(pinInput.value);
      const stored = getStoredPin();
      if (entered === stored) {
        showUnlockError('');
        dismiss();
      } else {
        showUnlockError('Incorrect PIN. Try again.');
        pinInput.select();
      }
    }

    pinSubmit.addEventListener('click', doUnlock);
    pinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doUnlock(); }
    });
  }

  /**
   * PWA: register service worker (offline app shell). Not available on file:// — use localhost or HTTPS.
   */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
    });
  }

  whenDomReady(bootPinScreen);
  registerServiceWorker();
})();
