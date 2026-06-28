/**
 * AbdDetector — Leeapk Ad Block Detector Library
 * Version: 2.1.1
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
// checkExtensions ফাংশনের জন্য ফিক্স
function checkExtensions(callback) {
    callback = callback || function () {};
    var domBlocked = null;
    var scriptBlocked = null;
    var domDone = false;
    var scriptDone = false;

    function evaluate() {
        if (domBlocked === null || scriptBlocked === null) return;
        if (domDone && scriptDone) {
            callback(domBlocked && scriptBlocked);
        }
    }

    // DOM Bait
    var bait = document.createElement('div');
    // ... (কোড如前)
    setTimeout(function () {
        // ... (চেক)
        domBlocked = /* ... */;
        domDone = true;
        evaluate();
    }, 350);

    // Script Bait
    if (!_baitScriptUrl) {
        scriptBlocked = false;
        scriptDone = true;
        evaluate();
    } else {
        // ... (script লোড)
        var timeoutId = setTimeout(function() { 
            if (!scriptDone) {
                scriptBlocked = false;
                scriptDone = true;
                evaluate();
            }
        }, 4000);
        
        s.onload = function() {
            clearTimeout(timeoutId);
            scriptBlocked = window.abd_ok !== 1;
            scriptDone = true;
            evaluate();
        };
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
        version: '2.1.1'
    };
}));
