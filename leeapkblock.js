/**
 * AbdDetector — Leeapk Ad Block Detector Library
 * Version: 2.1.5 (False-Positive Fixed)
 * Author: Mr. Lee (leeapk.com)
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AbdDetector = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

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
            var DNS_FAST_THRESHOLD = 80; // ফলস পজিটিভ এড়াতে থ্রেশহোল্ড কমানো হলো

            function done(blocked) {
                if (finished) return;
                finished = true;
                callback(blocked);
            }

            img.onload = function () { done(false); };
            img.onerror = function () {
                var elapsed = Date.now() - startTime;
                if (elapsed < DNS_FAST_THRESHOLD) {
                    done(true); 
                } else {
                    done(false); 
                }
            };

            // স্লো নেটের কারণে যাতে ইউজার ট্র্যাপে না পড়ে তাই টাইমাউট ফলব্যাক 'false' করা হলো
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
        callback = callback || function () {};
        var domBlocked    = null;
        var scriptBlocked = null;

        function evaluate() {
            if (domBlocked === null || scriptBlocked === null) return;
            // দুইটা মেথডই যখন কনফার্ম করবে তখনই ট্রু হবে (False positive prevention)
            callback(domBlocked && scriptBlocked);
        }

        // — Sub-check A: DOM Bait —
        var bait = document.createElement('div');
        bait.id = 'abd-ext-bait-' + Date.now();
        bait.className = ['adsbox', 'adsbygoogle', 'ad-banner', 'advertisement', 'pub_300x250'].join(' ');
        bait.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
        document.body.appendChild(bait);

        setTimeout(function () {
            var cs = window.getComputedStyle(bait);
            domBlocked = (
                bait.offsetHeight === 0 ||
                bait.offsetWidth  === 0 ||
                cs.display        === 'none' ||
                cs.visibility     === 'hidden'
            );
            bait.parentNode && bait.parentNode.removeChild(bait);
            evaluate();
        }, 350);

        // — Sub-check B: Bait Script —
        if (!_baitScriptUrl) { // 'leeapk' স্ট্রিং চেকিং বাগটি রিমুভ করা হলো
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
                finishScript(window.abd_ok !== 1);
            };
            s.onerror = function () {
                finishScript(true);
            };

            // নেট স্লো হলে অ্যাড ব্লকার ভেবে ভুল করবে না
            setTimeout(function () { finishScript(false); }, 4000);
            document.head.appendChild(s);
        }
    }

    /* ═══════════════════════════════════════════════════════════
       CHECK 3: DNS-LEVEL BLOCKING
       ═══════════════════════════════════════════════════════════ */
    var DNS_PROBE_DOMAINS = [
        'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
        'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/1/'
    ];

    var DNS_BLOCK_THRESHOLD    = 50;  // ৫০ মিলি সেকেন্ডের নিচে হলে তবেই লোকাল ফিল্টারিং (Pi-hole) নিশ্চিত হবে
    var DNS_MAJORITY_NEEDED    = 2;  

    function checkDNSBlock(callback) {
        callback = callback || function () {};

        // ইউজার যদি অফলাইনে থাকে তবে ডিএনএস ব্লকিং চেক স্কিপ করবে
        if (!navigator.onLine) {
            callback(false);
            return;
        }

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
                    var fastBlockCount = results.filter(Boolean).length;
                    callback(fastBlockCount >= DNS_MAJORITY_NEEDED);
                }
            }

            img.onload = function () { finish(false); };
            img.onerror = function () {
                var elapsed = Date.now() - startTime;
                finish(elapsed < DNS_BLOCK_THRESHOLD);
            };

            // নেট স্লো ট্র্যাপ রিলিজ
            setTimeout(function () { finish(false); }, 3500);
            img.src = url + '?_dns_=' + Date.now();
        });
    }

    /* ═══════════════════════════════════════════════════════════
       PUBLIC API
       ═══════════════════════════════════════════════════════════ */
    return {
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

        checkBraveShields: checkBraveShields,
        checkExtensions: checkExtensions,
        checkDNSBlock: checkDNSBlock,

        reset: function () {
            _detected      = false;
            _pendingChecks = 0;
            _cleanChecks   = 0;
        },
        version: '2.1.5'
    };
}));
