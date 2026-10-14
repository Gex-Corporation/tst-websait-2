// ======================================================
//  Invoice Pro — Backup Page JS (backup.js)
//  GEX Corporation | <Dev Alif/>
//  Full Website Backup & Restore, Individual Collections,
//  Cache Management & Danger Zone (All Data Clean)
// ======================================================

import {
    db, collection, getDocs, getDoc, setDoc, doc, updateDoc, deleteDoc,
    query, writeBatch, serverTimestamp, Timestamp,
    requireAdmin, buildPageTopbar, formatBDT, escapeHtml,
    showToast, confirmModal, CACHE_KEYS, ADMIN_MONITOR_CACHE,
    getOrMigrateProductsList, saveBulkProductsToSingleDoc,
    LOGIN_SESSION_KEY, REMEMBER_ME_KEY, appCache,
    syncCompanyStats, COMPANY_STATS_DOC_REF, CACHE_COMPANY_STATS,
    syncCustomersSummary, CUSTOMERS_SUMMARY_DOC_REF, CACHE_CUSTOMERS_SUMMARY,
    getOrSyncRecentInvoices
} from '../js/shared.js';

// All collections used in Invoice Pro system
const ALL_SYSTEM_COLLECTIONS = [
    'products',
    'invoices',
    'mpo_invoices',
    'users',
    'stocks',
    'customers',
    'settings',
    'deleteRequests',
    'personal_accounts'
];

window.addEventListener('DOMContentLoaded', async () => {
    if (!requireAdmin()) return;
    buildPageTopbar({
        title: '💾 ব্যাকআপ',
        subtitle: 'ডেটা এক্সপোর্ট, রিস্টোর ও ক্যাশ ব্যবস্থাপনা',
        backUrl: '../admin.html'
    });
    bindUI();
    renderStorageStats();
});

function bindUI() {
    // Individual Export Buttons
    document.getElementById('exportProductsJsonBtn').onclick = exportProductsJson;
    document.getElementById('exportInvoicesJsonBtn').onclick = () => exportCollection("invoices", "invoices_backup");
    document.getElementById('exportUsersJsonBtn').onclick = () => exportCollection("users", "users_backup");
    document.getElementById('exportStocksJsonBtn').onclick = () => exportCollection("stocks", "stocks_backup");
    document.getElementById('exportCustomersJsonBtn').onclick = () => exportCollection("customers", "customers_backup");
    document.getElementById('exportSettingsJsonBtn').onclick = () => exportCollection("settings", "settings_backup");
    document.getElementById('exportPersonalAccountsJsonBtn').onclick = () => exportCollection("personal_accounts", "personal_accounts_backup");
    document.getElementById('exportDeleteRequestsJsonBtn').onclick = () => exportCollection("deleteRequests", "delete_requests_backup");

    // Full Website Backup & Restore
    document.getElementById('btnFullBackup').onclick = exportAllCollections;
    document.getElementById('btnFullRestore').onclick = () => {
        const input = document.getElementById('importFile');
        input.value = '';
        input.onchange = (e) => {
            if (e.target.files && e.target.files[0]) {
                importAllCollections(e.target.files[0]);
            }
        };
        input.click();
    };

    // Individual Collection Restore Buttons
    document.querySelectorAll('[data-import]').forEach(btn => {
        btn.onclick = () => {
            const col = btn.dataset.import;
            const input = document.getElementById('importFile');
            input.value = '';
            input.onchange = (e) => {
                if (e.target.files && e.target.files[0]) {
                    importCollection(col, e.target.files[0]);
                }
            };
            input.click();
        };
    });

    // Local & IndexedDB Cache Category Buttons
    document.querySelectorAll('[data-clear-type]').forEach(btn => {
        btn.onclick = async () => {
            const type = btn.dataset.clearType;
            btn.disabled = true;
            await clearCacheByCategory(type);
            btn.disabled = false;
            await renderStorageStats();
        };
    });

    // Backward compatibility for data-clear-cache
    document.querySelectorAll('[data-clear-cache]').forEach(btn => {
        btn.onclick = async () => {
            const key = btn.dataset.clearCache;
            await appCache.remove(key);
            localStorage.removeItem(key);
            showToast(`${key} ক্যাশ মুছে ফেলা হয়েছে`, 'success');
            await renderStorageStats();
        };
    });

    document.getElementById('clearAllCacheBtn').onclick = () => {
        confirmModal('⚠️ সব Cache মুছুন', 'সব IndexedDB ও LocalStorage ক্যাশ সম্পূর্ণ মুছে যাবে। লগইন ইউজার তথ্য অক্ষত থাকবে এবং পরের পেজ লোডে Firebase থেকে ফ্রেশ ডেটা নামবে। নিশ্চিত?', async () => {
            const adminSession = sessionStorage.getItem(LOGIN_SESSION_KEY);
            const rememberCreds = localStorage.getItem(REMEMBER_ME_KEY);
            localStorage.clear();
            await appCache.clear();
            if (adminSession) sessionStorage.setItem(LOGIN_SESSION_KEY, adminSession);
            if (rememberCreds) localStorage.setItem(REMEMBER_ME_KEY, rememberCreds);
            showToast('সব ক্যাশ (IndexedDB ও LocalStorage) সফলভাবে মুছে ফেলা হয়েছে!', 'success');
            await renderStorageStats();
        });
    };

    // Force Global Sync
    document.getElementById('forceGlobalSyncBtn').onclick = forceGlobalSync;

    // Danger Zone: All Data Clean Modal Controls
    const cleanModal = document.getElementById('cleanConfirmModal');
    const cleanPassInput = document.getElementById('cleanAdminPasswordInput');
    const cleanPassError = document.getElementById('cleanPassErrorMsg');
    const togglePassBtn = document.getElementById('toggleCleanPassBtn');

    const closeCleanModal = () => {
        cleanModal.classList.add('hidden');
        if (cleanPassInput) cleanPassInput.value = '';
        if (cleanPassError) cleanPassError.style.display = 'none';
        if (cleanPassInput) cleanPassInput.type = 'password';
        if (togglePassBtn) togglePassBtn.textContent = '👁️';
    };

    document.getElementById('deleteAllInvoicesBtn').onclick = () => {
        document.getElementById('cleanIncludeProducts').checked = false;
        if (cleanPassInput) cleanPassInput.value = '';
        if (cleanPassError) cleanPassError.style.display = 'none';
        if (cleanPassInput) cleanPassInput.type = 'password';
        if (togglePassBtn) togglePassBtn.textContent = '👁️';
        cleanModal.classList.remove('hidden');
        if (cleanPassInput) setTimeout(() => cleanPassInput.focus(), 100);
    };

    if (togglePassBtn && cleanPassInput) {
        togglePassBtn.onclick = () => {
            if (cleanPassInput.type === 'password') {
                cleanPassInput.type = 'text';
                togglePassBtn.textContent = '🙈';
            } else {
                cleanPassInput.type = 'password';
                togglePassBtn.textContent = '👁️';
            }
        };
    }

    if (cleanPassInput) {
        cleanPassInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                deleteAllInvoices();
            }
        };
    }

    document.getElementById('closeCleanModalBtn').onclick = closeCleanModal;
    document.getElementById('closeCleanModalCross').onclick = closeCleanModal;
    cleanModal.onclick = (e) => {
        if (e.target.id === 'cleanConfirmModal') closeCleanModal();
    };

    document.getElementById('confirmFullCleanBtn').onclick = deleteAllInvoices;
}

// ==================== Storage Stats & Cache Management ====================
async function clearCacheByCategory(category) {
    const dbKeys = (await appCache.keys()) || [];
    let removedCount = 0;

    const isMatch = (key) => {
        if (!key) return false;
        if (category === 'products') {
            return key === CACHE_KEYS.PRODUCTS || key.startsWith('erp_cached_products');
        }
        if (category === 'stocks') {
            return key === CACHE_KEYS.STOCKS || key.startsWith('erp_cached_stocks');
        }
        if (category === 'customers') {
            return key === 'admin_ledger_all_customers_v1' || key === 'ledger_last_customer_version_v1' || key.startsWith('admin_ledger_') || key.startsWith('ledger_') || key.startsWith('erp_cached_customers') || key.startsWith('admin_cache_customers_') || key.startsWith('full_cust_sync_done_');
        }
        if (category === 'history') {
            return key.startsWith('erp_sell_history_') || key.startsWith('admin_cache_sales_') || key.startsWith('erp_cached_sales_history');
        }
        if (category === 'monitor') {
            return key === ADMIN_MONITOR_CACHE || key === 'monitor_last_sync_v1' || key === 'monitor_last_known_inv_count_v1' || key.startsWith('admin_sales_monitor') || key.startsWith('monitor_');
        }
        if (category === 'users') {
            return key === ADMIN_USERS_CACHE || key === 'cachedUsers_v1_1' || key === 'erp_cached_users_v3' || key.startsWith('local_cache_version_');
        }
        if (category === 'settings') {
            return key === CACHE_KEYS.SETTINGS || key === CACHE_COMPANY_STATS || key.startsWith('erp_cached_settings') || key.startsWith('admin_company_stats');
        }
        return false;
    };

    // 1. Remove matching keys from IndexedDB
    for (const key of dbKeys) {
        if (isMatch(key)) {
            await appCache.remove(key);
            removedCount++;
        }
    }

    // 2. Remove matching keys from localStorage
    const localKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && isMatch(key)) {
            localKeys.push(key);
        }
    }
    localKeys.forEach(k => {
        localStorage.removeItem(k);
        removedCount++;
    });

    const labels = {
        products: '🛍️ Products',
        stocks: '📦 Stocks',
        customers: '🤝 Customers',
        history: '🧾 Sales History',
        monitor: '📊 Sales Monitor',
        users: '👥 Users & MPO',
        settings: '⚙️ Settings & Stats'
    };

    showToast(`${labels[category] || category} ক্যাশ মুছে ফেলা হয়েছে (${removedCount}টি আইটেম)`, 'success');
    return removedCount;
}

async function renderStorageStats() {
    let total = 0, keys = 0;
    let prodSize = 0, monSize = 0;
    let localTotal = 0, idbTotal = 0;
    const entries = [];

    // LocalStorage entries
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const val = localStorage.getItem(key) || '';
        const size = (key.length + val.length) * 2;
        total += size;
        localTotal += size;
        keys++;
        entries.push({ key, size, type: 'LocalStorage' });

        if (key === CACHE_KEYS.PRODUCTS || key === CACHE_KEYS.STOCKS || key.startsWith('erp_cached_products') || key.startsWith('erp_cached_stocks')) {
            prodSize += size;
        }
        if (key === ADMIN_MONITOR_CACHE || key.startsWith('erp_sell_history_') || key.startsWith('admin_cache_sales_')) {
            monSize += size;
        }
    }

    // IndexedDB entries
    try {
        const dbKeys = await appCache.keys();
        for (const key of dbKeys) {
            const val = await appCache.get(key);
            const size = val ? JSON.stringify(val).length * 2 : 0;
            total += size;
            idbTotal += size;
            keys++;
            entries.push({ key, size, type: 'IndexedDB' });

            if (key === CACHE_KEYS.PRODUCTS || key === CACHE_KEYS.STOCKS || key.startsWith('erp_cached_products') || key.startsWith('erp_cached_stocks')) {
                prodSize += size;
            }
            if (key === ADMIN_MONITOR_CACHE || key.startsWith('erp_sell_history_') || key.startsWith('admin_cache_sales_') || key.startsWith('admin_sales_monitor')) {
                monSize += size;
            }
        }
    } catch (e) {
        console.error('appCache read error:', e);
    }

    document.getElementById('statTotalCache').textContent = formatBytes(total);
    document.getElementById('statTotalCache').title = `IndexedDB: ${formatBytes(idbTotal)} | Local: ${formatBytes(localTotal)}`;
    document.getElementById('statCacheKeys').textContent  = `${keys}টি`;
    document.getElementById('statProdCache').textContent  = formatBytes(prodSize);
    document.getElementById('statMonCache').textContent   = formatBytes(monSize);

    entries.sort((a, b) => b.size - a.size);
    const list = document.getElementById('cacheKeyList');
    if (entries.length === 0) {
        list.innerHTML = `<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:12px;">📭 বর্তমানে কোনো ক্যাশ সংরক্ষিত নেই</div>`;
        return;
    }

    list.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:12px;color:var(--text-muted);">
        <span>ক্যাশ আইটেম তালিকা (${entries.length})</span>
        <span>IDB: <strong style="color:#2dd4bf;">${formatBytes(idbTotal)}</strong> · Local: <strong style="color:#fbbf24;">${formatBytes(localTotal)}</strong></span>
    </div>` +
    `<div style="display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto;padding-right:4px;">` +
    entries.map(e => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;font-size:12px;gap:8px;">
            <div style="display:flex;align-items:center;gap:8px;overflow:hidden;max-width:65%;">
                <span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;${e.type === 'IndexedDB' ? 'background:rgba(20,184,166,0.15);color:#2dd4bf;border:1px solid rgba(20,184,166,0.3);' : 'background:rgba(245,158,11,0.15);color:#fbbf24;border:1px solid rgba(245,158,11,0.3);'}">${e.type}</span>
                <span style="color:var(--text-secondary);font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(e.key)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
                <span style="color:var(--text-muted);font-size:11.5px;">${formatBytes(e.size)}</span>
                <button class="btn btn-sm" style="padding:2px 8px;font-size:11px;background:rgba(239,68,68,0.12);color:#f87171;border:1px solid rgba(239,68,68,0.25);" data-delete-key="${escapeHtml(e.key)}" data-delete-type="${e.type}" title="এই ক্যাশটি মুছুন">🗑️</button>
            </div>
        </div>
    `).join('') + '</div>';

    // Bind individual delete buttons
    list.querySelectorAll('[data-delete-key]').forEach(btn => {
        btn.onclick = async () => {
            const key = btn.dataset.deleteKey;
            const type = btn.dataset.deleteType;
            if (type === 'IndexedDB') {
                await appCache.remove(key);
            } else {
                localStorage.removeItem(key);
            }
            showToast(`"${key}" ক্যাশ মুছে ফেলা হয়েছে`, 'success');
            await renderStorageStats();
        };
    });
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
}

function today() {
    return new Date().toISOString().split('T')[0];
}

// ==================== Firestore Field Helpers ====================
function serializeFirestoreForBackup(value) {
    if (value === null || value === undefined) return value;
    if (typeof value.toMillis === 'function') {
        return { seconds: value.seconds, nanoseconds: value.nanoseconds };
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (Array.isArray(value)) return value.map(serializeFirestoreForBackup);
    if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = serializeFirestoreForBackup(v);
        }
        return out;
    }
    return value;
}

function restoreFirestoreFields(value) {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(restoreFirestoreFields);
    if (typeof value === 'object') {
        if (value.seconds !== undefined && value.nanoseconds !== undefined) {
            return new Timestamp(value.seconds, value.nanoseconds);
        }
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = restoreFirestoreFields(v);
        }
        return out;
    }
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
        const d = new Date(value);
        if (!isNaN(d.getTime())) {
            return Timestamp.fromDate(d);
        }
    }
    return value;
}

function downloadJson(data, filename) {
    const json = JSON.stringify(data, (key, val) => {
        if (val?.seconds !== undefined && val?.nanoseconds !== undefined) {
            return new Date(val.seconds * 1000).toISOString();
        }
        return val;
    }, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ==================== Export Specific Collection ====================
async function exportCollection(colName, filename) {
    setStatus(`⏳ ${colName} Export হচ্ছে...`, 'blue');
    try {
        let data = [];
        if (colName === 'products') {
            const pMap = await getOrMigrateProductsList();
            data = Object.values(pMap).map(p => serializeFirestoreForBackup(p));
        } else {
            const snap = await getDocs(collection(db, colName));
            data = snap.docs.map(d => serializeFirestoreForBackup({ id: d.id, ...d.data() }));
        }
        downloadJson(data, `${filename}_${today()}.json`);
        setStatus(`✅ ${data.length}টি রেকর্ড export হয়েছে (${colName})`, 'green');
    } catch (e) {
        console.error(e);
        setStatus(`❌ ${colName} Export করা যায়নি`, 'red');
    }
}

async function exportProductsJson() {
    setStatus('⏳ Products Export হচ্ছে...', 'blue');
    try {
        const pMap = await getOrMigrateProductsList();
        const data = Object.values(pMap).map(p => serializeFirestoreForBackup(p));
        downloadJson(data, `products_backup_${today()}.json`);
        setStatus(`✅ ${data.length}টি পণ্য export হয়েছে`, 'green');
    } catch (e) {
        console.error(e);
        setStatus('❌ Products Export করা যায়নি', 'red');
    }
}

// ==================== Full Website Backup & Restore ====================
async function exportAllCollections() {
    setStatus('⏳ Full Backup তৈরি হচ্ছে... সমস্ত কালেকশন ও ডকুমেন্ট রিড হচ্ছে', 'blue');
    try {
        const fullBackup = {
            metadata: {
                backupDate: new Date().toISOString(),
                exportedAt: Date.now(),
                version: 'v3',
                system: 'Invoice Pro Full Backup',
                collections: ALL_SYSTEM_COLLECTIONS,
                totalDocuments: 0
            }
        };

        let totalDocs = 0;

        for (const col of ALL_SYSTEM_COLLECTIONS) {
            if (col === 'products') {
                // Read from single document productsList
                const pMap = await getOrMigrateProductsList();
                const pList = Object.values(pMap).map(p => serializeFirestoreForBackup(p));
                fullBackup.products = pList;
                totalDocs += pList.length;
            } else {
                const snap = await getDocs(collection(db, col));
                const docs = snap.docs.map(d => serializeFirestoreForBackup({ id: d.id, ...d.data() }));
                fullBackup[col] = docs;
                totalDocs += docs.length;
            }
        }

        fullBackup.metadata.totalDocuments = totalDocs;
        downloadJson(fullBackup, `full_website_backup_${today()}.json`);
        setStatus(`✅ Full Backup সম্পন্ন! মোট ${totalDocs}টি ডকুমেন্ট ও ${ALL_SYSTEM_COLLECTIONS.length}টি কালেকশন ব্যাকআপ হয়েছে।`, 'green');
        showToast('Full Backup সফলভাবে ডাউনলোড হয়েছে!', 'success');
    } catch (e) {
        console.error('Full backup error:', e);
        setStatus('❌ Full Backup ব্যর্থ হয়েছে: ' + (e.message || 'Error'), 'red');
    }
}

async function importAllCollections(file) {
    confirmModal('⚠️ Full Website Restore', 'এটি ওয়েবসাইটের সমস্ত কালেকশন মুছে এই ব্যাকআপ ফাইলের ডেটা দিয়ে সম্পূর্ণ রিস্টোর করবে। আপনি কি নিশ্চিত?', async () => {
        setStatus('⏳ Full Restore হচ্ছে... দয়া করে অপেক্ষা করুন', 'blue');
        try {
            const text = await file.text();
            const fullData = JSON.parse(text);
            const dataToRestore = fullData.data || fullData;

            const hasAnyData = ALL_SYSTEM_COLLECTIONS.some(col => Array.isArray(dataToRestore[col]) && dataToRestore[col].length > 0);
            if (!hasAnyData && !dataToRestore.settings && !dataToRestore.users) {
                throw new Error('ফাইলের ভেতর কোনো বৈধ কালেকশন ডেটা পাওয়া যায়নি।');
            }

            let totalRestored = 0;

            // 1. Restore settings first (so company, config, dailyStats are restored)
            if (dataToRestore.settings && Array.isArray(dataToRestore.settings)) {
                totalRestored += await restoreDataToCollection('settings', dataToRestore.settings);
            }

            // 2. Restore products into single document settings/productsList (clean overwrite)
            if (dataToRestore.products && Array.isArray(dataToRestore.products)) {
                await saveBulkProductsToSingleDoc(dataToRestore.products, true);
                totalRestored += dataToRestore.products.length;
            }

            // 3. Restore all other standard collections in order
            const otherCollections = ['users', 'stocks', 'customers', 'invoices', 'mpo_invoices', 'deleteRequests', 'personal_accounts'];
            for (const col of otherCollections) {
                if (dataToRestore[col] && Array.isArray(dataToRestore[col])) {
                    totalRestored += await restoreDataToCollection(col, dataToRestore[col]);
                }
            }

            // 4. Also check if there are other custom collections present
            for (const [key, val] of Object.entries(dataToRestore)) {
                if (key === 'metadata' || key === 'localBrowserCache' || ALL_SYSTEM_COLLECTIONS.includes(key)) continue;
                if (Array.isArray(val) && val.length > 0) {
                    totalRestored += await restoreDataToCollection(key, val);
                }
            }

            // 4b. Ensure companyStats, customersSummary, and recentInvoices are accurately synced
            await syncCompanyStats();
            try { await syncCustomersSummary(); } catch (_) {}
            try { await getOrSyncRecentInvoices(true); } catch (_) {}

            // 5. Force increment version counters in settings/appConfig
            const configRef = doc(db, "settings", "appConfig");
            const snap = await getDoc(configRef);
            const v = snap.exists() ? snap.data() : {};
            await setDoc(configRef, {
                productVersion:  (v.productVersion  || 0) + 1,
                stockVersion:    (v.stockVersion    || 0) + 1,
                salesVersion:    (v.salesVersion    || 0) + 1,
                historyVersion:  (v.historyVersion  || 0) + 1,
                customerVersion: (v.customerVersion || 0) + 1,
                settingsVersion: (v.settingsVersion || 0) + 1
            }, { merge: true });

            // 6. Clear local caches while keeping active admin session & remember me
            const adminSession = sessionStorage.getItem(LOGIN_SESSION_KEY);
            const rememberCreds = localStorage.getItem(REMEMBER_ME_KEY);
            localStorage.clear();
            await appCache.clear();
            if (adminSession) sessionStorage.setItem(LOGIN_SESSION_KEY, adminSession);
            if (rememberCreds) localStorage.setItem(REMEMBER_ME_KEY, rememberCreds);

            setStatus(`✅ Full Restore সফলভাবে সম্পন্ন হয়েছে! মোট ${totalRestored}টি রেকর্ড রিস্টোর হয়েছে।`, 'green');
            renderStorageStats();
            showToast('Full Restore সম্পন্ন হয়েছে! পেজ রিফ্রেশ করুন।', 'success');
        } catch (e) {
            console.error('Full restore error:', e);
            setStatus('❌ Full Restore ব্যর্থ হয়েছে: ' + (e.message || 'Error'), 'red');
        }
    });
}

// ==================== Import Specific Collection ====================
async function importCollection(colName, file) {
    confirmModal('⚠️ রিস্টোর (' + colName + ')', `পুরোনো ${colName} ডেটা রিপ্লেস হয়ে নতুন ডেটা রিস্টোর হবে। নিশ্চিত?`, async () => {
        setStatus(`⏳ ${colName} রিস্টোর হচ্ছে...`, 'blue');
        try {
            const text = await file.text();
            let data = JSON.parse(text);
            if (data && !Array.isArray(data) && data[colName] && Array.isArray(data[colName])) {
                data = data[colName];
            }
            if (!Array.isArray(data)) {
                throw new Error(`${colName} ফাইলের ডেটা একটি অ্যারে (Array) হতে হবে।`);
            }
            const count = await restoreDataToCollection(colName, data);
            setStatus(`✅ ${colName} সফলভাবে রিস্টোর হয়েছে (${count}টি রেকর্ড)`, 'green');
            renderStorageStats();
            showToast(`${colName} রিস্টোর সম্পন্ন হয়েছে!`, 'success');
        } catch (e) {
            console.error(e);
            setStatus(`❌ ${colName} রিস্টোর ব্যর্থ হয়েছে: ` + (e.message || 'Error'), 'red');
        }
    });
}

async function restoreDataToCollection(colName, docs) {
    if (!docs || !Array.isArray(docs)) return 0;

    // Special handler for products: store into single document settings/productsList
    if (colName === 'products') {
        await saveBulkProductsToSingleDoc(docs, true);
        return docs.length;
    }

    const snap = await getDocs(collection(db, colName));

    // Delete existing documents in collection with safety guards
    const toDelete = snap.docs.filter(d => {
        // Never delete appConfig during settings restore
        if (colName === 'settings' && d.id === 'appConfig') return false;
        // Never delete admin user during user restore unless backup contains admin
        if (colName === 'users' && d.id === 'admin') {
            const hasAdminInBackup = docs.some(b => b.id === 'admin');
            if (!hasAdminInBackup) return false;
        }
        return true;
    });

    for (let i = 0; i < toDelete.length; i += 400) {
        const batch = writeBatch(db);
        toDelete.slice(i, i + 400).forEach(d => batch.delete(d.ref));
        await batch.commit();
    }

    // Insert new docs in batches
    let count = 0;
    for (let i = 0; i < docs.length; i += 400) {
        const batch = writeBatch(db);
        docs.slice(i, i + 400).forEach(d => {
            const docId = d.id;
            const docRef = docId ? doc(db, colName, docId) : doc(collection(db, colName));
            const copy = { ...d };
            delete copy.id;
            batch.set(docRef, restoreFirestoreFields(copy), { merge: true });
            count++;
        });
        await batch.commit();
    }

    return count;
}

// ==================== Force Global Sync ====================
async function forceGlobalSync() {
    confirmModal('Force Global Sync', 'সব ব্যবহারকারীর ডিভাইসে fresh data নামাতে force করবেন?', async () => {
        setStatus('⏳ Sync command পাঠানো হচ্ছে...', 'blue');
        try {
            const configRef = doc(db, "settings", "appConfig");
            const snap = await getDoc(configRef);
            const old = snap.exists() ? snap.data() : {};
            await setDoc(configRef, {
                productVersion:  (old.productVersion  || 0) + 1,
                stockVersion:    (old.stockVersion    || 0) + 1,
                customerVersion: (old.customerVersion || 0) + 1,
                salesVersion:    (old.salesVersion    || 0) + 1,
                historyVersion:  (old.historyVersion  || 0) + 1,
                settingsVersion: (old.settingsVersion || 0) + 1
            }, { merge: true });
            setStatus('✅ Force sync command পাঠানো হয়েছে! সব ডিভাইস পরের লোডে fresh data নামাবে।', 'green');
            showToast('Force Sync সফল হয়েছে!', 'success');
        } catch (e) {
            setStatus('❌ Command পাঠানো যায়নি', 'red');
        }
    }, false);
}

// ==================== Danger Zone: All Data Clean ====================
async function deleteAllInvoices() {
    const cleanModal = document.getElementById('cleanConfirmModal');
    const cleanPassInput = document.getElementById('cleanAdminPasswordInput');
    const cleanPassError = document.getElementById('cleanPassErrorMsg');
    const deleteProducts = document.getElementById('cleanIncludeProducts').checked;

    let enteredPassword = cleanPassInput ? cleanPassInput.value.trim() : '';
    if (!enteredPassword) {
        enteredPassword = prompt('⚠️ নিশ্চিত করতে এডমিন পাসওয়ার্ড লিখুন:') || '';
    }

    if (!enteredPassword) {
        if (cleanPassError) {
            cleanPassError.textContent = '❌ অনুগ্রহ করে এডমিন পাসওয়ার্ড দিন!';
            cleanPassError.style.display = 'block';
        }
        if (cleanPassInput) cleanPassInput.focus();
        showToast('এডমিন পাসওয়ার্ড প্রয়োজন!', 'warning');
        return;
    }

    // Verify admin password with Firestore
    const confirmBtn = document.getElementById('confirmFullCleanBtn');
    const originalBtnText = confirmBtn ? confirmBtn.textContent : '';
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = '⏳ পাসওয়ার্ড যাচাই হচ্ছে...';
    }
    if (cleanPassError) cleanPassError.style.display = 'none';

    try {
        const adminSnap = await getDoc(doc(db, "users", "admin"));
        if (!adminSnap.exists()) {
            throw new Error('এডমিন অ্যাকাউন্ট পাওয়া যায়নি!');
        }
        const actualPassword = String(adminSnap.data()?.password || '');
        if (String(enteredPassword) !== actualPassword) {
            if (cleanPassError) {
                cleanPassError.textContent = '❌ ভুল এডমিন পাসওয়ার্ড! কোনো ডেটা মোছা হয়নি।';
                cleanPassError.style.display = 'block';
            }
            if (cleanPassInput) {
                cleanPassInput.focus();
                cleanPassInput.select();
            }
            showToast('ভুল এডমিন পাসওয়ার্ড! অপারেশন বাতিল।', 'error');
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = originalBtnText;
            }
            return;
        }
    } catch (err) {
        console.error('Admin password verification error:', err);
        if (cleanPassError) {
            cleanPassError.textContent = '❌ পাসওয়ার্ড যাচাই ব্যর্থ: ' + err.message;
            cleanPassError.style.display = 'block';
        }
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = originalBtnText;
        }
        return;
    }

    // Password verified! Now close modal and proceed with deletion
    if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = originalBtnText;
    }
    if (cleanModal) cleanModal.classList.add('hidden');
    setStatus('⏳ সমস্ত ডেটা মুছে ফেলা হচ্ছে... দয়া করে অপেক্ষা করুন', 'blue');

    try {
        // 1. Collections to completely wipe out
        const collectionsToClean = [
            "invoices",
            "mpo_invoices",
            "customers",
            "deleteRequests",
            "personal_accounts"
        ];

        for (const colName of collectionsToClean) {
            const snap = await getDocs(collection(db, colName));
            const deleteBatchSize = 400;
            for (let i = 0; i < snap.docs.length; i += deleteBatchSize) {
                const batch = writeBatch(db);
                snap.docs.slice(i, i + deleteBatchSize).forEach(d => batch.delete(d.ref));
                await batch.commit();
            }
        }

        // 2. Settings collection handling
        const settingsSnap = await getDocs(collection(db, "settings"));
        for (const d of settingsSnap.docs) {
            if (d.id === 'appConfig') {
                // Keep appConfig intact
                continue;
            }
            if (d.id === 'productsList') {
                if (deleteProducts) {
                    await deleteDoc(d.ref);
                }
                continue;
            }
            if (d.id === 'company') {
                if (deleteProducts) {
                    await deleteDoc(d.ref);
                }
                continue;
            }
            // Delete dailyStats and other settings docs
            await deleteDoc(d.ref);
        }

        // Reset companyStats
        await setDoc(COMPANY_STATS_DOC_REF(), {
            totalSales: 0,
            totalPaid: 0,
            totalInvoices: 0,
            mpoCount: 0,
            updatedAt: serverTimestamp()
        });
        try { localStorage.removeItem(CACHE_COMPANY_STATS); } catch (_) {}

        // 3. Products and Stocks handling
        if (deleteProducts) {
            // Delete legacy products collection
            const prodSnap = await getDocs(collection(db, "products"));
            for (let i = 0; i < prodSnap.docs.length; i += 400) {
                const batch = writeBatch(db);
                prodSnap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
                await batch.commit();
            }

            // Delete all stocks
            const stockSnap = await getDocs(collection(db, "stocks"));
            for (let i = 0; i < stockSnap.docs.length; i += 400) {
                const batch = writeBatch(db);
                stockSnap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
                await batch.commit();
            }
        } else {
            // Keep products in settings/productsList, but reset stock quantities to 0
            const pMap = await getOrMigrateProductsList();
            const keptProducts = Object.values(pMap);

            // Clear old stocks first to remove orphans
            const stockSnap = await getDocs(collection(db, "stocks"));
            for (let i = 0; i < stockSnap.docs.length; i += 400) {
                const batch = writeBatch(db);
                stockSnap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
                await batch.commit();
            }

            // Set quantity: 0 for every existing product in stocks
            for (let i = 0; i < keptProducts.length; i += 400) {
                const batch = writeBatch(db);
                keptProducts.slice(i, i + 400).forEach(p => {
                    batch.set(doc(db, "stocks", p.id), {
                        productId: p.id,
                        quantity: 0,
                        updatedAt: serverTimestamp()
                    });
                });
                await batch.commit();
            }
        }

        // 4. Users collection handling:
        // Only keep admin user (preserve admin username & password), delete all MPO users
        const userSnap = await getDocs(collection(db, "users"));
        for (const d of userSnap.docs) {
            if (d.id === 'admin') {
                // Keep admin credentials, reset sales & invoices statistics
                await updateDoc(doc(db, "users", "admin"), {
                    totalSales: 0,
                    totalPaid: 0,
                    invoiceCounter: 0,
                    invoiceCount: 0,
                    payments: [],
                    monthlyStats: {},
                    forceClearCache: Date.now()
                });
            } else {
                // Delete MPO user document
                await deleteDoc(d.ref);
            }
        }

        // 5. Increment version counters in settings/appConfig
        const configRef = doc(db, "settings", "appConfig");
        const vSnap = await getDoc(configRef);
        const v = vSnap.exists() ? vSnap.data() : {};
        await setDoc(configRef, {
            productVersion:  (v.productVersion  || 0) + 1,
            stockVersion:    (v.stockVersion    || 0) + 1,
            salesVersion:    (v.salesVersion    || 0) + 1,
            historyVersion:  (v.historyVersion  || 0) + 1,
            customerVersion: (v.customerVersion || 0) + 1,
            settingsVersion: (v.settingsVersion || 0) + 1
        }, { merge: true });

        // 6. Clear local caches while keeping active admin session & remember me
        const currentSession = sessionStorage.getItem(LOGIN_SESSION_KEY);
        const rememberCreds = localStorage.getItem(REMEMBER_ME_KEY);
        localStorage.clear();
        await appCache.clear();
        if (currentSession) sessionStorage.setItem(LOGIN_SESSION_KEY, currentSession);
        if (rememberCreds) localStorage.setItem(REMEMBER_ME_KEY, rememberCreds);

        const successMsg = deleteProducts
            ? '✅ ডেটাবেস সম্পূর্ণ ফ্যাক্টরি রিসেট করা হয়েছে! শুধুমাত্র এডমিন আইডি (নাম ও পাসওয়ার্ড) অবশিষ্ট আছে।'
            : '✅ ডেটাবেস সফলভাবে ক্লিন করা হয়েছে! শুধুমাত্র প্রোডাক্ট তালিকা এবং এডমিন আইডি অবশিষ্ট আছে।';

        setStatus(successMsg, 'green');
        renderStorageStats();
        showToast(successMsg, 'success');
    } catch (e) {
        console.error('All data clean error:', e);
        setStatus('❌ ডেটা মুছতে সমস্যা হয়েছে: ' + (e.message || 'Error'), 'red');
        showToast('ডেটা মুছতে ত্রুটি হয়েছে!', 'error');
    }
}

function setStatus(msg, type) {
    const el = document.getElementById('backupStatusMsg');
    const classes = { blue: 'badge-blue', green: 'badge-green', red: 'badge-red' };
    el.className = `badge ${classes[type] || 'badge-blue'}`;
    el.textContent = msg;
    el.style.display = 'inline-flex';
    el.style.padding = '8px 14px';
    el.style.fontSize = '13px';
}
