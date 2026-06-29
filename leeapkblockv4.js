/**
 * AdBlock Detector — leeapkblockv4.js
 * Advanced multi-layer detection for Brave Shields, uBlock, AdGuard, DNS blockers, etc.
 * Exposes AbdDetector global object.
 * Fixed: scoring logic, double-finalize race, fetchBait false positive,
 *        baitScriptUrl unused, honeypot offsetParent, DNS threshold.
 */
(function(global) {
  'use strict';

  // ─── Configuration ──────────────────────────────────────────────
  const CONFIG = {
    HONEYPOT_CLASSES: ['ad-container', 'banner-ad', 'google-ads', 'ad-banner'],
    DNS_DOMAINS: [
      'https://doubleclick.net/ads/',
      'https://googleads.com/ads/',
      'https://adservice.google.com/ads/',
      'https://www.googletagservices.com/tag/',
      'https://securepubads.g.doubleclick.net/tag/',
      'https://amazon-adsystem.com/ads/',
      'https://adsrvr.org/ads/',
      'https://adnxs.com/ads/',
      'https://pubmatic.com/ads/',
      'https://openx.net/ads/'
    ],
    // FIX: 120ms → 200ms; slow connections false positive এড়াতে
    DNS_BLOCK_THRESHOLD: 200,
    DNS_MAJORITY_NEEDED: 0.6,
    BRAVE_BAIT_URL: 'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/1/?ts=',
    TIMEOUT: 8000,
    // Strong signal threshold — একটা check এটা পার করলে detected
    STRONG_SIGNAL: 70,
    DETECTION_THRESHOLD: 60
  };

  // ─── Helpers ────────────────────────────────────────────────────
  function randomBaitUrl() {
    const domains = [
      'https://googleads.g.doubleclick.net/pagead/',
      'https://securepubads.g.doubleclick.net/tag/js/',
      'https://www.googletagservices.com/tag/',
      'https://amazon-adsystem.com/ads/',
      'https://adsrvr.org/ads/'
    ];
    const base = domains[Math.floor(Math.random() * domains.length)];
    return base + 'gpt_' + Date.now() + '_' + Math.random().toString(36).substring(7);
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ─── Detection Methods ───────────────────────────────────────────

  // 1. Honeypot Div
  // FIX: offsetParent === null unreliable → getBoundingClientRect() use করো
  async function checkHoneypot() {
    try {
      const div = document.createElement('div');
      const cls = CONFIG.HONEYPOT_CLASSES[Math.floor(Math.random() * CONFIG.HONEYPOT_CLASSES.length)];
      div.className = cls;
      div.style.cssText = 'height:1px;width:1px;overflow:hidden;position:fixed;top:-9999px;left:-9999px;';
      document.body.appendChild(div);
      await sleep(100);
      const rect = div.getBoundingClientRect();
      const cs   = getComputedStyle(div);
      const hidden = rect.width === 0 ||
                     rect.height === 0 ||
                     cs.display === 'none' ||
                     cs.visibility === 'hidden' ||
                     cs.opacity === '0';
      document.body.removeChild(div);
      return hidden ? 80 : 0;
    } catch (e) { return 0; }
  }

  // 2. Performance Observer
  // FIX: transferSize === 0 alone is unreliable (cache also gives 0)
  //      → additionally check decodedBodySize === 0
  async function checkPerformanceObserver() {
    if (typeof PerformanceObserver === 'undefined') return 0;
    return new Promise((resolve) => {
      let blocked = false;
      let observer;
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.initiatorType === 'img' &&
                entry.name.includes('doubleclick') &&
                entry.transferSize === 0 &&
                entry.decodedBodySize === 0) {
              blocked = true;
              observer.disconnect();
              resolve(80);
              return;
            }
          }
        });
        observer.observe({ entryTypes: ['resource'] });
      } catch (e) { return resolve(0); }

      const img = new Image();
      img.src = CONFIG.BRAVE_BAIT_URL + Date.now();
      setTimeout(() => {
        try { observer.disconnect(); } catch (_) {}
        resolve(blocked ? 80 : 0);
      }, 1500);
    });
  }

  // 3. DNS Blocking
  // FIX: threshold 120 → 200ms (CONFIG.DNS_BLOCK_THRESHOLD)
  async function checkDNSBlock() {
    return new Promise((resolve) => {
      const domains = CONFIG.DNS_DOMAINS;
      let blockedCount = 0;
      let completed = 0;
      const total = domains.length;
      domains.forEach((url) => {
        const img = new Image();
        const start = Date.now();
        let done = false;
        const finish = (isBlocked) => {
          if (done) return;
          done = true;
          if (isBlocked) blockedCount++;
          completed++;
          if (completed === total) {
            const ratio = blockedCount / total;
            const score = ratio >= CONFIG.DNS_MAJORITY_NEEDED ? Math.min(100, ratio * 100) : 0;
            resolve(score);
          }
        };
        img.onload = () => finish(false);
        img.onerror = () => {
          const elapsed = Date.now() - start;
          finish(elapsed < CONFIG.DNS_BLOCK_THRESHOLD);
        };
        setTimeout(() => finish(false), 3000);
        img.src = url + '?_=' + Date.now() + Math.random();
      });
    });
  }

  // 4. Brave Shields
  async function checkBraveShields() {
    try {
      if (navigator.brave && typeof navigator.brave.isBrave === 'function') {
        const isBrave = await navigator.brave.isBrave();
        if (isBrave) {
          const img = new Image();
          const start = Date.now();
          const p = new Promise((resolve) => {
            img.onload = () => resolve(false);
            img.onerror = () => {
              const elapsed = Date.now() - start;
              resolve(elapsed < 100);
            };
            setTimeout(() => resolve(false), 3000);
          });
          img.src = CONFIG.BRAVE_BAIT_URL + Date.now();
          const blocked = await p;
          return blocked ? 90 : 50;
        }
      }
      return 0;
    } catch (e) { return 0; }
  }

  // 5. Extension globals + CSS injection markers
  async function checkExtensions() {
    let score = 0;
    if (window.ghostery || window.Ghostery) score = Math.max(score, 80);
    try {
      const styles = document.querySelectorAll('style');
      for (const style of styles) {
        const text = style.textContent || '';
        if (text.includes('abp-') || text.includes('uBlock') || text.includes('adblock')) {
          score = Math.max(score, 70);
          break;
        }
      }
    } catch (e) {}
    const knownGlobals = ['uBlock', 'adblock', 'AdBlock', 'ABP'];
    for (const g of knownGlobals) {
      if (window[g] !== undefined) {
        score = Math.max(score, 80);
        break;
      }
    }
    return score;
  }

  // 6. Fetch bait
  // FIX: সব catch → blocked ধরা ভুল; শুধু network fetch failure ধরো
  async function checkFetchBait() {
    try {
      const url = randomBaitUrl();
      await fetch(url, { mode: 'no-cors', cache: 'no-store' });
      return 0;
    } catch (e) {
      // TypeError + 'fetch' message = network block; বাকি error (offline, etc.) ignore
      if (e instanceof TypeError && e.message.toLowerCase().includes('fetch')) {
        return 70;
      }
      return 0;
    }
  }

  // 7. Bait Script injection (NEW — baitScriptUrl এখন actually ব্যবহার হচ্ছে)
  async function checkScriptBait(url) {
    if (!url) return 0;
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = url + '?_=' + Date.now();
      s.onload = () => {
        try { document.head.removeChild(s); } catch (_) {}
        resolve(0);
      };
      s.onerror = () => {
        try { document.head.removeChild(s); } catch (_) {}
        resolve(80);
      };
      setTimeout(() => {
        try { document.head.removeChild(s); } catch (_) {}
        resolve(0);
      }, 3000);
      document.head.appendChild(s);
    });
  }

  // ─── Scoring helper ──────────────────────────────────────────────
  // FIX: simple average ছিল → false negative হতো।
  // এখন: কোনো check strong signal (≥70) দিলে সেটাকে weighted বেশি গুরুত্ব দেওয়া হচ্ছে।
  function computeScore(scores) {
    if (!scores.length) return 0;
    const max = Math.max(...scores);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    // যদি কোনো একটা check strong signal দেয়, max ও average-এর weighted blend নাও
    if (max >= CONFIG.STRONG_SIGNAL) {
      return Math.round(max * 0.65 + avg * 0.35);
    }
    return Math.round(avg);
  }

  // ─── Main Detector Class ─────────────────────────────────────────
  class AbdDetector {
    constructor() {
      this._detected   = false;
      this._score      = 0;
      this._timeoutId  = null;
      this._finalized  = false;   // FIX: race condition guard
      this._onDetected = null;
      this._onClear    = null;
      this._baitScriptUrl = '';
    }

    init(config) {
      this._onDetected    = config.onDetected || null;
      this._onClear       = config.onClear || null;
      this._baitScriptUrl = config.baitScriptUrl || '';
      this._detected      = false;
      this._score         = 0;
      this._finalized     = false;

      const checks = [
        checkHoneypot(),
        checkPerformanceObserver(),
        checkDNSBlock(),
        checkBraveShields(),
        checkExtensions(),
        checkFetchBait()
      ];

      // FIX: baitScriptUrl এখন actually use হচ্ছে
      if (this._baitScriptUrl) {
        checks.push(checkScriptBait(this._baitScriptUrl));
      }

      // Overall timeout
      this._timeoutId = setTimeout(() => {
        this._finalize(true);
      }, CONFIG.TIMEOUT);

      Promise.all(checks.map(p => p.catch(() => 0)))
        .then(scores => {
          this._score = computeScore(scores);
          this._finalize(false);
        })
        .catch(() => this._finalize(true));
    }

    // FIX: _finalized guard দিয়ে double-finalize race condition বন্ধ
    _finalize(forced) {
      if (this._finalized) return;
      this._finalized = true;

      if (this._timeoutId) {
        clearTimeout(this._timeoutId);
        this._timeoutId = null;
      }

      // Timeout হলে partial score থাকলে সেটা ব্যবহার করো, 0 করো না
      if (forced && this._score < CONFIG.DETECTION_THRESHOLD) {
        // partial score যদি strong signal না দেখায়, clear করো
        this._score = 0;
      }

      const detected = this._score >= CONFIG.DETECTION_THRESHOLD;
      if (detected !== this._detected) {
        this._detected = detected;
        if (detected && typeof this._onDetected === 'function') {
          this._onDetected();
        } else if (!detected && typeof this._onClear === 'function') {
          this._onClear();
        }
      }
    }

    reset() {
      if (this._timeoutId) {
        clearTimeout(this._timeoutId);
        this._timeoutId = null;
      }
      this._detected  = false;
      this._score     = 0;
      this._finalized = false;   // FIX: reset-এও clear করো
    }

    get detected() { return this._detected; }
    get score()    { return this._score; }
  }

  // ─── Expose globally ─────────────────────────────────────────────
  const instance = new AbdDetector();
  global.AbdDetector = instance;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = instance;
  }
  if (typeof define === 'function' && define.amd) {
    define(function() { return instance; });
  }

})(typeof window !== 'undefined' ? window : this);
