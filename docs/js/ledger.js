// Invoice Pro — Customer Ledger Page JS (ledger.js)
import {
    db, collection, getDocs, getDoc, updateDoc, setDoc, doc,
    query, where, serverTimestamp, arrayUnion, increment,
    requireAdmin, buildPageTopbar, formatBDT, escapeHtml, avatarBg,
    showToast, confirmModal, debounce, recordCustomerCollection,
    getOrSyncCompanyStats, appCache,
    CUSTOMERS_SUMMARY_DOC_REF, getOrSyncCustomersSummary, syncCustomersSummary
} from '../js/shared.js';

// ==================== Constants ====================
const LEDGER_CUSTOMERS_CACHE = 'admin_ledger_all_customers_v1';
const LEDGER_VERSION_KEY     = 'ledger_last_customer_version_v1';
const USERS_CACHE            = 'admin_cached_users_list_v1';
const REFRESH_COOLDOWN_MS    = 5000;

// ==================== State ====================
let allCustomers          = [];
let filteredCusts         = [];
let currentCust           = null;
let mpoList               = [];
let lastRefreshTime       = 0;
let refreshCooldownTimer  = null;

window.addEventListener('DOMContentLoaded', async () => {
    if (!requireAdmin()) return;
    buildPageTopbar({ title: '📒 কাস্টমার খাতা', subtitle: 'সকল MPO-এর কাস্টমার লেজার', backUrl: '../admin.html' });
    bindUI();
    await loadAllCustomers(false);
});

function bindUI() {
    document.getElementById('ledgerSearch').addEventListener('input', debounce(applyFilter, 250));
    document.getElementById('mpoFilterLedger').addEventListener('change', applyFilter);
    document.getElementById('dueFilter').addEventListener('change', applyFilter);
    document.getElementById('ledgerRefreshBtn').onclick = () => forceRefresh();
    document.getElementById('closeProfileModal').onclick = () => document.getElementById('customerProfileModal').classList.add('hidden');
    document.getElementById('customerProfileModal').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden'); });
    document.getElementById('closeTxnModal').onclick  = () => document.getElementById('addTxnModal').classList.add('hidden');
    document.getElementById('cancelTxnModal').onclick = () => document.getElementById('addTxnModal').classList.add('hidden');
    document.getElementById('saveTxnBtn').onclick     = saveTxn;
}

// ==================== Cache Helpers (IndexedDB) ====================
async function loadCache() {
    try {
        const cached = await appCache.get(LEDGER_CUSTOMERS_CACHE);
        if (Array.isArray(cached) && cached.length > 0) return cached;
        // Check legacy per-user caches if available
        const legacyAll = [];
        const usersRaw = await appCache.get(USERS_CACHE);
        if (usersRaw) {
            const users = (typeof usersRaw === 'string' ? JSON.parse(usersRaw) : usersRaw).filter(u => u.id !== 'admin');
            for (const u of users) {
                const uCusts = await appCache.get(`admin_cache_customers_${u.id}`);
                if (Array.isArray(uCusts)) {
                    uCusts.forEach(c => legacyAll.push({ ...c, mpo: c.mpo || u.id }));
                }
            }
        }
        if (legacyAll.length > 0) {
            await appCache.set(LEDGER_CUSTOMERS_CACHE, legacyAll);
            return legacyAll;
        }
        return [];
    } catch (err) {
        console.warn("IndexedDB load error:", err);
        return [];
    }
}

async function saveCache(items) {
    try {
        await appCache.set(LEDGER_CUSTOMERS_CACHE, items);
        // Also update per-MPO caches so mpo.html stays hot without extra reads
        const userGroups = {};
        (items || []).forEach(c => {
            const u = c.mpo || c.user;
            if (u) {
                if (!userGroups[u]) userGroups[u] = [];
                userGroups[u].push(c);
            }
        });
        for (const [userId, group] of Object.entries(userGroups)) {
            await appCache.set(`admin_cache_customers_${userId}`, group);
        }
    } catch (err) {
        console.warn("IndexedDB save error:", err);
    }
}

async function getServerCustomerVersion() {
    try {
        const snap = await getDoc(doc(db, "settings", "appConfig"));
        if (!snap.exists()) return 1;
        const data = snap.data();
        return parseInt(data.customerVersion) || 1;
    } catch (e) {
        console.warn("Error fetching customerVersion:", e);
        return 0;
    }
}

async function ensureUsersLoaded() {
    try {
        const usersRaw = await appCache.get(USERS_CACHE);
        let users = [];
        if (usersRaw) {
            const raw = typeof usersRaw === 'string' ? JSON.parse(usersRaw) : usersRaw;
            users = raw.filter(u => u.id !== 'admin');
        } else {
            const snap = await getDocs(collection(db, "users"));
            users = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => u.id !== 'admin');
            await appCache.set(USERS_CACHE, [...users, { id: 'admin' }]);
        }
        mpoList = users.map(u => u.id);
    } catch (e) {
        console.warn("Error loading users list:", e);
    }
}

// ==================== Load Customers (Direct 1 Read: settings/customersSummary) ====================
async function loadAllCustomers(isManualRefresh = false) {
    // 1. Instant Offline-First render from IndexedDB if available
    const cached = await loadCache();
    if (cached.length > 0) {
        allCustomers = cached;
        populateMPOFilter();
        applyFilter();
    } else {
        const grid = document.getElementById('ledgerGrid');
        grid.innerHTML = `<div class="loading-center" style="grid-column:1/-1;min-height:200px"><div class="spinner"></div><span>লোড হচ্ছে...</span></div>`;
    }

    // Load MPO users from cache or server
    await ensureUsersLoaded();

    // 2. Directly fetch single customer summary document from server (1 Firestore Read!)
    try {
        const summaryMap = await getOrSyncCustomersSummary(true);
        allCustomers = Object.values(summaryMap || {}).map(c => ({
            ...c,
            mpo: c.mpo || c.user || ''
        }));

        await saveCache(allCustomers);
        populateMPOFilter();
        applyFilter();

        if (isManualRefresh) {
            showToast('কাস্টমার তথ্য রিফ্রেশ হয়েছে', 'success');
        }
    } catch (e) {
        console.error("Ledger customer fetch error:", e);
        if (allCustomers.length === 0) {
            const grid = document.getElementById('ledgerGrid');
            grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--red2)">❌ লোড করা যায়নি</div>`;
        }
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

    const btn = document.getElementById('ledgerRefreshBtn');
    btn.disabled = true;
    btn.textContent = '⏳ সিঙ্ক হচ্ছে...';

    try {
        await loadAllCustomers(true);
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

function populateMPOFilter() {
    const select = document.getElementById('mpoFilterLedger');
    if (!select) return;
    const current = select.value;
    const allMpos = new Set(mpoList);
    allCustomers.forEach(c => {
        const u = c.mpo || c.user;
        if (u) allMpos.add(u);
    });
    const sorted = Array.from(allMpos).sort();
    select.innerHTML = '<option value="">সব MPO</option>' + sorted.map(m => `<option value="${escapeHtml(m)}"${m === current ? ' selected' : ''}>${escapeHtml(m)}</option>`).join('');
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

async function updateStats(customers) {
    const isFiltered = (document.getElementById('ledgerSearch')?.value?.trim()) ||
                       (document.getElementById('mpoFilterLedger')?.value) ||
                       (document.getElementById('dueFilter')?.value);

    document.getElementById('statTotalCust').textContent  = customers.length;
    document.getElementById('statHasDue').textContent     = customers.filter(c => getDue(c) > 0).length;

    if (!isFiltered) {
        try {
            const stats = await getOrSyncCompanyStats();
            document.getElementById('statTotalSales').textContent = formatBDT(stats.totalSales || 0);
            document.getElementById('statTotalDue').textContent   = formatBDT(stats.totalDue || 0);
            return;
        } catch (_) {}
    }

    let totalSales = 0, totalDue = 0;
    customers.forEach(c => { totalSales += c.totalSales || 0; totalDue += getDue(c); });
    document.getElementById('statTotalSales').textContent = formatBDT(totalSales);
    document.getElementById('statTotalDue').textContent   = formatBDT(totalDue);
}

// ==================== Customer Profile & Lazy Transaction Statement ====================
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
        ${due > 0 ? `<div style="display:flex;gap:10px;margin-top:10px;">
            <button class="btn btn-success flex-1" id="profilePaymentBtn" data-id="${escapeHtml(c.id)}">💰 পেমেন্ট রেকর্ড করুন</button>
        </div>` : '<div style="padding:10px;text-align:center;color:var(--green2);font-weight:600">✅ সম্পূর্ণ পরিশোধিত</div>'}

        <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:14px;">
            <div style="font-size:13px;font-weight:700;margin-bottom:8px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">লেনদেন বিবরণী (স্টেটমেন্ট)</div>
            <div id="profileTxnList">
                <div style="text-align:center;padding:16px;color:var(--text-muted);font-size:12px;">
                    <span class="spinner" style="display:inline-block;width:14px;height:14px;vertical-align:middle;margin-right:6px;"></span>স্টেটমেন্ট লোড হচ্ছে...
                </div>
            </div>
        </div>
    `;

    document.getElementById('profilePaymentBtn')?.addEventListener('click', () => {
        document.getElementById('customerProfileModal').classList.add('hidden');
        openAddTxn(c.id);
    });

    document.getElementById('customerProfileModal').classList.remove('hidden');

    // Lazy load full statement for this specific customer on demand (1 read)
    (async () => {
        try {
            const snap = await getDoc(doc(db, "customers", custId));
            const listEl = document.getElementById('profileTxnList');
            if (!listEl) return;
            if (!snap.exists()) {
                listEl.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:12px;">কোনো লেনদেন রেকর্ড নেই</div>';
                return;
            }
            const data = snap.data();
            const txns = (data.transactions || []).slice().sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0));
            if (!txns.length) {
                listEl.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:12px;">কোনো লেনদেন নেই</div>';
                return;
            }

            listEl.innerHTML = `
                <div style="max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">
                    ${txns.map(t => {
                        const isSale = t.type === 'sale';
                        return `
                        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg-input, rgba(255,255,255,0.03));border:1px solid var(--border);border-radius:8px;font-size:12px;">
                            <div>
                                <span style="font-weight:600;color:${isSale ? 'var(--blue2)' : 'var(--green2)'}">${isSale ? '🛒 বিক্রয় (দিলাম)' : '💰 কালেকশন (নিলাম)'}</span>
                                <span style="color:var(--text-muted);margin-left:6px;">${escapeHtml(t.date || '')}</span>
                                ${t.note ? `<div style="color:var(--text-muted);font-size:11px;margin-top:2px;">${escapeHtml(t.note)}</div>` : ''}
                            </div>
                            <div style="font-weight:700;color:${isSale ? 'var(--blue2)' : 'var(--green2)'}">
                                ${isSale ? '+' : '-'}${formatBDT(t.amount || 0)}
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            `;
        } catch (err) {
            console.warn("Lazy load txn error:", err);
            const listEl = document.getElementById('profileTxnList');
            if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:12px;color:var(--red2);font-size:12px;">স্টেটমেন্ট লোড করা যায়নি</div>';
        }
    })();
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
        const txnEntry = {
            txnId: `txn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type: 'payment',
            amount: amount,
            date: new Date().toLocaleDateString('en-CA'),
            note: document.getElementById('txnNote').value.trim() || 'কালেকশন (এডমিন)',
            createdAt: new Date().toISOString()
        };

        // 1. Update individual customer document with transaction
        await updateDoc(doc(db, "customers", txnCustId), {
            totalPaid: newPaid,
            transactions: arrayUnion(txnEntry),
            updatedAt: serverTimestamp(),
            lastUpdated: new Date().toISOString()
        });

        // 2. Atomically update single summary document (settings/customersSummary)
        await setDoc(CUSTOMERS_SUMMARY_DOC_REF(), {
            list: {
                [txnCustId]: {
                    totalPaid: increment(amount),
                    updatedAt: serverTimestamp()
                }
            },
            updatedAt: serverTimestamp()
        }, { merge: true });

        // Update local object
        c.totalPaid = newPaid;
        await saveCache(allCustomers);

        // Bump customerVersion in appConfig
        try {
            await updateDoc(doc(db, "settings", "appConfig"), {
                customerVersion: increment(1)
            });
            const curVer = parseInt(localStorage.getItem(LEDGER_VERSION_KEY)) || 0;
            localStorage.setItem(LEDGER_VERSION_KEY, String(curVer + 1));
        } catch (_) {}

        // Update MPO accounting & companyStats
        if (c.mpo) {
            await recordCustomerCollection(c.mpo, amount, new Date());
        }

        document.getElementById('addTxnModal').classList.add('hidden');
        showToast(`${formatBDT(amount)} পেমেন্ট রেকর্ড হয়েছে`, 'success');
        applyFilter();
    } catch (e) {
        console.error("Save transaction error:", e);
        showToast('সেভ করা যায়নি', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '✅ সেভ করুন';
    }
}
