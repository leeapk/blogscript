/**
 * AbdDetector — Leeapk Ad Block Detector Library
 * Version: 2.2.0
 * Author: Mr. Lee
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

    function _trigger(method) {
        if (_detected) return;
        _detected = true;
        if (typeof _onDetectedCb === 'function') _onDetectedCb(method);
    }

    function _checkComplete(isBlocked) {
        _pendingChecks--;
        if (_pendingChecks === 0 && !_detected) {
            if (typeof _onClearCb === 'function') _onClearCb();
        }
    }

    /* ══════════════════════════════════════════
       CHECK 1: BRAVE SHIELDS
    ══════════════════════════════════════════ */
    function checkBraveShields(callback) {
        callback = callback || function () {};

        if (!navigator.brave || typeof navigator.brave.isBrave !== 'function') {
            callback(false);
            return;
        }

        navigator.brave.isBrave().then(function (isBrave) {
            if (!isBrave) { callback(false); return; }

            // Brave confirm হয়েছে — এখন Shields ON/OFF check
            var img       = new Image();
            var startTime = Date.now();
            var finished  = false;

            function done(blocked) {
                if (finished) return;
                finished = true;
                callback(blocked);
            }

            img.onload  = function () { done(false); };
            img.onerror = function () {
                // Shields ON → instant block (< 80ms)
                // Shields OFF → normal network error (>= 80ms)
                done(Date.now() - startTime < 80);
            };
            setTimeout(function () { done(false); }, 4000);

            // FIX: doubleclick.net DNS probe এর সাথে conflict এড়াতে
            // আলাদা URL ব্যবহার করো
            img.src = 'https://static.ads-twitter.com/uwt.js?_=' + Date.now();

        }).catch(function () { callback(false); });
    }

    /* ══════════════════════════════════════════
       CHECK 2: BROWSER EXTENSIONS (DOM bait)
    ══════════════════════════════════════════ */
    var _baitScriptUrl = '';

    function checkExtensions(callback) {
        callback = callback || function () {};

        // — DOM Bait — (primary, always runs)
        var bait = document.createElement('div');
        bait.id        = 'abd-bait-' + Date.now();
        bait.className = 'adsbox adsbygoogle ad-banner advertisement pub_300x250 banner-ads';
        bait.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
        document.body.appendChild(bait);

        setTimeout(function () {
            var cs         = window.getComputedStyle(bait);
            var domBlocked = (
                bait.offsetHeight === 0 ||
                bait.offsetWidth  === 0 ||
                cs.display        === 'none' ||
                cs.visibility     === 'hidden' ||
                cs.opacity        === '0'
            );
            bait.parentNode && bait.parentNode.removeChild(bait);

            // FIX: DOM check-ই primary। bait script optional (OR logic)
            if (domBlocked) {
                callback(true);
                return;
            }

            // DOM blocked না হলে bait script চেক করো
            if (!_baitScriptUrl) {
                callback(false);
                return;
            }

            window.abd_ok  = undefined;
            var s          = document.createElement('script');
            s.src          = _baitScriptUrl + '?_=' + Date.now();
            s.async        = true;
            var scriptDone = false;

            function finishScript(blocked) {
                if (scriptDone) return;
                scriptDone = true;
                s.parentNode && s.parentNode.removeChild(s);
                callback(blocked);
            }

            s.onload  = function () { finishScript(window.abd_ok !== 1); };
            s.onerror = function () { finishScript(true); };
            setTimeout(function () { finishScript(false); }, 4000);
            document.head.appendChild(s);

        }, 350);
    }

    /* ══════════════════════════════════════════
       CHECK 3: DNS-LEVEL BLOCKING
    ══════════════════════════════════════════ */
    // FIX: নিজের domain এর fake ad path + ভিন্ন third-party ad URL
    // doubleclick.net এর সাথে Brave check conflict এড়ানো হয়েছে
    var DNS_PROBE_DOMAINS = [
        'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
        'https://securepubads.g.doubleclick.net/tag/js/gpt.js'
    ];

    var DNS_BLOCK_THRESHOLD = 100; // FIX: 50→100ms, slow network false positive কমায়
    var DNS_MAJORITY_NEEDED = 2;

    function checkDNSBlock(callback) {
        callback = callback || function () {};

        if (!navigator.onLine) { callback(false); return; }

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
                if (++completed === total) {
                    callback(results.filter(Boolean).length >= DNS_MAJORITY_NEEDED);
                }
            }

            img.onload  = function () { finish(false); };
            img.onerror = function () { finish(Date.now() - startTime < DNS_BLOCK_THRESHOLD); };
            setTimeout(function () { finish(false); }, 4000);
            img.src = url + '?_dns_=' + Date.now();
        });
    }

    /* ══════════════════════════════════════════
       PUBLIC API
    ══════════════════════════════════════════ */
    return {
        init: function (config) {
            config         = config || {};
            _baitScriptUrl = config.baitScriptUrl || '';
            _onDetectedCb  = config.onDetected    || null;
            _onClearCb     = config.onClear       || null;
            _detected      = false;
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

        reset: function () {
            _detected      = false;
            _pendingChecks = 0;
        },
        version: '2.2.0'
    };
}));
