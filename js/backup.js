// Invoice Pro — Backup Page JS (backup.js)
import { appCache } from "./shared.js";
import {
    db, collection, getDocs, getDoc, doc, updateDoc, deleteDoc,
    query, writeBatch, serverTimestamp,
    requireAdmin, buildPageTopbar, formatBDT, escapeHtml,
    showToast, confirmModal, CACHE_KEYS, ADMIN_MONITOR_CACHE
} from '../js/shared.js';

window.addEventListener('DOMContentLoaded', async () => {
    if (!requireAdmin()) return;
    buildPageTopbar({ title: '💾 ব্যাকআপ', subtitle: 'ডেটা এক্সপোর্ট ও ক্যাশ ব্যবস্থাপনা', backUrl: '../admin.html' });
    bindUI();
    renderStorageStats();
});

function bindUI() {
    document.getElementById('exportProductsJsonBtn').onclick  = () => exportCollection("products", "products_backup");
    document.getElementById('exportInvoicesJsonBtn').onclick  = () => exportCollection("invoices", "invoices_backup");
    document.getElementById('exportUsersJsonBtn').onclick     = () => exportCollection("users", "users_backup");
    document.getElementById('exportStocksJsonBtn').onclick    = () => exportCollection("stocks", "stocks_backup");
    document.getElementById('exportCustomersJsonBtn').onclick = () => exportCollection("customers", "customers_backup");
    document.getElementById('exportSettingsJsonBtn').onclick  = () => exportCollection("settings", "settings_backup");

    document.getElementById('btnFullBackup').onclick = exportAllCollections;
    document.getElementById('btnFullRestore').onclick = () => {
        const input = document.getElementById('importFile');
        input.onchange = (e) => { if (e.target.files[0]) importAllCollections(e.target.files[0]); };
        input.click();
    };

    document.querySelectorAll('[data-import]').forEach(btn => {
        btn.onclick = () => {
            const col = btn.dataset.import;
            const input = document.getElementById('importFile');
            input.onchange = (e) => { if (e.target.files[0]) importCollection(col, e.target.files[0]); };
            input.click();
        };
    });

    document.querySelectorAll('[data-clear-cache]').forEach(btn => {
        btn.onclick = async () => {
            const key = btn.dataset.clearCache;
            localStorage.removeItem(key); await appCache.remove(key);
            if (key === ADMIN_MONITOR_CACHE) localStorage.removeItem('monitor_last_sync_v1');
            showToast(key + ' মুছে ফেলা হয়েছে', 'success');
            renderStorageStats();
        };
    });

    document.getElementById('clearAllCacheBtn').onclick       = () => confirmModal('সব Cache মুছুন', 'সব local cache মুছে যাবে। পরের পেজ লোডে Firebase থেকে ফ্রেশ ডেটা নামবে। নিশ্চিত?', async () => { localStorage.clear(); await appCache.clear(); showToast('সব cache মুছা হয়েছে', 'warning'); renderStorageStats(); });
    document.getElementById('forceGlobalSyncBtn').onclick     = forceGlobalSync;
    document.getElementById('deleteAllInvoicesBtn').onclick = () => {
        document.getElementById('cleanIncludeProducts').checked = false;
        document.getElementById('cleanConfirmModal').style.display = 'flex';
    };
    
    const closeCleanModal = () => document.getElementById('cleanConfirmModal').style.display = 'none';
    document.getElementById('closeCleanModalBtn').onclick = closeCleanModal;
    document.getElementById('closeCleanModalCross').onclick = closeCleanModal;
    document.getElementById('cleanConfirmModal').onclick = (e) => {
        if(e.target.id === 'cleanConfirmModal') closeCleanModal();
    };
    
    document.getElementById('confirmFullCleanBtn').onclick = deleteAllInvoices;
}

// ==================== Storage Stats ====================
async function renderStorageStats() {
    let total = 0, keys = 0;
    let prodSize = 0, monSize = 0;
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const val = localStorage.getItem(key) || '';
        const size = (key.length + val.length) * 2;
        total += size; keys++;
        entries.push({ key, size, type: 'Local' });
        if (key === CACHE_KEYS.PRODUCTS || key === CACHE_KEYS.STOCKS) prodSize += size;
        if (key === ADMIN_MONITOR_CACHE) monSize += size;
    }
    try {
        const dbKeys = await appCache.keys();
        for (const key of dbKeys) {
            const val = await appCache.get(key);
            const size = val ? JSON.stringify(val).length * 2 : 0;
            total += size; keys++;
            entries.push({ key, size, type: 'IndexedDB' });
            if (key === CACHE_KEYS.PRODUCTS || key === CACHE_KEYS.STOCKS) prodSize += size;
            if (key === ADMIN_MONITOR_CACHE) monSize += size;
        }
    } catch(e) {}
    document.getElementById('statTotalCache').textContent = formatBytes(total);
    document.getElementById('statCacheKeys').textContent  = keys;
    document.getElementById('statProdCache').textContent  = formatBytes(prodSize);
    document.getElementById('statMonCache').textContent   = formatBytes(monSize);

    entries.sort((a, b) => b.size - a.size);
    const list = document.getElementById('cacheKeyList');
    list.innerHTML = `<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">Cache Keys (${entries.length})</div>` +
        `<div style="display:flex;flex-direction:column;gap:4px;max-height:200px;overflow-y:auto;">` +
        entries.map(e => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:rgba(255,255,255,0.03);border-radius:7px;font-size:12px;">
                <span style="color:var(--text-secondary);font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:65%;">${escapeHtml(e.key)} <small>(${e.type})</small></span>
                <span style="color:var(--text-muted);flex-shrink:0;">${formatBytes(e.size)}</span>
            </div>
        `).join('') + '</div>';
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
}

// ==================== Export ====================
async function exportCollection(colName, filename) {
    const btn = document.querySelector(`[id*="${colName.slice(0,4)}"]`);
    setStatus('⏳ Export হচ্ছে...', 'blue');
    try {
        const snap = await getDocs(collection(db, colName));
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        downloadJson(data, `${filename}_${today()}.json`);
        setStatus(`✅ ${data.length}টি রেকর্ড export হয়েছে`, 'green');
    } catch (e) {
        setStatus('❌ Export করা যায়নি', 'red');
    }
}

function downloadJson(data, filename) {
    const json = JSON.stringify(data, (key, val) => {
        if (val?.seconds !== undefined && val?.nanoseconds !== undefined) return new Date(val.seconds * 1000).toISOString();
        return val;
    }, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function today() { return new Date().toISOString().split('T')[0]; }

// ==================== Force Global Sync ====================
async function forceGlobalSync() {
    confirmModal('Force Global Sync', 'সব ব্যবহারকারীর ডিভাইসে fresh data নামাতে force করবেন?', async () => {
        setStatus('⏳ Sync command পাঠানো হচ্ছে...', 'blue');
        try {
            const configRef = doc(db, "settings", "appConfig");
            const snap = await getDoc(configRef);
            const old = snap.exists() ? snap.data() : {};
            await updateDoc(configRef, {
                productVersion:  (old.productVersion  || 0) + 1,
                stockVersion:    (old.stockVersion    || 0) + 1,
                customerVersion: (old.customerVersion || 0) + 1,
                salesVersion:    (old.salesVersion    || 0) + 1,
            });
            setStatus('✅ Force sync command পাঠানো হয়েছে! সব ডিভাইস পরের লোডে fresh data নামাবে।', 'green');
        } catch (e) { setStatus('❌ Command পাঠানো যায়নি', 'red'); }
    }, false);
}

// ==================== Delete All Invoices ====================
async function deleteAllInvoices() {
    const includeProducts = document.getElementById('cleanIncludeProducts').checked;
    document.getElementById('cleanConfirmModal').style.display = 'none';
    setStatus('⏳ ডিলেট হচ্ছে... দয়া করে অপেক্ষা করুন', 'blue');
        try {
            const collections = ["invoices", "customers", "stocks", "settings", "deleteRequests"];
            if (includeProducts) collections.push("products");
    
            for (const colName of collections) {
                const snap = await getDocs(collection(db, colName));
                const toDelete = snap.docs.filter(d => {
                    if (colName === 'settings' && d.id === 'appConfig') return false;
                    if (colName === 'settings' && d.id === 'company' && !includeProducts) return false;
                    return true;
                });
                const deleteBatchSize = 400;
                for (let i = 0; i < toDelete.length; i += deleteBatchSize) {
                    const batch = writeBatch(db);
                    toDelete.slice(i, i + deleteBatchSize).forEach(d => batch.delete(doc(db, colName, d.id)));
                    await batch.commit();
                }
            }
    
            const userSnap = await getDocs(collection(db, "users"));
            for (const d of userSnap.docs) {
                if (d.id === 'admin') {
                    await updateDoc(doc(db, "users", "admin"), {
                        totalSales: 0,
                        totalPaid: 0,
                        invoiceCounter: 0,
                        invoiceCount: 0,
                        forceClearCache: Date.now()
                    });
                } else {
                    await deleteDoc(doc(db, "users", d.id));
                }
            }
    
            const configRef = doc(db, "settings", "appConfig");
            const vSnap = await getDoc(configRef);
            if (vSnap.exists()) {
                const v = vSnap.data();
                await updateDoc(configRef, {
                    productVersion: (v.productVersion || 0) + 1,
                    stockVersion: (v.stockVersion || 0) + 1,
                    salesVersion: (v.salesVersion || 0) + 1,
                    historyVersion: (v.historyVersion || 0) + 1,
                    customerVersion: (v.customerVersion || 0) + 1,
                    settingsVersion: (v.settingsVersion || 0) + 1
                });
            }
            localStorage.clear();
            await appCache.clear();
            setStatus('✅ ডেটাবেস সফলভাবে ফ্যাক্টরি রিসেট করা হয়েছে! পেজ রিলোড করুন।', 'green');
            renderStorageStats();
    } catch (e) {
        console.error(e);
        setStatus('❌ ডিলেট করা যায়নি! কনসোল চেক করুন।', 'red');
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

// ==================== Full Backup & Restore ====================
async function exportAllCollections() {
    setStatus('⏳ Full Backup হচ্ছে...', 'blue');
    try {
        const collections = ['products', 'invoices', 'users', 'stocks', 'customers', 'settings'];
        const fullData = {};
        for (let col of collections) {
            const snap = await getDocs(collection(db, col));
            fullData[col] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        }
        downloadJson(fullData, `full_backup_${today()}.json`);
        setStatus('✅ Full Backup সফলভাবে সম্পন্ন হয়েছে!', 'green');
    } catch (e) {
        console.error(e);
        setStatus('❌ Full Backup ব্যর্থ হয়েছে', 'red');
    }
}

async function importAllCollections(file) {
    confirmModal('⚠️ Full Restore', 'এটি সমস্ত ডাটাবেস মুছে এই ফাইলের ডাটা দিয়ে রিস্টোর করবে। নিশ্চিত?', async () => {
        setStatus('⏳ Full Restore হচ্ছে... দয়া করে অপেক্ষা করুন', 'blue');
        try {
            const text = await file.text();
            const fullData = JSON.parse(text);
            for (const [colName, docs] of Object.entries(fullData)) {
                await restoreDataToCollection(colName, docs);
            }
            setStatus('✅ Full Restore সফলভাবে সম্পন্ন হয়েছে!', 'green');
        } catch (e) {
            console.error(e);
            setStatus('❌ Full Restore ব্যর্থ হয়েছে', 'red');
        }
    });
}

// ==================== Import Specific Collection ====================
async function importCollection(colName, file) {
    confirmModal('⚠️ রিস্টোর (' + colName + ')', 'পুরোনো ডাটা রিপ্লেস হয়ে নতুন ডাটা রিস্টোর হবে। নিশ্চিত?', async () => {
        setStatus(`⏳ ${colName} রিস্টোর হচ্ছে...`, 'blue');
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            await restoreDataToCollection(colName, data);
            setStatus(`✅ ${colName} সফলভাবে রিস্টোর হয়েছে (${data.length}টি রেকর্ড)`, 'green');
        } catch (e) {
            console.error(e);
            setStatus(`❌ ${colName} রিস্টোর ব্যর্থ হয়েছে`, 'red');
        }
    });
}

async function restoreDataToCollection(colName, docs) {
    const snap = await getDocs(collection(db, colName));
    // Delete all existing docs in collection
    for (let i = 0; i < snap.docs.length; i += 450) {
        const batch = writeBatch(db);
        snap.docs.slice(i, i + 450).forEach(d => batch.delete(d.ref));
        await batch.commit();
    }
    // Insert new docs
    for (let i = 0; i < docs.length; i += 450) {
        const batch = writeBatch(db);
        docs.slice(i, i + 450).forEach(d => {
            const docRef = doc(db, colName, d.id);
            const copy = { ...d };
            delete copy.id;
            batch.set(docRef, copy);
        });
        await batch.commit();
    }
}

