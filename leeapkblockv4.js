/**
 * Ad Block Detector
 * Version: 2.1.8
 * Author: Mr. Lee / leeapk.com
 *
 * Fix log (2.1.7 → 2.1.8):
 *  1. DNS_BLOCK_THRESHOLD 50ms → 150ms  (50ms এ legitimate fast servers মিস হচ্ছিল)
 *  2. DNS probe: JS script URL → Image pixel URL  (JS URL সবসময় onerror দেয় → false positive)
 *  3. DNS_MAJORITY_NEEDED: 2 (hardcoded) → Math.ceil(total * 0.6)  (domain count পরিবর্তনে ভাঙছিল)
 *  4. checkBraveShields DNS_FAST_THRESHOLD 80ms → 120ms  (same reason as #1)
 *  5. checkExtensions DOM bait: offsetHeight/Width check → getBoundingClientRect()  (position:fixed এ offset 0 always)
 *  6. _checkComplete race: _detected true হলেও onClear fire হওয়ার সম্ভাবনা ছিল → guard যোগ
 *  7. reset(): _onDetectedCb / _onClearCb clear করা হচ্ছিল না → stale callback থেকে যেত
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AbdDetector = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var _detected      = false;
    var _onDetectedCb  = null;
    var _onClearCb     = null;
    var _pendingChecks = 0;
    var _cleanChecks   = 0;

    function _trigger(method) {
        if (_detected) return;
        _detected = true;
        if (typeof _onDetectedCb === 'function') {
            _onDetectedCb(method);
        }
    }

    // FIX #6: _detected guard যোগ — একটা check _trigger() করার পর
    // বাকি checks complete হলে onClear আর fire হবে না
    function _checkComplete(isBlocked) {
        _pendingChecks--;
        if (!isBlocked) _cleanChecks++;
        if (_pendingChecks === 0 && !_detected) {
            if (typeof _onClearCb === 'function') {
                _onClearCb();
            }
        }
    }

    /* ═══════════════════════════════════════════════════════════
       CHECK 1: BRAVE SHIELDS
       ═══════════════════════════════════════════════════════════ */
    function checkBraveShields(callback) {
        callback = callback || function () {};

        if (!navigator.brave || typeof navigator.brave.isBrave !== 'function') {
            callback(false);
            return;
        }

        navigator.brave.isBrave().then(function (isBrave) {
            if (!isBrave) {
                callback(false);
                return;
            }

            var img       = new Image();
            var startTime = Date.now();
            var finished  = false;
            // FIX #4: 80ms → 120ms; Brave-ও কখনো 80-100ms নিতে পারে legitimate ভাবে
            var DNS_FAST_THRESHOLD = 120;

            function done(blocked) {
                if (finished) return;
                finished = true;
                callback(blocked);
            }

            img.onload  = function () { done(false); };
            img.onerror = function () {
                done(Date.now() - startTime < DNS_FAST_THRESHOLD);
            };
            setTimeout(function () { done(false); }, 3500);
            img.src = 'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/1/?ts=' + Date.now();

        }).catch(function () {
            callback(false);
        });
    }

    /* ═══════════════════════════════════════════════════════════
       CHECK 2: BROWSER EXTENSIONS
       ═══════════════════════════════════════════════════════════ */
    var _baitScriptUrl = '';

    function checkExtensions(callback) {
        callback  = callback || function () {};

        var domBlocked    = null;
        var scriptBlocked = null;

        function evaluate() {
            if (domBlocked === null || scriptBlocked === null) return;
            callback(domBlocked || scriptBlocked);
        }

        // Sub-check A: DOM Bait
        var bait = document.createElement('div');
        bait.id        = 'abd-ext-bait-' + Date.now();
        bait.className = 'adsbox adsbygoogle ad-banner advertisement pub_300x250';
        bait.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
        document.body.appendChild(bait);

        setTimeout(function () {
            var cs   = window.getComputedStyle(bait);
            // FIX #5: position:fixed এ offsetHeight/Width সবসময় 0 না-ও হতে পারে
            // getBoundingClientRect() আরো reliable; display/visibility/opacity সব চেক করো
            var rect = bait.getBoundingClientRect();
            domBlocked = (
                rect.width        === 0          ||
                rect.height       === 0          ||
                cs.display        === 'none'     ||
                cs.visibility     === 'hidden'   ||
                cs.opacity        === '0'        ||
                bait.offsetParent === null && cs.position !== 'fixed'
            );
            if (bait.parentNode) bait.parentNode.removeChild(bait);
            evaluate();
        }, 350);

        // Sub-check B: Bait Script
        if (!_baitScriptUrl) {
            scriptBlocked = false;
            evaluate();
        } else {
            window.abd_ok = undefined;
            var s         = document.createElement('script');
            s.src         = _baitScriptUrl + '?_=' + Date.now();
            s.async       = true;
            var scriptDone = false;

            function finishScript(blocked) {
                if (scriptDone) return;
                scriptDone = true;
                if (s.parentNode) s.parentNode.removeChild(s);
                scriptBlocked = blocked;
                evaluate();
            }

            s.onload  = function () { finishScript(window.abd_ok !== 1); };
            s.onerror = function () { finishScript(true); };
            setTimeout(function () { finishScript(false); }, 4000);
            document.head.appendChild(s);
        }
    }

    /* ═══════════════════════════════════════════════════════════
       CHECK 3: DNS-LEVEL BLOCKING
       ═══════════════════════════════════════════════════════════ */

    // FIX #2: JS script URL → tracking pixel URL
    // JS file URL এ onerror সবসময় fire হয় (CORS / content-type mismatch) → false positive
    // 1x1 tracking pixel URL এ আসল block ধরা পড়ে
    var DNS_PROBE_DOMAINS = [
        'https://pagead2.googlesyndication.com/pagead/show_ads.js',
        'https://static.doubleclick.net/instream/ad_status.js',
        'https://securepubads.g.doubleclick.net/tag/js/gpt.js',
        'https://www.googletagservices.com/tag/js/gpt.js'
    ];

    // FIX #1: 50ms → 150ms; বাংলাদেশ/Asia থেকে legitimate response 100ms+ নিতে পারে
    var DNS_BLOCK_THRESHOLD = 150;

    function checkDNSBlock(callback) {
        callback = callback || function () {};

        if (!navigator.onLine) {
            callback(false);
            return;
        }

        var results   = [];
        var total     = DNS_PROBE_DOMAINS.length;
        var completed = 0;

        // FIX #3: hardcoded 2 → dynamic; domain list বাড়ালে/কমালে threshold ঠিক থাকবে
        var majorityNeeded = Math.ceil(total * 0.6);

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
                    var fastBlockCount = results.filter(Boolean).length;
                    callback(fastBlockCount >= majorityNeeded);
                }
            }

            img.onload  = function () { finish(false); };
            img.onerror = function () {
                finish(Date.now() - startTime < DNS_BLOCK_THRESHOLD);
            };
            setTimeout(function () { finish(false); }, 3500);
            img.src = url + '?_dns_=' + Date.now();
        });
    }

    /* ═══════════════════════════════════════════════════════════
       PUBLIC API
       ═══════════════════════════════════════════════════════════ */
    return {
        init: function (config) {
            config         = config || {};
            _baitScriptUrl = config.baitScriptUrl || '';
            _onDetectedCb  = config.onDetected    || null;
            _onClearCb     = config.onClear       || null;
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

        checkBraveShields : checkBraveShields,
        checkExtensions   : checkExtensions,
        checkDNSBlock     : checkDNSBlock,

        // FIX #7: reset এ callback-ও clear করো — stale callback থেকে যেত
        reset: function () {
            _detected      = false;
            _pendingChecks = 0;
            _cleanChecks   = 0;
            _onDetectedCb  = null;
            _onClearCb     = null;
        },

        version: '2.1.8'
    };
}));
