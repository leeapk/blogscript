(function(){
    if (typeof window.AcrpConfig === 'undefined') return;
    const conf = window.AcrpConfig;
    
    document.addEventListener("click", function(e) {
        if (conf.type === 'anywhere') { 
        } else { 
            if (!e.target.closest(conf.sel)) return; 
        }
        
        const now = Date.now();
        const last = parseInt(localStorage.getItem("acrp_l") || 0);
        if (now - last < conf.cool) return;
        
        let i = parseInt(localStorage.getItem("acrp_i") || 0);
        localStorage.setItem("acrp_l", now);
        localStorage.setItem("acrp_i", (i + 1) % conf.links.length);
        
        window.open(conf.links[i % conf.links.length], "_blank");
    });
})();
