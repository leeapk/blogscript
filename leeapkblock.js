/**
 * AbdDetector — Leeapk Ad Block Detector Library
 * Version: 2.0.0
 * Author: Mr. Lee (leeapk.com)
 *
 * ─── HOW TO USE ────────────────────────────────────────────────
 *
 *   AbdDetector.init({
 *     baitScriptUrl : 'https://raw.githubusercontent.com/USER/REPO/main/assets/ads/adsense.js',
 *     onDetected    : function(method) { ... },   // called once on first detection
 *     onClear       : function() { ... },          // called when all checks pass clean
 *   });
 *
 * ─── INDIVIDUAL CHECKS ─────────────────────────────────────────
 *
 *   AbdDetector.checkBraveShields(callback)   → callback(true/false)
 *   AbdDetector.checkExtensions(callback)     → callback(true/false)
 *   AbdDetector.checkDNSBlock(callback)       → callback(true/false)
 *
 * ───────────────────────────────────────────────────────────────
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AbdDetector = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* ═══════════════════════════════════════════════════════════
       INTERNAL HELPERS
    ═══════════════════════════════════════════════════════════ */

    var _detected = false;
    var _onDetectedCb = null;
    var _onClearCb = null;
    var _pendingChecks = 0;
    var _cleanChecks = 0;

    function _trigger(method) {
        if (_detected) return;
        _detected = true;
        if (typeof _onDetectedCb === 'function') {
            _onDetectedCb(method);
        }
    }

    function _checkComplete(isBlocked) {
        _pendingChecks--;
        if (!isBlocked) _cleanChecks++;

        // All checks done and none detected a blocker
        if (_pendingChecks === 0 && !_detected) {
            if (typeof _onClearCb === 'function') {
                _onClearCb();
            }
        }
    }

    /* ═══════════════════════════════════════════════════════════
       CHECK 1: BRAVE SHIELDS
       ───────────────────────────────────────────────────────────
       Brave browser exposes navigator.brave.isBrave() Promise.
       If Brave confirmed → probe a tracker URL as <img>.
         • Shields ON  → image errors instantly (blocked)
         • Shields OFF → image errors too (CORS) but LATER (~300ms+)
       We use timing: error < DNS_FAST_THRESHOLD = Shields ON.
    ═══════════════════════════════════════════════════════════ */

    function checkBraveShields(callback) {
        callback = callback || function () {};

        if (!navigator.brave || typeof navigator.brave.isBrave !== 'function') {
            // Not Brave at all — skip, no detection
            callback(false);
            return;
        }

        navigator.brave.isBrave().then(function (isBrave) {
            if (!isBrave) {
                callback(false);
                return;
            }

            // Confirmed Brave. Now check Shields status via timing probe.
            var img       = new Image();
            var startTime = Date.now();
            var finished  = false;

            var DNS_FAST_THRESHOLD = 150; // ms — Shields-blocked requests fail faster than CORS

            function done(blocked) {
                if (finished) return;
                finished = true;
                callback(blocked);
            }

            img.onload = function () {
                // Loaded — Shields are OFF (or this domain wasn't blocked)
                done(false);
            };

            img.onerror = function () {
                var elapsed = Date.now() - startTime;
                // Shields ON → error is near-instant (DNS/Shields intercept)
                // Shields OFF → error takes longer (CORS rejection from server)
                if (elapsed < DNS_FAST_THRESHOLD) {
                    done(true);   // Shields ON — blocked
                } else {
                    done(false);  // Shields OFF — CORS error only
                }
            };

            // Safety timeout: if neither fires, assume Shields ON
            setTimeout(function () { done(true); }, 3500);

            // Known ad URL that Brave Shields blocks (EasyPrivacy + Brave's own list)
            img.src = 'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/1/?ts=' + Date.now();

        }).catch(function () {
            callback(false);
        });
    }

    /* ═══════════════════════════════════════════════════════════
       CHECK 2: BROWSER EXTENSIONS (uBlock, ABP, AdGuard, etc.)
       ───────────────────────────────────────────────────────────
       Two sub-methods, both must agree to avoid false positives:

       A) DOM Bait — inject a <div> with ad-like class names.
          Extensions hide/remove it via CSS injection.
          Check: offsetHeight===0 or display:none → blocked.

       B) Bait Script — load a JS file from a URL path that
          matches EasyList filter rules (ads/adsense.js).
          • Blocked → onerror fires
          • Loaded  → check window.abd_ok === 1 (sentinel)
          baitScriptUrl must be set via AbdDetector.init()
    ═══════════════════════════════════════════════════════════ */

    var _baitScriptUrl = '';

    function checkExtensions(callback) {
        callback = callback || function () {};

        var domBlocked    = null;
        var scriptBlocked = null;

        function evaluate() {
            // Wait for both sub-checks to finish
            if (domBlocked === null || scriptBlocked === null) return;

            // Either sub-check blocked = extension detected
            callback(domBlocked || scriptBlocked);
        }

        // — Sub-check A: DOM Bait —
        var bait = document.createElement('div');
        bait.id = 'abd-ext-bait-' + Date.now();
        // Class names matched by uBlock Origin, ABP, AdGuard EasyList filters
        bait.className = [
            'adsbox', 'adsbygoogle', 'ad-banner',
            'advertisement', 'ad-zone', 'pub_300x250',
            'ad-slot', 'adsense-ad', 'textads'
        ].join(' ');
        bait.style.cssText = 'position:fixed;left:-9999px;top:-9999px;' +
                             'width:1px;height:1px;opacity:0;pointer-events:none;';

        document.body.appendChild(bait);

        setTimeout(function () {
            var cs = window.getComputedStyle(bait);
            domBlocked = (
                bait.offsetHeight === 0 ||
                bait.offsetWidth  === 0 ||
                cs.display        === 'none' ||
                cs.visibility     === 'hidden' ||
                parseFloat(cs.maxHeight) === 0
            );
            bait.parentNode && bait.parentNode.removeChild(bait);
            evaluate();
        }, 350);

        // — Sub-check B: Bait Script —
        if (!_baitScriptUrl || _baitScriptUrl.indexOf('leeapk') !== -1) {
            // URL not configured — skip script sub-check
            scriptBlocked = false;
            evaluate();
        } else {
            window.abd_ok = undefined;

            var s   = document.createElement('script');
            s.src   = _baitScriptUrl + '?_=' + Date.now();
            s.async = true;

            var scriptDone = false;

            function finishScript(blocked) {
                if (scriptDone) return;
                scriptDone = true;
                s.parentNode && s.parentNode.removeChild(s);
                scriptBlocked = blocked;
                evaluate();
            }

            s.onload = function () {
                // Loaded — check sentinel value
                finishScript(window.abd_ok !== 1);
            };
            s.onerror = function () {
                // Blocked by filter list
                finishScript(true);
            };

            // Timeout fallback
            setTimeout(function () { finishScript(true); }, 5000);
            document.head.appendChild(s);
        }
    }

    /* ═══════════════════════════════════════════════════════════
       CHECK 3: DNS-LEVEL BLOCKING (AdGuard DNS, Pi-hole, NextDNS)
       ───────────────────────────────────────────────────────────
       DNS blockers resolve known ad domains to 0.0.0.0 (NXDOMAIN).
       We probe multiple known ad-serving domains as <img> requests.

       Key insight — DNS block vs CORS:
         DNS blocked  → error is VERY fast (< 100ms) — no TCP connection
         Not blocked  → error comes later (CORS rejection from server,
                        after full TCP + TLS handshake ~300-600ms)

       We probe N domains. If MAJORITY error within DNS_THRESHOLD ms
       → DNS blocking confirmed.

       Why multiple domains?
         One domain might be slow on the network. Majority vote
         reduces false positives on slow connections.
    ═══════════════════════════════════════════════════════════ */

    var DNS_PROBE_DOMAINS = [
        'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
        'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/1/',
        'https://static.doubleclick.net/instream/ad_status.js',
    ];

    var DNS_BLOCK_THRESHOLD    = 120;  // ms — faster than this = DNS blocked
    var DNS_MAJORITY_NEEDED    = 2;    // out of 3 probes must be fast-blocked

    function checkDNSBlock(callback) {
        callback = callback || function () {};

        var results   = [];
        var total     = DNS_PROBE_DOMAINS.length;
        var completed = 0;

        DNS_PROBE_DOMAINS.forEach(function (url) {
            var img       = new Image();
            var startTime = Date.now();
            var done      = false;

            function finish(fastBlocked) {
                if (done) return;
                done = true;

                results.push(fastBlocked);
                completed++;

                if (completed === total) {
                    // Count fast-error responses
                    var fastBlockCount = results.filter(Boolean).length;
                    callback(fastBlockCount >= DNS_MAJORITY_NEEDED);
                }
            }

            img.onload = function () {
                finish(false); // Loaded — definitely not DNS blocked
            };

            img.onerror = function () {
                var elapsed = Date.now() - startTime;
                // Fast error = DNS block (no server reached)
                // Slow error = CORS (server reached, rejected)
                finish(elapsed < DNS_BLOCK_THRESHOLD);
            };

            setTimeout(function () {
                // No response at all — treat as blocked
                finish(true);
            }, 4000);

            img.src = url + (url.indexOf('?') > -1 ? '&' : '?') + '_=' + Date.now();
        });
    }

    /* ═══════════════════════════════════════════════════════════
       PUBLIC API
    ═══════════════════════════════════════════════════════════ */

    return {

        /**
         * Run all checks. Calls onDetected(method) on first block found,
         * or onClear() if nothing detected.
         *
         * @param {Object} config
         * @param {string}   config.baitScriptUrl  - GitHub raw URL of adsense.js bait file
         * @param {Function} config.onDetected      - called with method name on detection
         * @param {Function} config.onClear         - called when all checks pass
         */
        init: function (config) {
            config = config || {};
            _baitScriptUrl = config.baitScriptUrl || '';
            _onDetectedCb  = config.onDetected || null;
            _onClearCb     = config.onClear    || null;
            _detected      = false;
            _cleanChecks   = 0;
            _pendingChecks = 3;

            checkBraveShields(function (blocked) {
                if (blocked) _trigger('brave_shields');
                _checkComplete(blocked);
            });

            checkExtensions(function (blocked) {
                if (blocked) _trigger('extension');
                _checkComplete(blocked);
            });

            checkDNSBlock(function (blocked) {
                if (blocked) _trigger('dns');
                _checkComplete(blocked);
            });
        },

        /**
         * Standalone: check only Brave Shields.
         * callback(true) = Shields ON, callback(false) = Shields OFF or not Brave
         */
        checkBraveShields: checkBraveShields,

        /**
         * Standalone: check only browser extensions (uBlock, ABP, AdGuard, etc.)
         * callback(true) = extension blocking detected
         */
        checkExtensions: checkExtensions,

        /**
         * Standalone: check only DNS-level blocking (AdGuard DNS, Pi-hole, NextDNS)
         * callback(true) = DNS blocking detected
         */
        checkDNSBlock: checkDNSBlock,

        /**
         * Reset state (for use before re-running init)
         */
        reset: function () {
            _detected      = false;
            _pendingChecks = 0;
            _cleanChecks   = 0;
        },

        version: '2.0.0'
    };

}));
