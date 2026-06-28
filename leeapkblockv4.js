/**
 * AbdDetector
 * Version: 2.2.2 (GA Optimized + Fast Detection)
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

    var _detected = false;
    var _onDetectedCb = null;
    var _onClearCb = null;
    var _pendingChecks = 0;
    var _cleanChecks = 0;
    var _fastTimedOut = false;
    var _baitScriptUrl = '';
    var _isGAReady = false;
    var _eventQueue = [];
    var _gaMeasurementId = '';

    /* ═══════════════════════════════════════════════════════════
       GA INTEGRATION HELPERS
       ═══════════════════════════════════════════════════════════ */
    function _trackGAEvent(eventName, params) {
        params = params || {};
        
        // GA রেডি থাকলে সরাসরি পাঠান
        if (_isGAReady && typeof gtag !== 'undefined') {
            gtag('event', eventName, params);
            return;
        }
        
        // না থাকলে Queue-তে রাখুন
        _eventQueue.push({ event: eventName, params: params });
        
        // Queue খুব বড় হলে ছোট করুন
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
        
        // GA ইভেন্ট পাঠান
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

        if (_pendingChecks === 0 && !_detected) {
            // ক্লিয়ার ইভেন্ট GA-তে পাঠান
            _trackGAEvent('no_adblock', {
                'page': window.location.pathname,
                'non_interaction': true
            });
            
            if (typeof _onClearCb === 'function') {
                _onClearCb();
            }
        }
    }

    /* ═══════════════════════════════════════════════════════════
       CHECK 1: BRAVE SHIELDS (OPTIMIZED)
       ═══════════════════════════════════════════════════════════ */
    function checkBraveShields(callback) {
        callback = callback || function () {};

        // ফাস্ট চেক: User Agent
        if (navigator.userAgent.indexOf('Brave') !== -1) {
            // ডিএনএস চেক (ফাস্ট)
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
                // 30ms এর কম হলে Brave Shield সক্রিয়
                done(elapsed < 30);
            };
            
            setTimeout(function () { done(false); }, 500);
            img.src = 'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/1/?ts=' + Date.now();
            return;
        }

        // স্লো চেক: navigator.brave (যদি উপলব্ধ থাকে)
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
                // দুইটা মেথডই কনফার্ম করলে ট্রু হবে
                callback(domBlocked && scriptBlocked);
            }
        }

        // — Sub-check A: DOM Bait (ফাস্ট) —
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

        // — Sub-check B: Bait Script (স্লো) —
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
            }, 2000); // 4s থেকে 2s-এ কমানো হলো
            
            document.head.appendChild(s);
        }
    }

    /* ═══════════════════════════════════════════════════════════
       CHECK 3: DNS-LEVEL BLOCKING (OPTIMIZED)
       ═══════════════════════════════════════════════════════════ */
    var DNS_PROBE_DOMAINS = [
        'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
        'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/1/',
        'https://securepubads.g.doubleclick.net/gampad/ads?',
        'https://tpc.googlesyndication.com/safeframe/1-0-40/html/container.html'
    ];

    var DNS_BLOCK_THRESHOLD = 30; // 30ms এর কম হলে ব্লক
    var DNS_MAJORITY_NEEDED = 2;

    function checkDNSBlock(callback) {
        callback = callback || function () {};

        // অফলাইন চেক (ইমপ্রুভড)
        if (!navigator.onLine) {
            // অফলাইন হলেও DNS চেক করার চেষ্টা করুন
            // কিছু অ্যাডব্লকার অফলাইনেও কাজ করে
        }

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
            }, 2000); // 3.5s থেকে 2s-এ কমানো
            
            timeoutIds.push(timeoutId);
            img.src = url + '?_dns_=' + Date.now() + '_' + index;
        });
    }

    /* ═══════════════════════════════════════════════════════════
       GA LOADER (INTEGRATED)
       ═══════════════════════════════════════════════════════════ */
    function _loadGA(measurementId) {
        if (!measurementId || _isGAReady) return;
        
        _gaMeasurementId = measurementId;
        
        // GA স্ক্রিপ্ট লোড করুন
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
            
            // Queue-তে থাকা ইভেন্টগুলো পাঠান
            _flushGAEvents();
        };
        script.onerror = function() {
            // GA লোড না হলেও AbdDetector কাজ করবে
            console.warn('GA failed to load, but AbdDetector is active');
        };
        document.head.appendChild(script);
    }

    /* ═══════════════════════════════════════════════════════════
       PUBLIC API
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
            _fastTimedOut = false;
            
            // GA ইনিশিয়ালাইজ করুন (যদি দেওয়া থাকে)
            if (config.gaMeasurementId) {
                _loadGA(config.gaMeasurementId);
            }

            // ফাস্ট টাইমআউট - 1500ms
            var fastTimeout = setTimeout(function() {
                _fastTimedOut = true;
            }, 1500);

            // === চেক ১: DNS (ফাস্টেস্ট) ===
            _pendingChecks++;
            checkDNSBlock(function (blocked) {
                if (blocked && !_detected) {
                    _trigger('dns');
                    clearTimeout(fastTimeout);
                }
                _checkComplete(blocked);
            });

            // === চেক ২: Brave (মাঝারি) ===
            _pendingChecks++;
            checkBraveShields(function (blocked) {
                if (blocked && !_detected) {
                    _trigger('brave_shields');
                    clearTimeout(fastTimeout);
                }
                _checkComplete(blocked);
            });

            // === চেক ৩: Extensions (স্লো, কিন্তু ফাস্ট ফলব্যাক) ===
            // 100ms পর চালান, ফাস্ট চেক শেষ হওয়ার জন্য অপেক্ষা
            setTimeout(function() {
                if (!_detected) {
                    _pendingChecks++;
                    checkExtensions(function (blocked) {
                        if (blocked && !_detected) {
                            _trigger('extension');
                            clearTimeout(fastTimeout);
                        }
                        _checkComplete(blocked);
                    });
                }
            }, 100);

            // 1500ms পরেও যদি ডিটেক্ট না হয়, ক্লিয়ার কল করুন
            setTimeout(function() {
                if (!_detected && _pendingChecks === 0) {
                    // সব চেক কমপ্লিট হয়েছে কিন্তু ডিটেক্ট হয়নি
                }
            }, 2000);
        },

        // ইন্ডিপেন্ডেন্ট চেক মেথড
        checkBraveShields: checkBraveShields,
        checkExtensions: checkExtensions,
        checkDNSBlock: checkDNSBlock,

        // GA ম্যানুয়ালি সেট করার মেথড
        setGA: function(measurementId) {
            _loadGA(measurementId);
        },

        // ম্যানুয়ালি GA ইভেন্ট পাঠান
        trackEvent: function(eventName, params) {
            _trackGAEvent(eventName, params);
        },

        reset: function () {
            _detected = false;
            _pendingChecks = 0;
            _cleanChecks = 0;
            _fastTimedOut = false;
            _eventQueue = [];
        },
        
        version: '2.2.2'
    };
}));
