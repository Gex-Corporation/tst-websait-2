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
    CACHE_KEYS, ADMIN_MONITOR_CACHE, ADMIN_USERS_CACHE, deleteInvoiceWithRestore,
    getOrSyncCompanyStats, appCache,
    getOrSyncRecentInvoices, RECENT_INVOICES_DOC_REF, getMpoInvoices
} from '../js/shared.js';

// ==================== Constants ====================
const MONITOR_PAGE_SIZE       = 20;    // প্রতি পেজে ২০টি করে রেন্ডার
const SERVER_FETCH_LIMIT      = 20;    // সার্ভার থেকে প্রতিবারে ২০টি ফেচ
const REFRESH_COOLDOWN_MS     = 5000;  // রিফ্রেশ কুলডাউন ৫ সেকেন্ড
const MONITOR_INV_COUNT_KEY   = 'monitor_last_known_inv_count_v1';

// ==================== State ====================
let allInvoices          = [];   // full IndexedDB accumulated cache
let filteredInvoices     = [];   // filtered by search/MPO/status
let displayedCount       = 0;
let pendingDeleteIds     = new Set();
let mpoList              = [];
let currentDetailInv     = null;
let oldestServerDoc      = null; // Last DocumentSnapshot for server pagination fallback
let hasMoreServer        = true; // Flag for older server invoices
let lastRefreshTime      = 0;    // Throttle timestamp
let refreshCooldownTimer = null; // Cooldown timer interval

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
    search.addEventListener('input', debounce(() => applyFilter(true), 300));

    document.getElementById('mpoFilter').addEventListener('change', () => applyFilter(true));
    document.getElementById('statusFilter').addEventListener('change', () => applyFilter(true));
}

// ==================== Cache Helpers (IndexedDB) ====================
async function loadCache() {
    try {
        const cached = await appCache.get(ADMIN_MONITOR_CACHE);
        if (Array.isArray(cached) && cached.length > 0) return cached;
        // Check & migrate legacy localStorage if exists
        const raw = localStorage.getItem(ADMIN_MONITOR_CACHE);
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    await appCache.set(ADMIN_MONITOR_CACHE, parsed);
                    localStorage.removeItem(ADMIN_MONITOR_CACHE);
                    return parsed;
                }
            } catch (_) {}
        }
        return [];
    } catch (err) {
        console.warn("IndexedDB load error:", err);
        return [];
    }
}

async function saveCache(items) {
    try {
        await appCache.set(ADMIN_MONITOR_CACHE, items);
    } catch (err) {
        console.warn("IndexedDB save error:", err);
    }
}

function mergeItems(existing, updates, isLatestSync = false) {
    const map = {};
    (existing || []).forEach(i => { if (i.id) map[i.id] = i; });

    // When syncing the latest batch from server (limit 20), any cached item
    // that is newer than or equal to the oldest item of this fresh batch,
    // but not present in the fetched batch, was deleted on the server.
    if (isLatestSync && updates && updates.length > 0) {
        const updateIds = new Set(updates.map(u => u.id));
        const oldestUpdateTs = getTs(updates[updates.length - 1]);
        if (oldestUpdateTs > 0) {
            Object.keys(map).forEach(id => {
                const item = map[id];
                if (getTs(item) >= oldestUpdateTs && !updateIds.has(id)) {
                    delete map[id];
                }
            });
        }
    }

    (updates || []).forEach(i => {
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

// ==================== Server Fetch Helpers ====================
async function fetchLatestServerInvoices() {
    try {
        // Read from single document settings/recentInvoices (Exact 1 Firestore read!)
        const newItems = await getOrSyncRecentInvoices(true);
        if (newItems && newItems.length > 0) {
            allInvoices = mergeItems(allInvoices, newItems, true);
            await saveCache(allInvoices);
            return true;
        } else {
            hasMoreServer = false;
            return false;
        }
    } catch (err) {
        console.warn("Fetch latest server invoices error:", err);
        return false;
    }
}

// ==================== Load Monitor Data ====================
async function loadMonitorData(force = false) {
    const tbody = document.getElementById('monitorTableBody');
    const cached = await loadCache();

    // 1. Instant Offline-First render from IndexedDB if available
    if (cached.length > 0 && !force) {
        allInvoices = cached;
        applyFilter(true);
        const stats = await updateStats();

        // 🛡️ Smart Invoice Counter Guard:
        // settings/companyStats tracks totalInvoices in real-time.
        // If current totalInvoices matches our last known count and we have cached invoices,
        // no invoices were created or deleted on server -> SKIP server fetch (0 invoice reads)!
        const currentCount = parseInt(stats?.totalInvoices);
        const lastKnownRaw = localStorage.getItem(MONITOR_INV_COUNT_KEY);
        const lastKnownCount = lastKnownRaw !== null ? parseInt(lastKnownRaw) : -1;

        if (!isNaN(currentCount) && currentCount > 0 && currentCount === lastKnownCount) {
            // Count unchanged: Skip server invoices fetch -> 0 invoice read!
            return;
        }

        // Count changed or first time -> Background sync latest 20 from server
        fetchLatestServerInvoices().then(hasChanges => {
            if (hasChanges) {
                applyFilter(true);
                updateStats();
            }
            if (!isNaN(currentCount)) {
                localStorage.setItem(MONITOR_INV_COUNT_KEY, String(currentCount));
            }
        }).catch(() => {});
        return;
    }

    // 2. Fresh load if no cache
    if (cached.length === 0) {
        renderLoading(tbody, 'ইনভয়েস লোড হচ্ছে...');
    }
    try {
        await fetchLatestServerInvoices();
        applyFilter(true);
        const stats = await updateStats();
        if (stats && !isNaN(parseInt(stats.totalInvoices))) {
            localStorage.setItem(MONITOR_INV_COUNT_KEY, String(stats.totalInvoices));
        }
    } catch (e) {
        console.error("Monitor load error:", e);
        tbody.innerHTML = `<tr><td colspan="7"><div class="loading-center" style="color:var(--red2)">❌ লোড করা যায়নি। পুনরায় চেষ্টা করুন।</div></td></tr>`;
    }
}

// ==================== Refresh with 5-Second Cooldown ====================
async function forceRefresh() {
    const now = Date.now();
    const elapsed = now - lastRefreshTime;
    if (elapsed < REFRESH_COOLDOWN_MS) {
        const remaining = Math.ceil((REFRESH_COOLDOWN_MS - elapsed) / 1000);
        showToast(`অনুগ্রহ করে ${remaining} সেকেন্ড অপেক্ষা করুন`, 'warning');
        return;
    }
    lastRefreshTime = now;

    const btn = document.getElementById('monitorRefreshBtn');
    btn.disabled = true;
    btn.textContent = '⏳ সিঙ্ক হচ্ছে...';

    try {
        await fetchLatestServerInvoices();
        await loadPendingDeleteRequests();
        applyFilter(true);
        const stats = await updateStats(true);
        if (stats && !isNaN(parseInt(stats.totalInvoices))) {
            localStorage.setItem(MONITOR_INV_COUNT_KEY, String(stats.totalInvoices));
        }
        showToast('সর্বশেষ ২০টি ইনভয়েস সফলভাবে সিঙ্ক হয়েছে', 'success');
    } catch (e) {
        console.error("Refresh error:", e);
        showToast('রিফ্রেশ করা যায়নি', 'error');
    }

    // 5-second countdown on button
    let countdown = 5;
    btn.textContent = `⏳ ${countdown}s`;
    if (refreshCooldownTimer) clearInterval(refreshCooldownTimer);
    refreshCooldownTimer = setInterval(() => {
        countdown--;
        if (countdown > 0) {
            btn.textContent = `⏳ ${countdown}s`;
        } else {
            clearInterval(refreshCooldownTimer);
            refreshCooldownTimer = null;
            btn.disabled = false;
            btn.textContent = '🔄 রিফ্রেশ';
        }
    }, 1000);
}

// ==================== Filter & Search ====================
function applyFilter(reset = true) {
    const search = document.getElementById('monitorSearch').value.trim().toLowerCase();
    const mpoVal = document.getElementById('mpoFilter').value;
    const statusVal = document.getElementById('statusFilter').value;

    filteredInvoices = allInvoices.filter(inv => {
        if (mpoVal && inv.user !== mpoVal) return false;
        if (statusVal === 'active'    && pendingDeleteIds.has(inv.id)) return false;
        if (statusVal === 'pending'   && !pendingDeleteIds.has(inv.id)) return false;
        if (statusVal === 'unprinted' && inv.adminPrinted) return false;
        if (statusVal === 'printed'   && !inv.adminPrinted) return false;
        if (search) {
            const haystack = [inv.user, inv.invoiceNumber, inv.billTo, inv.shipTo, String(inv.grandTotal)].join(' ').toLowerCase();
            if (!haystack.includes(search)) return false;
        }
        return true;
    });

    if (reset) {
        displayedCount = 0;
        renderTable();
    }
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

    const hasMore = displayedCount < filteredInvoices.length || hasMoreServer;
    const wrap = document.getElementById('monitorLoadMoreWrap');
    wrap.style.display = hasMore ? 'block' : 'none';
}

// ==================== Hybrid Load More ====================
async function showMore() {
    // 1. If we still have un-rendered invoices in IndexedDB / memory:
    if (displayedCount < filteredInvoices.length) {
        renderTable();
        return;
    }

    // 2. If local cache reached end, check server for next 20 older invoices:
    if (!hasMoreServer) {
        showToast('আর কোনো পুরনো ইনভয়েস নেই', 'info');
        document.getElementById('monitorLoadMoreWrap').style.display = 'none';
        return;
    }

    const mpoVal = document.getElementById('mpoFilter').value;
    const loadMoreBtn = document.getElementById('monitorLoadMoreBtn');
    loadMoreBtn.disabled = true;
    const origText = loadMoreBtn.textContent;
    loadMoreBtn.textContent = '⏳ সার্ভার থেকে পুরনো ইনভয়েস লোড হচ্ছে...';

    try {
        let olderItems = [];
        if (mpoVal) {
            // Load this MPO's bucket! (Exact 1 read for 500 invoices!)
            const bucketRes = await getMpoInvoices(mpoVal);
            olderItems = bucketRes.invoices || [];
        } else {
            // Fallback for general server query if legacy invoices exist
            try {
                let q = oldestServerDoc
                    ? query(collection(db, "invoices"), orderBy("updatedAt", "desc"), startAfter(oldestServerDoc), limit(SERVER_FETCH_LIMIT))
                    : query(collection(db, "invoices"), orderBy("updatedAt", "desc"), limit(SERVER_FETCH_LIMIT));
                const snap = await getDocs(q);
                if (!snap.empty) {
                    oldestServerDoc = snap.docs[snap.docs.length - 1];
                    olderItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                }
            } catch (_) {}
        }

        if (olderItems.length === 0) {
            hasMoreServer = false;
            document.getElementById('monitorLoadMoreWrap').style.display = 'none';
            showToast('সব পুরনো ইনভয়েস লোড সম্পন্ন হয়েছে', 'info');
            return;
        }

        // Accumulate in IndexedDB!
        allInvoices = mergeItems(allInvoices, olderItems);
        await saveCache(allInvoices);

        // Re-filter and render the next batch (without resetting displayedCount)
        applyFilter(false);
        renderTable();
        showToast(`${olderItems.length}টি পুরনো ইনভয়েস সিঙ্ক হয়েছে`, 'success');
    } catch (e) {
        console.error("Load older invoices error:", e);
        showToast('পুরনো ইনভয়েস লোড করা যায়নি', 'error');
    } finally {
        loadMoreBtn.disabled = false;
        loadMoreBtn.textContent = origText;
    }
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
async function updateStats(force = false) {
    try {
        const stats = await getOrSyncCompanyStats(force);
        document.getElementById('statTotalInv').textContent   = stats.totalInvoices || allInvoices.length;
        document.getElementById('statTotalSales').textContent  = stats.totalSales > 0 ? formatBDT(stats.totalSales) : '—';
        document.getElementById('statTotalDue').textContent    = stats.totalDue > 0 ? formatBDT(stats.totalDue) : '—';
        return stats;
    } catch (_) {
        let totalSales = 0, totalPaid = 0;
        const usersRaw = await appCache.get(ADMIN_USERS_CACHE);
        if (usersRaw) {
            try {
                const parsed = typeof usersRaw === 'string' ? JSON.parse(usersRaw) : usersRaw;
                parsed.filter(u => u.id !== 'admin').forEach(u => {
                    totalSales += parseFloat(u.totalSales || 0);
                    totalPaid  += parseFloat(u.totalPaid  || 0);
                });
            } catch {}
        }
        document.getElementById('statTotalInv').textContent   = allInvoices.length;
        document.getElementById('statTotalSales').textContent  = totalSales > 0 ? formatBDT(totalSales) : '—';
        document.getElementById('statTotalDue').textContent    = totalSales > 0 ? formatBDT(Math.max(0, totalSales - totalPaid)) : '—';
        return null;
    }
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
        'এই ইনভয়েসটি স্থায়ীভাবে মুছে যাবে এবং স্টক, কাস্টমার খাতা ও সংশ্লিষ্ট হিসাব স্বয়ংক্রিয়ভাবে সমন্বয় হবে। এগিয়ে যাবেন?',
        async () => {
            try {
                btn.disabled = true;
                await deleteInvoiceWithRestore(invoiceId);
                showToast('ইনভয়েস ডিলেট ও হিসাব সমন্বয় হয়েছে', 'success');
                allInvoices = allInvoices.filter(i => i.id !== invoiceId);
                filteredInvoices = filteredInvoices.filter(i => i.id !== invoiceId);
                await saveCache(allInvoices);
                displayedCount = Math.max(0, displayedCount - 1);
                applyFilter(false);
                await loadPendingDeleteRequests();
                const stats = await updateStats(true);
                if (stats && !isNaN(parseInt(stats.totalInvoices))) {
                    localStorage.setItem(MONITOR_INV_COUNT_KEY, String(stats.totalInvoices));
                }
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

function deleteInvoice(invoiceId) {
    confirmModal(
        'ইনভয়েস ডিলেট করুন',
        'এই ইনভয়েসটি স্থায়ীভাবে মুছে যাবে এবং স্টক, কাস্টমার খাতা ও এমপিওর বিক্রয় হিসাব স্বয়ংক্রিয়ভাবে পুনরুদ্ধার হবে। আপনি কি নিশ্চিত?',
        async () => {
            try {
                await deleteInvoiceWithRestore(invoiceId);
                showToast('ইনভয়েস ডিলেট ও হিসাব পুনরুদ্ধার হয়েছে', 'success');
                allInvoices = allInvoices.filter(i => i.id !== invoiceId);
                filteredInvoices = filteredInvoices.filter(i => i.id !== invoiceId);
                await saveCache(allInvoices);
                displayedCount = Math.max(0, displayedCount - 1);
                applyFilter(false);
                loadPendingDeleteRequests();
                const stats = await updateStats(true);
                if (stats && !isNaN(parseInt(stats.totalInvoices))) {
                    localStorage.setItem(MONITOR_INV_COUNT_KEY, String(stats.totalInvoices));
                }
            } catch (e) {
                showToast('ডিলেট করা যায়নি: ' + (e.message || e), 'error');
                console.error(e);
            }
        },
        true
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
        const toPrint = { ...inv, user: inv.user || '' };
        sessionStorage.setItem('admin_print_invoice', JSON.stringify(toPrint));
        window.open('../main.html?action=admin_print', '_blank');
        
        if (!inv.adminPrinted) {
            // 1. Update in settings/recentInvoices
            try {
                await setDoc(RECENT_INVOICES_DOC_REF(), {
                    list: {
                        [inv.id]: { adminPrinted: true }
                    }
                }, { merge: true });
            } catch (_) {}

            // 2. Update in mpo_invoices bucket
            const bucketId = inv.bucketId || (inv.user ? `${inv.user}_part_${inv.part || 1}` : null);
            if (bucketId) {
                try {
                    await setDoc(doc(db, "mpo_invoices", bucketId), {
                        invoices: {
                            [inv.id]: { adminPrinted: true }
                        }
                    }, { merge: true });
                } catch (_) {}
            }

            // 3. Fallback to legacy document if present
            try {
                await updateDoc(doc(db, "invoices", inv.id), { adminPrinted: true });
            } catch (_) {}

            inv.adminPrinted = true;
            saveCache(allInvoices);
            applyFilter();
        }
    } catch (e) {
        console.error(e);
        showToast('প্রিন্ট করা যায়নি', 'error');
    }
}
