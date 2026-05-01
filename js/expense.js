/**
 * Expense & Budget Visualizer — app.js
 *
 * Arsitektur: Single-Page Application berbasis state tunggal (AppState).
 * Pola: unidirectional data flow
 *   User Action → State Mutation → Persist to LocalStorage → Re-render UI
 *
 * File ini adalah satu-satunya file JavaScript aplikasi.
 * Semua logika (state, persistence, UI, event handling) ada di sini.
 */

'use strict';

/* =========================================================
 * SECTION 1: APPLICATION STATE
 * =========================================================
 * Satu objek tunggal yang menjadi sumber kebenaran (single source of truth)
 * untuk seluruh state aplikasi. Tidak ada state tersebar di DOM atau
 * variabel global terpisah — semua fungsi render membaca dari AppState.
 */

/**
 * @typedef {Object} Transaction
 * @property {number} id        - Timestamp Unix (Date.now()) sebagai unique ID
 * @property {string} name      - Nama item pengeluaran (non-empty, trimmed)
 * @property {number} amount    - Jumlah pengeluaran (positive number)
 * @property {string} category  - Nama kategori (harus ada di AppState.categories)
 */

/**
 * State tunggal aplikasi.
 */
const AppState = {
  /** Daftar semua transaksi yang dicatat pengguna */
  transactions: [],

  /** Daftar nama kategori — default: Food, Transport, Fun */
  categories: ['Food', 'Transport', 'Fun'],

  /** Batas pengeluaran per kategori: { 'Food': 100000, ... } */
  limits: {},

  /** Opsi urutan transaksi: '' | 'asc' | 'desc' | 'cat' */
  sortOption: '',

  /** Tema tampilan: 'light' | 'dark' */
  theme: 'light',

  /** Nama pengguna — null jika belum diisi */
  username: null,
};

/* =========================================================
 * SECTION 2: STORAGE AVAILABILITY FLAG
 * =========================================================
 */

/** @type {boolean} */
let storageAvailable = true;

/* =========================================================
 * SECTION 3: PERSISTENCE LAYER — Storage Object
 * =========================================================
 * Semua operasi baca/tulis localStorage dilewatkan melalui objek ini
 * untuk memudahkan error handling terpusat.
 *
 * Local Storage Schema:
 *   evb_transactions  → JSON array of Transaction objects
 *   evb_categories    → JSON array of category name strings
 *   evb_limits        → JSON object mapping category → number
 *   evb_sort          → sort option string: ''|'asc'|'desc'|'cat'
 *   evb_theme         → 'light' | 'dark'
 */

const Storage = {
  /**
   * Serialisasi value ke JSON dan simpan ke localStorage.
   * @param {string} key
   * @param {*} value
   */
  save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn(`[Storage.save] Gagal menyimpan key "${key}":`, err);
    }
  },

  /**
   * Baca dan deserialisasi nilai dari localStorage.
   * @param {string} key
   * @param {*} fallback
   * @returns {*}
   */
  load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? JSON.parse(raw) : fallback;
    } catch (err) {
      console.warn(`[Storage.load] Gagal membaca key "${key}":`, err);
      return fallback;
    }
  },
};

/* =========================================================
 * SECTION 4: STORAGE INITIALIZATION
 * =========================================================
 */

/**
 * Tampilkan banner peringatan bahwa localStorage tidak tersedia.
 */
function showStorageWarning() {
  const banner = document.getElementById('storage-warning');
  if (banner) {
    banner.removeAttribute('hidden');
  }
}

/**
 * Deteksi ketersediaan localStorage.
 * @returns {boolean}
 */
function initStorage() {
  try {
    const testKey = 'evb_test';
    localStorage.setItem(testKey, '1');
    const result = localStorage.getItem(testKey);
    localStorage.removeItem(testKey);

    if (result !== '1') {
      throw new Error('localStorage read/write mismatch');
    }

    storageAvailable = true;
    return true;
  } catch (err) {
    console.warn('[initStorage] localStorage tidak tersedia:', err);
    storageAvailable = false;
    showStorageWarning();
    return false;
  }
}

/* =========================================================
 * SECTION 5: STATE LOADING
 * =========================================================
 */

/**
 * Baca semua state yang tersimpan dari localStorage ke AppState.
 * Dipanggil sekali saat aplikasi pertama kali dimuat.
 */
function loadState() {
  AppState.transactions = Storage.load('evb_transactions', []);
  AppState.categories = Storage.load('evb_categories', ['Food', 'Transport', 'Fun']);
  AppState.limits = Storage.load('evb_limits', {});
  AppState.sortOption = Storage.load('evb_sort', '');
  AppState.username = Storage.load('evb_username', null);

  const savedTheme = Storage.load('evb_theme', null);
  if (savedTheme !== null) {
    AppState.theme = savedTheme;
  } else {
    const prefersDark =
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    AppState.theme = prefersDark ? 'dark' : 'light';
  }
}

/* =========================================================
 * SECTION 6: STATE PERSISTENCE
 * =========================================================
 */

/**
 * Tulis seluruh AppState ke localStorage.
 * Dipanggil setelah setiap mutasi state.
 */
function persistAll() {
  if (!storageAvailable) return;

  Storage.save('evb_transactions', AppState.transactions);
  Storage.save('evb_categories', AppState.categories);
  Storage.save('evb_limits', AppState.limits);
  Storage.save('evb_sort', AppState.sortOption);
  Storage.save('evb_theme', AppState.theme);
  Storage.save('evb_username', AppState.username);
}

/* =========================================================
 * SECTION 7: BALANCE DISPLAY
 * =========================================================
 */

/** Formatter Rupiah — digunakan di seluruh aplikasi */
const rupiahFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

/**
 * Hitung total dari AppState.transactions dan update #balance-amount.
 */
function updateBalance() {
  const total = AppState.transactions.reduce((sum, t) => sum + t.amount, 0);
  const el = document.getElementById('balance-amount');
  if (el) {
    el.textContent = rupiahFormatter.format(total);
  }
}

/* =========================================================
 * SECTION 8: CHART
 * =========================================================
 */

/** Instance Chart.js yang aktif — null jika belum ada */
let chartInstance = null;

/**
 * Hitung total pengeluaran per kategori dari AppState.transactions.
 * @returns {Record<string, number>}
 */
function getCategoryTotals() {
  const totals = {};
  for (const t of AppState.transactions) {
    totals[t.category] = (totals[t.category] || 0) + t.amount;
  }
  return totals;
}

/**
 * Kembalikan warna dari palet tetap berdasarkan index.
 * @param {number} index
 * @returns {string}
 */
function getCategoryColor(index) {
  const palette = [
    '#f6ad55',
    '#63b3ed',
    '#b794f4',
    '#68d391',
    '#fc8181',
    '#76e4f7',
    '#fbb6ce',
    '#90cdf4',
  ];
  return palette[index % palette.length];
}

/**
 * Buat atau update Chart.js pie chart berdasarkan AppState.
 * Tangani kasus Chart.js tidak tersedia dan tidak ada transaksi.
 */
function updateChart() {
  const container = document.querySelector('.chart-container');
  const canvas = document.getElementById('spending-chart');

  if (!canvas) return;

  // Tidak ada transaksi — tampilkan empty state
  if (AppState.transactions.length === 0) {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
    if (container) {
      container.setAttribute('data-empty', 'Belum ada data');
    }
    return;
  }

  // Ada transaksi — hapus empty state
  if (container) {
    container.removeAttribute('data-empty');
  }

  // Chart.js tidak tersedia (CDN gagal dimuat)
  if (typeof Chart === 'undefined') {
    if (container) {
      container.setAttribute('data-empty', 'Chart tidak tersedia.');
    }
    return;
  }

  const totals = getCategoryTotals();
  const labels = Object.keys(totals);
  const data = Object.values(totals);

  // Tentukan warna dan border untuk setiap kategori
  const backgroundColors = labels.map((cat) => {
    const idx = AppState.categories.indexOf(cat);
    return getCategoryColor(idx >= 0 ? idx : 0);
  });

  const borderColors = labels.map((cat) => (isOverLimit(cat) ? '#e53e3e' : 'transparent'));
  const borderWidths = labels.map((cat) => (isOverLimit(cat) ? 3 : 0));

  if (chartInstance) {
    // Update chart yang sudah ada
    chartInstance.data.labels = labels;
    chartInstance.data.datasets[0].data = data;
    chartInstance.data.datasets[0].backgroundColor = backgroundColors;
    chartInstance.data.datasets[0].borderColor = borderColors;
    chartInstance.data.datasets[0].borderWidth = borderWidths;
    chartInstance.update();
  } else {
    // Buat chart baru
    chartInstance = new Chart(canvas, {
      type: 'pie',
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: backgroundColors,
            borderColor: borderColors,
            borderWidth: borderWidths,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              font: { size: 13 },
              padding: 16,
            },
          },
          tooltip: {
            callbacks: {
              label(context) {
                const value = context.parsed;
                return ` ${context.label}: ${rupiahFormatter.format(value)}`;
              },
            },
          },
        },
      },
    });
  }
}

/* =========================================================
 * SECTION 9: FORM INPUT TRANSAKSI
 * =========================================================
 */

/**
 * Validasi input form transaksi.
 * @param {string} name
 * @param {string|number} amount
 * @param {string} category
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateForm(name, amount, category) {
  const errors = [];

  if (!name || String(name).trim().length === 0) {
    errors.push('Nama item tidak boleh kosong.');
  }

  const parsedAmount = parseFloat(amount);
  if (amount === '' || amount === null || amount === undefined || isNaN(parsedAmount) || parsedAmount <= 0) {
    errors.push('Jumlah harus berupa angka positif lebih dari 0.');
  }

  if (!category || category === '') {
    errors.push('Pilih kategori terlebih dahulu.');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Tambah transaksi baru ke AppState, persist, dan render ulang.
 * @param {string} name
 * @param {string|number} amount
 * @param {string} category
 */
function addTransaction(name, amount, category) {
  const now = new Date();
  const transaction = {
    id: Date.now(),
    name: String(name).trim(),
    amount: parseFloat(amount),
    category,
    // Simpan tahun dan bulan sebagai string "YYYY-MM" untuk pengelompokan bulanan
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    date: now.toISOString(),
  };
  AppState.transactions.push(transaction);
  persistAll();
  renderAll();
}

/**
 * Handle submit form transaksi.
 * @param {Event} event
 */
function handleFormSubmit(event) {
  event.preventDefault();

  const nameEl = document.getElementById('input-name');
  const amountEl = document.getElementById('input-amount');
  const categoryEl = document.getElementById('input-category');
  const errorEl = document.getElementById('form-error');

  const name = nameEl ? nameEl.value : '';
  const amount = amountEl ? amountEl.value : '';
  const category = categoryEl ? categoryEl.value : '';

  const { valid, errors } = validateForm(name, amount, category);

  if (!valid) {
    if (errorEl) errorEl.textContent = errors.join(' ');
    return;
  }

  if (errorEl) errorEl.textContent = '';
  addTransaction(name, amount, category);
  resetForm();
}

/**
 * Reset semua field form transaksi ke nilai default.
 */
function resetForm() {
  const form = document.getElementById('transaction-form');
  if (form) form.reset();
}

/* =========================================================
 * SECTION 10: TRANSACTION LIST
 * =========================================================
 */

/**
 * Kembalikan salinan AppState.transactions yang diurutkan sesuai sortOption.
 * @returns {Transaction[]}
 */
function getSortedTransactions() {
  const copy = [...AppState.transactions];

  switch (AppState.sortOption) {
    case 'asc':
      copy.sort((a, b) => a.amount - b.amount);
      break;
    case 'desc':
      copy.sort((a, b) => b.amount - a.amount);
      break;
    case 'cat':
      copy.sort((a, b) => a.category.localeCompare(b.category));
      break;
    default:
      // '' — urutan asli (reverse chronological: terbaru di atas)
      copy.reverse();
      break;
  }

  return copy;
}

/**
 * Cek apakah total pengeluaran kategori sudah mencapai atau melebihi limit.
 * @param {string} category
 * @returns {boolean}
 */
function isOverLimit(category) {
  const limit = AppState.limits[category];
  if (limit === undefined || limit === null) return false;

  const total = AppState.transactions
    .filter((t) => t.category === category)
    .reduce((sum, t) => sum + t.amount, 0);

  return total >= limit;
}

/**
 * Render ulang #transaction-list dari getSortedTransactions().
 */
function renderList() {
  const listEl = document.getElementById('transaction-list');
  const emptyEl = document.getElementById('empty-state');

  if (!listEl) return;

  const sorted = getSortedTransactions();

  if (sorted.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  listEl.innerHTML = sorted
    .map((t) => {
      const overLimit = isOverLimit(t.category);
      const liClass = overLimit ? ' class="over-limit"' : '';
      return `<li${liClass} data-id="${t.id}">
        <span class="item-name">${escapeHtml(t.name)}</span>
        <span class="item-amount">${rupiahFormatter.format(t.amount)}</span>
        <span class="item-category" data-category="${escapeHtml(t.category)}">${escapeHtml(t.category)}</span>
        <button type="button" aria-label="Hapus transaksi ${escapeHtml(t.name)}">×</button>
      </li>`;
    })
    .join('');
}

/**
 * Escape HTML untuk mencegah XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Hapus transaksi berdasarkan ID, persist, dan render ulang.
 * @param {number} id
 */
function deleteTransaction(id) {
  AppState.transactions = AppState.transactions.filter((t) => t.id !== id);
  persistAll();
  renderAll();
}

/* =========================================================
 * SECTION 11: SORT CONTROLS
 * =========================================================
 */

/**
 * Handle perubahan sort option.
 */
function handleSortChange() {
  const sortEl = document.getElementById('sort-select');
  if (sortEl) {
    AppState.sortOption = sortEl.value;
    persistAll();
    renderList();
  }
}

/* =========================================================
 * SECTION 12: CUSTOM CATEGORY MANAGER
 * =========================================================
 */

/**
 * Render ulang <option> di #input-category dan #limit-category
 * dari AppState.categories.
 */
function renderCategoryDropdown() {
  const inputCatEl = document.getElementById('input-category');
  const limitCatEl = document.getElementById('limit-category');

  const optionsHtml =
    '<option value="">-- Pilih Kategori --</option>' +
    AppState.categories
      .map((cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`)
      .join('');

  if (inputCatEl) inputCatEl.innerHTML = optionsHtml;
  if (limitCatEl) limitCatEl.innerHTML = optionsHtml;
}

/**
 * Handle submit form tambah kategori baru.
 * @param {Event} event
 */
function handleAddCategory(event) {
  if (event) event.preventDefault();

  const inputEl = document.getElementById('input-new-category');
  const errorEl = document.getElementById('category-error');

  const raw = inputEl ? inputEl.value : '';
  const trimmed = raw.trim();

  if (!trimmed) {
    if (errorEl) errorEl.textContent = 'Nama kategori tidak boleh kosong.';
    return;
  }

  // Cek duplikat (case-insensitive)
  const isDuplicate = AppState.categories.some(
    (cat) => cat.toLowerCase() === trimmed.toLowerCase(),
  );

  if (isDuplicate) {
    if (errorEl) errorEl.textContent = 'Kategori sudah ada.';
    return;
  }

  // Tambah kategori baru
  AppState.categories.push(trimmed);
  persistAll();
  renderCategoryDropdown();

  if (inputEl) inputEl.value = '';
  if (errorEl) errorEl.textContent = '';
}

/* =========================================================
 * SECTION 13: SPENDING LIMIT MANAGER
 * =========================================================
 */

/**
 * Validasi nilai limit pengeluaran.
 * @param {*} value
 * @returns {boolean}
 */
function validateLimit(value) {
  const num = parseFloat(value);
  return !isNaN(num) && isFinite(num) && num > 0;
}

/** Menyimpan kategori yang sudah pernah ditampilkan toast-nya agar tidak spam */
const _toastedCategories = new Set();

/** Timer untuk auto-hide toast */
let _toastTimer = null;

/**
 * Tampilkan toast warning saat kategori melewati batas.
 * @param {string} category
 */
function showLimitToast(category) {
  const toast = document.getElementById('limit-toast');
  const msg = document.getElementById('limit-toast-message');
  if (!toast || !msg) return;

  const limit = AppState.limits[category];
  const total = AppState.transactions
    .filter((t) => t.category === category)
    .reduce((sum, t) => sum + t.amount, 0);

  msg.textContent = `⚠️ Batas ${escapeHtml(category)} terlampaui! Total: ${rupiahFormatter.format(total)} / Batas: ${rupiahFormatter.format(limit)}`;
  toast.removeAttribute('hidden');

  // Auto-hide setelah 5 detik
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => hideLimitToast(), 5000);
}

/**
 * Sembunyikan toast warning.
 */
function hideLimitToast() {
  const toast = document.getElementById('limit-toast');
  if (toast) toast.setAttribute('hidden', '');
  if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }
}

/**
 * Cek semua kategori yang baru melewati batas dan tampilkan toast.
 * Dipanggil setelah setiap mutasi transaksi.
 */
function checkAndNotifyLimits() {
  for (const category of Object.keys(AppState.limits)) {
    if (isOverLimit(category)) {
      if (!_toastedCategories.has(category)) {
        _toastedCategories.add(category);
        showLimitToast(category);
        break; // Tampilkan satu toast per aksi, tidak spam
      }
    } else {
      // Reset flag jika sudah tidak over-limit lagi
      _toastedCategories.delete(category);
    }
  }
}

/**
 * Handle submit form atur batas pengeluaran.
 * @param {Event} event
 */
function handleSetLimit(event) {
  if (event) event.preventDefault();

  const categoryEl = document.getElementById('limit-category');
  const amountEl = document.getElementById('limit-amount');
  const errorEl = document.getElementById('limit-error');

  const category = categoryEl ? categoryEl.value : '';
  const amount = amountEl ? amountEl.value : '';

  if (!category) {
    if (errorEl) errorEl.textContent = 'Pilih kategori terlebih dahulu.';
    return;
  }

  if (!validateLimit(amount)) {
    if (errorEl) errorEl.textContent = 'Batas harus berupa angka positif lebih dari 0.';
    return;
  }

  AppState.limits[category] = parseFloat(amount);
  persistAll();

  if (errorEl) errorEl.textContent = '';
  // Reset form
  if (categoryEl) categoryEl.value = '';
  if (amountEl) amountEl.value = '';

  updateHighlights();
  updateChart();
  renderLimitsMonitor();
  checkAndNotifyLimits();
}

/**
 * Hapus batas pengeluaran untuk kategori tertentu.
 * @param {string} category
 */
function removeLimit(category) {
  delete AppState.limits[category];
  _toastedCategories.delete(category);
  persistAll();
  updateHighlights();
  updateChart();
  renderLimitsMonitor();
  hideLimitToast();
}

/**
 * Render panel monitor semua batas aktif.
 */
function renderLimitsMonitor() {
  const listEl = document.getElementById('limits-list');
  const emptyEl = document.getElementById('limits-empty');
  if (!listEl) return;

  const entries = Object.entries(AppState.limits);

  if (entries.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  listEl.innerHTML = entries.map(([cat, limit]) => {
    const total = AppState.transactions
      .filter((t) => t.category === cat)
      .reduce((sum, t) => sum + t.amount, 0);
    const pct = Math.min((total / limit) * 100, 100).toFixed(0);
    const exceeded = total >= limit;
    const liClass = exceeded ? ' class="limit-exceeded"' : '';
    const fillClass = exceeded ? ' exceeded' : '';
    const textClass = exceeded ? ' exceeded' : '';

    return `<li${liClass} data-limit-cat="${escapeHtml(cat)}">
      <span class="limit-cat-name">${escapeHtml(cat)}</span>
      <div class="limit-progress-wrap">
        <div class="limit-progress-bar-bg">
          <div class="limit-progress-bar-fill${fillClass}" style="width:${pct}%"></div>
        </div>
        <span class="limit-progress-text${textClass}">
          ${rupiahFormatter.format(total)} / ${rupiahFormatter.format(limit)}${exceeded ? ' ⚠️' : ''}
        </span>
      </div>
      <button type="button" class="limit-remove-btn" aria-label="Hapus batas ${escapeHtml(cat)}">×</button>
    </li>`;
  }).join('');
}

/**
 * Iterasi semua <li> di #transaction-list dan tambah/hapus class over-limit.
 */
function updateHighlights() {
  const listEl = document.getElementById('transaction-list');
  if (!listEl) return;

  const items = listEl.querySelectorAll('li[data-id]');
  items.forEach((li) => {
    const id = parseInt(li.getAttribute('data-id'), 10);
    const transaction = AppState.transactions.find((t) => t.id === id);
    if (!transaction) return;

    if (isOverLimit(transaction.category)) {
      li.classList.add('over-limit');
    } else {
      li.classList.remove('over-limit');
    }
  });
}

/* =========================================================
 * SECTION 13B: MONTHLY SUMMARY
 * =========================================================
 */

/** Instance bar chart bulanan */
let monthlyChartInstance = null;

/** Bulan yang sedang diperluas di tabel detail */
let expandedMonth = null;

/**
 * Format "YYYY-MM" menjadi nama bulan yang mudah dibaca, misal "Januari 2025".
 * @param {string} monthKey - format "YYYY-MM"
 * @returns {string}
 */
function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split('-');
  const names = [
    'Januari','Februari','Maret','April','Mei','Juni',
    'Juli','Agustus','September','Oktober','November','Desember',
  ];
  return `${names[parseInt(month, 10) - 1]} ${year}`;
}

/**
 * Kembalikan data agregasi per bulan, diurutkan dari terlama ke terbaru.
 * @returns {Array<{ key: string, label: string, total: number, transactions: Transaction[] }>}
 */
function getMonthlyData() {
  const map = {};

  for (const t of AppState.transactions) {
    // Transaksi lama (sebelum fitur bulan) pakai bulan dari id (timestamp)
    const key = t.month || (() => {
      const d = new Date(t.id);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();

    if (!map[key]) map[key] = { key, total: 0, transactions: [] };
    map[key].total += t.amount;
    map[key].transactions.push(t);
  }

  return Object.values(map)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((m) => ({ ...m, label: formatMonthLabel(m.key) }));
}

/**
 * Render section ringkasan bulanan: tabel + bar chart.
 */
function renderMonthlySummary() {
  const container = document.getElementById('monthly-summary-content');
  const emptyEl = document.getElementById('monthly-empty');
  const canvas = document.getElementById('monthly-chart');
  if (!container) return;

  const data = getMonthlyData();

  if (data.length === 0) {
    container.style.display = 'none';
    if (emptyEl) emptyEl.style.display = '';
    if (monthlyChartInstance) { monthlyChartInstance.destroy(); monthlyChartInstance = null; }
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  container.style.display = '';

  // ── Bar Chart ──
  if (canvas && typeof Chart !== 'undefined') {
    const labels = data.map((m) => m.label);
    const totals = data.map((m) => m.total);
    const maxVal = Math.max(...totals);

    const bgColors = totals.map((v) => v === maxVal ? '#e53e3e' : '#4a6cf7');

    if (monthlyChartInstance) {
      monthlyChartInstance.data.labels = labels;
      monthlyChartInstance.data.datasets[0].data = totals;
      monthlyChartInstance.data.datasets[0].backgroundColor = bgColors;
      monthlyChartInstance.update();
    } else {
      monthlyChartInstance = new Chart(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Total Pengeluaran',
            data: totals,
            backgroundColor: bgColors,
            borderRadius: 6,
          }],
        },
        options: {
          responsive: true,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => ` ${rupiahFormatter.format(ctx.parsed.y)}`,
              },
            },
          },
          scales: {
            y: {
              ticks: {
                callback: (v) => rupiahFormatter.format(v),
                maxTicksLimit: 5,
              },
            },
          },
        },
      });
    }
  }

  // ── Tabel Ringkasan ──
  const tableEl = document.getElementById('monthly-table-body');
  if (!tableEl) return;

  tableEl.innerHTML = data.slice().reverse().map((m) => {
    const isExpanded = expandedMonth === m.key;
    const detailRows = isExpanded
      ? m.transactions
          .slice()
          .sort((a, b) => b.id - a.id)
          .map((t) => `
            <tr class="monthly-detail-row">
              <td colspan="2" class="detail-name">${escapeHtml(t.name)}</td>
              <td class="detail-cat">${escapeHtml(t.category)}</td>
              <td class="detail-amount">${rupiahFormatter.format(t.amount)}</td>
            </tr>`)
          .join('')
      : '';

    return `
      <tr class="monthly-row${isExpanded ? ' expanded' : ''}" data-month-key="${escapeHtml(m.key)}">
        <td class="month-label">${escapeHtml(m.label)}</td>
        <td class="month-count">${m.transactions.length} transaksi</td>
        <td class="month-total">${rupiahFormatter.format(m.total)}</td>
        <td class="month-toggle">
          <button type="button" class="month-detail-btn" aria-label="${isExpanded ? 'Tutup' : 'Lihat'} detail ${escapeHtml(m.label)}">
            ${isExpanded ? '▲' : '▼'}
          </button>
        </td>
      </tr>
      ${detailRows}`;
  }).join('');
}

/* =========================================================
 * SECTION 14: DARK/LIGHT MODE TOGGLE
 * =========================================================
 */

/**
 * Terapkan tema ke <body> dan update teks tombol #theme-toggle.
 * @param {'light'|'dark'} theme
 */
function applyTheme(theme) {
  const body = document.body;
  const toggleBtn = document.getElementById('theme-toggle');

  if (theme === 'dark') {
    body.classList.add('dark');
    if (toggleBtn) {
      toggleBtn.textContent = '☀️ Mode Terang';
      toggleBtn.setAttribute('aria-label', 'Ganti ke mode terang');
    }
  } else {
    body.classList.remove('dark');
    if (toggleBtn) {
      toggleBtn.textContent = '🌙 Mode Gelap';
      toggleBtn.setAttribute('aria-label', 'Ganti ke mode gelap');
    }
  }
}

/**
 * Toggle tema antara light dan dark.
 */
function handleThemeToggle() {
  AppState.theme = AppState.theme === 'dark' ? 'light' : 'dark';
  persistAll();
  applyTheme(AppState.theme);
}

/* =========================================================
 * SECTION 14B: USERNAME FEATURE
 * =========================================================
 */

/**
 * Tampilkan sapaan di header berdasarkan AppState.username.
 */
function renderGreeting() {
  const greetingEl = document.getElementById('user-greeting');
  if (!greetingEl) return;

  if (AppState.username) {
    const hour = new Date().getHours();
    let salam = 'Halo';
    if (hour >= 5 && hour < 12) salam = 'Selamat pagi';
    else if (hour >= 12 && hour < 15) salam = 'Selamat siang';
    else if (hour >= 15 && hour < 18) salam = 'Selamat sore';
    else if (hour >= 18 || hour < 5) salam = 'Selamat malam';

    greetingEl.textContent = `${salam}, ${escapeHtml(AppState.username)}! 👋`;
  } else {
    greetingEl.textContent = '';
  }
}

/**
 * Tampilkan modal isi nama pengguna.
 */
function showUsernameModal() {
  const modal = document.getElementById('username-modal');
  const input = document.getElementById('input-username');
  if (modal) {
    modal.removeAttribute('hidden');
    // Pre-fill jika sudah ada nama sebelumnya
    if (input && AppState.username) {
      input.value = AppState.username;
    }
    if (input) input.focus();
  }
}

/**
 * Sembunyikan modal nama pengguna.
 */
function hideUsernameModal() {
  const modal = document.getElementById('username-modal');
  if (modal) modal.setAttribute('hidden', '');
  const errorEl = document.getElementById('username-error');
  if (errorEl) errorEl.textContent = '';
}

/**
 * Handle submit form nama pengguna.
 * @param {Event} event
 */
function handleUsernameSubmit(event) {
  event.preventDefault();

  const input = document.getElementById('input-username');
  const errorEl = document.getElementById('username-error');
  const raw = input ? input.value : '';
  const trimmed = raw.trim();

  if (!trimmed) {
    if (errorEl) errorEl.textContent = 'Nama tidak boleh kosong.';
    return;
  }

  AppState.username = trimmed;
  persistAll();
  hideUsernameModal();
  renderGreeting();
}

/* =========================================================
 * SECTION 15: RENDER ALL
 * =========================================================
 */

/**
 * Render ulang semua komponen UI dari AppState.
 * Dipanggil setelah setiap mutasi state yang mempengaruhi tampilan.
 */
function renderAll() {
  renderList();
  updateBalance();
  updateChart();
  updateHighlights();
  renderGreeting();
  renderLimitsMonitor();
  renderMonthlySummary();
  checkAndNotifyLimits();
}

/* =========================================================
 * SECTION 16: INITIALIZATION
 * =========================================================
 */

/**
 * Inisialisasi aplikasi — dipanggil saat DOMContentLoaded.
 * Urutan:
 *   1. initStorage()
 *   2. loadState()
 *   3. applyTheme(AppState.theme)
 *   4. renderCategoryDropdown()
 *   5. Set nilai #sort-select dari AppState.sortOption
 *   6. renderAll()
 *   7. Pasang semua event listener
 */
function init() {
  // 1. Deteksi ketersediaan localStorage
  initStorage();

  // 2. Muat state dari localStorage
  loadState();

  // 3. Terapkan tema yang tersimpan
  applyTheme(AppState.theme);

  // 4. Render dropdown kategori
  renderCategoryDropdown();

  // 5. Set nilai sort select sesuai state tersimpan
  const sortEl = document.getElementById('sort-select');
  if (sortEl) sortEl.value = AppState.sortOption;

  // 6. Render semua komponen
  renderAll();

  // 7. Pasang semua event listener

  // Form transaksi
  const transactionForm = document.getElementById('transaction-form');
  if (transactionForm) {
    transactionForm.addEventListener('submit', handleFormSubmit);
  }

  // Hapus error saat user mengetik di field form transaksi
  const inputName = document.getElementById('input-name');
  const inputAmount = document.getElementById('input-amount');
  const inputCategory = document.getElementById('input-category');
  const formError = document.getElementById('form-error');

  [inputName, inputAmount, inputCategory].forEach((el) => {
    if (el) {
      el.addEventListener('input', () => {
        if (formError) formError.textContent = '';
      });
    }
  });

  // Event delegation untuk tombol hapus di transaction list
  const listEl = document.getElementById('transaction-list');
  if (listEl) {
    listEl.addEventListener('click', (event) => {
      const btn = event.target.closest('button');
      if (!btn) return;
      const li = btn.closest('li[data-id]');
      if (!li) return;
      const id = parseInt(li.getAttribute('data-id'), 10);
      if (!isNaN(id)) deleteTransaction(id);
    });
  }

  // Sort select
  const sortSelect = document.getElementById('sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', handleSortChange);
  }

  // Form kategori baru
  const categoryForm = document.getElementById('category-form');
  if (categoryForm) {
    categoryForm.addEventListener('submit', handleAddCategory);
  }

  // Hapus error saat user mengetik di field kategori baru
  const inputNewCategory = document.getElementById('input-new-category');
  const categoryError = document.getElementById('category-error');
  if (inputNewCategory) {
    inputNewCategory.addEventListener('input', () => {
      if (categoryError) categoryError.textContent = '';
    });
  }

  // Form batas pengeluaran
  const limitForm = document.getElementById('limit-form');
  if (limitForm) {
    limitForm.addEventListener('submit', handleSetLimit);
  }

  // Hapus error saat user mengubah field limit
  const limitCategory = document.getElementById('limit-category');
  const limitAmount = document.getElementById('limit-amount');
  const limitError = document.getElementById('limit-error');

  [limitCategory, limitAmount].forEach((el) => {
    if (el) {
      el.addEventListener('input', () => {
        if (limitError) limitError.textContent = '';
      });
    }
  });

  // Event delegation untuk tombol hapus batas di limits monitor
  const limitsListEl = document.getElementById('limits-list');
  if (limitsListEl) {
    limitsListEl.addEventListener('click', (event) => {
      const btn = event.target.closest('.limit-remove-btn');
      if (!btn) return;
      const li = btn.closest('li[data-limit-cat]');
      if (!li) return;
      const cat = li.getAttribute('data-limit-cat');
      if (cat) removeLimit(cat);
    });
  }

  // Toast close button
  const toastClose = document.getElementById('limit-toast-close');
  if (toastClose) {
    toastClose.addEventListener('click', hideLimitToast);
  }
  // Theme toggle
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', handleThemeToggle);
  }

  // Username modal — form submit
  const usernameForm = document.getElementById('username-form');
  if (usernameForm) {
    usernameForm.addEventListener('submit', handleUsernameSubmit);
  }

  // Hapus error saat user mengetik di field username
  const inputUsername = document.getElementById('input-username');
  const usernameError = document.getElementById('username-error');
  if (inputUsername) {
    inputUsername.addEventListener('input', () => {
      if (usernameError) usernameError.textContent = '';
    });
  }

  // Tombol edit nama
  const editUsernameBtn = document.getElementById('edit-username-btn');
  if (editUsernameBtn) {
    editUsernameBtn.addEventListener('click', showUsernameModal);
  }

  // Tutup modal saat klik backdrop
  const modalBackdrop = document.querySelector('.modal-backdrop');
  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', () => {
      // Hanya boleh tutup jika nama sudah ada
      if (AppState.username) hideUsernameModal();
    });
  }

  // Tutup modal dengan Escape (jika nama sudah ada)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && AppState.username) {
      hideUsernameModal();
    }
  });

  // Tampilkan modal jika nama belum diisi
  if (!AppState.username) {
    showUsernameModal();
  }

  // Event delegation untuk toggle detail bulan
  const monthlyTableBody = document.getElementById('monthly-table-body');
  if (monthlyTableBody) {
    monthlyTableBody.addEventListener('click', (event) => {
      const btn = event.target.closest('.month-detail-btn');
      if (!btn) return;
      const row = btn.closest('tr[data-month-key]');
      if (!row) return;
      const key = row.getAttribute('data-month-key');
      expandedMonth = expandedMonth === key ? null : key;
      renderMonthlySummary();
    });
  }
}

/* =========================================================
 * SECTION 17: ENTRY POINT
 * =========================================================
 */

document.addEventListener('DOMContentLoaded', init);
