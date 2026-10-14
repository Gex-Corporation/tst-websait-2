// Invoice Pro — Nizosvo Hisab (personal.js)
// Firestore Collection: "personal_accounts"
//   - _config document : { passwordEnabled, password }
//   - Other documents  : one per person

import {
    db, collection, getDocs, setDoc, updateDoc, deleteDoc,
    doc, getDoc, query, orderBy, serverTimestamp, arrayUnion, arrayRemove,
    requireAdmin, buildPageTopbar, formatBDT, escapeHtml, avatarBg,
    showToast, confirmModal, debounce
} from '../js/shared.js';

const COLLECTION   = 'personal_accounts';
const CONFIG_DOC   = '_config';
const SESSION_KEY  = 'personal_hisar_unlocked_v1';

let allPersons      = [];
let currentTxnId    = null;
let currentTxnType  = 'dilam';
let configCache     = null; // { passwordEnabled, password }

// ─────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
    if (!requireAdmin()) return;
    buildPageTopbar({
        title: 'নিজস্ব হিসাব',
        subtitle: 'মালিকের ব্যক্তিগত দিলাম-পেলাম খাতা',
        backUrl: '../admin.html'
    });
    document.getElementById('txnDate').valueAsDate = new Date();
    bindUI();

    // ⬇ পেজ ছেড়ে গেলে সাথে সাথে unlock সরিয়ে দাও
    // যাতে পরের বার আসলে পাসওয়ার্ড চাওয়া হয়
    window.addEventListener('pagehide', () => {
        sessionStorage.removeItem(SESSION_KEY);
    });

    await checkAccess();
});

// ── Fetch config from Firestore ───────────────────────────
async function fetchConfig() {
    if (configCache) return configCache;
    try {
        const snap = await getDoc(doc(db, COLLECTION, CONFIG_DOC));
        configCache = snap.exists() ? snap.data() : { passwordEnabled: false, password: '' };
    } catch (e) {
        console.error('Config fetch error:', e);
        configCache = { passwordEnabled: false, password: '' };
    }
    return configCache;
}

async function saveConfig(data) {
    await setDoc(doc(db, COLLECTION, CONFIG_DOC), data, { merge: true });
    // cache আপডেট করো যাতে পরের fetchConfig() পুরনো ডেটা না দেয়
    configCache = { ...(configCache || {}), ...data };
}


// ── Access / Gate ─────────────────────────────────────────
async function checkAccess() {
    // প্রথমে সবকিছু লুকাও — Firebase চেক শেষ না হওয়া পর্যন্ত কিছুই দেখাবে না
    document.getElementById('personalMain').style.display = 'none';
    document.getElementById('passwordGate').classList.add('hidden');

    const cfg = await fetchConfig();

    if (cfg.passwordEnabled && cfg.password) {
        // পাসওয়ার্ড চালু আছে — সব সময় গেট দেখাও
        // (sessionStorage শুধু একই পেজ ভিজিটের মধ্যে কাজ করে)
        const unlocked = sessionStorage.getItem(SESSION_KEY) === 'true';
        if (!unlocked) {
            // গেট স্ক্রিন দেখাও, checking spinner লুকাও
            document.getElementById('gateChecking').style.display = 'none';
            document.getElementById('gateForm').classList.remove('hidden');
            document.getElementById('passwordGate').classList.remove('hidden');
            document.getElementById('personalMain').style.display = 'none';
            return;
        }
    }

    // পাসওয়ার্ড নেই বা এই সেশনে আনলক — সরাসরি পেজ দেখাও
    document.getElementById('passwordGate').classList.add('hidden');
    document.getElementById('personalMain').style.display = '';
    loadPersons();
}

function unlockPage() {
    // শুধু এই একটি পেজ ভিজিটের জন্য আনলক (pagehide-এ আবার লক হয়)
    sessionStorage.setItem(SESSION_KEY, 'true');
    document.getElementById('passwordGate').classList.add('hidden');
    document.getElementById('personalMain').style.display = '';
    loadPersons();
}

async function verifyPassword() {
    const input   = document.getElementById('gatePasswordInput').value;
    const errorEl = document.getElementById('gateError');
    const btn     = document.getElementById('gateSubmitBtn');

    if (!input) { showToast('পাসওয়ার্ড দিন', 'warning'); return; }

    btn.disabled = true; btn.textContent = '⏳ যাচাই হচ্ছে...';
    try {
        const cfg = await fetchConfig();
        if (cfg.password && input === cfg.password) {
            errorEl.classList.add('hidden');
            unlockPage();
        } else {
            errorEl.classList.remove('hidden');
            const inp = document.getElementById('gatePasswordInput');
            inp.value = '';
            inp.classList.add('shake');
            setTimeout(() => inp.classList.remove('shake'), 500);
        }
    } catch (e) {
        showToast('যাচাই করা যায়নি', 'error');
    } finally {
        btn.disabled = false; btn.textContent = '🔓 প্রবেশ করুন';
    }
}

// ── Settings ─────────────────────────────────────────────
async function openSettings() {
    const cfg = await fetchConfig();
    const toggle = document.getElementById('passwordToggle');
    toggle.checked = cfg.passwordEnabled || false;
    document.getElementById('passwordSetArea').classList.toggle('hidden', !cfg.passwordEnabled);
    document.getElementById('currentPassHint').style.display = (cfg.passwordEnabled && cfg.password) ? 'flex' : 'none';
    document.getElementById('removePasswordBtn').style.display = (cfg.passwordEnabled && cfg.password) ? 'block' : 'none';
    openModal('settingsModal');
}

function onPasswordToggle() {
    const enabled = document.getElementById('passwordToggle').checked;
    document.getElementById('passwordSetArea').classList.toggle('hidden', !enabled);
}

async function savePassword() {
    const pw1 = document.getElementById('newPasswordInput').value.trim();
    const pw2 = document.getElementById('confirmPasswordInput').value.trim();
    if (!pw1) { showToast('পাসওয়ার্ড দিন', 'warning'); return; }
    if (pw1 !== pw2) { showToast('পাসওয়ার্ড মিলছে না', 'warning'); return; }
    if (pw1.length < 4) { showToast('কমপক্ষে ৪ অক্ষর দিন', 'warning'); return; }

    const btn = document.getElementById('savePasswordBtn');
    btn.disabled = true; btn.textContent = '⏳';
    try {
        await saveConfig({ passwordEnabled: true, password: pw1 });
        // sessionStorage set করা হচ্ছে না — পেজ ছেড়ে গেলে আবার পাসওয়ার্ড চাইবে
        document.getElementById('newPasswordInput').value     = '';
        document.getElementById('confirmPasswordInput').value = '';
        document.getElementById('currentPassHint').style.display = 'flex';
        document.getElementById('removePasswordBtn').style.display = 'block';
        showToast('পাসওয়ার্ড Firebase-এ সেভ হয়েছে ✅ — পরের বার পেজে ঢুকতে পাসওয়ার্ড লাগবে', 'success');
    } catch (e) {
        showToast('সেভ করা যায়নি', 'error');
    } finally { btn.disabled = false; btn.textContent = '✅ পাসওয়ার্ড সেট করুন'; }
}


async function removePassword() {
    confirmModal('পাসওয়ার্ড সরানো হবে', 'পাসওয়ার্ড সুরক্ষা সরিয়ে দিলে যেকেউ এই পেজে ঢুকতে পারবে।', async () => {
        try {
            await saveConfig({ passwordEnabled: false, password: '' });
            document.getElementById('passwordToggle').checked = false;
            document.getElementById('passwordSetArea').classList.add('hidden');
            document.getElementById('currentPassHint').style.display = 'none';
            document.getElementById('removePasswordBtn').style.display = 'none';
            showToast('পাসওয়ার্ড সুরক্ষা সরানো হয়েছে', 'info');
        } catch (e) { showToast('সরানো যায়নি', 'error'); }
    });
}

// ── Eye toggle helper ─────────────────────────────────────
// ইনপুট type="text" — CSS .revealed ক্লাস দিয়ে মাস্ক/আনমাস্ক করা হয়
// ব্রাউজার type="password" না দেখলে পাসওয়ার্ড সেভ পপআপ আসে না
function bindEyeToggles() {
    document.querySelectorAll('.eye-toggle').forEach(btn => {
        btn.onclick = () => {
            const inp = document.getElementById(btn.dataset.target);
            if (!inp) return;
            const isRevealed = inp.classList.contains('revealed');
            inp.classList.toggle('revealed', !isRevealed);
            btn.textContent = isRevealed ? '👁' : '🙈';
        };
    });
}

// ── UI Bindings ───────────────────────────────────────────
function bindUI() {
    document.getElementById('gateSubmitBtn').onclick = verifyPassword;
    document.getElementById('gatePasswordInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') verifyPassword();
    });

    document.getElementById('personalSearch').addEventListener('input', debounce(applyFilter, 250));
    document.getElementById('balanceFilter').addEventListener('change', applyFilter);

    document.getElementById('addPersonBtn').onclick        = () => openAddPerson();
    document.getElementById('closeAddPersonModal').onclick = () => closeModal('addPersonModal');
    document.getElementById('cancelAddPersonBtn').onclick  = () => closeModal('addPersonModal');
    document.getElementById('savePersonBtn').onclick       = savePerson;

    document.getElementById('closeProfileModal').onclick = () => closeModal('personProfileModal');
    document.getElementById('personProfileModal').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeModal('personProfileModal');
    });

    document.getElementById('closeTxnModal').onclick = () => closeModal('addTxnModal');
    document.getElementById('cancelTxnBtn').onclick  = () => closeModal('addTxnModal');
    document.getElementById('saveTxnBtn').onclick    = saveTxn;
    document.getElementById('txnTypeDilam').onclick  = () => setTxnType('dilam');
    document.getElementById('txnTypePelam').onclick  = () => setTxnType('pelam');

    document.getElementById('personalSettingsBtn').onclick    = openSettings;
    document.getElementById('closeSettingsModal').onclick     = () => closeModal('settingsModal');
    document.getElementById('closeSettingsBtnFooter').onclick = () => closeModal('settingsModal');
    document.getElementById('passwordToggle').addEventListener('change', onPasswordToggle);
    document.getElementById('savePasswordBtn').onclick   = savePassword;
    document.getElementById('removePasswordBtn').onclick = removePassword;

    ['addPersonModal','addTxnModal','settingsModal'].forEach(id => {
        document.getElementById(id).addEventListener('click', e => {
            if (e.target === e.currentTarget) closeModal(id);
        });
    });

    bindEyeToggles();
}

function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function openModal(id)  { document.getElementById(id).classList.remove('hidden'); }

// ── Load Persons ──────────────────────────────────────────
async function loadPersons() {
    const grid = document.getElementById('personalGrid');
    grid.innerHTML = '<div class="loading-center" style="grid-column:1/-1;min-height:200px"><div class="spinner"></div><span>লোড হচ্ছে...</span></div>';
    try {
        const snap = await getDocs(query(collection(db, COLLECTION), orderBy('createdAt', 'desc')));
        // exclude _config document
        allPersons = snap.docs
            .filter(d => d.id !== CONFIG_DOC)
            .map(d => ({ id: d.id, ...d.data() }));
        applyFilter();
    } catch (e) {
        console.error('Personal load error:', e);
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--red2)">❌ লোড করা যায়নি</div>';
    }
}

// ── Filter ────────────────────────────────────────────────
function applyFilter() {
    const q      = document.getElementById('personalSearch').value.trim().toLowerCase();
    const filter = document.getElementById('balanceFilter').value;

    const filtered = allPersons.filter(p => {
        const bal = getBalance(p);
        if (filter === 'receivable' && bal <= 0) return false;
        if (filter === 'payable'    && bal >= 0) return false;
        if (filter === 'clear'      && bal !== 0) return false;
        if (q) {
            const h = [p.name, p.phone, p.address].join(' ').toLowerCase();
            if (!h.includes(q)) return false;
        }
        return true;
    }).sort((a, b) => Math.abs(getBalance(b)) - Math.abs(getBalance(a)));

    renderCards(filtered);
    updateStats(filtered);
}

function getBalance(p) {
    return (p.totalDilam || 0) - (p.totalPelam || 0);
}

// ── Render Cards ──────────────────────────────────────────
function renderCards(persons) {
    const grid = document.getElementById('personalGrid');
    if (!persons.length) {
        grid.innerHTML = '<div style="grid-column:1/-1"><div class="empty-state"><div class="empty-icon">📔</div>কোনো হিসাব নেই<br><small style="color:var(--text-muted);font-size:12px;margin-top:6px;display:block">উপরে ➕ বাটন দিয়ে নতুন ব্যক্তি যোগ করুন</small></div></div>';
        return;
    }
    grid.innerHTML = persons.map(p => {
        const bal          = getBalance(p);
        const bg           = avatarBg(p.name || p.id);
        const initials     = (p.name || '?').substring(0, 2).toUpperCase();
        const isReceivable = bal > 0;
        const isPayable    = bal < 0;
        const accentClass  = isReceivable ? 'receivable' : isPayable ? 'payable' : 'clear';
        const balLabel     = isReceivable ? 'আমি পাব' : isPayable ? 'আমি দেব' : 'পরিশোধিত';
        const balColor     = isReceivable ? 'var(--orange2)' : isPayable ? 'var(--blue2)' : 'var(--green2)';
        const badgeClass   = isReceivable ? 'badge-receivable' : isPayable ? 'badge-payable' : 'badge-clear';
        const txnCount     = (p.transactions || []).length;
        return '<div class="person-card" data-id="' + escapeHtml(p.id) + '">' +
            '<div class="person-card-accent ' + accentClass + '"></div>' +
            '<div class="person-card-top">' +
                '<div class="person-avatar" style="background:' + bg + '">' + initials + '</div>' +
                '<div style="flex:1;min-width:0;">' +
                    '<div class="person-name truncate">' + escapeHtml(p.name || '—') + '</div>' +
                    '<div class="person-meta">' +
                        (p.phone ? '📞 ' + escapeHtml(p.phone) : '') +
                        (p.address ? (p.phone ? ' · ' : '') + '📍 ' + escapeHtml(p.address) : '') +
                        (txnCount ? ' · ' + txnCount + 'টি লেনদেন' : '') +
                    '</div>' +
                '</div>' +
                '<span class="badge ' + badgeClass + '">' + balLabel + '</span>' +
            '</div>' +
            '<div class="person-fin-grid">' +
                '<div class="person-fin-item"><div class="person-fin-label">দিলাম</div><div class="person-fin-value" style="color:var(--orange2)">' + formatBDT(p.totalDilam || 0) + '</div></div>' +
                '<div class="person-fin-item"><div class="person-fin-label">পেলাম</div><div class="person-fin-value" style="color:var(--green2)">' + formatBDT(p.totalPelam || 0) + '</div></div>' +
                '<div class="person-fin-item"><div class="person-fin-label">' + balLabel + '</div><div class="person-fin-value" style="color:' + balColor + '">' + formatBDT(Math.abs(bal)) + '</div></div>' +
            '</div>' +
            '<div class="person-card-actions">' +
                '<button class="btn btn-sm flex-1 view-profile-btn" data-id="' + escapeHtml(p.id) + '">👁 বিবরণ</button>' +
                '<button class="btn btn-sm btn-success add-txn-btn" data-id="' + escapeHtml(p.id) + '" style="flex:1">💰 লেনদেন</button>' +
                '<button class="btn btn-sm edit-person-btn" data-id="' + escapeHtml(p.id) + '" title="সম্পাদনা">✏️</button>' +
            '</div>' +
        '</div>';
    }).join('');

    grid.querySelectorAll('.view-profile-btn').forEach(btn => btn.onclick = e => { e.stopPropagation(); openProfile(btn.dataset.id); });
    grid.querySelectorAll('.add-txn-btn').forEach(btn     => btn.onclick = e => { e.stopPropagation(); openAddTxn(btn.dataset.id); });
    grid.querySelectorAll('.edit-person-btn').forEach(btn => btn.onclick = e => { e.stopPropagation(); openAddPerson(btn.dataset.id); });
    grid.querySelectorAll('.person-card').forEach(card    => card.addEventListener('click', () => openProfile(card.dataset.id)));
}

function updateStats(persons) {
    let totalReceivable = 0, totalPayable = 0;
    persons.forEach(p => {
        const bal = getBalance(p);
        if (bal > 0) totalReceivable += bal;
        else if (bal < 0) totalPayable += Math.abs(bal);
    });
    const net = totalReceivable - totalPayable;
    document.getElementById('statTotalPersons').textContent    = persons.length;
    document.getElementById('statTotalReceivable').textContent = formatBDT(totalReceivable);
    document.getElementById('statTotalPayable').textContent    = formatBDT(totalPayable);
    document.getElementById('statNetBalance').textContent      = (net >= 0 ? '+' : '') + formatBDT(net);
    document.getElementById('statNetBalance').style.color      = net >= 0 ? 'var(--green2)' : 'var(--red2)';
}

// ── Add / Edit Person ─────────────────────────────────────
function openAddPerson(id = null) {
    const p = id ? allPersons.find(x => x.id === id) : null;
    document.getElementById('editPersonId').value  = id || '';
    document.getElementById('personName').value    = p?.name    || '';
    document.getElementById('personPhone').value   = p?.phone   || '';
    document.getElementById('personAddress').value = p?.address || '';
    document.getElementById('personNote').value    = p?.note    || '';
    document.getElementById('addPersonTitle').textContent = id ? '✏️ তথ্য সম্পাদনা' : '➕ নতুন ব্যক্তি';
    openModal('addPersonModal');
    setTimeout(() => document.getElementById('personName').focus(), 100);
}

async function savePerson() {
    const name = document.getElementById('personName').value.trim();
    if (!name) { showToast('নাম দিন', 'warning'); return; }
    const editId = document.getElementById('editPersonId').value;
    const data = {
        name,
        phone:     document.getElementById('personPhone').value.trim(),
        address:   document.getElementById('personAddress').value.trim(),
        note:      document.getElementById('personNote').value.trim(),
        updatedAt: serverTimestamp()
    };
    const btn = document.getElementById('savePersonBtn');
    btn.disabled = true; btn.textContent = '⏳';
    try {
        if (editId) {
            await updateDoc(doc(db, COLLECTION, editId), data);
            const idx = allPersons.findIndex(p => p.id === editId);
            if (idx !== -1) Object.assign(allPersons[idx], data);
            showToast('তথ্য আপডেট হয়েছে', 'success');
        } else {
            const newRef = doc(collection(db, COLLECTION));
            await setDoc(newRef, { ...data, totalDilam: 0, totalPelam: 0, transactions: [], createdAt: serverTimestamp() });
            allPersons.unshift({ id: newRef.id, ...data, totalDilam: 0, totalPelam: 0, transactions: [] });
            showToast('নতুন ব্যক্তি যোগ হয়েছে', 'success');
        }
        closeModal('addPersonModal');
        applyFilter();
    } catch (e) {
        console.error(e); showToast('সেভ করা যায়নি', 'error');
    } finally { btn.disabled = false; btn.textContent = '✅ সেভ করুন'; }
}

// ── Profile Modal ─────────────────────────────────────────
function openProfile(id) {
    const p = allPersons.find(x => x.id === id);
    if (!p) return;
    const bal = getBalance(p);
    const bg  = avatarBg(p.name || p.id);
    const initials = (p.name || '?').substring(0, 2).toUpperCase();
    const isReceivable = bal > 0;
    const balColor = isReceivable ? 'var(--orange2)' : bal < 0 ? 'var(--blue2)' : 'var(--green2)';
    const balLabel = isReceivable ? 'আমি পাব' : bal < 0 ? 'আমি দেব' : 'পরিশোধিত';

    document.getElementById('profileTitle').textContent = '📔 ' + (p.name || 'বিবরণ');

    const txns = (p.transactions || []).slice().reverse();
    const txnHtml = txns.length
        ? txns.map(t =>
            '<div class="txn-row">' +
                '<div class="txn-row-icon">' + (t.type === 'dilam' ? '📤' : '📥') + '</div>' +
                '<div class="txn-row-info">' +
                    '<div class="txn-row-item">' + escapeHtml(t.item || (t.type === 'dilam' ? 'দিলাম' : 'পেলাম')) + (t.note ? ' — ' + escapeHtml(t.note) : '') + '</div>' +
                    '<div class="txn-row-date">' + (t.date || '—') + '</div>' +
                '</div>' +
                '<div class="txn-row-amount ' + t.type + '">' + (t.type === 'dilam' ? '+' : '-') + formatBDT(t.amount) + '</div>' +
                '<button class="txn-delete-btn" data-txnid="' + t.id + '" data-pid="' + escapeHtml(p.id) + '" title="মুছুন">🗑</button>' +
            '</div>'
        ).join('')
        : '<div class="empty-state" style="padding:24px 0"><div class="empty-icon">📭</div>কোনো লেনদেন নেই</div>';

    document.getElementById('profileBody').innerHTML =
        '<div class="profile-header">' +
            '<div style="width:50px;height:50px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:' + bg + ';font-size:18px;font-weight:800;color:white;flex-shrink:0;">' + initials + '</div>' +
            '<div>' +
                '<div style="font-size:16px;font-weight:700;margin-bottom:4px;">' + escapeHtml(p.name || '—') + '</div>' +
                '<div style="color:var(--text-muted);font-size:12px;">' + (p.phone ? '📞 ' + escapeHtml(p.phone) + '&nbsp;&nbsp;' : '') + (p.address ? '📍 ' + escapeHtml(p.address) : '') + '</div>' +
                (p.note ? '<div style="color:var(--text-muted);font-size:12px;margin-top:3px;">📝 ' + escapeHtml(p.note) + '</div>' : '') +
            '</div>' +
        '</div>' +
        '<div class="profile-fin-grid">' +
            '<div class="profile-fin-card"><div class="profile-fin-lbl">মোট দিলাম</div><div class="profile-fin-val" style="color:var(--orange2)">' + formatBDT(p.totalDilam || 0) + '</div></div>' +
            '<div class="profile-fin-card"><div class="profile-fin-lbl">মোট পেলাম</div><div class="profile-fin-val" style="color:var(--green2)">' + formatBDT(p.totalPelam || 0) + '</div></div>' +
            '<div class="profile-fin-card"><div class="profile-fin-lbl">' + balLabel + '</div><div class="profile-fin-val" style="color:' + balColor + '">' + formatBDT(Math.abs(bal)) + '</div></div>' +
        '</div>' +
        '<div class="profile-actions">' +
            '<button class="btn btn-success flex-1" id="profileAddTxnBtn" data-id="' + escapeHtml(p.id) + '">💰 নতুন লেনদেন</button>' +
            '<button class="btn flex-1" id="profileEditBtn" data-id="' + escapeHtml(p.id) + '">✏️ সম্পাদনা</button>' +
            '<button class="btn btn-danger" id="profileDeleteBtn" data-id="' + escapeHtml(p.id) + '">🗑️</button>' +
        '</div>' +
        '<div class="txn-history">' +
            '<div class="txn-history-title">লেনদেনের ইতিহাস (' + txns.length + 'টি)</div>' +
            txnHtml +
        '</div>';

    document.getElementById('profileAddTxnBtn').onclick = () => { closeModal('personProfileModal'); openAddTxn(p.id); };
    document.getElementById('profileEditBtn').onclick   = () => { closeModal('personProfileModal'); openAddPerson(p.id); };
    document.getElementById('profileDeleteBtn').onclick = () => deletePerson(p.id);
    document.querySelectorAll('.txn-delete-btn').forEach(btn => {
        btn.onclick = () => deleteTxn(btn.dataset.pid, btn.dataset.txnid);
    });
    openModal('personProfileModal');
}

async function deletePerson(id) {
    const p = allPersons.find(x => x.id === id);
    confirmModal(
        'ব্যক্তি মুছে ফেলবেন?',
        '"' + (p?.name || id) + '" এর সকল হিসাব মুছে যাবে। এটি আর ফিরিয়ে আনা যাবে না।',
        async () => {
            try {
                await deleteDoc(doc(db, COLLECTION, id));
                allPersons = allPersons.filter(x => x.id !== id);
                closeModal('personProfileModal');
                applyFilter();
                showToast('মুছে ফেলা হয়েছে', 'success');
            } catch (e) { showToast('মুছে ফেলা যায়নি', 'error'); }
        }
    );
}

// ── Add Transaction ───────────────────────────────────────
function setTxnType(type) {
    currentTxnType = type;
    document.getElementById('txnTypeDilam').classList.toggle('active', type === 'dilam');
    document.getElementById('txnTypePelam').classList.toggle('active', type === 'pelam');
}

function openAddTxn(id) {
    currentTxnId = id;
    const p = allPersons.find(x => x.id === id);
    document.getElementById('txnModalTitle').textContent = '💰 লেনদেন — ' + (p?.name || '—');
    document.getElementById('txnAmount').value     = '';
    document.getElementById('txnItem').value       = '';
    document.getElementById('txnNote').value       = '';
    document.getElementById('txnDate').valueAsDate = new Date();
    setTxnType('dilam');
    openModal('addTxnModal');
    setTimeout(() => document.getElementById('txnAmount').focus(), 100);
}

async function saveTxn() {
    const amount = parseFloat(document.getElementById('txnAmount').value);
    if (isNaN(amount) || amount <= 0) { showToast('সঠিক পরিমাণ দিন', 'warning'); return; }
    const p = allPersons.find(x => x.id === currentTxnId);
    if (!p) return;
    const txn = {
        id:   Date.now().toString(),
        type: currentTxnType,
        amount,
        item: document.getElementById('txnItem').value.trim(),
        note: document.getElementById('txnNote').value.trim(),
        date: document.getElementById('txnDate').value || new Date().toISOString().slice(0, 10),
        at:   new Date().toISOString()
    };
    const newDilam = (p.totalDilam || 0) + (txn.type === 'dilam' ? amount : 0);
    const newPelam = (p.totalPelam || 0) + (txn.type === 'pelam' ? amount : 0);
    const btn = document.getElementById('saveTxnBtn');
    btn.disabled = true; btn.textContent = '⏳';
    try {
        await updateDoc(doc(db, COLLECTION, currentTxnId), {
            totalDilam: newDilam, totalPelam: newPelam,
            transactions: arrayUnion(txn), updatedAt: serverTimestamp()
        });
        p.totalDilam = newDilam; p.totalPelam = newPelam;
        p.transactions = [...(p.transactions || []), txn];
        closeModal('addTxnModal');
        showToast((txn.type === 'dilam' ? 'দিলাম' : 'পেলাম') + ' ' + formatBDT(amount) + ' রেকর্ড হয়েছে', 'success');
        applyFilter();
    } catch (e) { console.error(e); showToast('সেভ করা যায়নি', 'error'); }
    finally { btn.disabled = false; btn.textContent = '✅ সেভ'; }
}

async function deleteTxn(personId, txnId) {
    const p   = allPersons.find(x => x.id === personId);
    const txn = (p?.transactions || []).find(t => t.id === txnId);
    if (!p || !txn) return;
    confirmModal(
        'লেনদেন মুছবেন?',
        (txn.type === 'dilam' ? 'দিলাম' : 'পেলাম') + ' — ' + formatBDT(txn.amount) + ' (' + (txn.date || '—') + ')',
        async () => {
            try {
                const newDilam = Math.max(0, (p.totalDilam || 0) - (txn.type === 'dilam' ? txn.amount : 0));
                const newPelam = Math.max(0, (p.totalPelam || 0) - (txn.type === 'pelam' ? txn.amount : 0));
                await updateDoc(doc(db, COLLECTION, personId), {
                    totalDilam: newDilam, totalPelam: newPelam,
                    transactions: arrayRemove(txn), updatedAt: serverTimestamp()
                });
                p.totalDilam = newDilam; p.totalPelam = newPelam;
                p.transactions = (p.transactions || []).filter(t => t.id !== txnId);
                closeModal('personProfileModal');
                applyFilter();
                showToast('লেনদেন মুছে গেছে', 'success');
            } catch (e) { showToast('মুছে ফেলা যায়নি', 'error'); }
        }
    );
}
