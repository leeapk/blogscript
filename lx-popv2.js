/**
 * lx-popv2.js
 * v3.3.0 — Stealth pop-under (LeeAPK 2026-11-24)
 * Same logic as AdsScriptv3.js (v3.0.0), renamed to a neutral filename
 * so ad blockers have no "Ads" hook in the URL. Requires Ads Manager
 * plugin v2.5.16+ (it sets window.__lxCfg, routes popup links through
 * the same-domain ?lxgo= redirect, and loads this file).
 *
 * Based on v2.2.0. Logic is IDENTICAL (geo via /cdn-cgi/trace,
 * global + geo popup links, cooldown, 'anywhere' / 'class' triggers,
 * pop-under open + location fallback). Only the detectable names
 * changed, so ad blockers have no static hook to target:
 *   - window.AcrpConfig  -> window.__lxCfg
 *   - localStorage key 'acrp_last_popup' -> 'lx_last_open'
 * Requires Ads Manager plugin v2.5.16+ (it sets window.__lxCfg and
 * loads this file). Upload this file to the leeapk/blogscript repo
 * as lx-popv2.js FIRST, then install the v2.5.16 plugin.
 *
 * v3.3.0 NOTE: same logic as v3.2.0 (cooldown fix). New filename only
 * — jsDelivr was still serving the cached v3.1.0 copy of lx-pop.js
 * after the v3.2.0 upload, so a new filename forces jsDelivr to fetch
 * the fresh file from GitHub.
 *
 * v3.2.0 FIX (2026-11-24): AdGuard blocks window.open (returns null),
 * but the old code called setCooldown() BEFORE window.open and removed
 * the click trigger after the first click. So one blocked attempt set
 * a 5-minute cooldown AND consumed the trigger — the popup could never
 * show again until the cooldown expired, and then it was blocked again.
 * Now the cooldown and the "triggered" flag are set ONLY when
 * window.open actually returns a window (success). When blocked, the
 * trigger stays armed so the next click retries. The old
 * window.location.href fallback (which hijacked the current tab when
 * window.open threw) is removed — a blocked popup no longer navigates
 * the user away from the site.
 */
(function () {
    'use strict';

    var cfg = window.__lxCfg;
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
    var STORAGE_KEY = 'lx_last_open';

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
    // 4. Popup open করো — সফল হলেই কেবল cooldown + triggered
    //    (v3.2.0: AdGuard window.open ব্লক করলে null দেয়; আগের কোড
    //    window.open-এর আগেই cooldown সেট করে ফেলত আর trigger খেয়ে
    //    ফেলত, তাই ব্লক হওয়া মাত্র ৫ মিনিটের জন্য লক হয়ে যেত।)
    // -------------------------------------------------------
    var _triggered = false;

    function openPopup(links) {
        if (_triggered) return false;

        var url = links[Math.floor(Math.random() * links.length)];

        try {
            var w = window.open(url, '_blank');
            if (w) {
                // Popup আসলেই খুলেছে — এখনই triggered + cooldown সেট করো।
                _triggered = true;
                setCooldown();
                // Pop-under: নতুন window টা পেছনে পাঠাও
                w.blur();
                window.focus();
                return true;
            }
            // window.open null দিয়েছে (ব্লকার আটকেছে) — cooldown সেট
            // করো না, triggered ও না, যাতে পরের ক্লিকে আবার চেষ্টা হয়।
            return false;
        } catch (e) {
            // Exception হলেও একই — cooldown না, retry চলবে।
            return false;
        }
    }

    // -------------------------------------------------------
    // 5. Trigger setup — ব্লক হলে trigger খেয়ে ফেলো না
    // -------------------------------------------------------
    function setupTrigger(resolved) {
        var links    = resolved.links;
        var cooldown = resolved.cooldown;
        var type     = cfg.trigger_type || 'anywhere';
        var sel      = cfg.trigger_sel  || '.click-trigger';

        if (isCoolingDown(cooldown)) return;

        if (type === 'anywhere') {
            // যেকোনো জায়গায় click করলে popup. { once: true } আর নেই —
            // সফলভাবে খুললেই কেবল listener সরানো হবে; ব্লক হলে পরের
            // ক্লিকে আবার চেষ্টা হবে।
            var handler = function () {
                if (isCoolingDown(cooldown)) {
                    document.removeEventListener('click', handler);
                    return;
                }
                if (openPopup(links)) {
                    document.removeEventListener('click', handler);
                }
            };
            document.addEventListener('click', handler);

        } else if (type === 'class') {
            // শুধু নির্দিষ্ট selector-এ click করলে popup.
            // Listener থেকেই যায় — ব্লক হলে পরের ক্লিকে retry হবে;
            // সফল হলে _triggered গার্ড আর popup খুলতে দেবে না।
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
