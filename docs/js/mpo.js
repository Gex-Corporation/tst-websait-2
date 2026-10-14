// ======================================================
//  Invoice Pro — MPO's Page JS (mpo.js)
//  GEX Corporation | <Dev Alif/>
// ======================================================

import {
    db, collection, getDocs, getDoc, setDoc, updateDoc, deleteDoc, doc,
    query, where, orderBy, limit, serverTimestamp, writeBatch, increment,
    arrayUnion, arrayRemove,
    Timestamp, startAfter,
    getCurrentUser, requireAdmin, logout, buildPageTopbar,
    formatBDT, formatDate, daysAgoLabel, escapeHtml, avatarBg,
    showToast, confirmModal, renderLoading, renderEmpty, debounce,
    CACHE_KEYS, ADMIN_USERS_CACHE,
    getInvoiceMonthKey, getMonthNameBangla, updateUserMonthlyStatsOnDelete,
    syncUserMonthlyStats, extractInvoiceNumber,
    getCustomerDocId, deleteInvoiceWithRestore,
    recordMPOPayment, deleteMPOPayment,
    getOrSyncCompanyStats, syncCompanyStats, COMPANY_STATS_DOC_REF, CACHE_COMPANY_STATS,
    deleteField, CUSTOMERS_SUMMARY_DOC_REF, syncCustomersSummary,
    appCache, getMpoInvoices
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
let accountingRenderLimit    = 10;
let sortedAccountingPayments = [];
const ACCOUNTING_PAGE_SIZE   = 10;

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
    document.getElementById('mpoRefreshBtn').onclick = async () => {
        await appCache.remove(ADMIN_USERS_CACHE);
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

    // Accounting tab (অফিস জমা লেনদেন ইতিহাস)
    const openAddPayBtn = document.getElementById('openAddPaymentModalBtn');
    if (openAddPayBtn) openAddPayBtn.onclick = () => openAddMPOPaymentModal();

    const closeAddPayBtn = document.getElementById('closeAddMPOPayment');
    if (closeAddPayBtn) closeAddPayBtn.onclick = () => closeAddMPOPaymentModal();

    const cancelAddPayBtn = document.getElementById('cancelAddMPOPayment');
    if (cancelAddPayBtn) cancelAddPayBtn.onclick = () => closeAddMPOPaymentModal();

    const submitAddPayBtn = document.getElementById('submitAddMPOPayment');
    if (submitAddPayBtn) submitAddPayBtn.onclick = () => submitAddMPOPayment();

    const refreshAccBtn = document.getElementById('refreshAccountingBtn');
    if (refreshAccBtn) refreshAccBtn.onclick = () => loadAccountingLedger(currentMPOId, true);

    const loadMoreAccBtn = document.getElementById('accountingLoadMoreBtn');
    if (loadMoreAccBtn) loadMoreAccBtn.onclick = () => loadMoreAccountingPayments();

    const payModal = document.getElementById('addMPOPaymentModal');
    if (payModal) {
        payModal.addEventListener('click', e => {
            if (e.target === e.currentTarget) closeAddMPOPaymentModal();
        });
    }

    // Monthly Target & Stats Bindings
    const mSelect = document.getElementById('monthlySelect');
    if (mSelect) mSelect.addEventListener('change', () => onMonthSelectChange());

    const syncBtn = document.getElementById('syncMonthlyDataBtn');
    if (syncBtn) syncBtn.onclick = () => handleSyncMonthlyData();

    const setTargetBtn = document.getElementById('setMonthlyTargetBtn');
    if (setTargetBtn) setTargetBtn.onclick = () => openSetTargetModal();

    const closeTargetBtn = document.getElementById('closeSetTarget');
    if (closeTargetBtn) closeTargetBtn.onclick = closeSetTargetModal;

    const cancelTargetBtn = document.getElementById('cancelSetTarget');
    if (cancelTargetBtn) cancelTargetBtn.onclick = closeSetTargetModal;

    const saveTargetBtn = document.getElementById('saveSetTarget');
    if (saveTargetBtn) saveTargetBtn.onclick = () => handleSaveTarget();

    const histToggle = document.getElementById('mtHistoryToggle');
    if (histToggle) histToggle.onclick = () => toggleHistoryWrap();
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
    if (tabId === 'accounting'  && currentMPOId) loadAccountingLedger(currentMPOId);
}

// ==================== Load MPO List ====================
async function loadMPOList() {
    const grid = document.getElementById('mpoCardGrid');
    grid.innerHTML = `<div class="loading-center" style="grid-column:1/-1;min-height:200px"><div class="spinner"></div><span>লোড হচ্ছে...</span></div>`;

    try {
        // Cache-first
        const cached = await appCache.get(ADMIN_USERS_CACHE);
        if (cached) {
            const raw = typeof cached === 'string' ? JSON.parse(cached) : cached;
            allUsers = raw.filter(u => u.id !== 'admin');
        } else {
            const snap = await getDocs(collection(db, "users"));
            const all  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            await appCache.set(ADMIN_USERS_CACHE, all);
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

async function updateListStats(mpos) {
    try {
        const stats = await getOrSyncCompanyStats();
        document.getElementById('statMPOCount').textContent   = stats.mpoCount || (mpos ? mpos.length : 0);
        document.getElementById('statTotalSales').textContent  = formatBDT(stats.totalSales || 0);
        document.getElementById('statTotalDue').textContent    = formatBDT(stats.totalDue || 0);
        document.getElementById('statTotalInv').textContent    = stats.totalInvoices || 0;
    } catch (_) {
        let totalSales = 0, totalPaid = 0, totalInv = 0;
        (mpos || []).forEach(u => {
            totalSales += parseFloat(u.totalSales || 0);
            totalPaid  += parseFloat(u.totalPaid  || 0);
            totalInv   += parseInt(u.invoiceCount  || 0);
        });
        document.getElementById('statMPOCount').textContent   = (mpos || []).length;
        document.getElementById('statTotalSales').textContent  = formatBDT(totalSales);
        document.getElementById('statTotalDue').textContent    = formatBDT(Math.max(0, totalSales - totalPaid));
        document.getElementById('statTotalInv').textContent    = totalInv;
    }
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

                ${(() => {
                    const curMKey = getInvoiceMonthKey(new Date());
                    const mStats = (u.monthlyStats && u.monthlyStats[curMKey]) ? u.monthlyStats[curMKey] : null;
                    const mSales = mStats ? (parseFloat(mStats.totalSales) || 0) : 0;
                    const mRange = (mStats && mStats.startInvoice) ? (mStats.startInvoice === mStats.endInvoice ? `#${mStats.startInvoice}` : `#${mStats.startInvoice}-#${mStats.endInvoice}`) : '—';
                    return `<div style="background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.22);border-radius:8px;padding:6px 10px;font-size:11px;color:#c084fc;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;">
                        <span>🎯 চলতি মাস: <strong>${formatBDT(mSales)}</strong></span>
                        <span style="font-size:10px;color:var(--text-muted);font-weight:600;">Inv: ${mRange}</span>
                    </div>`;
                })()}

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
    const custPaid = parseFloat(user.customerCollection || 0);
    const paid  = parseFloat(user.totalPaid  || 0);
    const due   = Math.max(0, sales - paid);
    document.getElementById('mpoStatSales').textContent    = formatBDT(sales);
    const elCustPaid = document.getElementById('mpoStatCustPaid');
    if (elCustPaid) elCustPaid.textContent = formatBDT(custPaid);
    document.getElementById('mpoStatPaid').textContent     = formatBDT(paid);
    document.getElementById('mpoStatDue').textContent      = formatBDT(due);
    document.getElementById('mpoStatInvCount').textContent = user.invoiceCount || 0;

    // Render Monthly Target & Accounts
    renderMonthlySection(user);

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
        const cached = await appCache.get(cacheKey);
        if (cached) {
            shopInfoAllData = typeof cached === 'string' ? JSON.parse(cached) : cached;
            renderShopInfo(shopInfoAllData);
            return;
        }
    }

    tbody.innerHTML = `<tr><td colspan="7"><div class="loading-center"><div class="spinner"></div></div></td></tr>`;
    try {
        const q    = query(collection(db, "customers"), where("user", "==", userId));
        const snap = await getDocs(q);
        shopInfoAllData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        await appCache.set(cacheKey, shopInfoAllData);
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
            try {
                await updateDoc(CUSTOMERS_SUMMARY_DOC_REF(), {
                    [`list.${custId}`]: deleteField(),
                    updatedAt: serverTimestamp()
                });
            } catch (_) {}
            try {
                await updateDoc(doc(db, "settings", "appConfig"), { customerVersion: increment(1) });
            } catch (_) {}
            await appCache.remove(`admin_cache_customers_${currentMPOId}`);
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
            const summaryDeletes = {};
            snap.docs.forEach(d => {
                batch.delete(doc(db, "customers", d.id));
                summaryDeletes[`list.${d.id}`] = deleteField();
            });
            await batch.commit();
            if (Object.keys(summaryDeletes).length > 0) {
                try {
                    summaryDeletes.updatedAt = serverTimestamp();
                    await updateDoc(CUSTOMERS_SUMMARY_DOC_REF(), summaryDeletes);
                } catch (_) {}
            }
            try {
                await updateDoc(doc(db, "settings", "appConfig"), { customerVersion: increment(1) });
            } catch (_) {}
            await appCache.remove(`admin_cache_customers_${currentMPOId}`);
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
            await appCache.remove(`admin_cache_customers_${currentMPOId}`);
            localStorage.removeItem(`admin_cache_customers_${currentMPOId}`);
            try { await syncCustomersSummary(); } catch (_) {}
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
        const cached = await appCache.get(`admin_cache_sales_${userId}`);
        if (cached) {
            salesHistoryData = typeof cached === 'string' ? JSON.parse(cached) : cached;
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
        // Load from MPO 500-invoice bucket! (Exact 1 Firestore read!)
        const bucketRes = await getMpoInvoices(userId, 1);
        let newData = bucketRes.invoices || [];

        // Sort descending by date/timestamp
        newData.sort((a, b) => {
            const ta = a.timestamp || a.updatedAt || a.date;
            const tb = b.timestamp || b.updatedAt || b.date;
            return new Date(tb || 0) - new Date(ta || 0);
        });

        salesHistoryData = newData;
        await appCache.set(`admin_cache_sales_${userId}`, newData);

        renderSalesHistory(salesHistoryData);
        salesHistoryHasMore = false; // All 500 loaded in 1 read

        const wrap = document.getElementById('salesHistoryLoadMoreWrap');
        if (wrap) wrap.style.display = 'none';
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
    confirmModal('ইনভয়েস ডিলেট', 'এই ইনভয়েসটি ডিলেট করবেন? স্টক, কাস্টমার খাতা ও এমপিওর বিক্রয় হিসাব স্বয়ংক্রিয়ভাবে সমন্বয়/পুনরুদ্ধার হবে।', async () => {
        try {
            await deleteInvoiceWithRestore(invoiceId);
            salesHistoryData = salesHistoryData.filter(i => i.id !== invoiceId);
            await appCache.remove(`admin_cache_sales_${currentMPOId}`);
            await appCache.remove(`admin_cache_customers_${currentMPOId}`);
            localStorage.removeItem(`admin_cache_sales_${currentMPOId}`);
            localStorage.removeItem(`admin_cache_customers_${currentMPOId}`);
            renderSalesHistory(salesHistoryData);
            await refreshCurrentMPODetailData();
            showToast('ইনভয়েস ডিলেট ও হিসাব সমন্বয় সফল হয়েছে', 'success');
        } catch (e) {
            console.error("Delete invoice error:", e);
            showToast('ডিলেট করা যায়নি', 'error');
        }
    });
}

// ==================== Accounting (অফিস জমা / কালেকশন লেনদেন স্টেটমেন্ট) ====================
function loadAccountingLedger(userId, forceRefresh = false) {
    if (!userId) return;
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;

    if (forceRefresh) {
        refreshCurrentMPODetailData();
        return;
    }

    // Reset pagination to first 10 items initially
    accountingRenderLimit = ACCOUNTING_PAGE_SIZE;

    // 1. Update Mini Summary Bar
    const sales = parseFloat(user.totalSales || 0);
    const paid  = parseFloat(user.totalPaid  || 0);
    const custPaid = parseFloat(user.customerCollection || 0);
    const due   = Math.max(0, sales - paid);

    const payments = Array.isArray(user.payments) ? user.payments.slice() : [];
    // Sort descending by date / createdAt (latest first)
    payments.sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));
    sortedAccountingPayments = payments;

    const elTotPaid = document.getElementById('accSummaryTotalPaid');
    if (elTotPaid) elTotPaid.textContent = formatBDT(paid);

    const elCustPaid = document.getElementById('accSummaryCustPaid');
    if (elCustPaid) elCustPaid.textContent = formatBDT(custPaid);

    const elDue = document.getElementById('accSummaryDue');
    if (elDue) elDue.textContent = formatBDT(due);

    const elCount = document.getElementById('accSummaryEntryCount');
    if (elCount) elCount.textContent = `${payments.length}টি`;

    // 2. Render first batch (initial 10 items)
    renderAccountingPaymentsTable();
}

function renderAccountingPaymentsTable() {
    const tbody = document.getElementById('accountingTableBody');
    const loadMoreWrap = document.getElementById('accountingLoadMoreWrap');
    const loadMoreBtn = document.getElementById('accountingLoadMoreBtn');
    if (!tbody) return;

    if (!sortedAccountingPayments || sortedAccountingPayments.length === 0) {
        const user = allUsers.find(u => u.id === currentMPOId);
        const paid = parseFloat(user?.totalPaid || 0);
        tbody.innerHTML = `<tr><td colspan="5">
            <div class="empty-state">
                <div class="empty-icon">💵</div>
                <div>কোনো অফিস জমা লেনদেনের ইতিহাস নেই</div>
                <div class="text-small text-muted" style="margin-top:6px;">
                    ${paid > 0 ? `(আগের রেকর্ডকৃত মোট কালেকশন: <strong>${formatBDT(paid)}</strong>)<br>` : ''}
                    এমপিও অফিসে টাকা জমা দিলে <strong>"➕ টাকা জমা নিন"</strong> বাটন দিয়ে যুক্ত করুন।
                </div>
            </div>
        </td></tr>`;
        if (loadMoreWrap) loadMoreWrap.style.display = 'none';
        return;
    }

    const totalCount = sortedAccountingPayments.length;
    const visiblePayments = sortedAccountingPayments.slice(0, accountingRenderLimit);

    tbody.innerHTML = visiblePayments.map(p => {
        const amt = parseFloat(p.amount || 0);
        const dateStr = p.date || '—';
        let createdStr = '—';
        if (p.createdAt) {
            const d = new Date(p.createdAt);
            if (!isNaN(d.getTime())) {
                createdStr = d.toLocaleDateString('bn-BD', { day: '2-digit', month: 'short', year: 'numeric' }) +
                             ' ' + d.toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit' });
            }
        }

        return `<tr>
            <td class="bold" style="white-space:nowrap;">📅 ${escapeHtml(dateStr)}</td>
            <td style="color:#34d399;font-weight:700;font-size:15px;white-space:nowrap;">+${formatBDT(amt)}</td>
            <td>
                <span class="badge neu" style="font-weight:600;">${escapeHtml(p.note || 'অফিস ক্যাশ জমা')}</span>
            </td>
            <td class="text-muted text-small" style="white-space:nowrap;">${createdStr}</td>
            <td style="text-align:center;">
                <button class="btn btn-sm btn-danger del-payment-btn" data-id="${escapeHtml(p.paymentId)}" title="মুছে ফেলুন">🗑️</button>
            </td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('.del-payment-btn').forEach(btn => {
        btn.onclick = () => deleteMPOPaymentHandler(btn.dataset.id);
    });

    // Control Load More Button visibility & text
    if (loadMoreWrap && loadMoreBtn) {
        if (totalCount > accountingRenderLimit) {
            const remaining = totalCount - accountingRenderLimit;
            loadMoreWrap.style.display = 'block';
            loadMoreBtn.textContent = `⬇️ আরও দেখুন (${Math.min(ACCOUNTING_PAGE_SIZE, remaining)}টি বাকি)`;
        } else {
            loadMoreWrap.style.display = 'none';
        }
    }
}

function loadMoreAccountingPayments() {
    accountingRenderLimit += ACCOUNTING_PAGE_SIZE;
    renderAccountingPaymentsTable();
}

function openAddMPOPaymentModal() {
    if (!currentMPOId) return;
    const titleEl = document.getElementById('addMPOPaymentModalTitle');
    if (titleEl) titleEl.textContent = `💰 অফিসে টাকা জমা গ্রহণ — ${currentMPOId}`;

    const amtEl = document.getElementById('mpoPaymentAmount');
    if (amtEl) amtEl.value = '';

    const dateEl = document.getElementById('mpoPaymentDate');
    if (dateEl) dateEl.value = new Date().toLocaleDateString('en-CA');

    const noteEl = document.getElementById('mpoPaymentNote');
    if (noteEl) noteEl.value = '';

    const modal = document.getElementById('addMPOPaymentModal');
    if (modal) modal.classList.remove('hidden');
    if (amtEl) setTimeout(() => amtEl.focus(), 100);
}

function closeAddMPOPaymentModal() {
    const modal = document.getElementById('addMPOPaymentModal');
    if (modal) modal.classList.add('hidden');
}

async function submitAddMPOPayment() {
    if (!currentMPOId) return;
    const amtInput = document.getElementById('mpoPaymentAmount');
    const amount = parseFloat(amtInput?.value);
    if (isNaN(amount) || amount <= 0) {
        showToast('সঠিক টাকার পরিমাণ দিন', 'warning');
        if (amtInput) amtInput.focus();
        return;
    }

    const dateVal = document.getElementById('mpoPaymentDate')?.value || new Date().toLocaleDateString('en-CA');
    const noteVal = document.getElementById('mpoPaymentNote')?.value.trim() || 'অফিস ক্যাশ জমা';

    const btn = document.getElementById('submitAddMPOPayment');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ জমা হচ্ছে...'; }

    try {
        const paymentEntry = await recordMPOPayment(currentMPOId, amount, dateVal, noteVal);

        // Update local object
        const user = allUsers.find(u => u.id === currentMPOId);
        if (user) {
            user.totalPaid = (parseFloat(user.totalPaid || 0)) + amount;
            if (!Array.isArray(user.payments)) user.payments = [];
            user.payments.push(paymentEntry);

            const mKey = getInvoiceMonthKey(dateVal);
            user.monthlyStats = user.monthlyStats || {};
            const curMonth = user.monthlyStats[mKey] || {
                monthKey: mKey,
                monthName: getMonthNameBangla(mKey),
                totalSales: 0,
                customerCollection: 0,
                totalPaid: 0,
                invoiceCount: 0,
                startInvoice: 0,
                endInvoice: 0,
                targetAmount: 0
            };
            curMonth.totalPaid = (parseFloat(curMonth.totalPaid || 0)) + amount;
            user.monthlyStats[mKey] = curMonth;

            // Re-render UI
            const sales = parseFloat(user.totalSales || 0);
            const paid = parseFloat(user.totalPaid || 0);
            const elPaid = document.getElementById('mpoStatPaid');
            const elDue = document.getElementById('mpoStatDue');
            if (elPaid) elPaid.textContent = formatBDT(paid);
            if (elDue) elDue.textContent = formatBDT(Math.max(0, sales - paid));

            renderSelectedMonthDisplay(user, currentSelectedMonthKey);
            renderMonthlyHistoryTable(user.monthlyStats);
            loadAccountingLedger(currentMPOId);
            renderMPOCards(allUsers);
        }

        closeAddMPOPaymentModal();
        showToast(`${formatBDT(amount)} জমা সফলভাবে যুক্ত হয়েছে`, 'success');
    } catch (e) {
        console.error("Submit MPO payment error:", e);
        showToast('জমা সেভ করা যায়নি', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '✓ জমা নিশ্চিত করুন'; }
    }
}

async function deleteMPOPaymentHandler(paymentId) {
    if (!currentMPOId || !paymentId) return;
    const user = allUsers.find(u => u.id === currentMPOId);
    const payment = (user?.payments || []).find(p => p.paymentId === paymentId);
    if (!payment) return;

    confirmModal(
        'জমা লেনদেন মুছুন',
        `${formatBDT(payment.amount)} জমার এন্ট্রিটি মুছে ফেলবেন? মোট কালেকশন এবং চলতি মাসের হিসাব থেকে টাকাটি সমন্বয়/মাইনাস হয়ে যাবে।`,
        async () => {
            try {
                const { targetPayment, newTotalPaid } = await deleteMPOPayment(currentMPOId, paymentId);

                // Update local memory
                if (user) {
                    user.totalPaid = newTotalPaid;
                    user.payments = (user.payments || []).filter(p => p.paymentId !== paymentId);

                    const mKey = getInvoiceMonthKey(payment.date || payment.createdAt);
                    if (user.monthlyStats && user.monthlyStats[mKey]) {
                        user.monthlyStats[mKey].totalPaid = Math.max(0, (parseFloat(user.monthlyStats[mKey].totalPaid || 0)) - parseFloat(payment.amount || 0));
                    }

                    // Update UI
                    const sales = parseFloat(user.totalSales || 0);
                    const elPaid = document.getElementById('mpoStatPaid');
                    const elDue = document.getElementById('mpoStatDue');
                    if (elPaid) elPaid.textContent = formatBDT(newTotalPaid);
                    if (elDue) elDue.textContent = formatBDT(Math.max(0, sales - newTotalPaid));

                    renderSelectedMonthDisplay(user, currentSelectedMonthKey);
                    renderMonthlyHistoryTable(user.monthlyStats);
                    loadAccountingLedger(currentMPOId);
                    renderMPOCards(allUsers);
                }

                showToast('জমা এন্ট্রি মুছে ফেলা হয়েছে ও হিসাব সমন্বয় হয়েছে', 'success');
            } catch (e) {
                console.error("Delete MPO payment error:", e);
                showToast('জমা এন্ট্রি মোছা যায়নি', 'error');
            }
        }
    );
}

// ==================== Remote Cache Clear ====================
async function remoteClearCache() {
    if (!currentMPOId) return;
    confirmModal('Cache Clear', `${currentMPOId}-এর ডিভাইসের cache clear করবেন? পরের লগইনে fresh data নামবে।`, async () => {
        try {
            await updateDoc(doc(db, "users", currentMPOId), { forceClearCache: Date.now() });
            await appCache.remove(`admin_cache_customers_${currentMPOId}`);
            await appCache.remove(`admin_cache_sales_${currentMPOId}`);
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
                const deletedUser = allUsers.find(u => u.id === currentMPOId);
                const dSales = parseFloat(deletedUser?.totalSales || 0);
                const dPaid  = parseFloat(deletedUser?.totalPaid || 0);
                const dInv   = parseInt(deletedUser?.invoiceCount || 0);

                await deleteDoc(doc(db, "users", currentMPOId));

                try {
                    await setDoc(COMPANY_STATS_DOC_REF(), {
                        mpoCount: increment(-1),
                        totalSales: increment(-dSales),
                        totalPaid: increment(-dPaid),
                        totalInvoices: increment(-dInv),
                        updatedAt: serverTimestamp()
                    }, { merge: true });
                    await appCache.remove(CACHE_COMPANY_STATS);
                    localStorage.removeItem(CACHE_COMPANY_STATS);
                } catch (_) {}

                await appCache.remove(ADMIN_USERS_CACHE);
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

        try {
            await setDoc(COMPANY_STATS_DOC_REF(), {
                mpoCount: increment(1),
                updatedAt: serverTimestamp()
            }, { merge: true });
            await appCache.remove(CACHE_COMPANY_STATS);
            localStorage.removeItem(CACHE_COMPANY_STATS);
        } catch (_) {}

        await appCache.remove(ADMIN_USERS_CACHE);
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
        const toPrint = { ...inv, user: inv.user || currentMPOId };
        sessionStorage.setItem('admin_print_invoice', JSON.stringify(toPrint));
        window.open('../main.html?action=admin_print', '_blank');
    } catch { showToast('প্রিন্ট করা যায়নি', 'error'); }
}

// ==================== MONTHLY TARGET & PERFORMANCE LOGIC ====================
let currentSelectedMonthKey = null;

async function renderMonthlySection(user) {
    if (!user) return;
    const curMonthKey = getInvoiceMonthKey(new Date());

    let monthlyStats = user.monthlyStats || {};

    // Auto-sync if user has invoices but no monthlyStats yet
    if (Object.keys(monthlyStats).length === 0 && (user.invoiceCount > 0 || user.totalSales > 0)) {
        console.log("Auto-syncing monthly stats for", user.id);
        const synced = await syncUserMonthlyStats(user.id);
        if (synced) {
            monthlyStats = synced;
            user.monthlyStats = synced;
            // update in allUsers array
            const u = allUsers.find(x => x.id === user.id);
            if (u) u.monthlyStats = synced;
        }
    }

    // Populate Month Dropdown
    const select = document.getElementById('monthlySelect');
    if (!select) return;

    // Collect all month keys sorted descending
    const keysSet = new Set(Object.keys(monthlyStats));
    keysSet.add(curMonthKey); // Always include current month
    const sortedKeys = Array.from(keysSet).sort().reverse();

    if (!currentSelectedMonthKey || !keysSet.has(currentSelectedMonthKey)) {
        currentSelectedMonthKey = curMonthKey;
    }

    select.innerHTML = sortedKeys.map(k => {
        const name = getMonthNameBangla(k);
        const isCurrent = (k === curMonthKey) ? ' (চলতি মাস)' : '';
        const isSelected = (k === currentSelectedMonthKey) ? 'selected' : '';
        return `<option value="${k}" ${isSelected}>${name}${isCurrent}</option>`;
    }).join('');

    renderSelectedMonthDisplay(user, currentSelectedMonthKey);
    renderMonthlyHistoryTable(monthlyStats);
}

function onMonthSelectChange() {
    const select = document.getElementById('monthlySelect');
    if (!select) return;
    currentSelectedMonthKey = select.value;
    const user = allUsers.find(u => u.id === currentMPOId);
    if (user) renderSelectedMonthDisplay(user, currentSelectedMonthKey);
}

function renderSelectedMonthDisplay(user, monthKey) {
    const monthlyStats = user.monthlyStats || {};
    const curMonthKey = getInvoiceMonthKey(new Date());
    const m = monthlyStats[monthKey] || {
        monthKey,
        monthName: getMonthNameBangla(monthKey),
        totalSales: 0,
        invoiceCount: 0,
        startInvoice: 0,
        endInvoice: 0,
        targetAmount: 0
    };

    const sales = parseFloat(m.totalSales || 0);
    const custPaid = parseFloat(m.customerCollection || 0);
    const count = parseInt(m.invoiceCount || 0);
    const target = parseFloat(m.targetAmount || 0);

    // 1. Sales
    document.getElementById('mtMonthSales').textContent = formatBDT(sales);
    document.getElementById('mtMonthSalesSub').textContent = (monthKey === curMonthKey) ? 'চলতি মাসের বিক্রয়' : `${m.monthName} এর বিক্রয়`;

    // 1b. Customer Collection
    const elMonthCustPaid = document.getElementById('mtMonthCustPaid');
    if (elMonthCustPaid) elMonthCustPaid.textContent = formatBDT(custPaid);
    const elMonthCustPaidSub = document.getElementById('mtMonthCustPaidSub');
    if (elMonthCustPaidSub) elMonthCustPaidSub.textContent = (monthKey === curMonthKey) ? 'চলতি মাসে কাস্টমার আদায়' : `${m.monthName} এ কাস্টমার আদায়`;

    // 1c. Monthly Office Collection / Deposit (মাসের জমা কালেকশন)
    const monthPaid = parseFloat(m.totalPaid || 0);
    const elMonthPaid = document.getElementById('mtMonthPaid');
    if (elMonthPaid) elMonthPaid.textContent = formatBDT(monthPaid);
    const elMonthPaidSub = document.getElementById('mtMonthPaidSub');
    if (elMonthPaidSub) elMonthPaidSub.textContent = (monthKey === curMonthKey) ? 'চলতি মাসে অফিসে জমা' : `${m.monthName} এ অফিসে জমা`;

    // 2. Invoice Range
    let rangeStr = '—';
    if (count > 0 && m.startInvoice && m.endInvoice) {
        if (m.startInvoice === m.endInvoice) {
            rangeStr = `#${m.startInvoice}`;
        } else {
            rangeStr = `#${m.startInvoice} - #${m.endInvoice}`;
        }
    }
    document.getElementById('mtInvRange').textContent = rangeStr;
    document.getElementById('mtInvRangeSub').textContent = (count > 0) ? `শুরু: #${m.startInvoice || 1} থেকে শেষ: #${m.endInvoice || count}` : 'কোনো ইনভয়েস নেই';

    // 3. Invoice Count
    document.getElementById('mtMonthInvCount').textContent = `${count}টি`;
    document.getElementById('mtMonthInvCountSub').textContent = `তৈরিকৃত ইনভয়েস`;

    // 4. Target & Progress
    const targetEl = document.getElementById('mtMonthTarget');
    const pctEl = document.getElementById('mtMonthTargetPercent');
    const progValEl = document.getElementById('mtProgressValue');
    const progFillEl = document.getElementById('mtProgressFill');

    if (target > 0) {
        targetEl.textContent = formatBDT(target);
        const pct = Math.min(100, Math.round((sales / target) * 100));
        pctEl.textContent = `${pct}% অর্জিত`;
        progValEl.textContent = `${pct}% (${formatBDT(sales)} / ${formatBDT(target)})`;
        progFillEl.style.width = `${pct}%`;
    } else {
        targetEl.textContent = 'টার্গেট নেই';
        pctEl.textContent = 'ক্লিক করে টার্গেট সেট করুন';
        progValEl.textContent = 'টার্গেট নির্ধারিত হয়নি';
        progFillEl.style.width = '0%';
    }
}

function renderMonthlyHistoryTable(monthlyStats) {
    const tbody = document.getElementById('mtHistoryTableBody');
    if (!tbody) return;

    const entries = Object.values(monthlyStats || {}).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
    if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:16px;">কোনো মাসিক হিসাবের ইতিহাস নেই</td></tr>';
        return;
    }

    tbody.innerHTML = entries.map(m => {
        const sales = parseFloat(m.totalSales || 0);
        const custPaid = parseFloat(m.customerCollection || 0);
        const monthPaid = parseFloat(m.totalPaid || 0);
        const count = parseInt(m.invoiceCount || 0);
        const target = parseFloat(m.targetAmount || 0);
        let rangeStr = '—';
        if (count > 0 && m.startInvoice && m.endInvoice) {
            rangeStr = (m.startInvoice === m.endInvoice) ? `#${m.startInvoice}` : `#${m.startInvoice} - #${m.endInvoice}`;
        }

        let targetStr = '—';
        let progressBadge = '<span class="badge neu">নেই</span>';
        if (target > 0) {
            targetStr = formatBDT(target);
            const pct = Math.min(100, Math.round((sales / target) * 100));
            if (pct >= 100) {
                progressBadge = `<span class="badge up">${pct}% অর্জিত</span>`;
            } else if (pct >= 50) {
                progressBadge = `<span class="badge" style="background:rgba(37,99,235,0.15);color:var(--blue2);">${pct}%</span>`;
            } else {
                progressBadge = `<span class="badge down">${pct}%</span>`;
            }
        }

        return `<tr>
            <td class="bold">${m.monthName || m.monthKey}</td>
            <td style="color:var(--green2);font-weight:700;">${formatBDT(sales)}</td>
            <td style="color:#2dd4bf;font-weight:700;">${formatBDT(custPaid)}</td>
            <td style="color:#60a5fa;font-weight:700;">${formatBDT(monthPaid)}</td>
            <td><span style="font-family:monospace;color:var(--blue2);font-weight:600;">${rangeStr}</span></td>
            <td>${count}টি</td>
            <td>${targetStr}</td>
            <td>${progressBadge}</td>
        </tr>`;
    }).join('');
}

function toggleHistoryWrap() {
    const wrap = document.getElementById('mtHistoryWrap');
    const icon = document.getElementById('mtToggleIcon');
    if (!wrap) return;
    const isHidden = wrap.classList.contains('hidden');
    wrap.classList.toggle('hidden');
    if (icon) icon.textContent = isHidden ? '▲' : '▼';
}

function openSetTargetModal() {
    if (!currentMPOId) return;
    const user = allUsers.find(u => u.id === currentMPOId);
    const mKey = currentSelectedMonthKey || getInvoiceMonthKey(new Date());
    const mName = getMonthNameBangla(mKey);

    document.getElementById('targetMonthDisplay').value = `${mName} (${mKey})`;
    const existingTarget = user?.monthlyStats?.[mKey]?.targetAmount || '';
    document.getElementById('targetAmountInput').value = existingTarget || '';

    document.getElementById('setTargetModal').classList.remove('hidden');
    document.getElementById('targetAmountInput').focus();
}

function closeSetTargetModal() {
    document.getElementById('setTargetModal').classList.add('hidden');
}

async function handleSaveTarget() {
    if (!currentMPOId) return;
    const mKey = currentSelectedMonthKey || getInvoiceMonthKey(new Date());
    const amount = parseFloat(document.getElementById('targetAmountInput').value) || 0;

    const btn = document.getElementById('saveSetTarget');
    btn.disabled = true;
    btn.textContent = '⏳ সেভ হচ্ছে...';

    try {
        const user = allUsers.find(u => u.id === currentMPOId);
        const monthlyStats = user?.monthlyStats || {};
        const curMonth = monthlyStats[mKey] || {
            monthKey: mKey,
            monthName: getMonthNameBangla(mKey),
            totalSales: 0,
            invoiceCount: 0,
            startInvoice: 0,
            endInvoice: 0
        };

        curMonth.targetAmount = amount;
        curMonth.updatedAt = new Date().toISOString();

        await updateDoc(doc(db, "users", currentMPOId), {
            [`monthlyStats.${mKey}`]: curMonth
        });

        // Update local object
        if (user) {
            user.monthlyStats = user.monthlyStats || {};
            user.monthlyStats[mKey] = curMonth;
        }

        closeSetTargetModal();
        renderSelectedMonthDisplay(user, mKey);
        renderMonthlyHistoryTable(user.monthlyStats);
        showToast('মাসিক টার্গেট সেভ হয়েছে', 'success');
    } catch (e) {
        console.error("Save target error:", e);
        showToast('টার্গেট সেভ করা যায়নি', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '✅ টার্গেট সেভ করুন';
    }
}

async function handleSyncMonthlyData() {
    if (!currentMPOId) return;
    const btn = document.getElementById('syncMonthlyDataBtn');
    btn.disabled = true;
    btn.textContent = '⏳ সিঙ্ক...';

    try {
        const synced = await syncUserMonthlyStats(currentMPOId);
        if (synced) {
            await refreshCurrentMPODetailData();
            showToast('মাসিক হিসাব সফলভাবে রি-সিঙ্ক হয়েছে', 'success');
        } else {
            showToast('সিঙ্ক করার মতো তথ্য নেই', 'warning');
        }
    } catch (e) {
        console.error("Sync error:", e);
        showToast('সিঙ্ক করা যায়নি', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '🔄 সিঙ্ক';
    }
}

async function refreshCurrentMPODetailData() {
    if (!currentMPOId) return;
    try {
        const snap = await getDoc(doc(db, "users", currentMPOId));
        if (snap.exists()) {
            const updatedUser = { id: currentMPOId, ...snap.data() };
            const idx = allUsers.findIndex(u => u.id === currentMPOId);
            if (idx !== -1) allUsers[idx] = updatedUser;

            // Update stats cards directly without forcing switchTab('shopInfo')
            const sales = parseFloat(updatedUser.totalSales || 0);
            const custPaid = parseFloat(updatedUser.customerCollection || 0);
            const paid  = parseFloat(updatedUser.totalPaid  || 0);
            const due   = Math.max(0, sales - paid);
            const elSales = document.getElementById('mpoStatSales');
            const elCustPaid = document.getElementById('mpoStatCustPaid');
            const elPaid = document.getElementById('mpoStatPaid');
            const elDue = document.getElementById('mpoStatDue');
            const elInvCount = document.getElementById('mpoStatInvCount');
            if (elSales) elSales.textContent = formatBDT(sales);
            if (elCustPaid) elCustPaid.textContent = formatBDT(custPaid);
            if (elPaid) elPaid.textContent = formatBDT(paid);
            if (elDue) elDue.textContent = formatBDT(due);
            if (elInvCount) elInvCount.textContent = updatedUser.invoiceCount || 0;

            // Re-render Monthly Target & Accounts
            renderMonthlySection(updatedUser);
            renderMPOCards(allUsers);

            // Invalidate customer cache and reload shopInfo if currently on shopInfo tab
            await appCache.remove(`admin_cache_customers_${currentMPOId}`);
            localStorage.removeItem(`admin_cache_customers_${currentMPOId}`);
            const activeTabEl = document.querySelector('.mpo-tab.active');
            if (activeTabEl && activeTabEl.dataset.tab === 'shopInfo') {
                await loadShopInfo(currentMPOId, true);
            } else if (activeTabEl && activeTabEl.dataset.tab === 'accounting') {
                loadAccountingLedger(currentMPOId);
            }
        }
    } catch (e) {
        console.warn("Refresh MPO Detail error:", e);
    }
}

