(function(){
    if (typeof window.AcrpConfig === 'undefined' || !window.AcrpConfig.links) return;
    const conf = window.AcrpConfig;
    let linksArray = Array.isArray(conf.links) ? conf.links : Object.values(conf.links);
    if (linksArray.length === 0) return;ে
    document.addEventListener("click", function(e) {
        if (conf.type !== 'anywhere') { 
            if (conf.sel && !e.target.closest(conf.sel)) return; 
        }
        const now = Date.now();
        const last = parseInt(localStorage.getItem("acrp_l") || 0, 10);
        if (now - last < conf.cool) return;
        const randomIndex = Math.floor(Math.random() * linksArray.length);
        const targetLink = linksArray[randomIndex];
        localStorage.setItem("acrp_l", now);
        const newWindow = window.open(targetLink, "_blank");
        if (newWindow) {
            newWindow.blur();
            window.focus();
        }
        
    }, { passive: true });
})();
