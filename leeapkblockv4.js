/**
 * AbdDetector — Leeapk Ad Block Detector Library
 * Version: 2.2.1 (CRITICAL FIX)
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
    var _baitScriptUrl = '';
    var _isGAReady = false;
    var _eventQueue = [];
    var _gaMeasurementId = '';
    var _checkCompleted = false;

    /* ═══════════════════════════════════════════════════════════
       GA INTEGRATION HELPERS
       ═══════════════════════════════════════════════════════════ */
    function _trackGAEvent(eventName, params) {
        params = params || {};
        
        if (_isGAReady && typeof gtag !== 'undefined') {
            gtag('event', eventName, params);
            return;
        }
        
        _eventQueue.push({ event: eventName, params: params });
        
        if (_eventQueue.length > 50) {
            _eventQueue.shift();
        }
    }

    function _flushGAEvents() {
        while (_eventQueue.length > 0) {
            var evt = _eventQueue.shift();
            if (typeof gtag !== 'undefined') {
                gtag('event', evt.event, evt.params);
            }
        }
    }

    /* ═══════════════════════════════════════════════════════════
       CORE DETECTION LOGIC
       ═══════════════════════════════════════════════════════════ */
    function _trigger(method) {
        if (_detected) return;
        _detected = true;
        
        _trackGAEvent('adblock_detected', {
            'method': method,
            'page': window.location.pathname,
            'non_interaction': true
        });
        
        if (typeof _onDetectedCb === 'function') {
            _onDetectedCb(method);
        }
    }

    function _checkComplete(isBlocked) {
        _pendingChecks--;
        
        if (!isBlocked) _cleanChecks++;

        // সব চেক কমপ্লিট হলে এবং ডিটেক্ট না হলে
        if (_pendingChecks <= 0 && !_detected) {
            if (!_checkCompleted) {
                _checkCompleted = true;
                
                _trackGAEvent('no_adblock', {
                    'page': window.location.pathname,
                    'non_interaction': true
                });
                
                if (typeof _onClearCb === 'function') {
                    _onClearCb();
                }
            }
        }
    }

    /* ═══════════════════════════════════════════════════════════
       CHECK 1: BRAVE SHIELDS
       ═══════════════════════════════════════════════════════════ */
    function checkBraveShields(callback) {
        callback = callback || function () {};

        // ফাস্ট চেক: User Agent
        if (navigator.userAgent.indexOf('Brave') !== -1) {
            var img = new Image();
            var startTime = Date.now();
            var finished = false;
            
            function done(blocked) {
                if (finished) return;
                finished = true;
                callback(blocked);
            }
            
            img.onload = function () { done(false); };
            img.onerror = function () {
                var elapsed = Date.now() - startTime;
                done(elapsed < 30);
            };
            
            setTimeout(function () { done(false); }, 500);
            img.src = 'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/1/?ts=' + Date.now();
            return;
        }

        // স্লো চেক: navigator.brave
        if (!navigator.brave || typeof navigator.brave.isBrave !== 'function') {
            callback(false);
            return;
        }

        navigator.brave.isBrave().then(function (isBrave) {
            if (!isBrave) {
                callback(false);
                return;
            }

            var img = new Image();
            var startTime = Date.now();
            var finished = false;

            function done(blocked) {
                if (finished) return;
                finished = true;
                callback(blocked);
            }

            img.onload = function () { done(false); };
            img.onerror = function () {
                var elapsed = Date.now() - startTime;
                done(elapsed < 30);
            };

            setTimeout(function () { done(false); }, 500);
            img.src = 'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/1/?ts=' + Date.now();

        }).catch(function () {
            callback(false);
        });
    }

    /* ═══════════════════════════════════════════════════════════
       CHECK 2: EXTENSIONS (FIXED)
       ═══════════════════════════════════════════════════════════ */
    function checkExtensions(callback) {
        callback = callback || function () {};
        var domBlocked = null;
        var scriptBlocked = null;
        var domDone = false;
        var scriptDone = false;
        var timeoutId = null;

        function evaluate() {
            if (domBlocked === null || scriptBlocked === null) return;
            if (domDone && scriptDone) {
                callback(domBlocked && scriptBlocked);
            }
        }

        // DOM Bait
        var bait = document.createElement('div');
        bait.id = 'abd-ext-bait-' + Date.now();
        bait.className = ['adsbox', 'adsbygoogle', 'ad-banner', 'advertisement', 'pub_300x250'].join(' ');
        bait.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
        document.body.appendChild(bait);

        setTimeout(function () {
            var cs = window.getComputedStyle(bait);
            domBlocked = (
                bait.offsetHeight === 0 ||
                bait.offsetWidth === 0 ||
                cs.display === 'none' ||
                cs.visibility === 'hidden'
            );
            domDone = true;
            bait.parentNode && bait.parentNode.removeChild(bait);
            evaluate();
        }, 350);

        // Script Bait
        if (!_baitScriptUrl) {
            scriptBlocked = false;
            scriptDone = true;
            evaluate();
        } else {
            window.abd_ok = undefined;
            var s = document.createElement('script');
            s.src = _baitScriptUrl + '?_=' + Date.now();
            s.async = true;
            var scriptFinished = false;

            function finishScript(blocked) {
                if (scriptFinished) return;
                scriptFinished = true;
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                s.parentNode && s.parentNode.removeChild(s);
                scriptBlocked = blocked;
                scriptDone = true;
                evaluate();
            }

            s.onload = function () {
                finishScript(window.abd_ok !== 1);
            };
            s.onerror = function () {
                finishScript(true);
            };

            timeoutId = setTimeout(function () { 
                finishScript(false); 
            }, 2000);
            
            document.head.appendChild(s);
        }
    }

    /* ═══════════════════════════════════════════════════════════
       CHECK 3: DNS-LEVEL BLOCKING
       ═══════════════════════════════════════════════════════════ */
    var DNS_PROBE_DOMAINS = [
        'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
        'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/1/',
        'https://securepubads.g.doubleclick.net/gampad/ads?',
        'https://tpc.googlesyndication.com/safeframe/1-0-40/html/container.html'
    ];

    var DNS_BLOCK_THRESHOLD = 30;
    var DNS_MAJORITY_NEEDED = 2;

    function checkDNSBlock(callback) {
        callback = callback || function () {};

        var results = [];
        var total = DNS_PROBE_DOMAINS.length;
        var completed = 0;
        var timeoutIds = [];

        DNS_PROBE_DOMAINS.forEach(function (url, index) {
            var img = new Image();
            var startTime = Date.now();
            var done = false;
            var timeoutId = null;

            function finish(fastBlocked) {
                if (done) return;
                done = true;
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                results[index] = fastBlocked;
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

            timeoutId = setTimeout(function () { 
                finish(false); 
            }, 2000);
            
            timeoutIds.push(timeoutId);
            img.src = url + '?_dns_=' + Date.now() + '_' + index;
        });
    }

    /* ═══════════════════════════════════════════════════════════
       GA LOADER
       ═══════════════════════════════════════════════════════════ */
    function _loadGA(measurementId) {
        if (!measurementId || _isGAReady) return;
        
        _gaMeasurementId = measurementId;
        
        var script = document.createElement('script');
        script.async = true;
        script.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
        script.onload = function() {
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', measurementId, {
                'custom_map': {
                    'dimension1': 'adblock_method',
                    'dimension2': 'adblock_status'
                }
            });
            _isGAReady = true;
            _flushGAEvents();
        };
        script.onerror = function() {
            console.warn('GA failed to load, but AbdDetector is active');
        };
        document.head.appendChild(script);
    }

    /* ═══════════════════════════════════════════════════════════
       PUBLIC API (FIXED)
       ═══════════════════════════════════════════════════════════ */
    return {
        init: function (config) {
            config = config || {};
            _baitScriptUrl = config.baitScriptUrl || '';
            _onDetectedCb = config.onDetected || null;
            _onClearCb = config.onClear || null;
            _detected = false;
            _cleanChecks = 0;
            _pendingChecks = 0;
            _checkCompleted = false;
            
            // GA ইনিশিয়ালাইজ করুন
            if (config.gaMeasurementId) {
                _loadGA(config.gaMeasurementId);
            }

            // টোটাল চেক কাউন্ট সেট করুন
            var totalChecks = 3; // DNS, Brave, Extension
            
            // === চেক ১: DNS (ফাস্টেস্ট) ===
            _pendingChecks++;
            checkDNSBlock(function (blocked) {
                if (blocked && !_detected) {
                    _trigger('dns');
                }
                _checkComplete(blocked);
            });

            // === চেক ২: Brave (মাঝারি) ===
            _pendingChecks++;
            checkBraveShields(function (blocked) {
                if (blocked && !_detected) {
                    _trigger('brave_shields');
                }
                _checkComplete(blocked);
            });

            // === চেক ৩: Extensions (স্লো) ===
            _pendingChecks++;
            // Extension চেক এখনই রান করবে, setTimeout ছাড়া
            checkExtensions(function (blocked) {
                if (blocked && !_detected) {
                    _trigger('extension');
                }
                _checkComplete(blocked);
            });

            // ব্যাকআপ টাইমার: 3 সেকেন্ড পরেও যদি কিছু না হয়
            setTimeout(function() {
                if (!_detected && _pendingChecks > 0) {
                    // পেন্ডিং চেকগুলো ফোর্স কমপ্লিট করুন
                    while (_pendingChecks > 0) {
                        _checkComplete(false);
                    }
                }
            }, 3000);
        },

        checkBraveShields: checkBraveShields,
        checkExtensions: checkExtensions,
        checkDNSBlock: checkDNSBlock,

        setGA: function(measurementId) {
            _loadGA(measurementId);
        },

        trackEvent: function(eventName, params) {
            _trackGAEvent(eventName, params);
        },

        reset: function () {
            _detected = false;
            _pendingChecks = 0;
            _cleanChecks = 0;
            _checkCompleted = false;
            _eventQueue = [];
        },
        
        version: '2.2.1'
    };
}));
