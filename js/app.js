// ─── app.js — Mode management, PIN, tab routing ──────────────────────────────

let currentMode = null; // 'inventory' | 'owner'
let pinBuffer   = '';
let correctPin  = DEFAULT_PIN;

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, duration = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

// ─── Start Screen ─────────────────────────────────────────────────────────────
async function initApp() {
  // Load PIN from DB
  try {
    const storedPin = await getConfig('pin');
    if (storedPin) correctPin = storedPin;
  } catch (e) {
    console.warn('Could not load PIN from DB, using default');
  }

  document.getElementById('start-inventory-btn').addEventListener('click', () => {
    enterMode('inventory');
  });

  document.getElementById('start-owner-btn').addEventListener('click', () => {
    showPinModal();
  });

  document.getElementById('switch-mode-btn').addEventListener('click', () => {
    leaveMode();
  });
}

function enterMode(mode) {
  currentMode = mode;
  document.getElementById('start-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  // Set mode badge
  const badge = document.getElementById('mode-badge');
  if (mode === 'inventory') {
    badge.textContent = 'Inventory Mode';
    badge.className = 'mode-badge inventory';
  } else {
    badge.textContent = 'Owner Mode';
    badge.className = 'mode-badge owner';
  }

  // Show/hide tabs based on mode
  document.querySelectorAll('[data-mode]').forEach(el => {
    const allowed = el.dataset.mode.split(',');
    el.classList.toggle('hidden', !allowed.includes(mode));
  });

  // Activate first visible tab
  const firstTab = document.querySelector('.tab-btn:not(.hidden)');
  if (firstTab) activateTab(firstTab.dataset.tab);
}

function leaveMode() {
  currentMode = null;
  document.getElementById('app').classList.add('hidden');
  document.getElementById('start-screen').classList.remove('hidden');
}

// ─── Tab Routing ──────────────────────────────────────────────────────────────
function activateTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === 'tab-' + tabId);
  });
  // Lazy-load tab modules
  onTabActivated(tabId);
}

function onTabActivated(tabId) {
  if (tabId === 'inventory' && typeof initInventory === 'function') {
    initInventory();
  } else if (tabId === 'collection' && typeof initCollection === 'function') {
    initCollection();
  } else if (tabId === 'add-card' && typeof initAddCard === 'function') {
    initAddCard();
  } else if (tabId === 'sales' && typeof initSales === 'function') {
    initSales();
  } else if (tabId === 'reports' && typeof initReports === 'function') {
    initReports();
  }
}

// ─── PIN Modal ────────────────────────────────────────────────────────────────
function showPinModal() {
  pinBuffer = '';
  updatePinDisplay();
  document.getElementById('pin-modal').classList.remove('hidden');
  document.getElementById('pin-error').textContent = '';
}

function hidePinModal() {
  document.getElementById('pin-modal').classList.add('hidden');
  pinBuffer = '';
}

function updatePinDisplay() {
  document.querySelectorAll('.pin-dot').forEach((dot, i) => {
    dot.classList.toggle('filled', i < pinBuffer.length);
  });
}

function pinKeyPress(val) {
  if (val === 'C') {
    pinBuffer = '';
    document.getElementById('pin-error').textContent = '';
    updatePinDisplay();
    return;
  }
  if (val === '⌫') {
    pinBuffer = pinBuffer.slice(0, -1);
    updatePinDisplay();
    return;
  }
  if (pinBuffer.length >= 4) return;
  pinBuffer += val;
  updatePinDisplay();

  if (pinBuffer.length === 4) {
    if (pinBuffer === correctPin) {
      hidePinModal();
      enterMode('owner');
    } else {
      document.getElementById('pin-error').textContent = 'Incorrect PIN';
      pinBuffer = '';
      updatePinDisplay();
    }
  }
}

// ─── Wire up PIN keypad ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.pin-key').forEach(key => {
    key.addEventListener('click', () => pinKeyPress(key.dataset.val));
  });

  document.getElementById('pin-modal-close')?.addEventListener('click', hidePinModal);

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });

  initApp();
});
