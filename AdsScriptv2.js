/**
 * AdsScript.js
 * v2.2.0 — Client-side Geo Detection via /cdn-cgi/trace
 */
(function () {
    'use strict';

    var cfg = window.AcrpConfig;
    if (!cfg) return;

    // -------------------------------------------------------
    // 1. /cdn-cgi/trace থেকে country detect করো (Cloudflare)
    //    Cache হয় না — সবসময় accurate।
    // -------------------------------------------------------
    function getCountry() {
        return fetch('/cdn-cgi/trace', { cache: 'no-store' })
            .then(function (r) { return r.text(); })
            .then(function (t) {
                var m = t.match(/loc=([A-Z]{2})/);
                return m ? m[1] : 'ALL';
            })
            .catch(function () { return 'ALL'; });
    }

    // -------------------------------------------------------
    // 2. Country অনুযায়ী popup config নির্ধারণ করো
    // -------------------------------------------------------
    function resolvePopupConfig(country) {
        var links    = cfg.global_links  || [];
        var cooldown = cfg.global_time   || 300000;
        var found    = false;

        if (cfg.geo_enabled && cfg.geo_rules && cfg.geo_rules.length) {
            for (var i = 0; i < cfg.geo_rules.length; i++) {
                var rule = cfg.geo_rules[i];
                if (rule.country === country && rule.links && rule.links.length) {
                    links    = rule.links;
                    cooldown = rule.time || cooldown;
                    found    = true;
                    break;
                }
            }
        }

        // Global disabled এবং geo match নেই — কিছু দেখাবো না
        if (!found && !cfg.global_enabled) return null;
        if (!links.length) return null;

        return { links: links, cooldown: cooldown };
    }

    // -------------------------------------------------------
    // 3. Cooldown check (localStorage)
    // -------------------------------------------------------
    var STORAGE_KEY = 'acrp_last_popup';

    function isCoolingDown(cooldown) {
        try {
            var last = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
            return (Date.now() - last) < cooldown;
        } catch (e) { return false; }
    }

    function setCooldown() {
        try { localStorage.setItem(STORAGE_KEY, Date.now().toString()); } catch (e) {}
    }

    // -------------------------------------------------------
    // 4. Popup open করো
    // -------------------------------------------------------
    var _triggered = false;

    function openPopup(links) {
        if (_triggered) return;
        _triggered = true;

        var url = links[Math.floor(Math.random() * links.length)];
        setCooldown();

        try {
            var w = window.open(url, '_blank');
            // Pop-under: নতুন window টা পেছনে পাঠাও
            if (w) {
                w.blur();
                window.focus();
            }
        } catch (e) {
            // Popup blocked হলে location change করো (fallback)
            window.location.href = url;
        }
    }

    // -------------------------------------------------------
    // 5. Trigger setup
    // -------------------------------------------------------
    function setupTrigger(resolved) {
        var links    = resolved.links;
        var cooldown = resolved.cooldown;
        var type     = cfg.trigger_type || 'anywhere';
        var sel      = cfg.trigger_sel  || '.click-trigger';

        if (isCoolingDown(cooldown)) return;

        if (type === 'anywhere') {
            // যেকোনো জায়গায় click করলে popup
            document.addEventListener('click', function handler() {
                if (!isCoolingDown(cooldown)) {
                    openPopup(links);
                }
                document.removeEventListener('click', handler);
            }, { once: true });

        } else if (type === 'class') {
            // শুধু নির্দিষ্ট selector-এ click করলে popup
            document.querySelectorAll(sel).forEach(function (el) {
                el.addEventListener('click', function (e) {
                    if (!isCoolingDown(cooldown)) {
                        // Default action (href) যেতে দাও, popup আলাদা খুলবে
                        openPopup(links);
                    }
                });
            });
        }
    }

    // -------------------------------------------------------
    // 6. Main — country detect করে সব কিছু চালাও
    // -------------------------------------------------------
    getCountry().then(function (country) {
        var resolved = resolvePopupConfig(country);
        if (!resolved) return;
        setupTrigger(resolved);
    });

})();
