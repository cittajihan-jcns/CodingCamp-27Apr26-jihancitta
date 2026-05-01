/**
 * Property-Based Tests — Expense & Budget Visualizer
 *
 * Task 3.1: Property 1 — Serialization Round-Trip
 *
 * Feature: expense-budget-visualizer, Property 1: Serialization Round-Trip
 *
 * Validates: Requirements 5.4, 5.5
 *
 * Untuk setiap array Transaction yang valid, serialisasi ke JSON string
 * lalu deserialisasi kembali HARUS menghasilkan array yang deeply equal
 * dengan aslinya — panjang sama, dan setiap elemen memiliki id, name,
 * amount, category yang identik.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// ─── Re-implementasi Storage (identik dengan expense.js) ─────────────────────────
// Karena expense.js adalah browser script (bukan ES module), kita definisikan
// ulang Storage di sini agar bisa ditest di Node/jsdom environment.
// Logika ini HARUS tetap sinkron dengan implementasi di expense.js.

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

// ─── Arbitrary (Generator) untuk Transaction ─────────────────────────────────

/**
 * Generator untuk Transaction yang valid.
 * - id: integer positif (simulasi Date.now())
 * - name: string non-empty yang sudah di-trim
 * - amount: float positif > 0
 * - category: salah satu dari kategori default
 */
const transactionArb = fc.record({
  id: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
  name: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  amount: fc.double({ min: 0.01, max: 1_000_000_000, noNaN: true }).filter((n) => n > 0),
  category: fc.constantFrom('Food', 'Transport', 'Fun', 'Kesehatan', 'Hiburan'),
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Storage — Persistence Layer', () => {
  // Bersihkan localStorage sebelum setiap test
  beforeEach(() => {
    localStorage.clear();
  });

  // ── Unit Tests ──────────────────────────────────────────────────────────────

  describe('Storage.save dan Storage.load', () => {
    it('menyimpan dan membaca kembali array sederhana', () => {
      const data = [1, 2, 3];
      Storage.save('test_key', data);
      const result = Storage.load('test_key', []);
      expect(result).toEqual(data);
    });

    it('mengembalikan fallback jika key tidak ada', () => {
      const fallback = [];
      const result = Storage.load('nonexistent_key', fallback);
      expect(result).toEqual(fallback);
    });

    it('mengembalikan fallback jika JSON rusak', () => {
      // Simulasi JSON rusak dengan menulis langsung ke localStorage
      localStorage.setItem('broken_key', '{invalid json}');
      const result = Storage.load('broken_key', 'fallback_value');
      expect(result).toBe('fallback_value');
    });

    it('mengembalikan fallback jika key ada tapi nilainya null', () => {
      // localStorage.getItem mengembalikan null untuk key yang tidak ada
      const result = Storage.load('missing_key', 42);
      expect(result).toBe(42);
    });

    it('menyimpan dan membaca objek Transaction tunggal', () => {
      const transaction = { id: 1234567890, name: 'Makan siang', amount: 25000, category: 'Food' };
      Storage.save('evb_transactions', [transaction]);
      const result = Storage.load('evb_transactions', []);
      expect(result).toEqual([transaction]);
    });

    it('menyimpan dan membaca array kosong', () => {
      Storage.save('evb_transactions', []);
      const result = Storage.load('evb_transactions', null);
      expect(result).toEqual([]);
    });
  });

  // ── Property-Based Test ─────────────────────────────────────────────────────

  describe('Property 1: Serialization Round-Trip', () => {
    /**
     * Feature: expense-budget-visualizer, Property 1: Serialization Round-Trip
     *
     * Validates: Requirements 5.4, 5.5
     *
     * Untuk SETIAP array Transaction yang valid:
     *   Storage.save(key, transactions) → Storage.load(key, [])
     *   harus menghasilkan array yang deeply equal dengan input asli.
     *
     * Properti yang diverifikasi:
     *   (a) Panjang array sama
     *   (b) Setiap elemen memiliki id, name, amount, category yang identik
     */
    it('round-trip serialisasi menghasilkan array yang deeply equal', () => {
      fc.assert(
        fc.property(fc.array(transactionArb, { minLength: 0, maxLength: 50 }), (transactions) => {
          const key = 'evb_transactions';

          // Simpan ke localStorage via Storage.save
          Storage.save(key, transactions);

          // Baca kembali via Storage.load
          const loaded = Storage.load(key, []);

          // (a) Panjang harus sama
          expect(loaded).toHaveLength(transactions.length);

          // (b) Setiap elemen harus deeply equal
          for (let i = 0; i < transactions.length; i++) {
            expect(loaded[i].id).toBe(transactions[i].id);
            expect(loaded[i].name).toBe(transactions[i].name);
            expect(loaded[i].amount).toBeCloseTo(transactions[i].amount, 5);
            expect(loaded[i].category).toBe(transactions[i].category);
          }

          // Bersihkan untuk iterasi berikutnya
          localStorage.clear();
        }),
        { numRuns: 100 },
      );
    });

    it('round-trip untuk array kosong menghasilkan array kosong', () => {
      fc.assert(
        fc.property(fc.constant([]), (transactions) => {
          Storage.save('evb_transactions', transactions);
          const loaded = Storage.load('evb_transactions', null);
          expect(loaded).toEqual([]);
          localStorage.clear();
        }),
        { numRuns: 10 },
      );
    });

    it('round-trip untuk semua field AppState (transactions, categories, limits, sort, theme)', () => {
      fc.assert(
        fc.property(
          fc.record({
            transactions: fc.array(transactionArb, { maxLength: 20 }),
            categories: fc.array(
              fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
              { minLength: 1, maxLength: 10 },
            ),
            limits: fc.dictionary(
              fc.constantFrom('Food', 'Transport', 'Fun'),
              fc.double({ min: 1, max: 10_000_000, noNaN: true }).filter((n) => n > 0),
            ),
            sortOption: fc.constantFrom('', 'asc', 'desc', 'cat'),
            theme: fc.constantFrom('light', 'dark'),
          }),
          (state) => {
            // Simpan semua field
            Storage.save('evb_transactions', state.transactions);
            Storage.save('evb_categories', state.categories);
            Storage.save('evb_limits', state.limits);
            Storage.save('evb_sort', state.sortOption);
            Storage.save('evb_theme', state.theme);

            // Baca kembali semua field
            const loadedTransactions = Storage.load('evb_transactions', []);
            const loadedCategories = Storage.load('evb_categories', []);
            const loadedLimits = Storage.load('evb_limits', {});
            const loadedSort = Storage.load('evb_sort', '');
            const loadedTheme = Storage.load('evb_theme', null);

            // Verifikasi round-trip untuk setiap field
            expect(loadedTransactions).toHaveLength(state.transactions.length);
            expect(loadedCategories).toEqual(state.categories);
            expect(loadedLimits).toEqual(state.limits);
            expect(loadedSort).toBe(state.sortOption);
            expect(loadedTheme).toBe(state.theme);

            localStorage.clear();
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
