// Invoice Pro — Settings Page JS (settings.js)
import {
    db, doc, getDoc, setDoc, updateDoc,
    requireAdmin, getCurrentUser, buildPageTopbar,
    showToast, confirmModal, CACHE_KEYS, appCache
} from '../js/shared.js';

window.addEventListener('DOMContentLoaded', async () => {
    if (!requireAdmin()) return;
    buildPageTopbar({ title: '⚙️ সেটিংস', subtitle: 'অ্যাপ কনফিগারেশন', backUrl: '../admin.html' });

    document.getElementById('settingCurrentUser').textContent = getCurrentUser() || '—';

    bindUI();
    await loadSettings();
});

async function loadSettings() {
    try {
        const snap = await getDoc(doc(db, "settings", "company"));
        if (snap.exists()) {
            const data = snap.data();
            document.getElementById('settingCompanyDetails').value = data.companyDetails || '';
            document.getElementById('settingDefaultNote').value = data.defaultNote || '';
            document.getElementById('settingPaymentInfo').value = data.paymentInfo || '';
        }
        
        const adminSnap = await getDoc(doc(db, "users", "admin"));
        if (adminSnap.exists()) {
            document.getElementById('currentPassword').value = adminSnap.data().password || '';
        }
    } catch (e) {
        // Load from appCache fallback
        try {
            const cached = await appCache.get(CACHE_KEYS.SETTINGS);
            if (cached) {
                const data = typeof cached === 'string' ? JSON.parse(cached) : cached;
                document.getElementById('settingCompanyDetails').value = data.companyDetails || '';
                document.getElementById('settingDefaultNote').value = data.defaultNote || '';
                document.getElementById('settingPaymentInfo').value = data.paymentInfo || '';
            }
        } catch {}
    }
}

function bindUI() {
    document.getElementById('saveShopInfoBtn').onclick = saveShopInfo;
    document.getElementById('changePasswordBtn').onclick = changePassword;
    
    document.getElementById('togglePasswordVisibility').onclick = function() {
        const input = document.getElementById('currentPassword');
        if (input.type === 'password') {
            input.type = 'text';
            this.textContent = '🙈';
        } else {
            input.type = 'password';
            this.textContent = '👁️';
        }
    };
}

async function saveShopInfo() {
    const data = {
        companyDetails: document.getElementById('settingCompanyDetails').value.trim(),
        defaultNote:    document.getElementById('settingDefaultNote').value.trim(),
        paymentInfo:    document.getElementById('settingPaymentInfo').value.trim(),
    };

    const btn = document.getElementById('saveShopInfoBtn');
    btn.disabled = true; btn.textContent = '⏳ সেভ হচ্ছে...';

    try {
        await setDoc(doc(db, "settings", "company"), { ...data, updatedAt: new Date() }, { merge: true });
        await appCache.set(CACHE_KEYS.SETTINGS, data);
        showToast('সেটিংস সেভ হয়েছে', 'success');
    } catch (e) {
        showToast('সেভ করা যায়নি: ' + e.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = '✅ সেভ ডিফল্ট';
    }
}

async function changePassword() {
    const current = document.getElementById('currentPassword').value;
    const newPass  = document.getElementById('newPassword').value;
    const confirm  = document.getElementById('confirmPassword').value;

    if (!current || !newPass || !confirm) { showToast('সব ঘর পূরণ করুন', 'warning'); return; }
    if (newPass !== confirm) { showToast('নতুন পাসওয়ার্ড মিলছে না', 'error'); return; }
    if (newPass.length < 4)  { showToast('পাসওয়ার্ড কমপক্ষে ৪ অক্ষর হতে হবে', 'warning'); return; }

    const btn = document.getElementById('changePasswordBtn');
    btn.disabled = true;

    try {
        const snap = await getDoc(doc(db, "users", "admin"));
        if (!snap.exists()) { showToast('Admin ব্যবহারকারী পাওয়া যায়নি', 'error'); return; }
        if (snap.data().password !== current) { showToast('বর্তমান পাসওয়ার্ড সঠিক নয়', 'error'); return; }

        await updateDoc(doc(db, "users", "admin"), { password: newPass });
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value     = '';
        document.getElementById('confirmPassword').value = '';
        showToast('পাসওয়ার্ড পরিবর্তন হয়েছে', 'success');
    } catch (e) {
        showToast('পরিবর্তন করা যায়নি: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
    }
}
