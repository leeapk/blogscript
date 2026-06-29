/**
 * AdBlock Detector
 * Advanced multi-layer detection for Brave Shields, uBlock, AdGuard, DNS blockers, etc.
 * Exposes AbdDetector global object.
 */
(function(global) {
  'use strict';

  // ─── Configuration ──────────────────────────────────────────────
  const CONFIG = {
    // Honeypot – classes commonly used by ad containers
    HONEYPOT_CLASSES: ['ad-container', 'banner-ad', 'google-ads', 'ad-banner'],
    // DNS probing – diverse ad/tracking domains
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
    DNS_BLOCK_THRESHOLD: 120,      // ms – fast error => DNS block
    DNS_MAJORITY_NEEDED: 0.6,      // 60% of probes must be blocked
    // Brave bait
    BRAVE_BAIT_URL: 'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/1/?ts=',
    // Overall timeout for all checks (ms)
    TIMEOUT: 8000,
    // Confidence threshold (0-100)
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

  // ─── Detection Methods (each returns a Promise<score 0-100>) ──

  // 1. Honeypot Div
  async function checkHoneypot() {
    try {
      const div = document.createElement('div');
      const cls = CONFIG.HONEYPOT_CLASSES[Math.floor(Math.random() * CONFIG.HONEYPOT_CLASSES.length)];
      div.className = cls;
      div.style.cssText = 'height:1px;width:1px;overflow:hidden;position:absolute;top:-9999px;';
      document.body.appendChild(div);
      await sleep(100);
      const hidden = div.offsetParent === null ||
                     div.style.display === 'none' ||
                     div.style.visibility === 'hidden' ||
                     getComputedStyle(div).display === 'none';
      document.body.removeChild(div);
      return hidden ? 80 : 0;
    } catch (e) { return 0; }
  }

  // 2. Performance Observer (detect blocked resources)
  async function checkPerformanceObserver() {
    return new Promise((resolve) => {
      let blocked = false;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.initiatorType === 'img' &&
              entry.name.includes('doubleclick') &&
              entry.transferSize === 0) {
            blocked = true;
            observer.disconnect();
            resolve(80);
            return;
          }
        }
      });
      observer.observe({ entryTypes: ['resource'] });
      const img = new Image();
      img.src = CONFIG.BRAVE_BAIT_URL + Date.now();
      setTimeout(() => {
        observer.disconnect();
        resolve(blocked ? 80 : 0);
      }, 1500);
    });
  }

  // 3. DNS Blocking (fast errors on many domains)
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

  // 5. Extensions (Ghostery, uBlock, ABP) – global objects + CSS
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

  // 6. Fetch bait (random URL)
  async function checkFetchBait() {
    try {
      const url = randomBaitUrl();
      await fetch(url, { mode: 'no-cors', cache: 'no-store' });
      return 0;
    } catch (e) {
      return 70;
    }
  }

  // ─── Main Detector Class ───────────────────────────────────────
  class AbdDetector {
    constructor() {
      this._detected = false;
      this._score = 0;
      this._timeoutId = null;
      this._pending = 0;
      this._onDetected = null;
      this._onClear = null;
      this._baitScriptUrl = '';
    }

    // Public init – called by the WordPress plugin
    init(config) {
      this._onDetected = config.onDetected || null;
      this._onClear = config.onClear || null;
      this._baitScriptUrl = config.baitScriptUrl || '';
      this._detected = false;
      this._score = 0;

      // Run all checks in parallel
      const checks = [
        checkHoneypot(),
        checkPerformanceObserver(),
        checkDNSBlock(),
        checkBraveShields(),
        checkExtensions(),
        checkFetchBait()
      ];

      this._pending = checks.length;

      // Overall timeout
      this._timeoutId = setTimeout(() => {
        this._finalize(true);
      }, CONFIG.TIMEOUT);

      Promise.all(checks.map(p => p.catch(() => 0)))
        .then(scores => {
          const total = scores.reduce((a, b) => a + b, 0);
          this._score = total / checks.length;
          this._finalize(false);
        })
        .catch(() => this._finalize(true));
    }

    _finalize(forced) {
      if (this._timeoutId) {
        clearTimeout(this._timeoutId);
        this._timeoutId = null;
      }
      if (forced && this._score < CONFIG.DETECTION_THRESHOLD) {
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
      this._detected = false;
      this._score = 0;
      this._pending = 0;
    }

    get detected() { return this._detected; }
    get score() { return this._score; }
  }

  // ─── Expose globally ──────────────────────────────────────────
  const instance = new AbdDetector();
  global.AbdDetector = instance;

  // Also support AMD / CommonJS if needed
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = instance;
  }
  if (typeof define === 'function' && define.amd) {
    define(function() { return instance; });
  }

})(typeof window !== 'undefined' ? window : this);
