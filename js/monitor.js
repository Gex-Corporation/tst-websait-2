// ======================================================
//  Invoice Pro — Sales Monitor Page JS (monitor.js)
//  GEX Corporation | <Dev Alif/>
// ======================================================

import {
    db, collection, getDocs, getDoc, setDoc, updateDoc, deleteDoc, doc,
    query, where, orderBy, limit, serverTimestamp, writeBatch,
    increment, Timestamp, startAfter,
    getCurrentUser, requireAdmin, logout, buildPageTopbar,
    formatBDT, formatDate, daysAgoLabel, escapeHtml,
    showToast, confirmModal, renderLoading, renderEmpty, debounce,
    CACHE_KEYS, ADMIN_MONITOR_CACHE
} from '../js/shared.js';

// ==================== Constants ====================
const MONITOR_PAGE_SIZE  = 50;
const MONITOR_CACHE_MAX  = 200;
const LAST_SYNC_KEY = 'monitor_last_sync_v1';

// ==================== State ====================
let allInvoices       = [];   // full local cache (sorted by updatedAt desc)
let filteredInvoices  = [];   // after search/filter
let displayedCount    = 0;
let pendingDeleteIds  = new Set();
let mpoList           = [];
let currentDetailInv  = null;

// ==================== Init ====================
window.addEventListener('DOMContentLoaded', async () => {
    const user = requireAdmin();
    if (!user) return;

    buildPageTopbar({
        title: '📈 Sales Monitor',
        subtitle: 'সব MPO-এর ইনভয়েস পর্যবেক্ষণ',
        backUrl: '../admin.html'
    });

    bindUI();
    await Promise.all([
        loadMonitorData(),
        loadPendingDeleteRequests(),
    ]);
});

// ==================== Bind UI Events ====================
function bindUI() {
    document.getElementById('monitorRefreshBtn').onclick  = () => forceRefresh();
    document.getElementById('monitorLoadMoreBtn').onclick = () => showMore();
    document.getElementById('refreshPendingBtn').onclick  = () => loadPendingDeleteRequests();
    document.getElementById('closeInvDetail').onclick     = closeDetailModal;
    document.getElementById('invoiceDetailModal').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeDetailModal();
    });

    const search = document.getElementById('monitorSearch');
    search.addEventListener('input', debounce(() => applyFilter(), 300));

    document.getElementById('mpoFilter').addEventListener('change', () => applyFilter());
    document.getElementById('statusFilter').addEventListener('change', () => applyFilter());
}

// ==================== Cache Helpers ====================
function loadCache() {
    try {
        const raw = localStorage.getItem(ADMIN_MONITOR_CACHE);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

function saveCache(items) {
    try {
        localStorage.setItem(ADMIN_MONITOR_CACHE, JSON.stringify(items.slice(0, MONITOR_CACHE_MAX)));
    } catch {}
}

function getLastSync() {
    return parseInt(localStorage.getItem(LAST_SYNC_KEY) || '0', 10);
}

function setLastSync(ts) {
    localStorage.setItem(LAST_SYNC_KEY, String(ts));
}

function mergeItems(existing, updates) {
    const map = {};
    existing.forEach(i => { if (i.id) map[i.id] = i; });
    updates.forEach(i => {
        if (i.id) {
            if (i.deleted) delete map[i.id];
            else map[i.id] = i;
        }
    });
    return Object.values(map).sort((a, b) => {
        const ta = getTs(a); const tb = getTs(b);
        return tb - ta;
    });
}

function getTs(item) {
    const u = item.updatedAt || item.timestamp;
    if (!u) return 0;
    if (u.seconds) return u.seconds * 1000;
    if (u.toMillis) return u.toMillis();
    return 0;
}

// ==================== Load Monitor Data ====================
async function loadMonitorData(force = false) {
    const tbody = document.getElementById('monitorTableBody');
    const cache = loadCache();

    if (cache.length > 0 && !force) {
        allInvoices = cache;
        applyFilter();
        updateStats();
        // Background sync
        syncIncremental().then(changed => {
            if (changed) { applyFilter(); updateStats(); }
        }).catch(() => {});
        return;
    }

    // No cache or force refresh
    renderLoading(tbody, 'ইনভয়েস লোড হচ্ছে...');
    try {
        const snap = await getDocs(query(
            collection(db, "invoices"),
            orderBy("updatedAt", "desc"),
            limit(MONITOR_CACHE_MAX)
        ));
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        allInvoices = items;
        saveCache(items);
        if (items.length > 0) {
            setLastSync(getTs(items[0]) || Date.now());
        }
        applyFilter();
        updateStats();
    } catch (e) {
        console.error("Monitor load error:", e);
        tbody.innerHTML = `<tr><td colspan="7"><div class="loading-center" style="color:var(--red2)">❌ লোড করা যায়নি। পুনরায় চেষ্টা করুন।</div></td></tr>`;
    }
}

async function syncIncremental() {
    const lastSync = getLastSync();
    try {
        const q = query(
            collection(db, "invoices"),
            where("updatedAt", ">", new Date(lastSync)),
            orderBy("updatedAt", "asc")
        );
        const snap = await getDocs(q);
        if (snap.empty) return false;
        const updates = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        allInvoices = mergeItems(allInvoices, updates);
        saveCache(allInvoices);
        const latest = getTs(updates[updates.length - 1]);
        if (latest > lastSync) setLastSync(latest);
        return true;
    } catch (e) {
        if (e.code !== 'failed-precondition') console.warn("Sync error:", e);
        return false;
    }
}

async function forceRefresh() {
    const btn = document.getElementById('monitorRefreshBtn');
    btn.disabled = true;
    btn.textContent = '⏳ রিফ্রেশ হচ্ছে...';
    localStorage.removeItem(ADMIN_MONITOR_CACHE);
    localStorage.removeItem(LAST_SYNC_KEY);
    allInvoices = [];
    filteredInvoices = [];
    displayedCount = 0;
    await loadMonitorData(true);
    await loadPendingDeleteRequests();
    btn.disabled = false;
    btn.textContent = '🔄 রিফ্রেশ';
    showToast('ডেটা রিফ্রেশ হয়েছে', 'success');
}

// ==================== Filter & Search ====================
function applyFilter() {
    const search = document.getElementById('monitorSearch').value.trim().toLowerCase();
    const mpoVal = document.getElementById('mpoFilter').value;
    const statusVal = document.getElementById('statusFilter').value;

    filteredInvoices = allInvoices.filter(inv => {
        if (mpoVal && inv.user !== mpoVal) return false;
        if (statusVal === 'active'  && pendingDeleteIds.has(inv.id)) return false;
        if (statusVal === 'pending' && !pendingDeleteIds.has(inv.id)) return false;
        if (statusVal === 'unprinted' && inv.adminPrinted) return false;
        if (statusVal === 'printed' && !inv.adminPrinted) return false;
        if (search) {
            const haystack = [inv.user, inv.invoiceNumber, inv.billTo, inv.shipTo, String(inv.grandTotal)].join(' ').toLowerCase();
            if (!haystack.includes(search)) return false;
        }
        return true;
    });

    displayedCount = 0;
    renderTable();
    populateMPOFilter();
}

function populateMPOFilter() {
    const select = document.getElementById('mpoFilter');
    const currentVal = select.value;
    const users = [...new Set(allInvoices.map(i => i.user).filter(Boolean))].sort();
    mpoList = users;
    select.innerHTML = '<option value="">সব MPO</option>' +
        users.map(u => `<option value="${escapeHtml(u)}" ${u === currentVal ? 'selected' : ''}>${escapeHtml(u)}</option>`).join('');
}

// ==================== Render Table ====================
function renderTable() {
    const tbody = document.getElementById('monitorTableBody');
    const PAGE = MONITOR_PAGE_SIZE;

    if (filteredInvoices.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7">
            <div class="no-results">
                <div class="no-results-icon">🔍</div>
                কোনো ইনভয়েস পাওয়া যায়নি
            </div>
        </td></tr>`;
        document.getElementById('monitorLoadMoreWrap').style.display = 'none';
        return;
    }

    const page = filteredInvoices.slice(displayedCount, displayedCount + PAGE);
    const rows = page.map(inv => buildRow(inv)).join('');

    if (displayedCount === 0) {
        tbody.innerHTML = rows;
    } else {
        tbody.insertAdjacentHTML('beforeend', rows);
    }

    displayedCount += page.length;
    bindRowActions();

    const hasMore = displayedCount < filteredInvoices.length;
    const wrap = document.getElementById('monitorLoadMoreWrap');
    wrap.style.display = hasMore ? 'block' : 'none';
}

function showMore() {
    renderTable();
}

function buildRow(inv) {
    // Invoice stores date in 3 possible ways:
    // 1. inv.date — formatted string like "15 Jan, 2024" (set by app.js formatDate)
    // 2. inv.timestamp — ISO string like "2024-01-15T10:30:00.000Z"
    // 3. inv.updatedAt — Firestore Timestamp object {seconds, nanoseconds}
    let dateStr = '—';

    if (inv.date && inv.date !== '—' && inv.date.trim()) {
        // Prefer the human-readable date string saved by app.js
        dateStr = inv.date.trim();
    } else {
        // Fallback: try timestamp (ISO string) or updatedAt (Firestore Timestamp)
        const ts = inv.timestamp || inv.updatedAt;
        if (ts) {
            let d = null;
            if (typeof ts === 'string') {
                // ISO string like "2024-01-15T10:30:00.000Z"
                d = new Date(ts);
            } else if (ts?.seconds) {
                // Firestore Timestamp object
                d = new Date(ts.seconds * 1000);
            } else if (ts?.toDate) {
                d = ts.toDate();
            }
            if (d && !isNaN(d.getTime())) {
                dateStr = d.toLocaleDateString('bn-BD', { day: '2-digit', month: 'short', year: 'numeric' });
            }
        }
    }

    const isPending = pendingDeleteIds.has(inv.id);
    const statusBadge = isPending
        ? '<span class="status-badge pending">পেন্ডিং</span>'
        : '<span class="status-badge active">সক্রিয়</span>';

    const currency = inv.currency || '৳';
    const total = Number(inv.grandTotal || 0).toLocaleString('en-BD');

    return `<tr data-id="${escapeHtml(inv.id)}">
        <td class="bold">${escapeHtml(inv.user || '—')}</td>
        <td>${dateStr}</td>
        <td class="accent">${escapeHtml(inv.invoiceNumber || '—')}</td>
        <td>${escapeHtml(inv.billTo || '—')}</td>
        <td class="bold" style="color:var(--green2)">${currency}${total}</td>
        <td>${statusBadge}</td>
        <td>
            <div class="inv-action-btns">
                <button class="btn btn-sm view-inv-btn" data-id="${escapeHtml(inv.id)}" title="বিবরণ দেখুন">
                    👁 <span class="btn-label">দেখুন</span>
                </button>
                <button class="btn btn-sm btn-primary print-inv-btn" data-id="${escapeHtml(inv.id)}" title="প্রিন্ট করুন">
                    🖨️
                </button>
                <button class="btn btn-sm btn-danger del-inv-btn" data-id="${escapeHtml(inv.id)}" title="ডিলেট করুন">
                    🗑️
                </button>
            </div>
        </td>
    </tr>`;
}

function bindRowActions() {
    const tbody = document.getElementById('monitorTableBody');
    tbody.querySelectorAll('.view-inv-btn').forEach(btn => {
        btn.onclick = () => {
            const inv = allInvoices.find(i => i.id === btn.dataset.id);
            if (inv) openDetailModal(inv);
        };
    });
    tbody.querySelectorAll('.print-inv-btn').forEach(btn => {
        btn.onclick = () => {
            const inv = allInvoices.find(i => i.id === btn.dataset.id);
            if (inv) printInvoice(inv);
        };
    });
    tbody.querySelectorAll('.del-inv-btn').forEach(btn => {
        btn.onclick = () => deleteInvoice(btn.dataset.id);
    });
}

// ==================== Stats ====================
function updateStats() {
    let totalSales = 0, totalPaid = 0;

    // Get from users cache
    const usersRaw = localStorage.getItem('admin_cached_users_list_v1');
    if (usersRaw) {
        try {
            JSON.parse(usersRaw).filter(u => u.id !== 'admin').forEach(u => {
                totalSales += parseFloat(u.totalSales || 0);
                totalPaid  += parseFloat(u.totalPaid  || 0);
            });
        } catch {}
    }

    document.getElementById('statTotalInv').textContent   = allInvoices.length;
    document.getElementById('statTotalSales').textContent  = totalSales > 0 ? formatBDT(totalSales) : '—';
    document.getElementById('statTotalDue').textContent    = totalSales > 0 ? formatBDT(Math.max(0, totalSales - totalPaid)) : '—';
}

// ==================== Pending Delete Requests ====================
async function loadPendingDeleteRequests() {
    try {
        const q = query(collection(db, "deleteRequests"), where("status", "==", "pending"));
        const snap = await getDocs(q);
        const requests = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        pendingDeleteIds = new Set(requests.map(r => r.invoiceId || r.id));

        const card = document.getElementById('pendingReqCard');
        const badge = document.getElementById('pendingBadge');
        const statEl = document.getElementById('statPendingReqs');

        statEl.textContent = requests.length;
        badge.textContent = requests.length;

        if (requests.length > 0) {
            card.style.display = 'block';
            renderPendingRequests(requests);
        } else {
            card.style.display = 'none';
        }

        // Re-render table to update pending badges
        if (filteredInvoices.length > 0) {
            displayedCount = 0;
            const tbody = document.getElementById('monitorTableBody');
            tbody.innerHTML = '';
            renderTable();
        }
    } catch (e) {
        console.error("Pending requests error:", e);
        document.getElementById('statPendingReqs').textContent = '—';
    }
}

function renderPendingRequests(requests) {
    const body = document.getElementById('pendingReqBody');
    body.innerHTML = requests.map(r => `
        <div class="pending-req-item">
            <div class="pending-req-info">
                <div class="req-user">👤 ${escapeHtml(r.user)}</div>
                <span>📄 <strong>ইনভয়েস:</strong> ${escapeHtml(r.invoiceNumber || '—')}</span>
                <span>📅 <strong>তারিখ:</strong> ${escapeHtml(r.date || '—')}</span>
                <span>💰 <strong>পরিমাণ:</strong> ${escapeHtml(r.currency || '')}${escapeHtml(String(r.grandTotal || 0))}</span>
            </div>
            <div class="pending-req-actions">
                <button class="btn btn-sm btn-success approve-req-btn" data-inv="${escapeHtml(r.invoiceId || r.id)}">
                    ✓ অনুমোদন
                </button>
                <button class="btn btn-sm btn-danger reject-req-btn" data-inv="${escapeHtml(r.invoiceId || r.id)}" data-req="${escapeHtml(r.id)}">
                    ✕ প্রত্যাখ্যান
                </button>
            </div>
        </div>
    `).join('');

    body.querySelectorAll('.approve-req-btn').forEach(btn => {
        btn.onclick = () => approveDeleteRequest(btn.dataset.inv, btn);
    });
    body.querySelectorAll('.reject-req-btn').forEach(btn => {
        btn.onclick = () => rejectDeleteRequest(btn.dataset.inv, btn.dataset.req, btn);
    });
}

async function approveDeleteRequest(invoiceId, btn) {
    confirmModal(
        'ইনভয়েস ডিলেট নিশ্চিত করুন',
        'এই ইনভয়েসটি স্থায়ীভাবে মুছে যাবে এবং স্টক পুনরুদ্ধার হবে। এগিয়ে যাবেন?',
        async () => {
            try {
                btn.disabled = true;
                await deleteInvoiceWithRestore(invoiceId);
                await deleteDoc(doc(db, "deleteRequests", invoiceId));
                showToast('ইনভয়েস ডিলেট হয়েছে', 'success');
                await forceRefresh();
            } catch (e) {
                showToast('ডিলেট করা যায়নি', 'error');
                console.error(e);
            }
        },
        true
    );
}

async function rejectDeleteRequest(invoiceId, reqId, btn) {
    confirmModal(
        'রিকোয়েস্ট প্রত্যাখ্যান',
        'এই ডিলেট রিকোয়েস্টটি প্রত্যাখ্যান করবেন? ইনভয়েসটি সক্রিয় থাকবে।',
        async () => {
            try {
                btn.disabled = true;
                await deleteDoc(doc(db, "deleteRequests", reqId || invoiceId));
                showToast('রিকোয়েস্ট প্রত্যাখ্যান হয়েছে', 'warning');
                await loadPendingDeleteRequests();
            } catch (e) {
                showToast('প্রত্যাখ্যান করা যায়নি', 'error');
            }
        },
        true
    );
}

// ==================== Delete Invoice With Restore ====================
async function deleteInvoiceWithRestore(invoiceId) {
    const invSnap = await getDoc(doc(db, "invoices", invoiceId));
    if (!invSnap.exists()) throw new Error("Invoice not found");
    const inv = invSnap.data();

    const batch = writeBatch(db);

    // Restore stock
    if (Array.isArray(inv.items)) {
        for (const item of inv.items) {
            if (item.productId && item.quantity > 0) {
                const stockRef = doc(db, "stocks", item.productId);
                batch.update(stockRef, { quantity: increment(item.quantity), updatedAt: serverTimestamp() });
            }
        }
    }

    // Update user accounting
    if (inv.user) {
        const grandTotal = parseFloat(inv.grandTotal || 0);
        if (grandTotal > 0) {
            batch.update(doc(db, "users", inv.user), {
                totalSales:   increment(-grandTotal),
                invoiceCount: increment(-1),
            });
        }
    }

    // Update daily stats
    if (inv.timestamp || inv.updatedAt) {
        const ts = (inv.timestamp || inv.updatedAt);
        const date = ts.seconds
            ? new Date(ts.seconds * 1000).toLocaleDateString('en-CA')
            : new Date().toLocaleDateString('en-CA');
        const grandTotal = parseFloat(inv.grandTotal || 0);
        if (grandTotal > 0) {
            batch.update(doc(db, "settings", "dailyStats"), { [date]: increment(-grandTotal) });
        }
    }

    batch.delete(doc(db, "invoices", invoiceId));
    await batch.commit();

    // Remove from local cache
    allInvoices = allInvoices.filter(i => i.id !== invoiceId);
    saveCache(allInvoices);
}

function deleteInvoice(invoiceId) {
    confirmModal(
        'ইনভয়েস ডিলেট করুন',
        'এই ইনভয়েসটি স্থায়ীভাবে মুছে যাবে এবং স্টক পুনরুদ্ধার হবে। আপনি কি নিশ্চিত?',
        async () => {
            try {
                await deleteInvoiceWithRestore(invoiceId);
                // Also remove pending delete request if exists
                try { await deleteDoc(doc(db, "deleteRequests", invoiceId)); } catch {}
                showToast('ইনভয়েস ডিলেট হয়েছে', 'success');
                filteredInvoices = filteredInvoices.filter(i => i.id !== invoiceId);
                displayedCount = Math.max(0, displayedCount - 1);
                applyFilter();
                loadPendingDeleteRequests();
            } catch (e) {
                showToast('ডিলেট করা যায়নি: ' + e.message, 'error');
                console.error(e);
            }
        }
    );
}

// ==================== Invoice Detail Modal ====================
function openDetailModal(inv) {
    currentDetailInv = inv;
    const modal = document.getElementById('invoiceDetailModal');
    const body = document.getElementById('invoiceDetailBody');

    const ts = inv.timestamp || inv.updatedAt;
    let dateStr = '—';
    if (ts?.seconds) dateStr = new Date(ts.seconds * 1000).toLocaleDateString('bn-BD', { day: '2-digit', month: 'long', year: 'numeric' });

    const currency = inv.currency || '৳';
    const items = Array.isArray(inv.items) ? inv.items : [];
    const subTotal = items.reduce((s, i) => s + (parseFloat(i.total || 0)), 0);
    const discount = inv.discountPercent > 0 ? (subTotal * inv.discountPercent / 100) : 0;

    body.innerHTML = `
        <div class="inv-detail-grid">
            <div class="inv-detail-card">
                <div class="inv-detail-section-title">ইনভয়েস তথ্য</div>
                <div class="info-row"><span class="label">ইনভয়েস নং</span><span class="value accent">${escapeHtml(inv.invoiceNumber || '—')}</span></div>
                <div class="info-row"><span class="label">তারিখ</span><span class="value">${dateStr}</span></div>
                <div class="info-row"><span class="label">MPO</span><span class="value">${escapeHtml(inv.user || '—')}</span></div>
                <div class="info-row"><span class="label">মুদ্রা</span><span class="value">${escapeHtml(inv.currency || 'BDT')}</span></div>
                ${inv.note ? `<div class="info-row"><span class="label">নোট</span><span class="value" style="font-size:12px">${escapeHtml(inv.note)}</span></div>` : ''}
            </div>
            <div class="inv-detail-card">
                <div class="inv-detail-section-title">কাস্টমার তথ্য</div>
                <div class="info-row"><span class="label">Bill To</span><span class="value">${escapeHtml(inv.billTo || '—')}</span></div>
                <div class="info-row"><span class="label">Ship To</span><span class="value">${escapeHtml(inv.shipTo || '—')}</span></div>
                <div class="info-row"><span class="label">ফোন</span><span class="value">${escapeHtml(inv.phone || '—')}</span></div>
            </div>
        </div>

        <div class="inv-detail-section-title">পণ্য তালিকা</div>
        <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:10px;overflow:hidden;">
            <table class="inv-items-table">
                <thead><tr>
                    <th>#</th><th>পণ্যের নাম</th><th style="text-align:right">পরিমাণ</th>
                    <th style="text-align:right">একক মূল্য</th><th style="text-align:right">মোট</th>
                </tr></thead>
                <tbody>
                    ${items.map((item, idx) => `<tr>
                        <td style="color:var(--text-muted)">${idx + 1}</td>
                        <td class="bold">${escapeHtml(item.name || item.productName || '—')}</td>
                        <td style="text-align:right">${item.quantity || 0}</td>
                        <td style="text-align:right">${currency}${Number(item.unitPrice || 0).toLocaleString()}</td>
                        <td style="text-align:right;color:var(--green2);font-weight:600">${currency}${Number(item.total || 0).toLocaleString()}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>
        <div class="inv-total-row">
            ${inv.discountPercent > 0 ? `<div><span class="total-label">সাব-টোটাল: </span><span style="color:var(--text-secondary)">${currency}${subTotal.toLocaleString()}</span></div>
            <div><span class="total-label">ছাড় (${inv.discountPercent}%): </span><span style="color:var(--red2)">-${currency}${discount.toFixed(2)}</span></div>` : ''}
            <div class="total-value">${currency}${Number(inv.grandTotal || 0).toLocaleString()}</div>
        </div>
    `;

    // Wire up modal footer buttons
    document.getElementById('printFromDetailBtn').onclick = () => {
        closeDetailModal();
        printInvoice(inv);
    };
    document.getElementById('deleteFromDetailBtn').onclick = () => {
        closeDetailModal();
        deleteInvoice(inv.id);
    };

    modal.classList.remove('hidden');
}

function closeDetailModal() {
    document.getElementById('invoiceDetailModal').classList.add('hidden');
    currentDetailInv = null;
}

// ==================== Print Invoice ====================
// Print করার জন্য main.html-এ ডেটা পাঠানো হয়
async function printInvoice(inv) {
    if (!inv) return;
    try {
        sessionStorage.setItem('admin_print_invoice', JSON.stringify(inv));
        window.open('../main.html?action=admin_print', '_blank');
        
        if (!inv.adminPrinted) {
            await updateDoc(doc(db, "invoices", inv.id), { adminPrinted: true });
            inv.adminPrinted = true;
            saveCache(allInvoices);
            applyFilter();
        }
    } catch (e) {
        console.error(e);
        showToast('প্রিন্ট করা যায়নি', 'error');
    }
}
