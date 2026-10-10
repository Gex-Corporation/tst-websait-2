// ======================================================
//  Invoice Pro — MPO's Page JS (mpo.js)
//  GEX Corporation | <Dev Alif/>
// ======================================================

import {
    db, collection, getDocs, getDoc, setDoc, updateDoc, deleteDoc, doc,
    query, where, orderBy, limit, serverTimestamp, writeBatch, increment,
    Timestamp, startAfter,
    getCurrentUser, requireAdmin, logout, buildPageTopbar,
    formatBDT, formatDate, daysAgoLabel, escapeHtml, avatarBg,
    showToast, confirmModal, renderLoading, renderEmpty, debounce,
    CACHE_KEYS, ADMIN_USERS_CACHE
} from '../js/shared.js';

// ==================== State ====================
let allUsers           = [];  // All MPO users from cache/Firebase
let filteredUsers      = [];
let currentMPOId       = null;
let shopInfoData       = [];
let salesHistoryData   = [];
let salesHistoryLastDoc= null;
let salesHistoryHasMore= false;
const PAGE_SIZE        = 15;

// ==================== Init ====================
window.addEventListener('DOMContentLoaded', async () => {
    const user = requireAdmin();
    if (!user) return;

    buildPageTopbar({
        title: "👤 MPO's তালিকা",
        subtitle: 'সকল সেলস রিপ্রেজেনটেটিভ',
        backUrl: '../admin.html'
    });

    bindUI();
    await loadMPOList();
});

// ==================== Bind UI Events ====================
function bindUI() {
    // List view
    document.getElementById('mpoSearch').addEventListener('input', debounce(filterMPOCards, 300));
    document.getElementById('mpoRefreshBtn').onclick = () => {
        localStorage.removeItem(ADMIN_USERS_CACHE);
        allUsers = [];
        loadMPOList();
    };
    document.getElementById('createUserBtn').onclick = () => openCreateUserModal();
    document.getElementById('backToListBtn').onclick = () => switchView('list');

    // Create user modal
    document.getElementById('closeCreateUser').onclick = closeCreateUserModal;
    document.getElementById('cancelCreateUser').onclick = closeCreateUserModal;
    document.getElementById('submitCreateUser').onclick = submitCreateUser;
    document.getElementById('createUserModal').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeCreateUserModal();
    });

    // Detail view tabs
    document.querySelectorAll('.mpo-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Detail view buttons
    document.getElementById('remoteClearCacheBtn').onclick = () => remoteClearCache();
    document.getElementById('deleteMPOBtn').onclick = () => deleteMPO();

    // Shop Info tab
    document.getElementById('shopInfoSearch').addEventListener('input', debounce(filterShopInfo, 250));
    document.getElementById('refreshShopInfoBtn').onclick  = () => loadShopInfo(currentMPOId, true);
    document.getElementById('exportShopInfoBtn').onclick   = () => exportShopInfo();
    document.getElementById('deleteAllCustomersBtn').onclick = () => deleteAllCustomers();
    document.getElementById('importShopInfoInput').addEventListener('change', e => importShopInfo(e));

    // Sales History tab
    document.getElementById('refreshSalesHistoryBtn').onclick     = () => loadSalesHistory(currentMPOId, true);
    document.getElementById('salesHistoryLoadMoreBtn').onclick    = () => loadSalesHistoryMore();

    // Accounting tab
    document.getElementById('saveTotalSalesBtn').onclick = () => saveAccounting('totalSales', 'editTotalSales');
    document.getElementById('saveTotalPaidBtn').onclick  = () => saveAccounting('totalPaid',  'editTotalPaid');
    document.getElementById('editTotalSales').addEventListener('input', updateCalcDue);
    document.getElementById('editTotalPaid').addEventListener('input',  updateCalcDue);
}

// ==================== View Switcher ====================
function switchView(view) {
    const listView   = document.getElementById('viewMPOList');
    const detailView = document.getElementById('viewMPODetail');
    if (view === 'list') {
        listView.style.display   = '';
        detailView.style.display = 'none';
        currentMPOId = null;
    } else {
        listView.style.display   = 'none';
        detailView.style.display = '';
    }
}

function switchTab(tabId) {
    document.querySelectorAll('.mpo-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
    document.querySelectorAll('.mpo-tab-content').forEach(c => c.style.display = 'none');
    const tabEl = document.getElementById('tab' + tabId.charAt(0).toUpperCase() + tabId.slice(1));
    if (tabEl) tabEl.style.display = '';

    // Lazy-load tab content
    if (tabId === 'shopInfo'    && currentMPOId) loadShopInfo(currentMPOId);
    if (tabId === 'salesHistory'&& currentMPOId) loadSalesHistory(currentMPOId);
    if (tabId === 'accounting'  && currentMPOId) loadAccountingForm(currentMPOId);
}

// ==================== Load MPO List ====================
async function loadMPOList() {
    const grid = document.getElementById('mpoCardGrid');
    grid.innerHTML = `<div class="loading-center" style="grid-column:1/-1;min-height:200px"><div class="spinner"></div><span>লোড হচ্ছে...</span></div>`;

    try {
        // Cache-first
        const cached = localStorage.getItem(ADMIN_USERS_CACHE);
        if (cached) {
            allUsers = JSON.parse(cached).filter(u => u.id !== 'admin');
        } else {
            const snap = await getDocs(collection(db, "users"));
            const all  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            localStorage.setItem(ADMIN_USERS_CACHE, JSON.stringify(all));
            allUsers = all.filter(u => u.id !== 'admin');
        }

        filteredUsers = allUsers;
        renderMPOCards(filteredUsers);
        updateListStats(allUsers);
    } catch (e) {
        console.error("MPO list load error:", e);
        grid.innerHTML = `<div class="loading-center" style="grid-column:1/-1;color:var(--red2)">❌ লোড করা যায়নি</div>`;
    }
}

function updateListStats(mpos) {
    let totalSales = 0, totalPaid = 0, totalInv = 0;
    mpos.forEach(u => {
        totalSales += parseFloat(u.totalSales || 0);
        totalPaid  += parseFloat(u.totalPaid  || 0);
        totalInv   += parseInt(u.invoiceCount  || 0);
    });
    document.getElementById('statMPOCount').textContent   = mpos.length;
    document.getElementById('statTotalSales').textContent  = formatBDT(totalSales);
    document.getElementById('statTotalDue').textContent    = formatBDT(Math.max(0, totalSales - totalPaid));
    document.getElementById('statTotalInv').textContent    = totalInv;
}

function filterMPOCards() {
    const q = document.getElementById('mpoSearch').value.trim().toLowerCase();
    filteredUsers = q ? allUsers.filter(u => u.id.toLowerCase().includes(q)) : allUsers;
    renderMPOCards(filteredUsers);
}

function renderMPOCards(users) {
    const grid = document.getElementById('mpoCardGrid');
    if (users.length === 0) {
        grid.innerHTML = `<div style="grid-column:1/-1"><div class="empty-state"><div class="empty-icon">👤</div>কোনো MPO পাওয়া যায়নি</div></div>`;
        return;
    }

    // Sort by totalSales desc
    const sorted = [...users].sort((a, b) => (b.totalSales || 0) - (a.totalSales || 0));
    const maxSales = sorted[0]?.totalSales || 1;

    grid.innerHTML = sorted.map((u, idx) => {
        const sales  = parseFloat(u.totalSales || 0);
        const paid   = parseFloat(u.totalPaid  || 0);
        const due    = Math.max(0, sales - paid);
        const initials = u.id.substring(0, 2).toUpperCase();
        const bg = avatarBg(u.id);
        const pct = Math.round((sales / maxSales) * 100);
        const dueColor = due > 0 ? 'var(--orange2)' : 'var(--green2)';
        const rankColors = ['#fbbf24','#94a3b8','#cd7f32'];
        const rankColor = rankColors[idx] || 'var(--text-muted)';

        return `
        <div class="mpo-card" data-id="${escapeHtml(u.id)}">
            <div class="mpo-card-accent" style="background:linear-gradient(90deg,${bg},${bg}88)"></div>
            <div class="mpo-card-body">
                <div class="mpo-card-header">
                    <div class="mpo-initials" style="background:${bg}">${initials}</div>
                    <div style="flex:1;min-width:0;">
                        <div class="mpo-card-name">${escapeHtml(u.id)}</div>
                        <div class="mpo-card-role">Sales Representative</div>
                    </div>
                    ${idx < 3 ? `<div style="font-size:18px" title="Rank #${idx+1}">🏆</div>` : ''}
                </div>

                <div class="mpo-card-stats">
                    <div class="mpo-mini-stat">
                        <div class="ms-value" style="color:var(--green2)">${formatBDT(sales)}</div>
                        <div class="ms-label">বিক্রয়</div>
                    </div>
                    <div class="mpo-mini-stat">
                        <div class="ms-value" style="color:var(--blue2)">${formatBDT(paid)}</div>
                        <div class="ms-label">কালেকশন</div>
                    </div>
                    <div class="mpo-mini-stat">
                        <div class="ms-value" style="color:${dueColor}">${formatBDT(due)}</div>
                        <div class="ms-label">বাকি</div>
                    </div>
                </div>

                <div class="progress-bar" style="margin-bottom:14px;">
                    <div class="progress-fill" style="width:${pct}%;background:linear-gradient(90deg,${bg},${bg}88)"></div>
                </div>

                <div class="mpo-card-footer">
                    <span class="mpo-inv-count">🧾 ${u.invoiceCount || 0}টি ইনভয়েস</span>
                    <button class="mpo-view-btn open-mpo-detail" data-id="${escapeHtml(u.id)}">
                        বিস্তারিত →
                    </button>
                </div>
            </div>
        </div>`;
    }).join('');

    // Click to open detail
    grid.querySelectorAll('[data-id].mpo-card').forEach(card => {
        card.addEventListener('click', () => openMPODetail(card.dataset.id));
    });
    grid.querySelectorAll('.open-mpo-detail').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); openMPODetail(btn.dataset.id); });
    });
}

// ==================== Open MPO Detail ====================
function openMPODetail(userId) {
    currentMPOId = userId;
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;

    // Set header
    document.getElementById('detailMPOName').textContent = `👤 ${userId}`;
    document.getElementById('detailMPOMeta').textContent = 'Sales Representative';

    // Set stats
    const sales = parseFloat(user.totalSales || 0);
    const paid  = parseFloat(user.totalPaid  || 0);
    const due   = Math.max(0, sales - paid);
    document.getElementById('mpoStatSales').textContent    = formatBDT(sales);
    document.getElementById('mpoStatPaid').textContent     = formatBDT(paid);
    document.getElementById('mpoStatDue').textContent      = formatBDT(due);
    document.getElementById('mpoStatInvCount').textContent = user.invoiceCount || 0;

    // Switch to detail view, default tab = shopInfo
    switchView('detail');
    switchTab('shopInfo');
}

// ==================== Shop Info ====================
let shopInfoAllData = [];

async function loadShopInfo(userId, forceRefresh = false) {
    const tbody = document.getElementById('shopInfoTableBody');
    const cacheKey = `admin_cache_customers_${userId}`;

    if (!forceRefresh) {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            shopInfoAllData = JSON.parse(cached);
            renderShopInfo(shopInfoAllData);
            return;
        }
    }

    tbody.innerHTML = `<tr><td colspan="7"><div class="loading-center"><div class="spinner"></div></div></td></tr>`;
    try {
        const q    = query(collection(db, "customers"), where("user", "==", userId));
        const snap = await getDocs(q);
        shopInfoAllData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        localStorage.setItem(cacheKey, JSON.stringify(shopInfoAllData));
        renderShopInfo(shopInfoAllData);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="7" style="color:var(--red2);padding:20px;text-align:center">❌ লোড করা যায়নি</td></tr>`;
    }
}

function filterShopInfo() {
    const q = document.getElementById('shopInfoSearch').value.trim().toLowerCase();
    const filtered = q
        ? shopInfoAllData.filter(c => [c.billTo, c.shipTo, c.phone].join(' ').toLowerCase().includes(q))
        : shopInfoAllData;
    renderShopInfo(filtered);
}

function renderShopInfo(data) {
    const tbody = document.getElementById('shopInfoTableBody');
    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">🏪</div>কোনো কাস্টমার নেই</div></td></tr>`;
        return;
    }

    const sorted = [...data].sort((a, b) => (a.billTo || '').localeCompare(b.billTo || ''));
    tbody.innerHTML = sorted.map(c => {
        const sales = parseFloat(c.totalSales || 0);
        const paid  = parseFloat(c.totalPaid  || 0);
        const due   = Math.max(0, sales - paid);
        return `<tr>
            <td class="bold">${escapeHtml(c.billTo || '—')}</td>
            <td>${escapeHtml(c.shipTo || '—')}</td>
            <td>${escapeHtml(c.phone || '—')}</td>
            <td style="color:var(--green2);font-weight:600">${sales > 0 ? formatBDT(sales) : '—'}</td>
            <td style="color:var(--blue2)">${paid > 0 ? formatBDT(paid) : '—'}</td>
            <td style="color:${due > 0 ? 'var(--orange2)' : 'var(--text-muted)'}">${due > 0 ? formatBDT(due) : '০'}</td>
            <td>
                <button class="btn btn-sm btn-danger del-cust-btn" data-id="${escapeHtml(c.id)}">🗑️</button>
            </td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('.del-cust-btn').forEach(btn => {
        btn.onclick = () => deleteCustomer(btn.dataset.id);
    });
}

async function deleteCustomer(custId) {
    confirmModal('কাস্টমার ডিলেট', 'এই কাস্টমারটি স্থায়ীভাবে মুছে যাবে। নিশ্চিত?', async () => {
        try {
            await deleteDoc(doc(db, "customers", custId));
            localStorage.removeItem(`admin_cache_customers_${currentMPOId}`);
            showToast('কাস্টমার ডিলেট হয়েছে', 'success');
            await loadShopInfo(currentMPOId, true);
        } catch (e) {
            showToast('ডিলেট করা যায়নি', 'error');
        }
    });
}

async function deleteAllCustomers() {
    confirmModal('সব কাস্টমার ডিলেট', `${currentMPOId}-এর সব কাস্টমার মুছে ফেলবেন? এটি পূর্বাবস্থায় ফেরানো যাবে না।`, async () => {
        try {
            const q = query(collection(db, "customers"), where("user", "==", currentMPOId));
            const snap = await getDocs(q);
            const batch = writeBatch(db);
            snap.docs.forEach(d => batch.delete(doc(db, "customers", d.id)));
            await batch.commit();
            localStorage.removeItem(`admin_cache_customers_${currentMPOId}`);
            showToast('সব কাস্টমার ডিলেট হয়েছে', 'success');
            shopInfoAllData = [];
            renderShopInfo([]);
        } catch (e) {
            showToast('ডিলেট করা যায়নি', 'error');
        }
    });
}

function exportShopInfo() {
    const data = shopInfoAllData;
    if (!data.length) { showToast('কোনো ডেটা নেই', 'warning'); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shop_info_${currentMPOId}_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Export সফল হয়েছে', 'success');
}

function importShopInfo(event) {
    const file = event.target.files[0];
    if (!file) return;
    confirmModal('Shop Info Import', `${currentMPOId}-এর জন্য নতুন shop info import করবেন? বিদ্যমান ডেটার সাথে merge হবে।`, async () => {
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (!Array.isArray(data)) throw new Error("Invalid format");
            for (const item of data) {
                if (!item.billTo) continue;
                const custId = generateCustId(currentMPOId, item.billTo);
                const { id, updatedAt, ...rest } = item;
                await setDoc(doc(db, "customers", custId), { ...rest, user: currentMPOId, updatedAt: serverTimestamp() }, { merge: true });
            }
            localStorage.removeItem(`admin_cache_customers_${currentMPOId}`);
            showToast(`${data.length}টি রেকর্ড import হয়েছে`, 'success');
            await loadShopInfo(currentMPOId, true);
        } catch (e) {
            showToast('Import করা যায়নি: ' + e.message, 'error');
        }
    }, false);
    event.target.value = '';
}

function generateCustId(userId, billTo) {
    const s = `${userId}|${billTo.trim().toLowerCase()}`;
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
    return `c_${userId}_${Math.abs(h)}`;
}

// ==================== Sales History ====================
async function loadSalesHistory(userId, forceRefresh = false) {
    const tbody = document.getElementById('salesHistoryTableBody');
    tbody.innerHTML = `<tr><td colspan="5"><div class="loading-center"><div class="spinner"></div></div></td></tr>`;

    salesHistoryLastDoc  = null;
    salesHistoryHasMore  = false;
    salesHistoryData     = [];

    if (!forceRefresh) {
        const cached = localStorage.getItem(`admin_cache_sales_${userId}`);
        if (cached) {
            salesHistoryData = JSON.parse(cached);
            renderSalesHistory(salesHistoryData);
            return;
        }
    }

    await fetchSalesFromServer(userId, false);
}

async function loadSalesHistoryMore() {
    if (currentMPOId) await fetchSalesFromServer(currentMPOId, true);
}

async function fetchSalesFromServer(userId, isLoadMore) {
    const tbody = document.getElementById('salesHistoryTableBody');
    try {
        let q = query(
            collection(db, "invoices"),
            where("user", "==", userId),
            orderBy("timestamp", "desc"),
            limit(PAGE_SIZE)
        );
        if (isLoadMore && salesHistoryLastDoc) {
            q = query(q, startAfter(salesHistoryLastDoc));
        }

        let snap;
        try { snap = await getDocs(q); }
        catch {
            // Fallback without orderBy
            let q2 = query(collection(db, "invoices"), where("user", "==", userId), limit(PAGE_SIZE));
            if (isLoadMore && salesHistoryLastDoc) q2 = query(q2, startAfter(salesHistoryLastDoc));
            snap = await getDocs(q2);
        }

        const newData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (isLoadMore) {
            salesHistoryData = [...salesHistoryData, ...newData];
        } else {
            salesHistoryData = newData;
            localStorage.setItem(`admin_cache_sales_${userId}`, JSON.stringify(newData));
        }

        renderSalesHistory(salesHistoryData);
        salesHistoryLastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
        salesHistoryHasMore = snap.docs.length === PAGE_SIZE;

        const wrap = document.getElementById('salesHistoryLoadMoreWrap');
        wrap.style.display = salesHistoryHasMore ? 'block' : 'none';
    } catch (e) {
        console.error("Sales history error:", e);
        tbody.innerHTML = `<tr><td colspan="5" style="color:var(--red2);text-align:center;padding:20px">❌ লোড করা যায়নি</td></tr>`;
    }
}

function renderSalesHistory(data) {
    const tbody = document.getElementById('salesHistoryTableBody');
    if (!data.length) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">🧾</div>কোনো ইনভয়েস নেই</div></td></tr>`;
        return;
    }

    tbody.innerHTML = data.map(inv => {
        // Prioritise inv.date (human-readable string stored by app.js)
        let dateStr = '—';
        if (inv.date && inv.date !== '—' && inv.date.trim()) {
            dateStr = inv.date.trim();
        } else {
            const ts = inv.timestamp || inv.updatedAt;
            if (ts) {
                let d = null;
                if (typeof ts === 'string') d = new Date(ts);
                else if (ts?.seconds)      d = new Date(ts.seconds * 1000);
                else if (ts?.toDate)       d = ts.toDate();
                if (d && !isNaN(d.getTime()))
                    dateStr = d.toLocaleDateString('bn-BD', { day: '2-digit', month: 'short', year: 'numeric' });
            }
        }
        const currency = inv.currency || '৳';
        return `<tr>
            <td>${dateStr}</td>
            <td class="accent">${escapeHtml(inv.invoiceNumber || '—')}</td>
            <td>${escapeHtml(inv.billTo || '—')}</td>
            <td class="bold" style="color:var(--green2)">${currency}${Number(inv.grandTotal || 0).toLocaleString()}</td>
            <td>
                <button class="btn btn-sm btn-primary print-history-btn" data-id="${escapeHtml(inv.id)}">🖨️ Print</button>
                <button class="btn btn-sm btn-danger del-history-btn" data-id="${escapeHtml(inv.id)}">🗑️</button>
            </td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('.print-history-btn').forEach(btn => {
        btn.onclick = () => {
            const inv = data.find(i => i.id === btn.dataset.id);
            if (inv) printInvoice(inv);
        };
    });
    tbody.querySelectorAll('.del-history-btn').forEach(btn => {
        btn.onclick = () => deleteSalesHistoryInvoice(btn.dataset.id);
    });
}

async function deleteSalesHistoryInvoice(invoiceId) {
    confirmModal('ইনভয়েস ডিলেট', 'এই ইনভয়েসটি ডিলেট করবেন? স্টক পুনরুদ্ধার হবে।', async () => {
        try {
            await deleteInvoiceWithRestore(invoiceId);
            salesHistoryData = salesHistoryData.filter(i => i.id !== invoiceId);
            localStorage.removeItem(`admin_cache_sales_${currentMPOId}`);
            renderSalesHistory(salesHistoryData);
            showToast('ডিলেট হয়েছে', 'success');
        } catch (e) {
            showToast('ডিলেট করা যায়নি', 'error');
        }
    });
}

async function deleteInvoiceWithRestore(invoiceId) {
    const invSnap = await getDoc(doc(db, "invoices", invoiceId));
    if (!invSnap.exists()) throw new Error("Invoice not found");
    const inv = invSnap.data();
    const batch = writeBatch(db);

    if (Array.isArray(inv.items)) {
        for (const item of inv.items) {
            if (item.productId && item.quantity > 0) {
                batch.update(doc(db, "stocks", item.productId), { quantity: increment(item.quantity), updatedAt: serverTimestamp() });
            }
        }
    }

    if (inv.user) {
        const grandTotal = parseFloat(inv.grandTotal || 0);
        if (grandTotal > 0) {
            batch.update(doc(db, "users", inv.user), { totalSales: increment(-grandTotal), invoiceCount: increment(-1) });
        }
    }

    batch.delete(doc(db, "invoices", invoiceId));
    await batch.commit();
}

// ==================== Accounting ====================
function loadAccountingForm(userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;
    document.getElementById('editTotalSales').value = user.totalSales || 0;
    document.getElementById('editTotalPaid').value  = user.totalPaid  || 0;
    updateCalcDue();
}

function updateCalcDue() {
    const s = parseFloat(document.getElementById('editTotalSales').value) || 0;
    const p = parseFloat(document.getElementById('editTotalPaid').value)  || 0;
    const due = Math.max(0, s - p);
    const el = document.getElementById('calcDue');
    el.textContent = formatBDT(due);
    el.style.color = due > 0 ? 'var(--orange2)' : 'var(--green2)';
}

async function saveAccounting(field, inputId) {
    const value = parseFloat(document.getElementById(inputId).value);
    if (isNaN(value)) { showToast('সঠিক সংখ্যা দিন', 'warning'); return; }
    try {
        await updateDoc(doc(db, "users", currentMPOId), { [field]: value });
        // Update local
        const u = allUsers.find(u => u.id === currentMPOId);
        if (u) u[field] = value;
        localStorage.removeItem(ADMIN_USERS_CACHE);
        updateCalcDue();
        showToast('আপডেট সফল', 'success');
        // Update detail stats
        const sales = parseFloat(document.getElementById('editTotalSales').value) || 0;
        const paid  = parseFloat(document.getElementById('editTotalPaid').value)  || 0;
        document.getElementById('mpoStatSales').textContent = formatBDT(sales);
        document.getElementById('mpoStatPaid').textContent  = formatBDT(paid);
        document.getElementById('mpoStatDue').textContent   = formatBDT(Math.max(0, sales - paid));
    } catch (e) {
        showToast('আপডেট করা যায়নি', 'error');
    }
}

// ==================== Remote Cache Clear ====================
async function remoteClearCache() {
    if (!currentMPOId) return;
    confirmModal('Cache Clear', `${currentMPOId}-এর ডিভাইসের cache clear করবেন? পরের লগইনে fresh data নামবে।`, async () => {
        try {
            await updateDoc(doc(db, "users", currentMPOId), { forceClearCache: Date.now() });
            localStorage.removeItem(`admin_cache_customers_${currentMPOId}`);
            localStorage.removeItem(`admin_cache_sales_${currentMPOId}`);
            showToast('Cache clear command পাঠানো হয়েছে', 'success');
        } catch (e) {
            showToast('Cache clear করা যায়নি', 'error');
        }
    }, false);
}

// ==================== Delete MPO ====================
async function deleteMPO() {
    if (!currentMPOId) return;
    confirmModal(
        'MPO ডিলেট',
        `"${currentMPOId}" MPO কে সম্পূর্ণ ডিলেট করবেন? এই অ্যাকাউন্টের সব ডেটা মুছে যাবে।`,
        async () => {
            try {
                await deleteDoc(doc(db, "users", currentMPOId));
                localStorage.removeItem(ADMIN_USERS_CACHE);
                allUsers = allUsers.filter(u => u.id !== currentMPOId);
                showToast(`${currentMPOId} ডিলেট হয়েছে`, 'success');
                switchView('list');
                renderMPOCards(allUsers);
                updateListStats(allUsers);
            } catch (e) {
                showToast('ডিলেট করা যায়নি', 'error');
            }
        }
    );
}

// ==================== Create User Modal ====================
function openCreateUserModal() {
    document.getElementById('newUsername').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('createUserModal').classList.remove('hidden');
    document.getElementById('newUsername').focus();
}

function closeCreateUserModal() {
    document.getElementById('createUserModal').classList.add('hidden');
}

async function submitCreateUser() {
    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newPassword').value.trim();
    if (!username || !password) { showToast('Username ও পাসওয়ার্ড দিন', 'warning'); return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) { showToast('Username শুধু অক্ষর, সংখ্যা, _, - দিয়ে হবে', 'warning'); return; }

    const btn = document.getElementById('submitCreateUser');
    btn.disabled = true;
    btn.textContent = '⏳ তৈরি হচ্ছে...';

    try {
        const existing = await getDoc(doc(db, "users", username));
        if (existing.exists()) { showToast('এই username ইতিমধ্যে আছে', 'error'); return; }

        await setDoc(doc(db, "users", username), {
            password,
            totalSales: 0, totalPaid: 0,
            invoiceCount: 0, invoiceCounter: 0
        });

        localStorage.removeItem(ADMIN_USERS_CACHE);
        closeCreateUserModal();
        showToast(`${username} তৈরি হয়েছে`, 'success');
        await loadMPOList();
    } catch (e) {
        showToast('তৈরি করা যায়নি: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '✅ তৈরি করুন';
    }
}

// ==================== Print Invoice ====================
function printInvoice(inv) {
    try {
        sessionStorage.setItem('admin_print_invoice', JSON.stringify(inv));
        window.open('../main.html?action=admin_print', '_blank');
    } catch { showToast('প্রিন্ট করা যায়নি', 'error'); }
}
