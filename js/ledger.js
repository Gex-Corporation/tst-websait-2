// Invoice Pro — Customer Ledger Page JS (ledger.js)
import {
    db, collection, getDocs, getDoc, updateDoc, doc,
    query, where, serverTimestamp,
    requireAdmin, buildPageTopbar, formatBDT, escapeHtml, avatarBg,
    showToast, confirmModal, debounce
} from '../js/shared.js';

let allCustomers = [], filteredCusts = [];
let currentCust  = null;
let mpoList      = [];

window.addEventListener('DOMContentLoaded', async () => {
    if (!requireAdmin()) return;
    buildPageTopbar({ title: '📒 কাস্টমার খাতা', subtitle: 'সকল MPO-এর কাস্টমার লেজার', backUrl: '../admin.html' });
    bindUI();
    await loadAllCustomers();
});

function bindUI() {
    document.getElementById('ledgerSearch').addEventListener('input', debounce(applyFilter, 250));
    document.getElementById('mpoFilterLedger').addEventListener('change', applyFilter);
    document.getElementById('dueFilter').addEventListener('change', applyFilter);
    document.getElementById('ledgerRefreshBtn').onclick = () => { allCustomers = []; loadAllCustomers(true); };
    document.getElementById('closeProfileModal').onclick = () => document.getElementById('customerProfileModal').classList.add('hidden');
    document.getElementById('customerProfileModal').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden'); });
    document.getElementById('closeTxnModal').onclick  = () => document.getElementById('addTxnModal').classList.add('hidden');
    document.getElementById('cancelTxnModal').onclick = () => document.getElementById('addTxnModal').classList.add('hidden');
    document.getElementById('saveTxnBtn').onclick     = saveTxn;
}

async function loadAllCustomers(force = false) {
    const grid = document.getElementById('ledgerGrid');
    grid.innerHTML = `<div class="loading-center" style="grid-column:1/-1;min-height:200px"><div class="spinner"></div><span>লোড হচ্ছে...</span></div>`;

    // Load from per-user caches (admin_cache_customers_<userId>)
    try {
        const USERS_CACHE = 'admin_cached_users_list_v1';
        let users = [];
        const usersRaw = localStorage.getItem(USERS_CACHE);
        if (usersRaw) {
            users = JSON.parse(usersRaw).filter(u => u.id !== 'admin');
        } else {
            const snap = await getDocs(collection(db, "users"));
            users = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => u.id !== 'admin');
            localStorage.setItem(USERS_CACHE, JSON.stringify([...users, { id: 'admin' }]));
        }

        mpoList = users.map(u => u.id);
        populateMPOFilter();

        // Load customers from per-user caches or Firestore
        allCustomers = [];
        for (const user of users) {
            const cacheKey = `admin_cache_customers_${user.id}`;
            let data;
            if (!force && localStorage.getItem(cacheKey)) {
                data = JSON.parse(localStorage.getItem(cacheKey));
            } else {
                const snap = await getDocs(query(collection(db, "customers"), where("user", "==", user.id)));
                data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                localStorage.setItem(cacheKey, JSON.stringify(data));
            }
            data.forEach(c => allCustomers.push({ ...c, mpo: user.id }));
        }

        applyFilter();
    } catch (e) {
        console.error("Ledger load error:", e);
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--red2)">❌ লোড করা যায়নি</div>`;
    }
}

function populateMPOFilter() {
    const select = document.getElementById('mpoFilterLedger');
    const current = select.value;
    select.innerHTML = '<option value="">সব MPO</option>' + mpoList.map(m => `<option value="${escapeHtml(m)}"${m === current ? ' selected' : ''}>${escapeHtml(m)}</option>`).join('');
}

function applyFilter() {
    const q      = document.getElementById('ledgerSearch').value.trim().toLowerCase();
    const mpo    = document.getElementById('mpoFilterLedger').value;
    const due    = document.getElementById('dueFilter').value;

    filteredCusts = allCustomers.filter(c => {
        if (mpo && c.mpo !== mpo) return false;
        const hasDue = getDue(c) > 0;
        if (due === 'due' && !hasDue) return false;
        if (due === 'clear' && hasDue) return false;
        if (q) {
            const h = [c.billTo, c.shipTo, c.phone, c.mpo].join(' ').toLowerCase();
            if (!h.includes(q)) return false;
        }
        return true;
    }).sort((a, b) => getDue(b) - getDue(a));

    renderCards(filteredCusts);
    updateStats(filteredCusts);
}

function getDue(c) { return Math.max(0, (c.totalSales || 0) - (c.totalPaid || 0)); }

function renderCards(customers) {
    const grid = document.getElementById('ledgerGrid');
    if (!customers.length) {
        grid.innerHTML = `<div style="grid-column:1/-1"><div class="empty-state"><div class="empty-icon">📒</div>কোনো কাস্টমার নেই</div></div>`;
        return;
    }

    grid.innerHTML = customers.map(c => {
        const sales = c.totalSales || 0;
        const paid  = c.totalPaid  || 0;
        const due   = getDue(c);
        const hasDue = due > 0;
        const bg = avatarBg(c.billTo || c.id);
        const initials = (c.billTo || '?').substring(0, 2).toUpperCase();
        const duePct = sales > 0 ? Math.round((due / sales) * 100) : 0;

        return `
        <div class="cust-card" data-id="${escapeHtml(c.id)}">
            <div class="due-indicator ${hasDue ? 'has-due' : 'cleared'}"></div>
            <div class="cust-card-top">
                <div class="cust-avatar" style="background:${bg}">${initials}</div>
                <div style="flex:1;min-width:0;">
                    <div class="cust-name truncate">${escapeHtml(c.billTo || '—')}</div>
                    <div class="cust-meta">MPO: ${escapeHtml(c.mpo)} ${c.phone ? '· ' + escapeHtml(c.phone) : ''}</div>
                </div>
                ${hasDue ? `<span class="badge badge-orange">${duePct}% বাকি</span>` : '<span class="badge badge-green">পরিষ্কার</span>'}
            </div>
            <div class="cust-financials">
                <div class="cust-fin-item"><div class="cust-fin-label">বিক্রয়</div><div class="cust-fin-value" style="color:var(--green2)">${formatBDT(sales)}</div></div>
                <div class="cust-fin-item"><div class="cust-fin-label">কালেকশন</div><div class="cust-fin-value" style="color:var(--blue2)">${formatBDT(paid)}</div></div>
            </div>
            ${hasDue ? `<div class="progress-bar" style="margin-bottom:10px;"><div class="progress-fill" style="width:${100-duePct}%;background:linear-gradient(90deg,var(--green),var(--teal))"></div></div>` : ''}
            <div style="display:flex;gap:8px;">
                <button class="btn btn-sm flex-1 view-profile-btn" data-id="${escapeHtml(c.id)}">👁 বিবরণ</button>
                ${hasDue ? `<button class="btn btn-sm btn-success add-payment-btn" data-id="${escapeHtml(c.id)}" style="flex:1">💰 পেমেন্ট</button>` : ''}
            </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.view-profile-btn').forEach(btn => {
        btn.onclick = e => { e.stopPropagation(); openProfile(btn.dataset.id); };
    });
    grid.querySelectorAll('.add-payment-btn').forEach(btn => {
        btn.onclick = e => { e.stopPropagation(); openAddTxn(btn.dataset.id); };
    });
    grid.querySelectorAll('.cust-card').forEach(card => {
        card.addEventListener('click', () => openProfile(card.dataset.id));
    });
}

function updateStats(customers) {
    let totalSales = 0, totalDue = 0;
    customers.forEach(c => { totalSales += c.totalSales || 0; totalDue += getDue(c); });
    document.getElementById('statTotalCust').textContent  = customers.length;
    document.getElementById('statHasDue').textContent     = customers.filter(c => getDue(c) > 0).length;
    document.getElementById('statTotalSales').textContent = formatBDT(totalSales);
    document.getElementById('statTotalDue').textContent   = formatBDT(totalDue);
}

function openProfile(custId) {
    const c = allCustomers.find(x => x.id === custId);
    if (!c) return;
    currentCust = c;
    const due = getDue(c);
    const bg = avatarBg(c.billTo || c.id);
    const initials = (c.billTo || '?').substring(0, 2).toUpperCase();

    document.getElementById('profileModalTitle').textContent = `📒 ${c.billTo || 'কাস্টমার'}`;
    document.getElementById('profileModalBody').innerHTML = `
        <div class="profile-header">
            <div class="cust-avatar avatar-lg" style="background:${bg};width:52px;height:52px;font-size:18px;font-weight:800;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;">${initials}</div>
            <div>
                <div style="font-size:16px;font-weight:700;margin-bottom:4px;">${escapeHtml(c.billTo || '—')}</div>
                <div style="color:var(--text-muted);font-size:12px;">📍 ${escapeHtml(c.shipTo || '—')} · 📞 ${escapeHtml(c.phone || '—')}</div>
                <div style="color:var(--text-muted);font-size:12px;margin-top:2px;">MPO: <strong style="color:var(--blue2)">${escapeHtml(c.mpo)}</strong></div>
            </div>
        </div>
        <div class="profile-fin-grid">
            <div class="profile-fin-card">
                <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">মোট বিক্রয়</div>
                <div style="font-size:20px;font-weight:800;color:var(--green2)">${formatBDT(c.totalSales || 0)}</div>
            </div>
            <div class="profile-fin-card">
                <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">কালেকশন</div>
                <div style="font-size:20px;font-weight:800;color:var(--blue2)">${formatBDT(c.totalPaid || 0)}</div>
            </div>
            <div class="profile-fin-card">
                <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">বাকি</div>
                <div style="font-size:20px;font-weight:800;color:${due > 0 ? 'var(--orange2)' : 'var(--green2)'}">${formatBDT(due)}</div>
            </div>
        </div>
        ${due > 0 ? `<div style="display:flex;gap:10px;margin-top:4px;">
            <button class="btn btn-success flex-1" id="profilePaymentBtn" data-id="${escapeHtml(c.id)}">💰 পেমেন্ট রেকর্ড করুন</button>
        </div>` : '<div style="padding:12px;text-align:center;color:var(--green2);font-weight:600">✅ সম্পূর্ণ পরিশোধিত</div>'}
    `;

    document.getElementById('profilePaymentBtn')?.addEventListener('click', () => {
        document.getElementById('customerProfileModal').classList.add('hidden');
        openAddTxn(c.id);
    });

    document.getElementById('customerProfileModal').classList.remove('hidden');
}

let txnCustId = null;
function openAddTxn(custId) {
    txnCustId = custId;
    const c = allCustomers.find(x => x.id === custId);
    document.getElementById('addTxnTitle').textContent = `💰 পেমেন্ট — ${c?.billTo || 'কাস্টমার'}`;
    document.getElementById('txnAmount').value = '';
    document.getElementById('txnNote').value   = '';
    document.getElementById('addTxnModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('txnAmount').focus(), 100);
}

async function saveTxn() {
    const amount = parseFloat(document.getElementById('txnAmount').value);
    if (isNaN(amount) || amount <= 0) { showToast('সঠিক পরিমাণ দিন', 'warning'); return; }
    const c = allCustomers.find(x => x.id === txnCustId);
    if (!c) return;

    const btn = document.getElementById('saveTxnBtn');
    btn.disabled = true; btn.textContent = '⏳';
    try {
        const newPaid = (c.totalPaid || 0) + amount;
        await updateDoc(doc(db, "customers", txnCustId), { totalPaid: newPaid, updatedAt: serverTimestamp() });
        c.totalPaid = newPaid;
        localStorage.removeItem(`admin_cache_customers_${c.mpo}`);
        document.getElementById('addTxnModal').classList.add('hidden');
        showToast(`${formatBDT(amount)} পেমেন্ট রেকর্ড হয়েছে`, 'success');
        applyFilter();
    } catch (e) {
        showToast('সেভ করা যায়নি', 'error');
    } finally { btn.disabled = false; btn.textContent = '✅ সেভ করুন'; }
}
