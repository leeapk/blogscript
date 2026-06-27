(function(){
    // কনফিগারেশন এবং লিঙ্ক অ্যারে ঠিকঠাক আছে কিনা চেক
    if (typeof window.AcrpConfig === 'undefined' || !window.AcrpConfig.links) return;
    const conf = window.AcrpConfig;
    
    // নিশ্চিত হওয়া যে links একটি সঠিক অ্যারে (প্লাগইনের জিও ডেটা অনেক সময় অবজেক্ট আকারে আসতে পারে)
    let linksArray = Array.isArray(conf.links) ? conf.links : Object.values(conf.links);
    if (linksArray.length === 0) return;

    // হাই-ট্রাফিকের জন্য passive: true ব্যবহার করা হয়েছে
    document.addEventListener("click", function(e) {
        
        // ট্রিগার টাইপ চেক
        if (conf.type !== 'anywhere') { 
            if (conf.sel && !e.target.closest(conf.sel)) return; 
        }
        
        // কুলডাউন (Cooldown) বা টাইম লিমিট চেক
        const now = Date.now();
        const last = parseInt(localStorage.getItem("acrp_l") || 0, 10);
        if (now - last < conf.cool) return;
        
        // জেনুইন জিо-টার্গেটেড লিঙ্ক র্যান্ডমলি সিলেক্ট করা
        const randomIndex = Math.floor(Math.random() * linksArray.length);
        const targetLink = linksArray[randomIndex];
        
        // লাস্ট পপ-আপ টাইম সেভ করা
        localStorage.setItem("acrp_l", now);
        
        // পপ-আন্ডার উইন্ডো ওপেনিং
        const newWindow = window.open(targetLink, "_blank");
        if (newWindow) {
            newWindow.blur(); // বিজ্ঞাপন উইন্ডোকে পেছনে পাঠাবে
            window.focus();   // আপনার মূল সাইটকে সামনে রাখবে
        }
        
    }, { passive: true });
})(); // <--- আপনার কোডে এই ব্র্যাকেট ও প্যারেন্থেসিসটি মিসিং ছিল
