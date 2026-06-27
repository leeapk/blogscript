(function(){
    // কনফিগারেশন চেক (যদি সাইটে প্লাগইন একটিভ না থাকে তবে স্ক্রিপ্ট থেমে যাবে)
    if (typeof window.AcrpConfig === 'undefined' || !window.AcrpConfig.links || window.AcrpConfig.links.length === 0) return;
    const conf = window.AcrpConfig;
    
    // হাই-ট্রাফিকের জন্য passive: true ব্যবহার করা হয়েছে, যা ব্রাউজার স্ক্রোল বা ক্লিক ল্যাগ কমায়
    document.addEventListener("click", function(e) {
        
        // ট্রিগার টাইপ চেক
        if (conf.type !== 'anywhere') { 
            if (!e.target.closest(conf.sel)) return; 
        }
        
        // কোoldown (Cooldown) বা টাইম লিমিট চেক
        const now = Date.now();
        const last = parseInt(localStorage.getItem("acrp_l") || 0, 10);
        if (now - last < conf.cool) return;
        
        // --- হাই-ট্রাফিক অপ্টিমাইজেশন (র্যান্ডম রোটেশন) ---
        // ১০,০০০+ ভিজিটর একই সাথে ক্লিক করলে লোকাল স্টোরেজে সিরিয়াল (i+1) মেইনটেইন করা ব্রাউজারকে স্লো করে।
        // তার চেয়ে র্যান্ডমলি লিঙ্ক পিক করলে সব লিঙ্কে সমান ট্রাফিক যাবে এবং ব্রাউজার ১ মিলিসেকেন্ডও ল্যাগ করবে না।
        const randomIndex = Math.floor(Math.random() * conf.links.length);
        const targetLink = conf.links[randomIndex];
        
        // লাস্ট পপ-আপ টাইম সেভ করা
        localStorage.setItem("acrp_l", now);
        
        // পপ-আন্ডার উইন্ডো ওপেনিং (পপ-আপ ব্লকার বাইপাস করার জন্য এবং ব্রাউজার ক্র্যাশ ঠেকাতে)
        const newWindow = window.open(targetLink, "_blank");
        if (newWindow) {
            newWindow.blur(); // নতুন উইন্ডোকে পেছনে পাঠাবে
            window.focus();   // আপনার মূল সাইটকে ভিজিটরের সামনে ফোকাসে রাখবে
        }
        
    }, { passive: true });
})();
