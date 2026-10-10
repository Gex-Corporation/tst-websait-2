// =====================================================================
// app.js — Main Invoice Logic (Login is handled by login.js)
// HTML structure is in main.html
// =====================================================================

import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, getDocs, getDoc, setDoc, updateDoc, deleteDoc, doc, query, where, orderBy, limit, serverTimestamp, startAfter, writeBatch, increment, arrayUnion, arrayRemove, Timestamp, onSnapshot } from "firebase/firestore";
import { appCache } from "./shared.js";

const firebaseConfig = {
  apiKey: "AIzaSyCng8ZDKd6zOc2ydbf-wUljOzEAViWSOQI",
  authDomain: "computer-kaaj.firebaseapp.com",
  projectId: "computer-kaaj",
  storageBucket: "computer-kaaj.firebasestorage.app",
  messagingSenderId: "786670596427",
  appId: "1:786670596427:web:db95ddef44d9f35739f8ce",
  measurementId: "G-007FD30DQ6"
};


let db;
try {
    if (!firebaseConfig.apiKey) {
        console.warn("Firebase configuration missing!");
    } else {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        console.log("Firebase Initialized");
    }
} catch (e) { console.error("Firebase Init Error:", e); }

const LOGO_URL = 'https://cdn.jsdelivr.net/gh/2dgameralif/srhealthcare-resource@main/srhealthcare%20logo.png';
const LOGIN_SESSION_KEY = 'invoice_logged_in_user_v1';
const REMEMBER_ME_KEY = 'invoice_remembered_user';

let currentUser = null;
let globalProductMap = {}; // productId -> productData
let globalStockMap = {}; // productId -> quantity
let globalCustomerList = [];
let activeProductInput = null;
let printReplacements = [];
let savedPageTitle = null;
let reloadAfterPrint = false;
let isPrintPrepared = false;
let printFinishCallback = null;
let printCleanupTimer = null;
const FORCE_IMMEDIATE_SYNC_KEY = 'force_immediate_sync_v1';
const MOBILE_SUGGESTION_MQ = window.matchMedia('(max-width: 768px)');
function isMobileViewport() {
    return window.matchMedia('(max-width: 768px)').matches;
}

// Pagination state
let historyLastDoc = null;
let monitorLastDoc = null;
let monitorDisplayedCount = 0;
let monitorServerMode = false;
const MONITOR_PAGE_SIZE = 50;
const MONITOR_CACHE_MAX = 100;
const ADMIN_MONITOR_CACHE = 'admin_sales_monitor_cache_v1';
const SELL_HISTORY_PAGE_SIZE = 10;
const SELL_HISTORY_CACHE_MAX = 10;
const USER_SALES_HISTORY_INITIAL_PAGE_SIZE = 15;
const USER_SALES_HISTORY_LOAD_MORE_SIZE = 10;
let currentDetailUserId = null; // To track which user is being viewed in detail
let deleteNotifPollInterval = null;
let sellHistoryLastDoc = null;
let userSalesHistoryLastDoc = null;
let userSalesHistoryHasMore = false;
let userSalesHistoryCache = [];

// ==================== Customer Ledger Globals ====================
let currentLedgerCustId = null;   // currently viewed customer ID
let currentLedgerTxnType = 'payment'; // 'sale' | 'payment'
let ledgerIsAdminView = false;    // is ledger opened from admin panel


function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// --- Optimized Delta Sync & Cache System (V3 - Map Architecture) ---
const CACHE_KEYS = {
    PRODUCTS: 'erp_cached_products_v3',
    STOCKS: 'erp_cached_stocks_v3',
    CUSTOMERS: 'erp_cached_customers_v3',
    SETTINGS: 'erp_cached_settings_v3',
    LAST_SYNC: 'erp_last_sync_timestamps_v3',
    VERSIONS: 'erp_global_versions_v3',
    SELL_HISTORY: 'erp_sell_history_v3'
};

const ADMIN_USERS_CACHE = 'admin_cached_users_list_v1';
const FIRESTORE_BACKUP_COLLECTIONS = ["users", "invoices", "products", "customers", "stocks", "settings", "deleteRequests"];

function getStorageByteSize(key, value) {
    return (String(key).length + String(value ?? '').length) * 2;
}

function getCacheItemCount(key, value) {
    if (!value) return 0;
    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.length;
        if (parsed && typeof parsed === 'object') {
            if (Array.isArray(parsed.items)) return parsed.items.length;
            return Object.keys(parsed).length;
        }
    } catch (e) { /* plain string */ }
    return value ? 1 : 0;
}

function categorizeStorageKey(key) {
    if (key === CACHE_KEYS.PRODUCTS) return 'Products Cache';
    if (key === CACHE_KEYS.STOCKS) return 'Stocks Cache';
    if (key === CACHE_KEYS.SETTINGS) return 'Settings Cache';
    if (key === CACHE_KEYS.SELL_HISTORY) return 'Sales History Cache';
    if (key === CACHE_KEYS.LAST_SYNC) return 'Sync Timestamps';
    if (key === CACHE_KEYS.VERSIONS) return 'Version Cache';
    if (key === ADMIN_MONITOR_CACHE) return 'Sales Monitor Cache';
    if (key === ADMIN_USERS_CACHE) return 'Admin Users Cache';
    if (key === 'cachedUsers_v1_1') return 'Sell History Users Cache';
    if (key === REMEMBER_ME_KEY) return 'Remember Me (Auth)';
    if (key === LOGIN_SESSION_KEY) return 'Login Session';
    if (key.startsWith(`${CACHE_KEYS.CUSTOMERS}_`)) return 'User Customers Cache';
    if (key.startsWith(`${CACHE_KEYS.SELL_HISTORY}_`)) return 'User Sell History Cache';
    if (key.startsWith('admin_cache_customers_')) return 'Admin Shop Info Cache';
    if (key.startsWith('admin_cache_sales_')) return 'Admin User Sales Cache';
    if (key.startsWith('local_cache_version_')) return 'Remote Sync Version';
    if (key.startsWith('erp_')) return 'ERP System Cache';
    return 'Other Browser Data';
}

function exportBrowserCacheSnapshot() {
    const local = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) local[key] = localStorage.getItem(key);
    }
    const session = {};
    for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key) session[key] = sessionStorage.getItem(key);
    }
    return { localStorage: local, sessionStorage: session, exportedAt: new Date().toISOString() };
}

function importBrowserCacheSnapshot(snapshot, { skipAuth = true } = {}) {
    if (!snapshot) return;
    if (snapshot.localStorage) {
        Object.entries(snapshot.localStorage).forEach(([key, val]) => {
            if (skipAuth && key === REMEMBER_ME_KEY) return;
            localStorage.setItem(key, val);
        });
    }
    if (snapshot.sessionStorage) {
        Object.entries(snapshot.sessionStorage).forEach(([key, val]) => {
            if (skipAuth && key === LOGIN_SESSION_KEY) return;
            sessionStorage.setItem(key, val);
        });
    }
}

function clearAllAppLocalCaches({ keepAuth = true } = {}) {
    const session = sessionStorage.getItem(LOGIN_SESSION_KEY);
    const remember = keepAuth ? localStorage.getItem(REMEMBER_ME_KEY) : null;
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (!keepAuth || key !== REMEMBER_ME_KEY)) keysToRemove.push(key);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    lastSyncTimes = { products: 0, stocks: 0, customers: 0, invoices_monitor: 0 };
    globalProductMap = {};
    globalStockMap = {};
    globalCustomerList = [];
    monitorLastDoc = null;
    monitorDisplayedCount = 0;
    monitorServerMode = false;
    if (session) sessionStorage.setItem(LOGIN_SESSION_KEY, session);
    if (remember) localStorage.setItem(REMEMBER_ME_KEY, remember);
}

function restoreFirestoreFields(value) {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(restoreFirestoreFields);
    if (typeof value === 'object') {
        if (value.seconds !== undefined && value.nanoseconds !== undefined) {
            return new Timestamp(value.seconds, value.nanoseconds);
        }
        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = restoreFirestoreFields(v);
        return out;
    }
    return value;
}

function serializeFirestoreForBackup(value) {
    if (value === null || value === undefined) return value;
    if (typeof value.toMillis === 'function') {
        return { seconds: value.seconds, nanoseconds: value.nanoseconds };
    }
    if (Array.isArray(value)) return value.map(serializeFirestoreForBackup);
    if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = serializeFirestoreForBackup(v);
        return out;
    }
    return value;
}

function parseProductsTxt(text) {
    const cleaned = String(text || '').replace(/^\uFEFF/, '');
    const toImport = [];
    const hasBlankSeparators = /\r?\n\s*\r?\n/.test(cleaned);

    if (hasBlankSeparators) {
        cleaned.split(/\r?\n\s*\r?\n/).map(b => b.trim()).filter(Boolean).forEach(block => {
            const lines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
            const name = lines[0];
            if (!name) return;
            const priceRaw = lines[1];
            const price = priceRaw === undefined || priceRaw === '' ? 0 : parseFloat(priceRaw);
            if (!isNaN(price)) toImport.push({ name, price });
        });
    } else {
        const lines = cleaned.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
        for (let i = 0; i < lines.length; i += 2) {
            const name = lines[i];
            if (!name) continue;
            const priceRaw = lines[i + 1];
            const price = priceRaw === undefined || priceRaw === '' ? 0 : parseFloat(priceRaw);
            if (!isNaN(price)) toImport.push({ name, price });
        }
    }
    return toImport;
}

async function restoreBackupCollection(colName, docs) {
    if (!docs?.length) return 0;
    let count = 0;
    const withId = docs.filter(d => d.id);
    const withoutId = docs.filter(d => !d.id);
    const BATCH_SIZE = 400;

    for (let i = 0; i < withId.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        withId.slice(i, i + BATCH_SIZE).forEach(docData => {
            const { id, ...raw } = docData;
            batch.set(doc(db, colName, id), restoreFirestoreFields(raw), { merge: true });
            count++;
        });
        await batch.commit();
    }

    for (const docData of withoutId) {
        const { id, ...raw } = docData;
        await addDoc(collection(db, colName), restoreFirestoreFields(raw));
        count++;
    }
    return count;
}

function loadMonitorCache() {
    try {
        const raw = localStorage.getItem(ADMIN_MONITOR_CACHE);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function saveMonitorCache(list) {
    localStorage.setItem(ADMIN_MONITOR_CACHE, JSON.stringify(sortMonitorCache(list).slice(0, MONITOR_CACHE_MAX)));
}

async function invalidateMonitorCache() {
    await appCache.remove(ADMIN_MONITOR_CACHE); localStorage.removeItem(ADMIN_MONITOR_CACHE);
    lastSyncTimes.invoices_monitor = 0;
    localStorage.setItem(CACHE_KEYS.LAST_SYNC, JSON.stringify(lastSyncTimes));
    const versions = JSON.parse(localStorage.getItem(CACHE_KEYS.VERSIONS) || '{}');
    delete versions.salesVersion;
    delete versions.historyVersion;
    localStorage.setItem(CACHE_KEYS.VERSIONS, JSON.stringify(versions));
}

function getInvoiceSortTime(inv) {
    const t = inv?.timestamp || inv?.date;
    const ms = Date.parse(t);
    return isNaN(ms) ? 0 : ms;
}

function getMonitorUpdatedAtMs(inv) {
    if (inv?.updatedAt?.toMillis) return inv.updatedAt.toMillis();
    if (inv?.updatedAt?.seconds != null) return inv.updatedAt.seconds * 1000;
    return getInvoiceSortTime(inv);
}

function sortMonitorCache(list) {
    return [...list].sort((a, b) => getMonitorUpdatedAtMs(b) - getMonitorUpdatedAtMs(a));
}

function getSellHistoryCacheKey(userId) {
    return `${CACHE_KEYS.SELL_HISTORY}_${userId}`;
}

function loadSellHistoryCache(userId) {
    try {
        const raw = localStorage.getItem(getSellHistoryCacheKey(userId));
        if (!raw) return { items: [], historyVersion: 0 };
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return { items: parsed, historyVersion: 0 };
        return { items: parsed.items || [], historyVersion: parsed.historyVersion || 0 };
    } catch (e) {
        return { items: [], historyVersion: 0 };
    }
}

function sortSellHistoryCache(list) {
    return [...list].sort((a, b) => {
        const numA = extractInvoiceNumber(a.invoiceNumber);
        const numB = extractInvoiceNumber(b.invoiceNumber);
        if (numA !== numB && (numA > 0 || numB > 0)) {
            return numB - numA;
        }
        return getInvoiceSortTime(b) - getInvoiceSortTime(a);
    });
}

function saveSellHistoryCache(userId, items, historyVersion) {
    const sorted = sortSellHistoryCache(items).slice(0, SELL_HISTORY_CACHE_MAX);
    localStorage.setItem(getSellHistoryCacheKey(userId), JSON.stringify({ items: sorted, historyVersion }));
}

function invalidateSellHistoryCache(userId) {
    localStorage.removeItem(getSellHistoryCacheKey(userId));
}

function prependSellHistoryCache(userId, invoice) {
    const cache = loadSellHistoryCache(userId);
    const localVersions = getLocalMonitorVersions();
    const newHistoryVersion = localVersions.historyVersion + 1;
    const newSalesVersion = localVersions.salesVersion + 1;
    const merged = [{ ...invoice }, ...cache.items.filter(i => i.id !== invoice.id)];
    saveSellHistoryCache(userId, merged, newHistoryVersion);
    saveLocalMonitorVersions(newSalesVersion, newHistoryVersion);
}

function removeSellHistoryCacheItem(userId, invoiceId) {
    const cache = loadSellHistoryCache(userId);
    saveSellHistoryCache(userId, cache.items.filter(i => i.id !== invoiceId), cache.historyVersion);
}

function updateSellHistoryLoadMoreButton(hasMore) {
    const container = document.getElementById('sellHistoryLoadMoreContainer');
    if (!container) return;
    if (hasMore) {
        container.innerHTML = '<button class="btn btn-secondary btn-sm" id="loadMoreSellHistoryBtn">Load More</button>';
        document.getElementById('loadMoreSellHistoryBtn').onclick = () => loadSellHistoryInvoices(true);
    } else {
        container.innerHTML = '';
    }
}

function getLocalMonitorVersions() {
    const versions = JSON.parse(localStorage.getItem(CACHE_KEYS.VERSIONS) || '{}');
    return {
        salesVersion: parseInt(versions.salesVersion) || 0,
        historyVersion: parseInt(versions.historyVersion) || 0
    };
}

function saveLocalMonitorVersions(salesVersion, historyVersion) {
    const versions = JSON.parse(localStorage.getItem(CACHE_KEYS.VERSIONS) || '{}');
    versions.salesVersion = salesVersion;
    versions.historyVersion = historyVersion;
    localStorage.setItem(CACHE_KEYS.VERSIONS, JSON.stringify(versions));
}

function getLocalCustomerVersion() {
    const versions = JSON.parse(localStorage.getItem(CACHE_KEYS.VERSIONS) || '{}');
    return parseInt(versions.customerVersion) || 0;
}

function saveLocalCustomerVersion(customerVersion) {
    const versions = JSON.parse(localStorage.getItem(CACHE_KEYS.VERSIONS) || '{}');
    versions.customerVersion = customerVersion;
    localStorage.setItem(CACHE_KEYS.VERSIONS, JSON.stringify(versions));
}

async function getServerCustomerVersion() {
    const snap = await getDoc(doc(db, "settings", "appConfig"));
    if (!snap.exists()) return 1;
    const data = snap.data();
    return parseInt(data.customerVersion) || 1;
}

async function customerVersionChanged() {
    const server = await getServerCustomerVersion();
    const local = getLocalCustomerVersion();
    return server !== local;
}

async function syncLocalCustomerVersionFromServer() {
    const server = await getServerCustomerVersion();
    saveLocalCustomerVersion(server);
}

async function getServerMonitorVersions() {
    const snap = await getDoc(doc(db, "settings", "appConfig"));
    if (!snap.exists()) return { salesVersion: 1, historyVersion: 1 };
    const data = snap.data();
    return {
        salesVersion: parseInt(data.salesVersion) || 1,
        historyVersion: parseInt(data.historyVersion) || 1
    };
}

async function monitorSalesVersionsChanged() {
    const server = await getServerMonitorVersions();
    const local = getLocalMonitorVersions();
    return server.salesVersion !== local.salesVersion || server.historyVersion !== local.historyVersion;
}

async function syncLocalMonitorVersionsFromServer() {
    const server = await getServerMonitorVersions();
    saveLocalMonitorVersions(server.salesVersion, server.historyVersion);
}

function monitorHasMoreToLoad(cache) {
    if (monitorDisplayedCount < cache.length) return true;
    return cache.length >= MONITOR_CACHE_MAX;
}

function mergeMonitorItems(cache, items) {
    const map = new Map(cache.map(i => [i.id, i]));
    items.forEach(item => {
        if (item.deleted === true) map.delete(item.id);
        else map.set(item.id, item);
    });
    return sortMonitorCache([...map.values()]);
}

function removeMonitorCacheItem(id) {
    const cache = loadMonitorCache().filter(i => i.id !== id);
    saveMonitorCache(cache);
    return cache;
}

function bumpMonitorSyncFromItems(items) {
    let latestTs = lastSyncTimes.invoices_monitor || 0;
    let foundTimestamp = false;
    items.forEach(item => {
        if (item.updatedAt?.toMillis) {
            foundTimestamp = true;
            latestTs = Math.max(latestTs, item.updatedAt.toMillis());
        } else if (item.updatedAt?.seconds) {
            foundTimestamp = true;
            latestTs = Math.max(latestTs, item.updatedAt.seconds * 1000);
        }
    });
    if (!foundTimestamp && items.length > 0) {
        latestTs = Date.now();
    }
    if (latestTs > (lastSyncTimes.invoices_monitor || 0)) {
        saveSyncTime('invoices_monitor', latestTs);
    }
}

async function syncMonitorIncremental() {
    if (!db) return false;
    const lastSync = lastSyncTimes.invoices_monitor || 0;
    try {
        const q = query(
            collection(db, "invoices"),
            where("updatedAt", ">", new Date(lastSync)),
            orderBy("updatedAt", "asc")
        );
        const snap = await getDocs(q);
        if (snap.empty) return false;

        const updates = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const cache = mergeMonitorItems(loadMonitorCache(), updates);
        saveMonitorCache(cache);
        bumpMonitorSyncFromItems(updates);
        return true;
    } catch (e) {
        if (e.code !== 'failed-precondition' && e.code !== 'invalid-argument') {
            console.warn("Monitor incremental sync failed:", e);
        }
        return false;
    }
}

async function syncUserSalesIncremental(userId) {
    if (!db) return false;
    const cacheKey = `admin_cache_sales_${userId}`;
    const cached = localStorage.getItem(cacheKey);
    let currentCache = cached ? JSON.parse(cached) : [];

    try {
        let changed = false;

        // 1. Sync from global monitor (no composite index required)
        try {
            await syncMonitorIncremental();
            const monitorUserInvoices = loadMonitorCache().filter(i => i.user === userId);
            if (monitorUserInvoices.length > 0) {
                const merged = mergeMonitorItems(currentCache, monitorUserInvoices);
                if (merged.length !== currentCache.length || JSON.stringify(merged) !== JSON.stringify(currentCache)) {
                    currentCache = merged;
                    changed = true;
                }
            }
        } catch (e1) {
            console.warn("Monitor sync in user sales failed:", e1);
        }

        // 2. Direct Firestore query for this user's invoices (single equality filter, guaranteed no index error!)
        try {
            const qUser = query(collection(db, "invoices"), where("user", "==", userId));
            const snap = await getDocs(qUser);
            if (!snap.empty) {
                const serverItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                const merged = mergeMonitorItems(currentCache, serverItems);
                if (merged.length !== currentCache.length || JSON.stringify(merged) !== JSON.stringify(currentCache)) {
                    currentCache = merged;
                    changed = true;
                }
            }
        } catch (e2) {
            console.warn("Direct user invoices sync failed:", e2);
        }

        if (changed) {
            localStorage.setItem(cacheKey, JSON.stringify(currentCache));
        }
        return changed;
    } catch (e) {
        console.warn("User sales incremental sync failed:", e);
        return false;
    }
}

async function syncUserCustomersIncremental(userId) {
    if (!db) return false;
    const cacheKey = `admin_cache_customers_${userId}`;
    const cached = localStorage.getItem(cacheKey);
    let currentCache = cached ? JSON.parse(cached) : [];

    // Incremental sync for a specific user's customers
    try {
        // Get latest timestamp from cache
        let latestTs = 0;
        currentCache.forEach(item => {
            if (item.updatedAt?.toMillis) {
                latestTs = Math.max(latestTs, item.updatedAt.toMillis());
            } else if (item.updatedAt?.seconds) {
                latestTs = Math.max(latestTs, item.updatedAt.seconds * 1000);
            }
        });

        const q = query(
            collection(db, "customers"),
            where("user", "==", userId),
            where("updatedAt", ">", new Date(latestTs)),
            orderBy("updatedAt", "asc")
        );
        const snap = await getDocs(q);
        if (snap.empty) return false;

        const updates = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const mergedCache = mergeMonitorItems(currentCache, updates);
        localStorage.setItem(cacheKey, JSON.stringify(mergedCache));
        return true;
    } catch (e) {
        if (e.code !== 'failed-precondition' && e.code !== 'invalid-argument') {
            console.warn("User customers incremental sync failed:", e);
        }
        return false;
    }
}

function getCustomerDocId(userId, billTo) {
    const normalized = billTo.trim().toLowerCase();
    let h = 0;
    const s = `${userId}|${normalized}`;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h) + s.charCodeAt(i);
        h |= 0;
    }
    return `c_${userId}_${Math.abs(h)}`;
}

function invalidateUsersCache() {
    localStorage.removeItem('cachedUsers_v1_1');
    localStorage.removeItem(ADMIN_USERS_CACHE);
}

function persistStockCache() {
    const dataMap = {};
    Object.entries(globalStockMap).forEach(([pid, qty]) => {
        dataMap[pid] = { productId: pid, quantity: qty, id: pid };
    });
    await appCache.set(CACHE_KEYS.STOCKS, dataMap);
}

// Initialize or load sync timestamps
let lastSyncTimes = JSON.parse(localStorage.getItem(CACHE_KEYS.LAST_SYNC) || '{"products": 0, "stocks": 0, "customers": 0, "invoices_monitor": 0}');

function saveSyncTime(type, time) {
    lastSyncTimes[type] = time;
    localStorage.setItem(CACHE_KEYS.LAST_SYNC, JSON.stringify(lastSyncTimes));
}

async function syncCollectionIncremental(colName, lastSyncKey, localDataMap, onUpdate, useUserFilter = false) {
    if (!db) return localDataMap;
    try {
        const lastSync = lastSyncTimes[lastSyncKey] || 0;
        let constraints = [
            where("updatedAt", ">", new Date(lastSync)),
            orderBy("updatedAt", "asc")
        ];
        
        if (useUserFilter && currentUser) {
            constraints.unshift(where("user", "==", currentUser));
        }

        const q = query(collection(db, colName), ...constraints);

        const snap = await getDocs(q);
        if (snap.empty) return localDataMap;

        let updatedMap = { ...localDataMap };
        let latestTimestamp = lastSync;

        snap.forEach(docSnap => {
            const data = docSnap.data();
            const id = docSnap.id;
            
            if (data.updatedAt) {
                const ts = data.updatedAt.toMillis();
                if (ts > latestTimestamp) latestTimestamp = ts;
            }

            if (data.deleted === true) {
                delete updatedMap[id];
            } else {
                updatedMap[id] = { id, ...data };
            }
        });

        saveSyncTime(lastSyncKey, latestTimestamp);
        if (onUpdate) await onUpdate(updatedMap);
        return updatedMap;
    } catch (e) {
        console.error(`Sync Error [${colName}]:`, e);
        if (e.code === 'failed-precondition' || e.code === 'invalid-argument') {
            return await fetchFullCollection(colName, lastSyncKey, useUserFilter);
        }
        return localDataMap;
    }
}

async function fetchFullCollection(colName, lastSyncKey, useUserFilter = false) {
    let constraints = [];
    if (useUserFilter && currentUser) {
        constraints.push(where("user", "==", currentUser));
    }
    const snap = await getDocs(query(collection(db, colName), ...constraints));
    let dataMap = {};
    let latestTs = 0;
    snap.forEach(d => {
        const data = d.data();
        if (data.deleted !== true) {
            const item = { id: d.id, ...data };
            dataMap[d.id] = item;
            if (item.updatedAt) {
                const ts = item.updatedAt.toMillis();
                if (ts > latestTs) latestTs = ts;
            }
        }
    });
    saveSyncTime(lastSyncKey, latestTs);
    return dataMap;
}

// --- Version System (For Emergency/Schema Migration) ---
async function ensureAppConfig() {
    if (!db) return;
    try {
        const configRef = doc(db, "settings", "appConfig");
        const snap = await getDoc(configRef);
        const defaults = { productVersion: 1, stockVersion: 1, salesVersion: 1, historyVersion: 1, customerVersion: 1, settingsVersion: 1 };
        if (!snap.exists()) await setDoc(configRef, defaults);
    } catch (e) {}
}

async function incrementVersions(types) {
    if (!db || !types?.length) return;
    const valid = types.filter(t => t && t !== 'USERS');
    if (!valid.length) return;
    try {
        const configRef = doc(db, "settings", "appConfig");
        const updates = {};
        valid.forEach(t => { updates[t] = increment(1); });
        await updateDoc(configRef, updates);
    } catch (e) {
        try {
            await ensureAppConfig();
            const configRef = doc(db, "settings", "appConfig");
            const updates = {};
            valid.forEach(t => { updates[t] = increment(1); });
            await updateDoc(configRef, updates);
        } catch (e2) { console.warn("Version bump failed:", e2); }
    }
}

async function incrementVersion(type) {
    return incrementVersions([type]);
}

function clearLocalStorageCache() {
    if (!confirm("⚠️ A to Z Clear Local Cache?\nThis will remove ALL stored data including products, customers, sales monitor cache, and admin caches from this browser.\n(Login session will be kept)")) return;
    clearAllAppLocalCaches({ keepAuth: true });
    alert("✅ All local storage cleared successfully!");
    location.reload();
}

async function getWithCache(type, fetchFunc, cacheKey) {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        try { return JSON.parse(cached); } catch (e) {}
    }
    const fresh = await fetchFunc();
    if (fresh) localStorage.setItem(cacheKey, JSON.stringify(fresh));
    return fresh;
}

async function getUsersWithAutoSync(cacheKey, onUpdate) {
    const cached = localStorage.getItem(cacheKey);
    let cachedUsers = null;
    if (cached) {
        try { cachedUsers = JSON.parse(cached); } catch (e) {}
    }
    if (cachedUsers) {
        setTimeout(async () => {
            try {
                if (!db) return;
                const snap = await getDocs(collection(db, "users"));
                const fresh = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                const oldStr = localStorage.getItem(cacheKey);
                const newStr = JSON.stringify(fresh);
                if (oldStr !== newStr) {
                    localStorage.setItem(cacheKey, newStr);
                    if (onUpdate) onUpdate(fresh);
                }
            } catch(e) {}
        }, 10);
        return cachedUsers;
    }
    const snap = await getDocs(collection(db, "users"));
    const fresh = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    localStorage.setItem(cacheKey, JSON.stringify(fresh));
    return fresh;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const day = String(date.getDate()).padStart(2, '0');
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
}

function formatDateTimeBD(invoice) {
    let date;
    // Try to get date from invoice's timestamp or updatedAt or date field
    if (invoice?.timestamp?.toMillis) {
        date = new Date(invoice.timestamp.toMillis());
    } else if (invoice?.updatedAt?.toMillis) {
        date = new Date(invoice.updatedAt.toMillis());
    } else if (invoice?.timestamp) {
        date = new Date(invoice.timestamp);
    } else if (invoice?.updatedAt) {
        date = new Date(invoice.updatedAt);
    } else if (invoice?.date) {
        date = new Date(invoice.date);
    } else {
        return formatDate(invoice?.date || '');
    }
    
    if (isNaN(date.getTime())) {
        return formatDate(invoice?.date || '');
    }
    
    // Format date
    const day = String(date.getDate()).padStart(2, '0');
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    const dateStr = `${day} ${month} ${year}`;
    
    // Format Bangladesh time (Asia/Dhaka time zone) using Intl.DateTimeFormat
    const timeStr = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Dhaka',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    }).format(date);
    
    return `<div style="font-weight:500;">${dateStr}</div><div style="font-size:0.85em;opacity:0.9;">${timeStr}</div>`;
}

function extractInvoiceNumber(str) {
    if (!str && str !== 0) return 0;
    if (typeof str === 'number') return str;
    const matches = String(str).match(/\d+/g);
    if (!matches) return 0;
    return parseInt(matches[matches.length - 1], 10) || 0;
}


function logout() {
    sessionStorage.removeItem(LOGIN_SESSION_KEY);
    window.location.href = 'index.html';
}

async function showMainApp() {
    document.getElementById('mainInvoiceWrapper').style.display = 'block';
    
    const isAdmin = (currentUser === 'admin');
    const adminPanelBtn = document.getElementById('adminPanelBtn');
    const btnSaveDefault = document.getElementById('btnSaveDefault');
    const viewStockBtn = document.getElementById('viewStockBtn');
    const viewPaymentBtn = document.getElementById('viewPaymentBtn');
    
    if (isAdmin) {
        adminPanelBtn.classList.add('admin-visible');
        btnSaveDefault.style.display = 'inline-block';
        if (viewStockBtn) viewStockBtn.style.display = 'none';
        if (viewPaymentBtn) viewPaymentBtn.style.display = 'none';
    } else {
        adminPanelBtn.classList.remove('admin-visible');
        btnSaveDefault.style.display = 'none';
        if (viewStockBtn) viewStockBtn.style.display = 'inline-block';
        if (viewPaymentBtn) viewPaymentBtn.style.display = 'inline-block';
    }
    document.getElementById('companyDetails').readOnly = !isAdmin;
    
    if (!window._appInitialized) { await initializeAppLogic(); window._appInitialized = true; }
    if (isAdmin) startDeleteNotifPolling();
}

async function initializeAppLogic() {
    if (!db) return;
    document.getElementById('usernameDisplay').textContent = currentUser;
    
    await ensureAppConfig();

    // --- Remote Cache Control Mechanism ---
    try {
        const userRef = doc(db, "users", currentUser);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const userData = userSnap.data();
            const serverCacheVersion = userData.forceClearCache || 0;
            const localCacheVersion = parseInt(localStorage.getItem(`local_cache_version_${currentUser}`)) || 0;
            
            if (serverCacheVersion > localCacheVersion) {
                console.log("Remote Clear Cache Signal Received!");
                clearAllAppLocalCaches({ keepAuth: true });
                localStorage.setItem(`local_cache_version_${currentUser}`, serverCacheVersion);
                sessionStorage.setItem(FORCE_IMMEDIATE_SYNC_KEY, '1');
                alert("System data updated. Refreshing...");
                location.reload();
                return;
            }
        }
    } catch (e) { console.error("Remote command error:", e); }
    
    // Initial load from cache (Map based)
    globalProductMap = (await appCache.get(CACHE_KEYS.PRODUCTS)) || {};
    const cachedStocksMap = (await appCache.get(CACHE_KEYS.STOCKS)) || {};
    globalStockMap = {};
    Object.values(cachedStocksMap).forEach(s => globalStockMap[s.productId] = s.quantity);
    globalCustomerList = (await appCache.get(`${CACHE_KEYS.CUSTOMERS}_${currentUser}`)) || [];

    // UI initial setup
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const dateInput = document.getElementById('invoiceDate');
    dateInput.setAttribute('data-raw', todayStr);
    dateInput.value = formatDate(todayStr);
    document.getElementById('logoPreview').src = LOGO_URL;
    document.getElementById('logoPreview').style.display = 'block';

    // Load settings (Always full fetch for settings for safety)
    const settingsSnap = await getDoc(doc(db, "settings", "company"));
    if (settingsSnap.exists()) {
        const s = settingsSnap.data();
        if (s.companyDetails) { document.getElementById('companyDetails').value = s.companyDetails; autoResize(document.getElementById('companyDetails')); }
        if (s.defaultNote) document.getElementById('invoiceNote').value = s.defaultNote;
    }

    // Background delta sync after UI is ready (saves startup reads)
    if (sessionStorage.getItem(FORCE_IMMEDIATE_SYNC_KEY)) {
        sessionStorage.removeItem(FORCE_IMMEDIATE_SYNC_KEY);
        syncAppData().catch(e => console.warn("Immediate sync:", e));
    } else {
        setTimeout(() => { syncAppData().catch(e => console.warn("Background sync:", e)); }, 2500);
    }

    // User-specific Invoice Numbering
    try {
        const userSnap = await getDoc(doc(db, "users", currentUser));
        let nextNum = 1;
        if (userSnap.exists() && userSnap.data().invoiceCounter !== undefined) {
            nextNum = (parseInt(userSnap.data().invoiceCounter) || 0) + 1;
        }
        document.getElementById('invoiceNumber').value = `Invoice No ${nextNum}`;
    } catch (e) {
        document.getElementById('invoiceNumber').value = 'Invoice No 1';
    }
    
    if (document.getElementById('invoiceBody').children.length === 0) addInvoiceRow();
    calculateGrandTotal();
}

async function syncProducts() {
    globalProductMap = await syncCollectionIncremental("products", "products", globalProductMap, async (dataMap) => {
        await appCache.set(CACHE_KEYS.PRODUCTS, dataMap);
    });
}

async function syncStocks() {
    const localStocksMap = {};
    Object.entries(globalStockMap).forEach(([pid, qty]) => {
        localStocksMap[pid] = { productId: pid, quantity: qty, id: pid };
    });
    
    await syncCollectionIncremental("stocks", "stocks", localStocksMap, async (dataMap) => {
        globalStockMap = {};
        Object.values(dataMap).forEach(s => globalStockMap[s.productId] = s.quantity);
        await appCache.set(CACHE_KEYS.STOCKS, dataMap);
    });
}

async function syncCustomers() {
    const customerMap = {};
    globalCustomerList.forEach(c => customerMap[c.id] = c);
    // Use user-specific sync key and enable user filter to ensure privacy
    await syncCollectionIncremental("customers", "customers_" + currentUser, customerMap, async (dataMap) => {
        globalCustomerList = Object.values(dataMap);
        await appCache.set(`${CACHE_KEYS.CUSTOMERS}_${currentUser}`, globalCustomerList);
    }, true);
}

async function syncAppData() {
    await Promise.all([syncProducts(), syncStocks(), syncCustomers()]);
}

async function refreshProductList() {
    await syncProducts();
}

async function refreshCustomerList() {
    await syncCustomers();
}

function isMobileSuggestionView() {
    return MOBILE_SUGGESTION_MQ.matches;
}

function hideCustomerSuggestions() {
    const box = document.getElementById('customerSuggestions');
    if (!box) return;
    box.style.display = 'none';
    resetCustomerSuggestionsPlacement();
}

function resetCustomerSuggestionsPlacement() {
    const box = document.getElementById('customerSuggestions');
    if (!box) return;
    if (box._portalParent) {
        box._portalParent.appendChild(box);
        box._portalParent = null;
    }
    box.classList.remove('suggestion-floating');
    ['position', 'left', 'top', 'right', 'bottom', 'width', 'maxWidth', 'zIndex'].forEach((prop) => {
        box.style[prop] = '';
    });
}

function repositionCustomerSuggestions() {
    const box = document.getElementById('customerSuggestions');
    const billTo = document.getElementById('billTo');
    if (!box || !billTo || box.style.display === 'none') return;

    if (!isMobileSuggestionView()) {
        resetCustomerSuggestionsPlacement();
        return;
    }

    const rect = billTo.getBoundingClientRect();
    const pad = 12;
    const width = Math.min(rect.width, window.innerWidth - pad * 2);

    if (!box._portalParent) {
        box._portalParent = box.parentElement;
        document.body.appendChild(box);
        box.classList.add('suggestion-floating');
    }

    const left = Math.max(pad, Math.min(rect.left, window.innerWidth - width - pad));
    box.style.position = 'fixed';
    box.style.left = `${left}px`;
    box.style.top = `${rect.bottom + 4}px`;
    box.style.width = `${width}px`;
    box.style.right = 'auto';
    box.style.bottom = 'auto';
    box.style.maxWidth = 'none';
    box.style.zIndex = '10001';
}

function initCustomerSuggestionListeners() {
    const onViewportChange = () => {
        const box = document.getElementById('customerSuggestions');
        if (box && box.style.display !== 'none') repositionCustomerSuggestions();
    };
    window.addEventListener('resize', onViewportChange);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', onViewportChange);
        window.visualViewport.addEventListener('scroll', onViewportChange);
    }
    window.addEventListener('scroll', onViewportChange, true);
}

function filterCustomers() {
    const qStr = document.getElementById('billTo').value.trim().toLowerCase();
    const box = document.getElementById('customerSuggestions');
    
    // Ensure customers are synced if typing starts and list is empty
    if (globalCustomerList.length === 0) syncCustomers();
    
    if (!qStr) { hideCustomerSuggestions(); return; }
    
    // Use a Set with a composite key (Name + Address + Phone) to allow different entries for same name
    const uniqueCustomers = [];
    const seenKeys = new Set();
    
    globalCustomerList.forEach(c => {
        if (c.billTo && c.billTo.toLowerCase().includes(qStr)) {
            const compositeKey = `${c.billTo}|${c.shipTo || ''}|${c.phone || ''}`.toLowerCase();
            if (!seenKeys.has(compositeKey)) {
                uniqueCustomers.push(c);
                seenKeys.add(compositeKey);
            }
        }
    });
    
    if (uniqueCustomers.length === 0) { hideCustomerSuggestions(); return; }
    
    box.innerHTML = uniqueCustomers.map(c => `
        <div class="suggestion-item" 
             data-billto="${c.billTo}" 
             data-shipto="${c.shipTo || ''}" 
             data-phone="${c.phone || ''}"
             style="padding: 10px; cursor: pointer; border-bottom: 1px solid #eee;">
             <strong>${c.billTo}</strong><br>
             <small style="color: #666;">${c.shipTo || ''} ${c.phone ? ' | ' + c.phone : ''}</small>
        </div>
    `).join('');
    
    box.style.display = 'block';
    repositionCustomerSuggestions();
    
    box.querySelectorAll('.suggestion-item').forEach(item => {
        const applySuggestion = (e) => {
            e.preventDefault();
            e.stopPropagation();
            document.getElementById('billTo').value = item.dataset.billto;
            document.getElementById('shipTo').value = item.dataset.shipto;
            document.getElementById('phoneField').value = item.dataset.phone;
            hideCustomerSuggestions();
            autoResize(document.getElementById('billTo'));
        };
        item.addEventListener('pointerdown', applySuggestion);
    });
}

async function dbFetchStock() { 
    await syncStocks();
    return globalStockMap;
}

async function dbUpdateStock(stockObj) {
    const entries = Object.entries(stockObj);
    if (!db || !entries.length) return;
    try {
        const batch = writeBatch(db);
        for (const [pid, qty] of entries) {
            batch.set(doc(db, "stocks", pid), {
                productId: pid,
                quantity: qty,
                updatedAt: serverTimestamp()
            }, { merge: true });
        }
        await batch.commit();
        await incrementVersions(['stockVersion']);
        persistStockCache();
    } catch (e) { console.error("Stock Update Error:", e); }
}

function autoResize(textarea) { textarea.style.height = 'auto'; textarea.style.height = textarea.scrollHeight + 'px'; }

function addInvoiceRow() {
    const tbody = document.getElementById('invoiceBody');
    const row = document.createElement('tr');
    row.innerHTML = `<td>
        <input type="text" class="product-name" placeholder="Select Product" readonly>
        <input type="hidden" class="product-id">
    </td>
        <td><input type="number" class="qty" value="1" min="1"></td>
        <td><input type="number" class="rate" value="0" min="0" step="0.01"></td>
        <td><input type="number" class="amount" value="0.00" readonly></td>
        <td><button class="btn btn-danger remove-btn">✕</button></td>`;
    tbody.appendChild(row);
    row.querySelector('.product-name').onclick = function() { openProductPopup(this); };
    const qtyInput = row.querySelector('.qty');
    qtyInput.addEventListener('input', function() {
        const v = this.value.trim();
        if (v !== '' && parseFloat(v) < 1) this.value = 1;
        calculateRow(this);
    });
    qtyInput.addEventListener('blur', function() {
        const v = parseFloat(this.value);
        if (!v || v < 1) this.value = 1;
        calculateRow(this);
    });
    row.querySelector('.rate').oninput = function() { if(this.value < 0) this.value = 0; calculateRow(this); };
    row.querySelector('.remove-btn').onclick = function() { removeRow(this); };
}

function calculateRow(el) { const row = el.closest('tr'); const qty = parseFloat(row.querySelector('.qty').value) || 0; const rate = parseFloat(row.querySelector('.rate').value) || 0; row.querySelector('.amount').value = (qty * rate).toFixed(2); calculateGrandTotal(); }

function calculateGrandTotal() {
    const symbol = document.getElementById('currencySelect').value;
    let sub = 0; document.querySelectorAll('.amount').forEach(a => sub += parseFloat(a.value) || 0);
    const discP = parseFloat(document.getElementById('discountPercent').value) || 0;
    const discA = sub * discP / 100; const final = sub - discA;
    
    const finalStr = symbol + ' ' + final.toFixed(2);
    document.getElementById('grandTotalMain').textContent = finalStr;
    document.getElementById('printGrandTotalTop').textContent = finalStr;
    
    document.getElementById('printSubTotal').textContent = symbol + ' ' + sub.toFixed(2);
    document.getElementById('printDiscountPercent').textContent = discP;
    document.getElementById('printDiscountAmount').textContent = '- ' + symbol + ' ' + discA.toFixed(2);
    document.getElementById('printGrandTotal').textContent = finalStr;
}

function removeRow(btn) { if (document.getElementById('invoiceBody').children.length > 1) { btn.closest('tr').remove(); calculateGrandTotal(); } else alert('At least one row is required!'); }

function openProductPopup(input) { 
    activeProductInput = input; 
    document.getElementById('productSearchInput').value = ''; 
    syncProducts(); // Sync in background when popup opens
    filterProducts(); 
    document.getElementById('productSearchPopup').style.display = 'flex'; 
    document.getElementById('productSearchInput').focus(); 
}

function filterProducts() {
    const qStr = document.getElementById('productSearchInput').value.toLowerCase();
    const list = document.getElementById('productSearchList');
    const products = Object.values(globalProductMap);
    const filtered = qStr ? products.filter(p => p.name && p.name.toLowerCase().includes(qStr)) : products;
    if (filtered.length === 0) { list.innerHTML = '<div class="product-list-item no-match">No products found</div>'; return; }
    list.innerHTML = filtered.map(p => {
        const priceDisplay = p.price && p.price > 0 ? `BDT ${p.price}` : 'Manual Price';
        return `<div class="product-list-item" data-id="${p.id}" data-name="${p.name}" data-price="${p.price || 0}">${p.name} - ${priceDisplay}</div>`;
    }).join('');
    list.querySelectorAll('.product-list-item').forEach(item => {
        if (!item.classList.contains('no-match')) {
            item.onclick = () => { 
                activeProductInput.value = item.dataset.name; 
                const row = activeProductInput.closest('tr'); 
                row.querySelector('.product-id').value = item.dataset.id;
                const price = parseFloat(item.dataset.price);
                const rateField = row.querySelector('.rate');
                rateField.value = price > 0 ? price : ''; 
                calculateRow(rateField); 
                document.getElementById('productSearchPopup').style.display = 'none';
                if (price === 0) {
                    rateField.focus();
                    rateField.select();
                }
            };
        }
    });
}

async function printInvoice() {
    if (!db) return alert("Firebase not connected!");
    const printBtn = document.getElementById('printBtn');
    const isMobilePrintFlow = isMobileViewport();
    const rows = []; let isValid = true;
    document.querySelectorAll('#invoiceBody tr').forEach(r => {
        const name = r.querySelector('.product-name').value;
        const pid = r.querySelector('.product-id').value;
        if (!name || !pid) { isValid = false; return; }
        rows.push({ 
            productId: pid, 
            name: name, 
            qty: parseFloat(r.querySelector('.qty').value) || 0, 
            rate: parseFloat(r.querySelector('.rate').value) || 0, 
            amount: parseFloat(r.querySelector('.amount').value) || 0 
        });
    });
    if (!isValid || rows.length === 0) return alert("Please select products!");
    
    const grandTotalVal = document.getElementById('printGrandTotal').textContent.split(' ')[1] || "0.00";
    
    const data = { 
        user: currentUser, 
        timestamp: new Date().toISOString(), 
        date: formatDate(document.getElementById('invoiceDate').value), 
        invoiceNumber: document.getElementById('invoiceNumber').value, 
        companyDetails: document.getElementById('companyDetails').value, 
        phone: document.getElementById('phoneField').value, 
        billTo: document.getElementById('billTo').value, 
        shipTo: document.getElementById('shipTo').value, 
        currency: document.getElementById('currencySelect').value, 
        discountPercent: parseFloat(document.getElementById('discountPercent').value) || 0, 
        grandTotal: grandTotalVal, 
        note: document.getElementById('invoiceNote').value, 
        items: rows 
    };

    if (isMobilePrintFlow) {
        reloadAfterPrint = false;
        openPrintDialog();
    }

    printBtn.disabled = true; printBtn.textContent = 'Saving...';
    try {
        const batch = writeBatch(db);
        const invRef = doc(collection(db, "invoices"));
        batch.set(invRef, { ...data, updatedAt: serverTimestamp() });

        const hasBillTo = !!data.billTo.trim();
        let customerData = null;
        let custDocId = null;

        if (hasBillTo) {
            custDocId = getCustomerDocId(currentUser, data.billTo.trim());
            const custSaleAmount = parseFloat(data.grandTotal) || 0;
            const custTxnEntry = {
                txnId: `txn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                type: 'sale',
                amount: custSaleAmount,
                date: data.date || '',
                note: data.invoiceNumber || '',
                createdAt: new Date().toISOString()
            };
            // Plain object for local cache (no field transforms)
            customerData = {
                user: currentUser,
                billTo: data.billTo.trim(),
                shipTo: data.shipTo.trim(),
                phone: data.phone.trim(),
                lastUpdated: new Date().toISOString(),
                _pendingTxn: custTxnEntry,     // temp field for cache update
                _pendingSaleAmount: custSaleAmount // temp field for cache update
            };
            // Firestore batch write with field transforms
            batch.set(doc(db, "customers", custDocId), {
                user: currentUser,
                billTo: data.billTo.trim(),
                shipTo: data.shipTo.trim(),
                phone: data.phone.trim(),
                lastUpdated: new Date().toISOString(),
                updatedAt: serverTimestamp(),
                totalSales: increment(custSaleAmount),
                transactions: arrayUnion(custTxnEntry)
            }, { merge: true });
        }

        const stockUpdates = {};
        rows.forEach(item => {
            if (item.productId) {
                const newQty = (globalStockMap[item.productId] || 0) - item.qty;
                stockUpdates[item.productId] = newQty;
                globalStockMap[item.productId] = newQty;
            }
        });
        for (const [pid, qty] of Object.entries(stockUpdates)) {
            batch.set(doc(db, "stocks", pid), {
                productId: pid,
                quantity: qty,
                updatedAt: serverTimestamp()
            }, { merge: true });
        }
        persistStockCache();

        const currentInvNum = extractInvoiceNumber(data.invoiceNumber);
        const saleAmount = parseFloat(data.grandTotal) || 0;
        const userRef = doc(db, "users", currentUser);
        batch.update(userRef, {
            totalSales: increment(saleAmount),
            invoiceCounter: currentInvNum,
            invoiceCount: increment(1)
        });

        // Add daily stats update for chart optimization
        const dateKey = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD format based on local time
        const dailyStatsRef = doc(db, "settings", "dailyStats");
        batch.set(dailyStatsRef, { [dateKey]: increment(saleAmount) }, { merge: true });

        const configRef = doc(db, "settings", "appConfig");
        const versionBumps = {
            salesVersion: increment(1),
            historyVersion: increment(1)
        };
        if (Object.keys(stockUpdates).length) versionBumps.stockVersion = increment(1);
        if (hasBillTo) versionBumps.customerVersion = increment(1);
        batch.update(configRef, versionBumps);

        await batch.commit();

        if (hasBillTo && customerData) {
            const pendingTxn = customerData._pendingTxn;
            const pendingSaleAmount = customerData._pendingSaleAmount || 0;
            // Remove temp fields before storing in cache
            const { _pendingTxn, _pendingSaleAmount, updatedAt, ...cleanCustData } = customerData;
            const existingIdx = globalCustomerList.findIndex(c => c.id === custDocId);
            if (existingIdx > -1) {
                const existing = globalCustomerList[existingIdx];
                existing.billTo = cleanCustData.billTo;
                existing.shipTo = cleanCustData.shipTo;
                existing.phone = cleanCustData.phone;
                existing.lastUpdated = cleanCustData.lastUpdated;
                existing.totalSales = (parseFloat(existing.totalSales) || 0) + pendingSaleAmount;
                if (!existing.transactions) existing.transactions = [];
                existing.transactions = [pendingTxn, ...existing.transactions];
                globalCustomerList[existingIdx] = existing;
            } else {
                globalCustomerList.push({
                    id: custDocId,
                    ...cleanCustData,
                    totalSales: pendingSaleAmount,
                    totalPaid: 0,
                    transactions: pendingTxn ? [pendingTxn] : []
                });
            }
            await appCache.set(`${CACHE_KEYS.CUSTOMERS}_${currentUser}`, globalCustomerList);
        }

        invalidateUsersCache();
        localStorage.removeItem(`admin_cache_sales_${currentUser}`);
        prependSellHistoryCache(currentUser, { id: invRef.id, ...data });
        saveMonitorCache(mergeMonitorItems(loadMonitorCache(), [{ id: invRef.id, ...data }]));

        alert("Invoice saved successfully!");
        reloadAfterPrint = !isMobilePrintFlow;
        if (!isMobilePrintFlow) openPrintDialog();
    } catch (e) { console.error("Save Invoice Error:", e); alert("Error saving invoice!"); } finally { printBtn.disabled = false; printBtn.textContent = '🖨️ Print'; }
}

function replaceWithDiv(input) { 
    const div = document.createElement('div'); 
    div.className = input.className + ' print-replacement'; 
    let val = input.value || '';
    if (input.id === 'invoiceDate') {
        val = formatDate(val);
    }
    div.textContent = val; 
    return div; 
}
function sanitizePrintFilename(name) {
    return String(name || '').replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim() || 'Invoice';
}

function getPrintDocumentTitle() {
    const username = (document.getElementById('usernameDisplay')?.textContent || currentUser || 'User').trim();
    const invoiceNo = (document.getElementById('invoiceNumber')?.value || 'Invoice').trim();
    return sanitizePrintFilename(`${username} & ${invoiceNo}`);
}

function restorePrintDom() {
    const wrapper = document.querySelector('.invoice-wrapper');
    if (wrapper) wrapper.classList.remove('shrink-level-1', 'shrink-level-2', 'shrink-level-3', 'shrink-level-4');
    printReplacements.forEach(i => {
        i.input.style.display = '';
        if (i.rep?.parentNode) i.rep.parentNode.removeChild(i.rep);
    });
    printReplacements = [];
    if (savedPageTitle !== null) {
        document.title = savedPageTitle;
        savedPageTitle = null;
    }
}

function beforePrint() { 
    if (isPrintPrepared) return;
    isPrintPrepared = true;
    savedPageTitle = document.title;
    document.title = getPrintDocumentTitle();

    const rowCount = document.querySelectorAll('#invoiceBody tr').length;
    const wrapper = document.querySelector('.invoice-wrapper');
    wrapper.classList.remove('shrink-level-1', 'shrink-level-2', 'shrink-level-3', 'shrink-level-4');
    
    if (rowCount > 40) wrapper.classList.add('shrink-level-4');
    else if (rowCount > 30) wrapper.classList.add('shrink-level-3');
    else if (rowCount > 22) wrapper.classList.add('shrink-level-2');
    else if (rowCount > 15) wrapper.classList.add('shrink-level-1');

    const selectors = ['#companyDetails','#invoiceNumber','#phoneField','#billTo','#shipTo','#invoiceNote','.product-name','.qty','.rate','.amount','#invoiceDate']; 
    selectors.forEach(s => { 
        document.querySelectorAll(s).forEach(input => { 
            const rep = replaceWithDiv(input); 
            input.parentNode.insertBefore(rep, input); 
            input.style.display = 'none'; 
            printReplacements.push({input, rep}); 
        }); 
    }); 
}
function afterPrint() { 
    if (!isPrintPrepared) return;
    isPrintPrepared = false;
    if (printCleanupTimer) {
        clearTimeout(printCleanupTimer);
        printCleanupTimer = null;
    }
    restorePrintDom();
    const shouldReload = reloadAfterPrint;
    reloadAfterPrint = false;
    const onDone = printFinishCallback;
    printFinishCallback = null;
    if (onDone) onDone();
    if (shouldReload) location.reload();
}

function scheduleAfterPrintCleanup() {
    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        afterPrint();
    };

    if (window.matchMedia) {
        const mq = window.matchMedia('print');
        const onPrintEnd = (e) => {
            if (!e.matches) {
                if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onPrintEnd);
                else if (typeof mq.removeListener === 'function') mq.removeListener(onPrintEnd);
                setTimeout(finish, 200);
            }
        };
        if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onPrintEnd);
        else if (typeof mq.addListener === 'function') mq.addListener(onPrintEnd);
    }

    printCleanupTimer = setTimeout(finish, 5000);
}

function openPrintDialog(onDone) {
    printFinishCallback = onDone || null;
    if (printCleanupTimer) {
        clearTimeout(printCleanupTimer);
        printCleanupTimer = null;
    }
    try {
        beforePrint();
        window.print();
        scheduleAfterPrintCleanup();
    } catch (error) {
        console.error('Print dialog error:', error);
        afterPrint();
        alert('Print dialog খুলতে সমস্যা হয়েছে। মোবাইলে browser share/print option ব্যবহার করুন।');
    }
}

async function deleteInvoiceWithRestore(invoiceId, callback, skipConfirm = false) {
    if (!skipConfirm && !confirm('Are you sure you want to delete this invoice? Stock will be restored and user accounting will be updated.')) return;
    try {
        const invRef = doc(db, "invoices", invoiceId);
        const invSnap = await getDoc(invRef);
        if (!invSnap.exists()) return alert("Invoice not found!");
        const data = invSnap.data();

        const batch = writeBatch(db);
        const stockUpdates = {};

        if (data.items && Array.isArray(data.items)) {
            for (const item of data.items) {
                if (item.productId) {
                    const newQty = (globalStockMap[item.productId] || 0) + (parseFloat(item.qty) || 0);
                    stockUpdates[item.productId] = newQty;
                    globalStockMap[item.productId] = newQty;
                }
            }
            for (const [pid, qty] of Object.entries(stockUpdates)) {
                batch.set(doc(db, "stocks", pid), {
                    productId: pid,
                    quantity: qty,
                    updatedAt: serverTimestamp()
                }, { merge: true });
            }
            persistStockCache();
        }

        if (data.user) {
            const userRef = doc(db, "users", data.user);
            const userUpdates = { invoiceCount: increment(-1) };
            if (data.grandTotal) {
                const userSnap = await getDoc(userRef);
                if (userSnap.exists()) {
                    const currentTotalSales = parseFloat(userSnap.data().totalSales) || 0;
                    const invoiceAmount = parseFloat(data.grandTotal) || 0;
                    userUpdates.totalSales = Math.max(0, currentTotalSales - invoiceAmount);
                }
            }
            batch.update(userRef, userUpdates);
        }

        // Add daily stats deduction for chart optimization
        if (data.grandTotal && data.timestamp) {
            const tsDate = new Date(data.timestamp);
            if (!isNaN(tsDate.getTime())) {
                const dateKey = tsDate.toLocaleDateString('en-CA');
                const invoiceAmount = parseFloat(data.grandTotal) || 0;
                const dailyStatsRef = doc(db, "settings", "dailyStats");
                batch.set(dailyStatsRef, { [dateKey]: increment(-invoiceAmount) }, { merge: true });
            }
        }

        batch.delete(invRef);
        await batch.commit();

        try { await deleteDoc(doc(db, "deleteRequests", invoiceId)); } catch (_) {}

        const versionTypes = ['salesVersion', 'historyVersion'];
        if (Object.keys(stockUpdates).length) versionTypes.push('stockVersion');
        await incrementVersions(versionTypes);
        invalidateUsersCache();
        if (data.user) {
            localStorage.removeItem(`admin_cache_sales_${data.user}`);
        }
        removeMonitorCacheItem(invoiceId);
        if (data.user) removeSellHistoryCacheItem(data.user, invoiceId);

        alert("Invoice deleted, stock restored, and user accounting updated!");
        if (callback) callback();
    } catch (e) {
        console.error("Delete Error:", e);
        alert("Error deleting invoice!");
    }
}

async function openHistory(isNext = false) {
    if (!db) return; 
    const modal = document.getElementById('historyModal'); 
    const container = document.getElementById('historyListContainer'); 
    modal.style.display = 'flex'; 
    
    if (!isNext) {
        container.innerHTML = 'Loading...';
        historyLastDoc = null;
    }

    try {
        let q = query(
            collection(db, "invoices"), 
            where("user", "==", currentUser), 
            orderBy("timestamp", "desc"), 
            limit(20)
        );
        
        if (isNext && historyLastDoc) {
            q = query(q, startAfter(historyLastDoc));
        }

        const snap = await getDocs(q);
        
        if (snap.empty && !isNext) { 
            container.innerHTML = 'No history found'; 
            return; 
        }

        let tableBody;
        if (!isNext) {
            container.innerHTML = `
                <table id="historyTable">
                    <thead><tr><th>Date</th><th>No.</th><th>Total</th><th>Action</th></tr></thead>
                    <tbody></tbody>
                </table>
                <div id="historyLoadMoreContainer" style="text-align:center; padding: 10px;"></div>
            `;
            tableBody = container.querySelector('tbody');
        } else {
            tableBody = container.querySelector('#historyTable tbody');
        }

        snap.forEach(d => { 
            const e = d.data();
            const json = encodeURIComponent(JSON.stringify({...e, id: d.id})); 
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${e.date}</td>
                <td>${e.invoiceNumber}</td>
                <td>${e.currency}${e.grandTotal}</td>
                <td>
                    <button class="btn btn-primary btn-sm load-inv" data-json="${json}">View</button>
                    ${currentUser === 'admin' ? `<button class="btn btn-danger btn-sm del-inv" data-id="${d.id}">Delete</button>` : ''}
                 </td>
            `;
            tableBody.appendChild(row);
        });

        // Bind events for rows
        tableBody.querySelectorAll('.load-inv').forEach(b => b.onclick = () => loadInvoiceUI(JSON.parse(decodeURIComponent(b.dataset.json))));
        tableBody.querySelectorAll('.del-inv').forEach(b => b.onclick = () => deleteInvoiceWithRestore(b.dataset.id, () => openHistory(false)));

        historyLastDoc = snap.docs[snap.docs.length - 1];
        
        const loadMoreBtnContainer = document.getElementById('historyLoadMoreContainer');
        if (snap.docs.length === 20) {
            loadMoreBtnContainer.innerHTML = '<button class="btn btn-secondary btn-sm" id="loadMoreHistoryBtn">Load More</button>';
            document.getElementById('loadMoreHistoryBtn').onclick = () => openHistory(true);
        } else {
            loadMoreBtnContainer.innerHTML = '';
        }
    } catch (e) { 
        console.error("History Error:", e);
        if (!isNext) container.innerHTML = 'Error loading data.'; 
    }
}

function loadInvoiceUI(e, keepAdminModalOpen = false) {
    if (!e) return; 
    document.getElementById('companyDetails').value = e.companyDetails || ''; 
    document.getElementById('invoiceNumber').value = e.invoiceNumber || ''; 
    const dateInput = document.getElementById('invoiceDate');
    dateInput.value = formatDate(e.date) || ''; 
    const d = new Date(e.date);
    if (!isNaN(d.getTime())) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        dateInput.setAttribute('data-raw', `${yyyy}-${mm}-${dd}`);
    }
    document.getElementById('phoneField').value = e.phone || ''; 
    document.getElementById('billTo').value = e.billTo || ''; 
    document.getElementById('shipTo').value = e.shipTo || ''; 
    document.getElementById('invoiceNote').value = e.note || ''; 
    document.getElementById('currencySelect').value = e.currency || 'BDT'; 
    document.getElementById('discountPercent').value = e.discountPercent || 0;
    const tbody = document.getElementById('invoiceBody'); tbody.innerHTML = '';
    if (e.items && Array.isArray(e.items)) { e.items.forEach(item => { addInvoiceRow(); const row = tbody.lastElementChild; row.querySelector('.product-name').value = item.name || ''; row.querySelector('.qty').value = item.qty || 1; row.querySelector('.rate').value = item.rate || 0; calculateRow(row.querySelector('.rate')); }); }
    const hm = document.getElementById('historyModal'); if(hm) hm.style.display = 'none';
    const shm = document.getElementById('sellHistoryModal'); if(shm) shm.style.display = 'none';
    if (!keepAdminModalOpen) {
        document.getElementById('adminModal').style.display = 'none'; 
    }
    autoResize(document.getElementById('companyDetails'));
}

async function showProducts() {
    document.querySelectorAll('.admin-section').forEach(s => s.style.display = 'none');
    document.getElementById('productSection').style.display = 'block';
    const tbody = document.getElementById('productTableBody');
    
    // Initialize form with one empty row if it's empty
    resetProductForm();

    const renderProductsTable = () => {
        const products = Object.values(globalProductMap);
        tbody.innerHTML = products.map(p => `<tr><td>${p.name}</td><td>BDT ${p.price || 0}</td><td><button class="btn btn-primary btn-sm edit-p" data-id="${p.id}">Edit</button> <button class="btn btn-danger btn-sm del-p" data-id="${p.id}">Del</button></td>`).join('');
        
        tbody.querySelectorAll('.edit-p').forEach(b => b.onclick = () => { 
            const p = globalProductMap[b.dataset.id]; 
            const formBody = document.getElementById('productFormBody');
            formBody.innerHTML = ''; // Clear all rows for edit
            addProductManagementRow(p.name, p.price, p.id);
            document.getElementById('cancelProductEditBtn').style.display = 'inline-block';
            document.getElementById('saveProductsBtn').textContent = 'Update Product';
            document.getElementById('addNewProductRowBtn').style.display = 'none'; // Hide new row btn during single edit
        });

        tbody.querySelectorAll('.del-p').forEach(b => b.onclick = async () => { 
            if (confirm('Delete this product?')) { 
                try { 
                    await updateDoc(doc(db, "products", b.dataset.id), { 
                        deleted: true, 
                        updatedAt: serverTimestamp() 
                    }); 
                    await incrementVersion('productVersion'); 
                    await showProducts(); 
                } catch (e) { alert("Error deleting!"); } 
            } 
        });
    };

    if (Object.keys(globalProductMap).length > 0) {
        renderProductsTable();
        refreshProductList().then(() => renderProductsTable()).catch(() => {});
        return;
    }

    tbody.innerHTML = '<tr><td colspan="3">Loading...</td></tr>';
    await refreshProductList();
    renderProductsTable();
}

function addProductManagementRow(name = '', price = '', id = '') {
    const tbody = document.getElementById('productFormBody');
    const row = document.createElement('tr');
    row.style.background = "transparent";
    row.innerHTML = `
        <td style="padding: 5px; background: transparent; border: none;"><input type="text" class="p-name" value="${name}" placeholder="Product Name" style="width: 100%; background: #0f172a; color: #f8fafc; border: 1px solid #334155; padding: 8px; border-radius: 6px;"></td>
        <td style="padding: 5px; background: transparent; border: none;"><input type="number" class="p-price" value="${price}" placeholder="0.00" step="0.01" style="width: 100%; background: #0f172a; color: #f8fafc; border: 1px solid #334155; padding: 8px; border-radius: 6px;"></td>
        <td style="text-align: center; padding: 5px; background: transparent; border: none;"><button class="btn btn-danger btn-sm remove-p-row" ${id ? 'disabled' : ''} style="padding: 5px 10px;">✕</button></td>
        <input type="hidden" class="p-id" value="${id}">
    `;
    tbody.appendChild(row);
    row.querySelector('.remove-p-row').onclick = function() { 
        if (tbody.children.length > 1) row.remove(); 
        else alert("At least one row is required!");
    };
}

async function saveProducts() {
    const rows = document.querySelectorAll('#productFormBody tr');
    const saveBtn = document.getElementById('saveProductsBtn');
    const productsToSave = [];
    
    let hasEmptyName = false;
    rows.forEach(row => {
        const name = row.querySelector('.p-name').value.trim();
        const price = parseFloat(row.querySelector('.p-price').value) || 0;
        const id = row.querySelector('.p-id').value;
        if (name) {
            productsToSave.push({ id, name, price });
        } else if (rows.length === 1 || id) {
            hasEmptyName = true;
        }
    });

    if (hasEmptyName && productsToSave.length === 0) return alert("Please enter a product name!");
    if (productsToSave.length === 0) return alert("No products to save!");

    saveBtn.disabled = true; 
    saveBtn.textContent = 'Saving...';
    
    try {
        for (const p of productsToSave) {
            const productData = { 
                name: p.name, 
                price: p.price, 
                updatedAt: serverTimestamp() 
            };
            if (p.id) {
                await updateDoc(doc(db, "products", p.id), productData);
            } else {
                await addDoc(collection(db, "products"), productData);
            }
        }
        
        await incrementVersion('productVersion');
        resetProductForm(); 
        await showProducts(); 
        alert("Saved successfully!");
    } catch (e) { 
        console.error("Save Error:", e);
        alert("Error saving!"); 
    } finally { 
        saveBtn.disabled = false; 
        saveBtn.textContent = 'Update Product List'; 
    }
}

function resetProductForm() { 
    const formBody = document.getElementById('productFormBody');
    formBody.innerHTML = '';
    addProductManagementRow();
    document.getElementById('cancelProductEditBtn').style.display = 'none';
    document.getElementById('saveProductsBtn').textContent = 'Update Product List';
    document.getElementById('addNewProductRowBtn').style.display = 'inline-block';
}

async function exportProductsTxt() {
    try {
        await syncProducts();
        let content = "";
        let count = 0;
        Object.values(globalProductMap).forEach(p => {
            if (p.name && !p.deleted) {
                content += `${p.name}\n${p.price ?? 0}\n\n`;
                count++;
            }
        });
        if (!count) return alert("No products to export.");
        const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `products_backup_${new Date().toISOString().split('T')[0]}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) { console.error("Export products error:", e); alert("Error exporting!"); }
}

async function importProductsTxt(event) {
    const file = event.target.files[0];
    if (!file) return;
    const status = document.getElementById('productImportStatus');
    status.textContent = '⏳ Importing...';
    try {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const toImport = parseProductsTxt(e.target.result);
                if (!toImport.length) {
                    status.textContent = '❌ No valid products found. Format: Product Name on one line, Price on next line, blank line between products.';
                    event.target.value = '';
                    return;
                }
                let count = 0;
                for (let i = 0; i < toImport.length; i += 450) {
                    const chunk = toImport.slice(i, i + 450);
                    const batch = writeBatch(db);
                    chunk.forEach(p => {
                        batch.set(doc(collection(db, "products")), {
                            name: p.name,
                            price: p.price,
                            updatedAt: serverTimestamp()
                        });
                    });
                    await batch.commit();
                    count += chunk.length;
                }
                await incrementVersions(['productVersion']);
                await refreshProductList();
                await showProducts();
                status.textContent = `✅ ${count} products imported.`;
                alert(`Imported ${count} products successfully`);
            } catch (err) {
                console.error("Import products error:", err);
                status.textContent = '❌ Error importing!';
                alert("Error importing products!");
            }
            event.target.value = '';
        };
        reader.onerror = () => {
            status.textContent = '❌ Error reading file!';
            event.target.value = '';
        };
        reader.readAsText(file, 'UTF-8');
    } catch (e) {
        status.textContent = '❌ Error importing!';
        event.target.value = '';
    }
}

async function showStock() {
    document.querySelectorAll('.admin-section').forEach(s => s.style.display = 'none');
    document.getElementById('stockSection').style.display = 'block';
    const tbody = document.getElementById('stockTableBody');

    const renderStockTable = (stocks) => {
        const products = Object.values(globalProductMap);
        tbody.innerHTML = products.map(p => `<tr><td>${p.name}</td><td>${stocks[p.id] || 0}</td><td><input type="number" class="st-up" data-id="${p.id}" style="width:80px"></td><td><button class="btn btn-primary btn-sm up-btn">Update</button></td>`).join('');
        tbody.querySelectorAll('.up-btn').forEach(b => b.onclick = async () => { 
            const input = b.closest('tr').querySelector('.st-up'); 
            const val = parseFloat(input.value) || 0; 
            if (val !== 0) { 
                const pid = input.dataset.id; 
                const newQty = (stocks[pid] || 0) + val;
                await dbUpdateStock({[pid]: newQty}); 
                globalStockMap[pid] = newQty; // Update local map immediately for UI
                await showStock(); 
            } 
        });
    };

    const hasCached = Object.keys(globalStockMap).length > 0 && Object.keys(globalProductMap).length > 0;
    if (hasCached) {
        renderStockTable(globalStockMap);
        dbFetchStock().then((refreshedStocks) => renderStockTable(refreshedStocks)).catch(() => {});
        return;
    }

    tbody.innerHTML = '<tr><td colspan="4">Loading...</td></tr>';
    try {
        const stocks = await dbFetchStock();
        renderStockTable(stocks);
    } catch(e) { tbody.innerHTML = '<tr><td colspan="4">Error occurred</td></tr>'; }
}

async function showAllUserDetails() {
    document.querySelectorAll('.admin-section').forEach(s => s.style.display = 'none');
    document.querySelectorAll('#adminModal .admin-modal-content > .admin-tab-container .admin-tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('allUserDetailsTabBtn').classList.add('active');
    document.getElementById('allUserDetailsSection').style.display = 'block';
    document.getElementById('userListSubSection').style.display = 'block';
    document.getElementById('singleUserDetailSubSection').style.display = 'none';
    
    const tbody = document.getElementById('allUsersDetailTableBody');
    
    try {
        const renderUsers = (users) => {
            tbody.innerHTML = users.map(u => {
                const totalSales = parseFloat(u.totalSales) || 0;
                const totalPaid = parseFloat(u.totalPaid) || 0;
                const due = totalSales - totalPaid;
                return `<tr>
                    <td>${u.id}</td>
                    <td>BDT ${totalSales.toFixed(2)}</td>
                    <td style="color: ${due > 0 ? '#f87171' : '#4ade80'}">BDT ${due.toFixed(2)}</td>
                    <td><button class="btn btn-primary btn-sm view-user-detail" data-id="${u.id}">View Details</button></td>
                </tr>`;
            }).join('');
            
            tbody.querySelectorAll('.view-user-detail').forEach(b => {
                b.onclick = () => openUserDetailView(b.dataset.id);
            });
        };
        
        const users = await getUsersWithAutoSync(ADMIN_USERS_CACHE, (freshUsers) => renderUsers(freshUsers));
        renderUsers(users);
    } catch (e) { tbody.innerHTML = '<tr><td colspan="4">Error loading users.</td></tr>'; }
}

async function openUserDetailView(userId) {
    currentDetailUserId = userId;
    document.getElementById('userListSubSection').style.display = 'none';
    document.getElementById('singleUserDetailSubSection').style.display = 'block';
    document.getElementById('detailViewUserName').textContent = `👤 User: ${userId}`;
    
    // Switch to default sub-tab
    document.querySelectorAll('.sub-admin-section').forEach(s => s.style.display = 'none');
    document.getElementById('subSectionShopInfo').style.display = 'block';
    document.querySelectorAll('#singleUserDetailSubSection .admin-tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('subTabShopInfo').classList.add('active');
    
    loadUserShopInfo(userId);
}

async function loadUserShopInfo(userId) {
    const tbody = document.getElementById('userShopInfoTableBody');
    tbody.innerHTML = '<table><td colspan="3">Loading...</td></tr>';
    
    try {
        // Check admin local cache first to save reads
        const cacheKey = `admin_cache_customers_${userId}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            renderShopInfo(JSON.parse(cached));

            // Background Auto Sync on Tab Click (Option #2): Always sync incremental changes
            (async () => {
                try {
                    const changed = await syncUserCustomersIncremental(userId);
                    await syncLocalCustomerVersionFromServer();
                    if (changed) {
                        const refreshed = JSON.parse(localStorage.getItem(cacheKey) || '[]');
                        renderShopInfo(refreshed);
                    }
                } catch(e) {}
            })();
            return;
        }
        
        await fetchUserShopInfoFromServer(userId, cacheKey);
        await syncLocalCustomerVersionFromServer();
    } catch (e) { tbody.innerHTML = '<td><td colspan="3">Error.</td></tr>'; }
}

async function fetchUserShopInfoFromServer(userId, cacheKey) {
    const q = query(collection(db, "customers"), where("user", "==", userId));
    const snap = await getDocs(q);
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    localStorage.setItem(cacheKey, JSON.stringify(data));
    renderShopInfo(data);
}

function renderShopInfo(data) {
    const tbody = document.getElementById('userShopInfoTableBody');
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4">No shop info found.</td></tr>';
        return;
    }

    // Sort alphabetically by name
    const sorted = [...data].sort((a, b) => (a.billTo || '').localeCompare(b.billTo || ''));

    tbody.innerHTML = sorted.map(c => `<tr>
        <td>${c.billTo || '-'}</td>
        <td>${c.shipTo || '-'}</td>
        <td>${c.phone || '-'}</td>
        <td>
            <button class="btn btn-danger btn-sm delete-customer-btn" data-id="${c.id}">🗑️ Del</button>
        </td>
    </tr>`).join('');

    tbody.querySelectorAll('.delete-customer-btn').forEach(btn => {
        btn.onclick = () => deleteCustomer(btn.dataset.id);
    });
}




async function deleteCustomer(docId) {
    if (!confirm('Are you sure you want to delete this customer?')) return;
    try {
        await deleteDoc(doc(db, "customers", docId));
        await incrementVersion('customerVersion');
        // Invalidate cache and refresh
        const cacheKey = `admin_cache_customers_${currentDetailUserId}`;
        localStorage.removeItem(cacheKey);
        await loadUserShopInfo(currentDetailUserId);
        alert('Customer deleted successfully!');
    } catch (e) {
        console.error('Error deleting customer:', e);
        alert('Error deleting customer!');
    }
}

async function deleteAllCustomers() {
    if (!confirm('Are you sure you want to delete ALL customers for this user? This cannot be undone!')) return;
    try {
        const q = query(collection(db, "customers"), where("user", "==", currentDetailUserId));
        const snap = await getDocs(q);
        const batch = writeBatch(db);
        snap.docs.forEach(d => {
            batch.delete(doc(db, "customers", d.id));
        });
        await batch.commit();
        await incrementVersion('customerVersion');
        // Invalidate cache and refresh
        const cacheKey = `admin_cache_customers_${currentDetailUserId}`;
        localStorage.removeItem(cacheKey);
        await loadUserShopInfo(currentDetailUserId);
        alert('All customers deleted successfully!');
    } catch (e) {
        console.error('Error deleting all customers:', e);
        alert('Error deleting all customers!');
    }
}

async function loadUserSalesHistory(userId, forceRefresh = false, isLoadMore = false) {
    const tbody = document.getElementById('userSalesHistoryTableBody');
    if (!isLoadMore) {
        userSalesHistoryLastDoc = null;
        userSalesHistoryHasMore = false;

        if (forceRefresh) {
            localStorage.removeItem(`admin_cache_sales_${userId}`);
            userSalesHistoryCache = [];
        }
    }

    try {
        if (!isLoadMore) {
            const cacheKey = `admin_cache_sales_${userId}`;
            const cached = localStorage.getItem(cacheKey);

            if (cached && !forceRefresh) {
                // ১) ক্যাশ থাকলে সাথে সাথে দেখাও
                const parsed = JSON.parse(cached);
                userSalesHistoryCache = sortSellHistoryCache(parsed);
                renderUserSalesHistory(userSalesHistoryCache.slice(0, USER_SALES_HISTORY_INITIAL_PAGE_SIZE), false);
                userSalesHistoryHasMore = userSalesHistoryCache.length > USER_SALES_HISTORY_INITIAL_PAGE_SIZE;
                updateUserSalesHistoryLoadMoreButton();

                // ২) ব্যাকগ্রাউন্ডে সবসময় Firebase থেকে নতুন ডাটা চেক করো
                (async () => {
                    try {
                        const changed = await syncUserSalesIncremental(userId);
                        await syncLocalMonitorVersionsFromServer();
                        if (changed) {
                            const refreshed = JSON.parse(localStorage.getItem(cacheKey) || '[]');
                            userSalesHistoryCache = sortSellHistoryCache(refreshed);
                            renderUserSalesHistory(userSalesHistoryCache.slice(0, USER_SALES_HISTORY_INITIAL_PAGE_SIZE), false);
                            userSalesHistoryHasMore = userSalesHistoryCache.length > USER_SALES_HISTORY_INITIAL_PAGE_SIZE;
                            updateUserSalesHistoryLoadMoreButton();
                        }
                    } catch(e) { console.warn('Background sales sync error:', e); }
                })();
                return;
            }

            // ক্যাশ নেই — সরাসরি সার্ভার থেকে লোড করো
            tbody.innerHTML = '<tr><td colspan="4">Loading...</td></tr>';
        }

        await fetchUserSalesFromServer(userId, isLoadMore);
        if (!isLoadMore) {
            await syncLocalMonitorVersionsFromServer();
        }
    } catch (e) {
        if (!isLoadMore) {
            tbody.innerHTML = '<tr><td colspan="4">Error.</td></tr>';
        }
    }
}

async function fetchUserSalesFromServer(userId, isLoadMore = false) {
    const cacheKey = `admin_cache_sales_${userId}`;
    try {
        const pageSize = isLoadMore ? USER_SALES_HISTORY_LOAD_MORE_SIZE : USER_SALES_HISTORY_INITIAL_PAGE_SIZE;
        let q = query(collection(db, "invoices"), where("user", "==", userId), orderBy("timestamp", "desc"), limit(pageSize));
        if (isLoadMore && userSalesHistoryLastDoc) {
            q = query(q, startAfter(userSalesHistoryLastDoc));
        }
        
        let snap;
        try {
            snap = await getDocs(q);
        } catch (err) {
            console.warn("OrderBy failed, falling back:", err);
            q = query(collection(db, "invoices"), where("user", "==", userId), limit(pageSize));
            if (isLoadMore && userSalesHistoryLastDoc) {
                q = query(q, startAfter(userSalesHistoryLastDoc));
            }
            snap = await getDocs(q);
        }
        
        const newData = snap.docs.map(d => ({...d.data(), id: d.id}));
        const sortedNewData = sortSellHistoryCache(newData);
        
        if (isLoadMore) {
            userSalesHistoryCache = sortSellHistoryCache([...userSalesHistoryCache, ...sortedNewData]);
            renderUserSalesHistory(userSalesHistoryCache, false);
        } else {
            userSalesHistoryCache = sortedNewData;
            localStorage.setItem(cacheKey, JSON.stringify(userSalesHistoryCache));
            renderUserSalesHistory(sortedNewData, false);
        }
        
        userSalesHistoryLastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
        userSalesHistoryHasMore = snap.docs.length === pageSize;
        updateUserSalesHistoryLoadMoreButton();
    } catch (e) {
        console.error("Fetch Sales History Error:", e);
        if (!isLoadMore) {
            document.getElementById('userSalesHistoryTableBody').innerHTML = '<tr><td colspan="4">Error fetching data.</td></tr>';
        }
    }
}

function updateUserSalesHistoryLoadMoreButton() {
    const container = document.getElementById('userSalesHistoryLoadMoreContainer');
    if (!container) return;
    if (userSalesHistoryHasMore) {
        container.innerHTML = '<button class="btn btn-secondary btn-sm" id="loadMoreUserSalesHistoryBtn">Load More</button>';
        document.getElementById('loadMoreUserSalesHistoryBtn').onclick = () => loadUserSalesHistory(currentDetailUserId, false, true);
    } else {
        container.innerHTML = '';
    }
}

function renderUserSalesHistory(data, append = false) {
    const tbody = document.getElementById('userSalesHistoryTableBody');
    if (!tbody) return;
    
    if (data.length === 0 && !append) { 
        tbody.innerHTML = '<tr><td colspan="4">No history.</td></tr>'; 
        return; 
    }
    
    const displayData = append ? data : sortSellHistoryCache(data);
    
    const rowsHtml = displayData.map(e => {
        const json = encodeURIComponent(JSON.stringify(e));
        return `<tr>
            <td>${formatDateTimeBD(e)}</td>
            <td>${e.invoiceNumber}</td>
            <td>${e.currency}${e.grandTotal}</td>
            <td>
                <button class="btn btn-primary btn-sm view-inv-sub" data-json="${json}">View</button>
                <button class="btn btn-success btn-sm print-inv-sub" data-json="${json}">🖨️ Print</button>
                <button class="btn btn-danger btn-sm del-inv-sub" data-id="${e.id}">Del</button>
            </td>
        </tr>`;
    }).join('');
    
    if (append) {
        tbody.insertAdjacentHTML('beforeend', rowsHtml);
    } else {
        tbody.innerHTML = rowsHtml;
    }
    
    // Bind actions to all buttons (in case of append, we need to re-bind or just bind the new ones - here we re-bind all for simplicity)
    tbody.querySelectorAll('.view-inv-sub').forEach(b => b.onclick = () => loadInvoiceUI(JSON.parse(decodeURIComponent(b.dataset.json))));
    tbody.querySelectorAll('.print-inv-sub').forEach(b => b.onclick = () => directPrintInvoice(JSON.parse(decodeURIComponent(b.dataset.json))));
    tbody.querySelectorAll('.del-inv-sub').forEach(b => b.onclick = () => deleteInvoiceWithRestore(b.dataset.id, () => loadUserSalesHistory(currentDetailUserId, true)));
}

function ensureMonitorLoadMoreContainer() {
    const tbody = document.getElementById('monitorTableBody');
    if (!tbody || document.getElementById('monitorLoadMoreContainer')) return;
    const container = document.createElement('div');
    container.id = 'monitorLoadMoreContainer';
    container.style.textAlign = 'center';
    container.style.padding = '10px';
    tbody.closest('table').after(container);
}

function buildMonitorRowHtml(e) {
    const json = encodeURIComponent(JSON.stringify(e));
    return `<tr style="height: 60px;">
        <td>${e.user || 'Unknown'}</td>
        <td>${formatDateTimeBD(e)}</td>
        <td>${e.invoiceNumber || ''}</td>
        <td>${e.currency || ''}${e.grandTotal || '0'}</td>
        <td>
            <button class="btn btn-primary btn-sm view-inv" data-json="${json}">View</button>
            <button class="btn btn-success btn-sm print-inv-admin" data-json="${json}">🖨️ Print</button>
            <button class="btn btn-danger btn-sm del-inv-admin" data-id="${e.id}">Delete</button>
        </td>
    </tr>`;
}

function bindMonitorRowActions(tbody) {
    tbody.querySelectorAll('.view-inv').forEach(b => b.onclick = () => loadInvoiceUI(JSON.parse(decodeURIComponent(b.dataset.json))));
    tbody.querySelectorAll('.print-inv-admin').forEach(b => b.onclick = () => directPrintInvoice(JSON.parse(decodeURIComponent(b.dataset.json))));
    tbody.querySelectorAll('.del-inv-admin').forEach(b => b.onclick = () => deleteInvoiceWithRestore(b.dataset.id, () => {
        removeMonitorCacheItem(b.dataset.id);
        showMonitor(false);
    }));
}

function renderMonitorTable(items, append = false) {
    const tbody = document.getElementById('monitorTableBody');
    if (!tbody) return;

    if (items.length === 0 && !append) {
        tbody.innerHTML = '<tr><td colspan="5">No data found</td></tr>';
        return;
    }

    const rowsHtml = items.map(buildMonitorRowHtml).join('');
    if (append) tbody.insertAdjacentHTML('beforeend', rowsHtml);
    else tbody.innerHTML = rowsHtml;
    bindMonitorRowActions(tbody);
}

function updateMonitorLoadMoreButton(hasMore) {
    const loadMoreBtnContainer = document.getElementById('monitorLoadMoreContainer');
    if (!loadMoreBtnContainer) return;
    if (hasMore) {
        loadMoreBtnContainer.innerHTML = '<button class="btn btn-secondary btn-sm" id="loadMoreMonitorBtn">Load More</button>';
        document.getElementById('loadMoreMonitorBtn').onclick = () => showMonitor(true);
    } else {
        loadMoreBtnContainer.innerHTML = '';
    }
}

async function fetchMonitorPageFromServer(isNext = false) {
    const cache = loadMonitorCache();
    let q = query(collection(db, "invoices"), orderBy("updatedAt", "desc"), limit(MONITOR_PAGE_SIZE));

    if (monitorLastDoc) {
        q = query(q, startAfter(monitorLastDoc));
    } else if (cache.length > 0) {
        const oldestCached = cache[cache.length - 1];
        if (oldestCached?.updatedAt?.toMillis) {
            q = query(q, startAfter(oldestCached.updatedAt));
        } else if (oldestCached?.updatedAt?.seconds != null) {
            q = query(q, startAfter(new Timestamp(oldestCached.updatedAt.seconds, oldestCached.updatedAt.nanoseconds || 0)));
        }
    }

    let snap;
    try {
        snap = await getDocs(q);
    } catch (err) {
        console.warn("OrderBy updatedAt failed, trying without orderBy:", err);
        q = query(collection(db, "invoices"), limit(MONITOR_PAGE_SIZE));
        if (monitorLastDoc) q = query(q, startAfter(monitorLastDoc));
        snap = await getDocs(q);
    }

    if (snap.empty && !isNext && monitorDisplayedCount === 0) {
        renderMonitorTable([]);
        updateMonitorLoadMoreButton(false);
        return;
    }

    if (snap.empty) {
        updateMonitorLoadMoreButton(false);
        return;
    }

    const pageItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMonitorTable(pageItems, isNext || monitorDisplayedCount > 0);
    monitorDisplayedCount += pageItems.length;
    monitorLastDoc = snap.docs[snap.docs.length - 1];
    updateMonitorLoadMoreButton(snap.docs.length === MONITOR_PAGE_SIZE);
}

async function showMonitor(isNext = false, forceRefresh = false) {
    document.querySelectorAll('.admin-section').forEach(s => s.style.display = 'none');
    const section = document.getElementById('monitorSection');
    if (section) section.style.display = 'block';

    const tbody = document.getElementById('monitorTableBody');
    if (!tbody) return;

    ensureMonitorLoadMoreContainer();

    if (forceRefresh) {
        invalidateMonitorCache();
        isNext = false;
    }

    if (!isNext) {
        monitorLastDoc = null;
        monitorServerMode = false;
        document.getElementById('monitorLoadMoreContainer').innerHTML = '';

        const cache = loadMonitorCache();
        if (cache.length > 0 && !forceRefresh) {
            monitorDisplayedCount = Math.min(cache.length, MONITOR_PAGE_SIZE);
            renderMonitorTable(cache.slice(0, monitorDisplayedCount));
            updateMonitorLoadMoreButton(monitorHasMoreToLoad(cache));

            // Background Auto Sync on Tab Click (Option #2): Always sync incremental changes
            (async () => {
                try {
                    const changed = await syncMonitorIncremental();
                    await syncLocalMonitorVersionsFromServer();
                    if (changed) {
                        const refreshed = loadMonitorCache();
                        monitorDisplayedCount = Math.min(refreshed.length, monitorDisplayedCount || MONITOR_PAGE_SIZE);
                        renderMonitorTable(refreshed.slice(0, monitorDisplayedCount));
                        updateMonitorLoadMoreButton(monitorHasMoreToLoad(refreshed));
                    }
                } catch(e) {}
            })();
            return;
        }

        tbody.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';

        try {
            await syncMonitorIncremental();
            await syncLocalMonitorVersionsFromServer();
            const syncedCache = loadMonitorCache();
            if (syncedCache.length > 0) {
                monitorDisplayedCount = Math.min(syncedCache.length, MONITOR_PAGE_SIZE);
                renderMonitorTable(syncedCache.slice(0, monitorDisplayedCount));
                updateMonitorLoadMoreButton(monitorHasMoreToLoad(syncedCache));
                return;
            }

            monitorServerMode = true;
            monitorDisplayedCount = 0;
            await fetchMonitorPageFromServer(false);
        } catch (e) {
            console.error("Monitor Error:", e);
            tbody.innerHTML = '<tr><td colspan="5">Error loading data. Check console.</td></tr>';
        }
        return;
    }

    try {
        const cache = loadMonitorCache();
        if (!monitorServerMode && monitorDisplayedCount < cache.length) {
            const nextBatch = cache.slice(monitorDisplayedCount, monitorDisplayedCount + MONITOR_PAGE_SIZE);
            monitorDisplayedCount += nextBatch.length;
            renderMonitorTable(nextBatch, true);
            if (monitorDisplayedCount >= cache.length && cache.length >= MONITOR_CACHE_MAX) {
                monitorServerMode = true;
            }
            updateMonitorLoadMoreButton(monitorServerMode ? true : monitorHasMoreToLoad(cache));
            return;
        }

        monitorServerMode = true;
        await fetchMonitorPageFromServer(true);
    } catch (e) {
        console.error("Monitor Error:", e);
    }
}

async function showUsers() {
    document.querySelectorAll('.admin-section').forEach(s => s.style.display = 'none');
    document.getElementById('userSection').style.display = 'block';
    const tbody = document.getElementById('userTableBody');
    try {
        const renderUserList = (users) => {
            tbody.innerHTML = users.map(u => {
                return `<tr><td>${u.id}</td><td>${u.password}</td><td>${u.id !== 'admin' ? `<button class="btn btn-danger btn-sm del-user" data-id="${u.id}">Delete</button>` : 'System'}</td>`;
            }).join('');
            tbody.querySelectorAll('.del-user').forEach(b => b.onclick = async () => {
                if (confirm('Delete this user?')) {
                    try {
                        await deleteDoc(doc(db, "users", b.dataset.id));
                        invalidateUsersCache();
                        showUsers();
                    } catch (err) { alert("Error deleting!"); }
                }
            });
        };
        const users = await getUsersWithAutoSync(ADMIN_USERS_CACHE, (freshUsers) => renderUserList(freshUsers));
        renderUserList(users);
    } catch (e) { tbody.innerHTML = '<tr><td colspan="3">Error occurred</td></tr>'; }
}

function showBackup() {
    document.querySelectorAll('.admin-section').forEach(s => s.style.display = 'none');
    document.getElementById('backupSection').style.display = 'block';
    document.getElementById('backupStatus').textContent = '';
}

function updateStorageMonitor() {
    if (currentUser !== 'admin') return;

    const grid = document.getElementById('storageDetailsGrid');
    const details = document.getElementById('storageKeyDetails');
    if (!grid) return;

    const categories = {};
    let totalBytes = 0;
    const allEntries = [];

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const val = localStorage.getItem(key) || '';
        const size = getStorageByteSize(key, val);
        totalBytes += size;
        const entry = { key, size, count: getCacheItemCount(key, val), storage: 'localStorage' };
        allEntries.push(entry);
        const cat = categorizeStorageKey(key);
        if (!categories[cat]) categories[cat] = { size: 0, count: 0, keys: 0 };
        categories[cat].size += size;
        categories[cat].count += entry.count;
        categories[cat].keys += 1;
    }

    for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (!key) continue;
        const val = sessionStorage.getItem(key) || '';
        const size = getStorageByteSize(key, val);
        totalBytes += size;
        const entry = { key, size, count: getCacheItemCount(key, val), storage: 'sessionStorage' };
        allEntries.push(entry);
        const cat = categorizeStorageKey(key);
        if (!categories[cat]) categories[cat] = { size: 0, count: 0, keys: 0 };
        categories[cat].size += size;
        categories[cat].count += entry.count;
        categories[cat].keys += 1;
    }

    const sortedCats = Object.entries(categories).sort((a, b) => b[1].size - a[1].size);
    grid.innerHTML = sortedCats.map(([name, data]) => {
        const sizeKB = (data.size / 1024).toFixed(2);
        const countLabel = data.count > 0 ? `${data.count} items` : `${data.keys} key${data.keys !== 1 ? 's' : ''}`;
        return `
            <div class="storage-category-card">
                <div class="storage-category-name">${name}</div>
                <div class="storage-category-size">${sizeKB} KB</div>
                <div class="storage-category-meta">${countLabel}</div>
            </div>
        `;
    }).join('') || '<div class="storage-category-card"><div class="storage-category-name">No cached data</div></div>';

    if (details) {
        const sortedEntries = [...allEntries].sort((a, b) => b.size - a.size);
        details.innerHTML = `
            <div class="storage-key-details-title">All cached keys (${sortedEntries.length})</div>
            <div class="storage-key-details-list">
                ${sortedEntries.map(e => `
                    <div class="storage-key-row">
                        <span class="storage-key-name" title="${e.key}">${e.key}</span>
                        <span class="storage-key-meta">${e.storage} · ${(e.size / 1024).toFixed(2)} KB${e.count ? ` · ${e.count} items` : ''}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
    const totalEl = document.getElementById('totalStorageUsage');
    if (totalEl) totalEl.textContent = `${totalMB} MB / 5.00 MB (${allEntries.length} keys)`;
}

async function remoteClearCache(userId) {
    if (!confirm(`Clear local storage for user: ${userId}? User will be forced to re-sync data.`)) return;
    const status = document.getElementById('remoteCacheStatus');
    status.textContent = '⏳ Sending clear command...';
    try {
        await updateDoc(doc(db, "users", userId), { forceClearCache: Date.now() });
        
        localStorage.removeItem(`admin_cache_customers_${userId}`);
        localStorage.removeItem(`admin_cache_sales_${userId}`);
        invalidateMonitorCache();

        status.textContent = '✅ Clear command sent & admin caches cleared!';
    } catch (e) { status.textContent = '❌ Error sending command.'; }
}

async function remoteRestoreCache(userId) {
    if (!confirm(`Force full sync for user: ${userId}? All saved customer, product and stock data will be re-downloaded to their device on next visit.`)) return;
    const status = document.getElementById('remoteCacheStatus');
    status.textContent = '⏳ Sending restore command...';
    try {
        await incrementVersions(['customerVersion', 'productVersion', 'stockVersion']);
        await updateDoc(doc(db, "users", userId), { forceClearCache: Date.now() });
        status.textContent = '✅ Restore command sent! User will re-sync all data on next visit.';
    } catch (e) { status.textContent = '❌ Error sending command.'; }
}

async function importUserShopInfo(event, userId) {
    const file = event.target.files[0];
    if (!file) return;
    if (!confirm(`Import shop info for user: ${userId}? This will merge with existing data.`)) return;
    
    try {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (!Array.isArray(data)) throw new Error("Invalid format");
                
                for (const item of data) {
                    const { id, updatedAt, ...rest } = item;
                    // Force current user ID to the imported data
                    const customerData = {
                        ...rest,
                        user: userId,
                        updatedAt: serverTimestamp()
                    };
                    
                    if (customerData.billTo) {
                        const custId = getCustomerDocId(userId, customerData.billTo);
                        await setDoc(doc(db, "customers", custId), customerData, { merge: true });
                    }
                }
                
                await incrementVersion('customerVersion');
                await updateDoc(doc(db, "users", userId), { forceClearCache: Date.now() });
                
                localStorage.removeItem(`admin_cache_customers_${userId}`);
                alert(`✅ ${data.length} shop records imported for ${userId}!`);
                loadUserShopInfo(userId);
            } catch (err) { alert("❌ Invalid JSON file!"); }
        };
        reader.readAsText(file);
    } catch (e) { alert("❌ Error reading file!"); }
    event.target.value = '';
}

async function downloadUserShopInfo(userId) {
    const cacheKey = `admin_cache_customers_${userId}`;
    const data = JSON.parse(localStorage.getItem(cacheKey) || "[]");
    if (data.length === 0) return alert("No shop info to download.");
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shop_info_${userId}_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function createUser() {
    const user = document.getElementById('newRegUsername').value.trim();
    const pass = document.getElementById('newRegPassword').value.trim();
    if (!user || !pass) return alert("Enter username and password!");
    try {
        await setDoc(doc(db, "users", user), {
            password: pass,
            totalSales: 0,
            totalPaid: 0,
            invoiceCount: 0,
            invoiceCounter: 0
        });
        invalidateUsersCache();
        document.getElementById('newRegUsername').value = '';
        document.getElementById('newRegPassword').value = '';
        showUsers();
        alert("New user created successfully!");
    } catch (e) { alert("Error creating user!"); }
}

async function deleteAllSales() {
    if (!confirm('Warning! All invoice data will be permanently deleted. Are you sure?')) return;
    const password = prompt('Enter admin password:');
    if (!password) return;
    try {
        const docSnap = await getDoc(doc(db, "users", "admin"));
        if (docSnap.exists() && String(docSnap.data().password) === String(password)) {
            const snap = await getDocs(collection(db, "invoices"));
            const batchPromises = snap.docs.map(d => deleteDoc(doc(db, "invoices", d.id)));
            await Promise.all(batchPromises);
            
            // Reset all users' accounting data
            const userSnap = await getDocs(collection(db, "users"));
            const userBatchPromises = userSnap.docs.map(d => updateDoc(doc(db, "users", d.id), {
                totalSales: 0,
                invoiceCount: 0,
                invoiceCounter: 0,
                forceClearCache: Date.now()
            }));
            await Promise.all(userBatchPromises);
            
            // Also delete all deleteRequests
            const deleteReqSnap = await getDocs(collection(db, "deleteRequests"));
            const deleteReqPromises = deleteReqSnap.docs.map(d => deleteDoc(doc(db, "deleteRequests", d.id)));
            await Promise.all(deleteReqPromises);

            // Reset dailyStats
            await deleteDoc(doc(db, "settings", "dailyStats"));
            
            await incrementVersions(['salesVersion', 'historyVersion']);
            invalidateUsersCache();
            invalidateMonitorCache();
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const k = localStorage.key(i);
                if (k && k.startsWith('admin_cache_sales_')) localStorage.removeItem(k);
                if (k && k.startsWith('admin_cache_customers_')) localStorage.removeItem(k);
            }
            clearAllAppLocalCaches({ keepAuth: true });
            showMonitor(false, true);
            alert("All sales data deleted!");
        } else alert("Wrong password!");
    } catch (e) { alert("Error deleting!"); }
}

async function forceGlobalSync() {
    if (!db) return alert("Firebase not connected!");
    const btn = document.getElementById('forceGlobalSyncBtn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '🔄 Syncing...';
    try {
        const configRef = doc(db, "settings", "appConfig");
        const snap = await getDoc(configRef);
        let versions = { productVersion: 1, stockVersion: 1, salesVersion: 1, historyVersion: 1, customerVersion: 1, settingsVersion: 1 };
        if (snap.exists()) {
            const data = snap.data();
            for (let k in versions) {
                versions[k] = (parseInt(data[k]) || 0) + 1;
            }
        }
        await setDoc(configRef, versions);
        clearAllAppLocalCaches({ keepAuth: true });
        alert("Global sync forced! All users will download fresh data on their next visit.");
        location.reload();
    } catch (e) {
        console.error("Global Sync Error:", e);
        alert("Error forcing global sync!");
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

async function exportAllData() {
    const status = document.getElementById('backupStatus');
    status.textContent = '⏳ Exporting database & local cache...';
    try {
        const backup = {
            metadata: {
                backupDate: new Date().toISOString(),
                exportedBy: currentUser,
                totalDocuments: 0,
                collections: FIRESTORE_BACKUP_COLLECTIONS,
                appVersion: 'v3'
            }
        };
        for (const colName of FIRESTORE_BACKUP_COLLECTIONS) {
            const snap = await getDocs(collection(db, colName));
            backup[colName] = snap.docs.map(d => serializeFirestoreForBackup({ id: d.id, ...d.data() }));
            backup.metadata.totalDocuments += snap.size;
        }
        backup.localBrowserCache = exportBrowserCacheSnapshot();
        backup.metadata.localCacheKeys =
            Object.keys(backup.localBrowserCache.localStorage).length +
            Object.keys(backup.localBrowserCache.sessionStorage).length;

        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `full_backup_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        status.textContent = `✅ Exported ${backup.metadata.totalDocuments} DB records + ${backup.metadata.localCacheKeys} local cache keys.`;
    } catch (e) {
        console.error('Export error:', e);
        status.textContent = '❌ Error exporting!';
    }
}

async function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!confirm('Warning! This will merge imported data with existing records. Documents with same IDs will be overwritten. Local browser cache from the backup will also be restored. Continue?')) return;
    const status = document.getElementById('backupStatus');
    status.textContent = '⏳ Importing data...';
    try {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const backup = JSON.parse(e.target.result);
                const backupData = backup.data || backup;
                const hasDbData = FIRESTORE_BACKUP_COLLECTIONS.some(c => Array.isArray(backupData[c]) && backupData[c].length > 0);
                if (!hasDbData && !backupData.localBrowserCache) {
                    throw new Error('Invalid backup file: no database collections or local cache found.');
                }
                let restoredCount = 0;

                for (const colName of FIRESTORE_BACKUP_COLLECTIONS) {
                    if (backupData[colName] && Array.isArray(backupData[colName])) {
                        restoredCount += await restoreBackupCollection(colName, backupData[colName]);
                    }
                }

                clearAllAppLocalCaches({ keepAuth: true });
                if (backupData.localBrowserCache) {
                    importBrowserCacheSnapshot(backupData.localBrowserCache, { skipAuth: true });
                }

                const configRef = doc(db, "settings", "appConfig");
                const snap = await getDoc(configRef);
                if (snap.exists()) {
                    const v = snap.data();
                    await updateDoc(configRef, {
                        productVersion: (v.productVersion || 0) + 1,
                        stockVersion: (v.stockVersion || 0) + 1,
                        salesVersion: (v.salesVersion || 0) + 1,
                        historyVersion: (v.historyVersion || 0) + 1,
                        customerVersion: (v.customerVersion || 0) + 1,
                        settingsVersion: (v.settingsVersion || 0) + 1
                    });
                } else {
                    await ensureAppConfig();
                }

                status.textContent = `✅ Restored ${restoredCount} DB records${backupData.localBrowserCache ? ' + local cache' : ''}.`;
                alert("Restore completed! Page will reload.");
                location.reload();
            } catch (err) {
                status.textContent = '❌ Invalid backup file!';
                console.error(err);
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    } catch (e) { status.textContent = '❌ Error importing!'; }
}

async function cleanAllData() {
    const includeProducts = document.getElementById('cleanIncludeProducts').checked;
    const status = document.getElementById('backupStatus');
    document.getElementById('cleanConfirmModal').style.display = 'none';
    status.textContent = '⏳ Deleting database & local cache...';
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
        } else {
            await ensureAppConfig();
        }

        clearAllAppLocalCaches({ keepAuth: true });
        invalidateUsersCache();

        status.textContent = '✅ Database & all local caches cleaned. (Admin preserved)';
        alert("Clean completed! All sales data removed. Admin user preserved. Page will reload.");
        location.reload();
    } catch (e) {
        console.error("Clean error:", e);
        status.textContent = '❌ Error deleting data!';
    }
}

async function openSellHistory(forceRefresh = false) {
    if (!db) return;
    const modal = document.getElementById('sellHistoryModal');
    const tbody = document.getElementById('sellHistoryBody');
    modal.style.display = 'flex';
    tbody.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';
    document.getElementById('sellHistoryInvoicesBody').innerHTML = '<tr><td colspan="5">Loading...</td></tr>';

    if (forceRefresh) {
        invalidateUsersCache();
        invalidateSellHistoryCache(currentUser);
    }

    try {
        const renderAccountingSummary = (usersData) => {
            let html = '';
            const targetUsers = (currentUser === 'admin') ? usersData : usersData.filter(u => u.id === currentUser);
            for (const user of targetUsers) {
                const invoiceCount = parseInt(user.invoiceCount, 10) || 0;
                const totalSales = parseFloat(user.totalSales) || 0;
                const totalPaid = parseFloat(user.totalPaid) || 0;
                const dueAmount = totalSales - totalPaid;
                html += `<tr>
                    <td>${user.id}</td>
                    <td>${invoiceCount}</td>
                    <td>BDT ${totalSales.toFixed(2)} ${currentUser === 'admin' ? `<button class="edit-accounting-btn" onclick="window.updateAccountingField('${user.id}', 'totalSales', ${totalSales})">✏️ Edit</button>` : ''}</td>
                    <td>BDT ${totalPaid.toFixed(2)} ${currentUser === 'admin' ? `<button class="edit-accounting-btn" onclick="window.updateAccountingField('${user.id}', 'totalPaid', ${totalPaid})">✏️ Edit</button>` : ''}</td>
                    <td style="color: ${dueAmount > 0 ? '#f87171' : '#4ade80'}; font-weight: bold;">BDT ${dueAmount.toFixed(2)}</td>
                </tr>`;
            }
            tbody.innerHTML = html || '<tr><td colspan="5">No data found</td></tr>';
        };
        const usersData = await getUsersWithAutoSync('cachedUsers_v1_1', (freshUsers) => renderAccountingSummary(freshUsers));
        renderAccountingSummary(usersData);
    } catch (e) { tbody.innerHTML = '<tr><td colspan="5">Error loading data</td></tr>'; }

    await loadSellHistoryInvoices(false, forceRefresh);
}

async function fetchPendingDeleteRequestIds(userId) {
    const pendingIds = new Set();
    try {
        const snap = await getDocs(query(collection(db, "deleteRequests"), where("status", "==", "pending")));
        snap.forEach(d => {
            if (d.data().user === userId) pendingIds.add(d.id);
        });
    } catch (e) {
        console.warn("Pending delete requests fetch failed:", e);
    }
    return pendingIds;
}

async function loadSellHistoryInvoices(isLoadMore = false, forceRefresh = false) {
    const tbody = document.getElementById('sellHistoryInvoicesBody');
    if (!tbody || !db) return;

    if (!isLoadMore) {
        sellHistoryLastDoc = null;
        document.getElementById('sellHistoryLoadMoreContainer').innerHTML = '';
        if (forceRefresh) invalidateSellHistoryCache(currentUser);
    }

    const pendingIds = await fetchPendingDeleteRequestIds(currentUser);

    if (!isLoadMore && !forceRefresh) {
        const cache = loadSellHistoryCache(currentUser);
        if (cache.items.length > 0) {
            renderSellHistoryInvoices(cache.items, pendingIds, false);
            updateSellHistoryLoadMoreButton(cache.items.length >= SELL_HISTORY_PAGE_SIZE);

            // Background Auto Sync on Tab Click (Option #2): Always check latest invoices
            (async () => {
                try {
                    const latest = cache.items[0];
                    const latestTs = latest?.timestamp ? (latest.timestamp.toMillis ? new Date(latest.timestamp.toMillis()) : new Date(latest.timestamp)) : new Date(0);
                    const qNew = query(
                        collection(db, "invoices"),
                        where("user", "==", currentUser),
                        where("timestamp", ">", latestTs),
                        orderBy("timestamp", "asc")
                    );
                    const snapNew = await getDocs(qNew);
                    if (!snapNew.empty) {
                        const newInvoices = snapNew.docs.map(d => ({ ...d.data(), id: d.id }));
                        let merged = [...newInvoices, ...cache.items];
                        const serverVersions = await getServerMonitorVersions();
                        saveSellHistoryCache(currentUser, merged, serverVersions.historyVersion);
                        const updatedCache = loadSellHistoryCache(currentUser);
                        renderSellHistoryInvoices(updatedCache.items, pendingIds, false);
                        updateSellHistoryLoadMoreButton(updatedCache.items.length >= SELL_HISTORY_PAGE_SIZE);
                    }
                } catch(e) {}
            })();
            return;
        }
    }

    if (!isLoadMore) {
        tbody.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';
    }

    try {
        let q = query(
            collection(db, "invoices"),
            where("user", "==", currentUser),
            orderBy("timestamp", "desc"),
            limit(SELL_HISTORY_PAGE_SIZE)
        );

        if (isLoadMore && sellHistoryLastDoc) {
            q = query(q, startAfter(sellHistoryLastDoc));
        } else if (isLoadMore) {
            const cache = loadSellHistoryCache(currentUser);
            const oldest = cache.items[cache.items.length - 1];
            if (oldest?.timestamp) {
                q = query(q, startAfter(oldest.timestamp));
            }
        }

        let snap;
        try {
            snap = await getDocs(q);
        } catch (err) {
            console.warn("Sell history orderBy failed, falling back:", err);
            q = query(collection(db, "invoices"), where("user", "==", currentUser), limit(SELL_HISTORY_PAGE_SIZE));
            if (isLoadMore && sellHistoryLastDoc) q = query(q, startAfter(sellHistoryLastDoc));
            snap = await getDocs(q);
        }

        if (snap.empty && !isLoadMore) {
            tbody.innerHTML = '<tr><td colspan="5">No invoices found.</td></tr>';
            updateSellHistoryLoadMoreButton(false);
            return;
        }

        if (snap.empty && isLoadMore) {
            updateSellHistoryLoadMoreButton(false);
            return;
        }

        const invoices = snap.docs.map(d => ({ ...d.data(), id: d.id }));

        if (!isLoadMore) {
            const serverVersions = await getServerMonitorVersions();
            saveSellHistoryCache(currentUser, invoices, serverVersions.historyVersion);
            saveLocalMonitorVersions(serverVersions.salesVersion, serverVersions.historyVersion);
            renderSellHistoryInvoices(invoices, pendingIds, false);
        } else {
            renderSellHistoryInvoices(invoices, pendingIds, true);
        }

        sellHistoryLastDoc = snap.docs[snap.docs.length - 1];
        updateSellHistoryLoadMoreButton(snap.docs.length === SELL_HISTORY_PAGE_SIZE);
    } catch (e) {
        console.error("Sell History Invoices Error:", e);
        if (!isLoadMore) tbody.innerHTML = '<tr><td colspan="5">Error loading invoices.</td></tr>';
    }
}

function buildSellHistoryRowHtml(e, pendingIds) {
    const json = encodeURIComponent(JSON.stringify(e));
    const isPending = pendingIds.has(e.id);
    const statusHtml = isPending
        ? '<span class="invoice-status-pending">Pending</span>'
        : '<span class="invoice-status-active">Active</span>';
    const deleteBtn = isPending
        ? '<button class="btn btn-secondary btn-sm" disabled>Pending</button>'
        : `<button class="btn btn-danger btn-sm del-inv-user" data-id="${e.id}">Delete</button>`;
    return `<tr>
        <td>${e.date || ''}</td>
        <td>${e.invoiceNumber || ''}</td>
        <td>${e.currency || ''}${e.grandTotal || '0'}</td>
        <td>${statusHtml}</td>
        <td>
            <button class="btn btn-primary btn-sm view-inv-user" data-json="${json}">View</button>
            ${deleteBtn}
        </td>
    </tr>`;
}

function bindSellHistoryRowActions(rows) {
    rows.forEach(row => {
        row.querySelectorAll('.view-inv-user').forEach(b => {
            b.onclick = () => {
                loadInvoiceUI(JSON.parse(decodeURIComponent(b.dataset.json)));
                document.getElementById('sellHistoryModal').style.display = 'none';
            };
        });
        row.querySelectorAll('.del-inv-user').forEach(b => {
            b.onclick = () => requestInvoiceDelete(b.dataset.id);
        });
    });
}

function renderSellHistoryInvoices(data, pendingIds, append = false) {
    const tbody = document.getElementById('sellHistoryInvoicesBody');
    if (!data.length && !append) {
        tbody.innerHTML = '<tr><td colspan="5">No invoices found.</td></tr>';
        return;
    }
    const rowsHtml = data.map(e => buildSellHistoryRowHtml(e, pendingIds)).join('');
    if (append) {
        const beforeCount = tbody.querySelectorAll('tr').length;
        tbody.insertAdjacentHTML('beforeend', rowsHtml);
        const newRows = [...tbody.querySelectorAll('tr')].slice(beforeCount);
        bindSellHistoryRowActions(newRows);
    } else {
        tbody.innerHTML = rowsHtml;
        bindSellHistoryRowActions([...tbody.querySelectorAll('tr')]);
    }
}

async function refreshSellHistoryPendingState() {
    const pendingIds = await fetchPendingDeleteRequestIds(currentUser);
    document.querySelectorAll('#sellHistoryInvoicesBody tr').forEach(row => {
        const delBtn = row.querySelector('.del-inv-user');
        if (!delBtn) return;
        const invoiceId = delBtn.dataset.id;
        if (!pendingIds.has(invoiceId)) return;
        const statusCell = row.cells[3];
        if (statusCell) statusCell.innerHTML = '<span class="invoice-status-pending">Pending</span>';
        delBtn.outerHTML = '<button class="btn btn-secondary btn-sm" disabled>Pending</button>';
    });
}

async function requestInvoiceDelete(invoiceId) {
    if (!confirm('Are you sure you want to request deletion of this invoice? Admin approval is required.')) return;
    try {
        const existing = await getDoc(doc(db, "deleteRequests", invoiceId));
        if (existing.exists() && existing.data().status === 'pending') {
            return alert('This invoice already has a pending delete request.');
        }
        const invSnap = await getDoc(doc(db, "invoices", invoiceId));
        if (!invSnap.exists()) return alert('Invoice not found!');
        const inv = invSnap.data();
        if (inv.user !== currentUser) return alert('You can only delete your own invoices.');

        await setDoc(doc(db, "deleteRequests", invoiceId), {
            invoiceId,
            user: currentUser,
            invoiceNumber: inv.invoiceNumber || '',
            date: inv.date || '',
            grandTotal: inv.grandTotal || 0,
            currency: inv.currency || '',
            status: 'pending',
            requestedAt: serverTimestamp()
        });
        alert('Delete request submitted! Waiting for admin approval.');
        await refreshSellHistoryPendingState();
    } catch (e) {
        console.error("Delete Request Error:", e);
        alert('Failed to submit delete request.');
    }
}

async function fetchAllPendingDeleteRequests() {
    try {
        const q = query(collection(db, "deleteRequests"), where("status", "==", "pending"));
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
        console.warn("Fetch pending delete requests failed:", e);
        return [];
    }
}

async function updateDeleteNotificationBadge() {
    // Legacy function - logic is now handled in startDeleteNotifPolling via onSnapshot
}

function startDeleteNotifPolling() {
    if (typeof deleteNotifPollInterval === 'function') deleteNotifPollInterval();
    else if (deleteNotifPollInterval) clearInterval(deleteNotifPollInterval);
    
    if (currentUser !== 'admin') return;
    
    const q = query(collection(db, "deleteRequests"), where("status", "==", "pending"));
    deleteNotifPollInterval = onSnapshot(q, (snap) => {
        const count = snap.docs.length;
        const badge = document.getElementById('deleteNotifBadge');
        if (badge) {
            if (count > 0) {
                badge.textContent = count > 99 ? '99+' : String(count);
                badge.style.display = 'inline-flex';
            } else {
                badge.style.display = 'none';
            }
        }
    }, (e) => {
        console.warn("Delete requests snapshot error:", e);
    });
}

async function openDeleteNotificationPanel() {
    const modal = document.getElementById('deleteNotifModal');
    const list = document.getElementById('deleteNotifList');
    if (!modal || !list) return;
    modal.style.display = 'flex';
    list.innerHTML = '<p>Loading...</p>';

    const requests = await fetchAllPendingDeleteRequests();
    if (!requests.length) {
        list.innerHTML = '<p class="delete-notif-empty">No pending delete requests.</p>';
        return;
    }

    list.innerHTML = requests.map(r => `
        <div class="delete-notif-item">
            <div class="delete-notif-info">
                <strong>👤 ${r.user}</strong>
                <span>Invoice: ${r.invoiceNumber || 'N/A'}</span>
                <span>Date: ${r.date || ''}</span>
                <span>Amount: ${r.currency || ''}${r.grandTotal || '0'}</span>
            </div>
            <div class="delete-notif-actions">
                <button class="btn btn-success btn-sm approve-del-req" data-id="${r.invoiceId || r.id}">✓ Approve</button>
                <button class="btn btn-danger btn-sm reject-del-req" data-id="${r.invoiceId || r.id}">✗ Reject</button>
            </div>
        </div>
    `).join('');

    list.querySelectorAll('.approve-del-req').forEach(b => b.onclick = () => approveDeleteRequest(b.dataset.id));
    list.querySelectorAll('.reject-del-req').forEach(b => b.onclick = () => rejectDeleteRequest(b.dataset.id));
}

async function approveDeleteRequest(invoiceId) {
    if (!confirm('Approve and permanently delete this invoice? Stock will be restored and user accounting will be updated.')) return;
    await deleteInvoiceWithRestore(invoiceId, async () => {
        await updateDeleteNotificationBadge();
        showMonitor(false, true);
        const requests = await fetchAllPendingDeleteRequests();
        if (requests.length) openDeleteNotificationPanel();
        else document.getElementById('deleteNotifModal').style.display = 'none';
    }, true);
}

async function rejectDeleteRequest(invoiceId) {
    if (!confirm('Reject this delete request? The invoice will remain active.')) return;
    try {
        await deleteDoc(doc(db, "deleteRequests", invoiceId));
        alert('Delete request rejected.');
        updateDeleteNotificationBadge();
        openDeleteNotificationPanel();
    } catch (e) {
        console.error("Reject delete error:", e);
        alert('Failed to reject request.');
    }
}

window.updateAccountingField = async (userId, field, currentVal) => {
    const input = prompt(`Enter new amount (Use + or - to adjust):`, currentVal);
    if (input === null || input.trim() === "") return;
    let amount; const trimmedInput = input.trim();
    if (trimmedInput.startsWith('+')) amount = (parseFloat(currentVal) || 0) + parseFloat(trimmedInput.substring(1));
    else if (trimmedInput.startsWith('-')) amount = (parseFloat(currentVal) || 0) - parseFloat(trimmedInput.substring(1));
    else amount = parseFloat(trimmedInput);
    if (isNaN(amount)) return alert("Enter a valid number!");
    try {
        await updateDoc(doc(db, "users", userId), { [field]: amount });
        invalidateUsersCache();
        alert("Updated successfully!"); openSellHistory();
    } catch (e) { alert("Update failed!"); }
};

async function directPrintInvoice(invoiceData) {
    if (!invoiceData) return;
    const originalUser = document.getElementById('usernameDisplay').textContent;
    const adminModalDisplay = document.getElementById('adminModal').style.display; // Remember if admin modal was open
    try {
        document.getElementById('usernameDisplay').textContent = invoiceData.user || 'Unknown';
        loadInvoiceUI(invoiceData, true); // Pass true to keep admin modal open
        openPrintDialog(() => {
            document.getElementById('usernameDisplay').textContent = originalUser;
            document.getElementById('adminModal').style.display = adminModalDisplay; // Restore admin modal state
        });
    } catch (e) { alert("Print failed!"); document.getElementById('usernameDisplay').textContent = originalUser; document.getElementById('adminModal').style.display = adminModalDisplay; }
}


function setupInvoiceDateEvents() {
    const invoiceDate = document.getElementById('invoiceDate');
    if (invoiceDate) {
        invoiceDate.addEventListener('focus', function() {
            this.type = 'date';
            if (this.getAttribute('data-raw')) this.value = this.getAttribute('data-raw');
        });
        invoiceDate.addEventListener('blur', function() {
            if (this.value && this.type === 'date') {
                this.setAttribute('data-raw', this.value);
                const d = this.value;
                this.type = 'text';
                this.value = formatDate(d);
            } else if (!this.value) {
                this.type = 'text';
            }
        });
    }
}

// =============================================================================
// CUSTOMER LEDGER (TALLY-STYLE) — দিলাম / নিলাম খাতা
// =============================================================================

let editingCustomerId = null; // for edit customer modal
let adminLedgerCurrentUserId = null; // admin: which user is being viewed
let adminLedgerCurrentUserName = '';

// Route: admin → admin ledger, user → user ledger
function openCustomerLedger() {
    if (currentUser === 'admin') {
        openAdminLedger();
    } else {
        ledgerIsAdminView = false;
        document.getElementById('customerLedgerModal').style.display = 'flex';
        loadCustomerLedger();
    }
}

// ---- 🔄 Ledger Refresh: cache clear করে Firebase থেকে নতুন data নেওয়া ----
async function ledgerForceRefresh() {
    const btn = document.getElementById('ledgerRefreshBtn');
    btn.classList.add('spinning');
    btn.disabled = true;
    try {
        // শুধু এই function-এর cache clear করা হচ্ছে — বাকি app cache অক্ষত থাকবে
        await appCache.remove(`${CACHE_KEYS.CUSTOMERS}_${currentUser}`);
        localStorage.removeItem(`full_cust_sync_done_${currentUser}_v1`);
        globalCustomerList = [];

        // Firebase থেকে full fetch
        const q = query(collection(db, 'customers'), where('user', '==', currentUser));
        const snap = await getDocs(q);
        globalCustomerList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        await appCache.set(`${CACHE_KEYS.CUSTOMERS}_${currentUser}`, globalCustomerList);
        localStorage.setItem(`full_cust_sync_done_${currentUser}_v1`, 'true');

        // UI রিফ্রেশ
        loadCustomerLedger(document.getElementById('ledgerSearchInput').value);
    } catch (e) {
        alert('রিফ্রেশ করতে সমস্যা হয়েছে: ' + e.message);
        console.error('Ledger force refresh error:', e);
    } finally {
        btn.classList.remove('spinning');
        btn.disabled = false;
    }
}

// ---- 🔍 Auto-Detect: Firebase-এ যেসব কাস্টমার local cache-এ নেই তাদের খুঁজে বের করা ----
async function autoDetectMissingCustomers() {
    const btn = document.getElementById('autoDetectCustomerBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '⏳ চেক হচ্ছে...';
    btn.disabled = true;

    try {
        // Firebase থেকে এই user-এর সব কাস্টমার আনা
        const q = query(collection(db, 'customers'), where('user', '==', currentUser));
        const snap = await getDocs(q);
        const firebaseCusts = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Local cache-এ কোনগুলো নেই তা বের করা
        const localIds = new Set(globalCustomerList.map(c => c.id));
        const missing = firebaseCusts.filter(c => !localIds.has(c.id));

        if (missing.length === 0) {
            alert('✅ সব কাস্টমার খাতায় আছেন। কোনো বাদ পড়া কাস্টমার নেই।');
            return;
        }

        // নতুন কাস্টমারগুলো cache-এ যোগ করা
        const merged = [...globalCustomerList];
        missing.forEach(c => {
            if (!localIds.has(c.id)) merged.push(c);
        });
        globalCustomerList = merged;
        await appCache.set(`${CACHE_KEYS.CUSTOMERS}_${currentUser}`, globalCustomerList);

        // UI রিফ্রেশ করা
        loadCustomerLedger(document.getElementById('ledgerSearchInput').value);

        // প্রতিটি missing কাস্টমারের profile একে একে দেখানো
        alert(`✅ ${missing.length} জন বাদ পড়া কাস্টমার পাওয়া গেছে। এখন তাদের প্রোফাইল দেখানো হবে।`);
        for (const cust of missing) {
            document.getElementById('customerLedgerModal').style.display = 'none';
            ledgerIsAdminView = false;
            await openCustomerProfile(cust.id, false);
            // user প্রতিটি profile দেখে close করলে পরেরটা দেখাবে
            await new Promise(resolve => {
                const backBtn = document.getElementById('backToLedgerBtn');
                const originalClick = backBtn.onclick;
                backBtn.onclick = () => {
                    backBtn.onclick = originalClick;
                    document.getElementById('customerProfileModal').style.display = 'none';
                    resolve();
                };
            });
        }
        document.getElementById('customerLedgerModal').style.display = 'flex';

    } catch (e) {
        alert('অটো ডিটেক্ট করতে সমস্যা হয়েছে: ' + e.message);
        console.error('Auto detect error:', e);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}


// =============================================================================
// ADMIN CUSTOMER LEDGER — User List → Customer Cards
// =============================================================================

async function openAdminLedger() {
    adminLedgerCurrentUserId = null;
    adminLedgerCurrentUserName = '';
    document.getElementById('adminLedgerModal').style.display = 'flex';
    document.getElementById('adminLedgerTitle').textContent = '📒 সকল ইউজারের খাতা';
    document.getElementById('adminLedgerBackBtn').style.display = 'none';
    document.getElementById('adminLedgerSearch').style.display = 'none';
    document.getElementById('adminLedgerSummary').style.display = 'none';
    document.getElementById('adminLedgerRefreshBtn').style.display = 'inline-flex'; // user list-এও refresh দেখাবে
    loadAdminLedgerUserList();
}



async function loadAdminLedgerUserList() {
    const container = document.getElementById('adminLedgerContent');
    container.innerHTML = '<div class="khata-loading">ইউজার লোড হচ্ছে...</div>';

    try {
        // Use cached user list
        const users = await getUsersWithAutoSync(ADMIN_USERS_CACHE, () => {
            // Only refresh user list if admin is still on user list view (not inside a customer list)
            if (!adminLedgerCurrentUserId) loadAdminLedgerUserList();
        });
        const normalUsers = users.filter(u => u.id !== 'admin');

        if (!normalUsers.length) {
            container.innerHTML = '<div class="khata-empty">কোনো ইউজার পাওয়া যায়নি।</div>';
            return;
        }

        // Fetch summary for each user (from their admin cache)
        container.innerHTML = normalUsers.map(u => {
            const custList = JSON.parse(localStorage.getItem(`admin_cache_customers_${u.id}`) || '[]');
            const totalDue = custList.reduce((s, c) =>
                s + Math.max(0, (parseFloat(c.totalSales) || 0) - (parseFloat(c.totalPaid) || 0)), 0);
            const custCount = custList.length;
            return `<div class="khata-card khata-card-${totalDue > 0 ? 'due' : 'clear'} admin-ledger-user-card" data-userid="${u.id}">
                <div class="khata-card-left">
                    <div class="khata-avatar ${totalDue > 0 ? 'avatar-due' : 'avatar-clear'}">
                        ${u.id.slice(0,2).toUpperCase()}
                    </div>
                    <div class="khata-card-info">
                        <div class="khata-card-name">${u.id}</div>
                        <div class="khata-card-phone">${custCount} জন কাস্টমার</div>
                    </div>
                </div>
                <div class="khata-card-right">
                    <div class="khata-card-bal-label">মোট পাব</div>
                    <div class="khata-card-bal ${totalDue > 0 ? 'bal-due' : 'bal-ok'}">৳${Math.round(totalDue).toLocaleString('bn-BD')}</div>
                    <div class="khata-card-arrow">›</div>
                </div>
            </div>`;
        }).join('');

        container.querySelectorAll('.admin-ledger-user-card').forEach(card => {
            card.onclick = () => openAdminLedgerUserCustomers(card.dataset.userid);
        });

    } catch (e) {
        container.innerHTML = '<div class="khata-empty">লোড করতে সমস্যা হয়েছে।</div>';
        console.error('Admin ledger user list error:', e);
    }
}

async function openAdminLedgerUserCustomers(userId) {
    adminLedgerCurrentUserId = userId;
    adminLedgerCurrentUserName = userId;
    currentDetailUserId = userId; // needed for adminEditCustomerBalance

    document.getElementById('adminLedgerTitle').textContent = `📒 ${userId} এর কাস্টমার`;
    document.getElementById('adminLedgerBackBtn').style.display = 'inline-flex';
    document.getElementById('adminLedgerSearch').style.display = 'block';
    document.getElementById('adminLedgerSearch').value = '';
    document.getElementById('adminLedgerSummary').style.display = 'flex';
    document.getElementById('adminLedgerRefreshBtn').style.display = 'inline-flex'; // Refresh বাটন দেখানো

    loadAdminLedgerCustomers(userId, '');

    // Live search
    document.getElementById('adminLedgerSearch').oninput = debounce(function() {
        loadAdminLedgerCustomers(userId, this.value);
    }, 350);
}


async function loadAdminLedgerCustomers(userId, searchQuery = '') {
    const container = document.getElementById('adminLedgerContent');
    const summaryEl = document.getElementById('adminLedgerSummary');
    container.innerHTML = '<div class="khata-loading">লোড হচ্ছে...</div>';

    // Fetch from server (or cache)
    try {
        const cacheKey = `admin_cache_customers_${userId}`;
        let customers = [];
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            customers = JSON.parse(cached);
            // ⚠️ Background refresh সরানো হয়েছে — Admin প্রতিটি user দেখলে
            // Firebase read হওয়া বন্ধ করা হয়েছে। Cache থেকে সরাসরি দেখাবে।
            // প্রয়োজনে Admin আলাদা Refresh বাটন দিয়ে sync করতে পারবে।
        } else {
            const q = query(collection(db, 'customers'), where('user', '==', userId));
            const snap = await getDocs(q);
            customers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            localStorage.setItem(cacheKey, JSON.stringify(customers));
        }

        // Filter by search
        if (searchQuery.trim()) {
            const sq = searchQuery.trim().toLowerCase();
            customers = customers.filter(c =>
                (c.billTo || '').toLowerCase().includes(sq) ||
                (c.phone || '').includes(sq)
            );
        }

        // Sort by balance desc
        customers.sort((a, b) => {
            const ba = (parseFloat(a.totalSales)||0) - (parseFloat(a.totalPaid)||0);
            const bb = (parseFloat(b.totalSales)||0) - (parseFloat(b.totalPaid)||0);
            return bb - ba;
        });

        // Summary
        const totalSales = customers.reduce((s, c) => s + (parseFloat(c.totalSales)||0), 0);
        const totalPaid  = customers.reduce((s, c) => s + (parseFloat(c.totalPaid)||0),  0);
        const totalBal   = totalSales - totalPaid;
        summaryEl.innerHTML = `
            <div class="khata-strip-item">
                <span class="khata-strip-label">মোট বিক্রয়</span>
                <span class="khata-strip-val" style="color:#60a5fa;">৳${Math.round(totalSales).toLocaleString('bn-BD')}</span>
            </div>
            <div class="khata-strip-divider"></div>
            <div class="khata-strip-item">
                <span class="khata-strip-label">মোট পাব</span>
                <span class="khata-strip-val" style="color:${totalBal > 0 ? '#f87171' : '#4ade80'};">৳${Math.round(totalBal).toLocaleString('bn-BD')}</span>
            </div>
            <div class="khata-strip-divider"></div>
            <div class="khata-strip-item">
                <span class="khata-strip-label">কাস্টমার</span>
                <span class="khata-strip-val" style="color:#c084fc;">${customers.length} জন</span>
            </div>
        `;

        if (!customers.length) {
            container.innerHTML = `<div class="khata-empty">📭<br>${searchQuery ? 'কোনো কাস্টমার পাওয়া যায়নি।' : 'এই ইউজারের কোনো কাস্টমার নেই।'}</div>`;
            return;
        }

        container.innerHTML = customers.map(c => {
            const sales = parseFloat(c.totalSales) || 0;
            const paid  = parseFloat(c.totalPaid)  || 0;
            const bal   = sales - paid;
            const hasDue = bal > 0;
            const initials = (c.billTo || '?').trim().slice(0, 2).toUpperCase();
            return `<div class="khata-card ${hasDue ? 'khata-card-due' : 'khata-card-clear'} admin-cust-card" data-id="${c.id}">
                <div class="khata-card-left">
                    <div class="khata-avatar ${hasDue ? 'avatar-due' : 'avatar-clear'}">${initials}</div>
                    <div class="khata-card-info">
                        <div class="khata-card-name">${c.billTo || ''}</div>
                        <div class="khata-card-phone">${c.phone || ''}</div>
                        ${c.shipTo ? `<div class="khata-card-addr">📍 ${c.shipTo}</div>` : ''}
                    </div>
                </div>
                <div class="khata-card-right">
                    <div class="khata-card-bal-label">${hasDue ? 'পাব' : 'পরিষ্কার'}</div>
                    <div class="khata-card-bal ${hasDue ? 'bal-due' : 'bal-ok'}">৳${Math.round(Math.abs(bal)).toLocaleString('bn-BD')}</div>
                    <div class="khata-card-arrow">›</div>
                </div>
            </div>`;
        }).join('');

        container.querySelectorAll('.admin-cust-card').forEach(card => {
            card.onclick = () => openAdminCustProfileFromLedger(card.dataset.id);
        });

    } catch (e) {
        container.innerHTML = '<div class="khata-empty">লোড করতে সমস্যা হয়েছে।</div>';
        console.error('Admin ledger customers error:', e);
    }
}

async function openAdminCustProfileFromLedger(custId) {
    // Use the existing profile modal but mark as admin + from admin ledger
    ledgerIsAdminView = true;
    await openCustomerProfile(custId, true);
    // Override back button to go back to admin ledger customer list
    document.getElementById('backToLedgerBtn').onclick = () => {
        document.getElementById('customerProfileModal').style.display = 'none';
        document.getElementById('adminLedgerModal').style.display = 'flex';
    };
}



async function loadCustomerLedger(searchQuery = '') {
    const container = document.getElementById('customerLedgerBody');
    const summaryBar = document.getElementById('ledgerSummaryBar');
    container.innerHTML = '<div class="khata-loading">লোড হচ্ছে...</div>';

    // One-time full fetch: শুধু প্রথমবার localStorage flag না থাকলে Firebase read করবে
    // এরপর globalCustomerList ইতিমধ্যে syncAppData() দিয়ে আপ-টু-ডেট থাকে
    const fullSyncFlag = `full_cust_sync_done_${currentUser}_v1`;
    if (!localStorage.getItem(fullSyncFlag)) {
        try {
            const q = query(collection(db, 'customers'), where('user', '==', currentUser));
            const snap = await getDocs(q);
            if (!snap.empty) {
                globalCustomerList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                await appCache.set(`${CACHE_KEYS.CUSTOMERS}_${currentUser}`, globalCustomerList);
            }
            localStorage.setItem(fullSyncFlag, 'true');
        } catch (e) {
            console.warn('Full customer fetch error:', e);
            // fallback: শুধু cache থেকে চলবে, extra Firebase call নয়
        }
    }
    // ⚠️ এখানে আর syncCustomers() call করা হচ্ছে না —
    // প্রতিবার Ledger খুললে বা search করলে Firebase read হওয়া বন্ধ করা হয়েছে।
    // globalCustomerList app startup-এ syncAppData() দিয়ে আগেই sync হয়ে থাকে।

    let customers = [...globalCustomerList];


    if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        customers = customers.filter(c =>
            (c.billTo || '').toLowerCase().includes(q) ||
            (c.phone || '').includes(q)
        );
    }

    // Sort: highest balance (due) first, then alphabetical
    customers.sort((a, b) => {
        const balA = (parseFloat(a.totalSales) || 0) - (parseFloat(a.totalPaid) || 0);
        const balB = (parseFloat(b.totalSales) || 0) - (parseFloat(b.totalPaid) || 0);
        if (balB !== balA) return balB - balA;
        return (a.billTo || '').localeCompare(b.billTo || '');
    });

    // Summary strip
    const totalSales = customers.reduce((s, c) => s + (parseFloat(c.totalSales) || 0), 0);
    const totalPaid  = customers.reduce((s, c) => s + (parseFloat(c.totalPaid)  || 0), 0);
    const totalBal   = totalSales - totalPaid;
    summaryBar.innerHTML = `
        <div class="khata-strip-item">
            <span class="khata-strip-label">মোট বিক্রয়</span>
            <span class="khata-strip-val" style="color:#60a5fa;">৳${Math.round(totalSales).toLocaleString('bn-BD')}</span>
        </div>
        <div class="khata-strip-divider"></div>
        <div class="khata-strip-item">
            <span class="khata-strip-label">মোট নিলাম</span>
            <span class="khata-strip-val" style="color:#4ade80;">৳${Math.round(totalPaid).toLocaleString('bn-BD')}</span>
        </div>
        <div class="khata-strip-divider"></div>
        <div class="khata-strip-item">
            <span class="khata-strip-label">মোট পাব</span>
            <span class="khata-strip-val" style="color:${totalBal > 0 ? '#f87171' : '#4ade80'};">৳${Math.round(totalBal).toLocaleString('bn-BD')}</span>
        </div>
    `;

    if (!customers.length) {
        container.innerHTML = `
            <div class="khata-empty">
                <div style="font-size:2.5rem;margin-bottom:12px;">📭</div>
                <div>${searchQuery ? 'কোনো কাস্টমার পাওয়া যায়নি।' : 'এখনো কোনো কাস্টমার নেই।'}</div>
                ${!searchQuery ? '<div style="margin-top:8px;opacity:0.6;font-size:0.85rem;">+ নতুন কাস্টমার বাটনে ক্লিক করুন</div>' : ''}
            </div>`;
        return;
    }

    container.innerHTML = customers.map(c => {
        const sales = parseFloat(c.totalSales) || 0;
        const paid  = parseFloat(c.totalPaid)  || 0;
        const bal   = sales - paid;
        const hasDue = bal > 0;
        const initials = (c.billTo || '?').trim().slice(0, 2).toUpperCase();
        return `<div class="khata-card ${hasDue ? 'khata-card-due' : 'khata-card-clear'}" data-id="${c.id}">
            <div class="khata-card-left">
                <div class="khata-avatar ${hasDue ? 'avatar-due' : 'avatar-clear'}">${initials}</div>
                <div class="khata-card-info">
                    <div class="khata-card-name">${c.billTo || ''}</div>
                    <div class="khata-card-phone">${c.phone || ''}</div>
                    ${c.shipTo ? `<div class="khata-card-addr">📍 ${c.shipTo}</div>` : ''}
                </div>
            </div>
            <div class="khata-card-right">
                <div class="khata-card-bal-label">${hasDue ? 'পাব' : 'নিষ্পত্তি'}</div>
                <div class="khata-card-bal ${hasDue ? 'bal-due' : 'bal-ok'}">৳${Math.round(Math.abs(bal)).toLocaleString('bn-BD')}</div>
                <div class="khata-card-arrow">›</div>
            </div>
        </div>`;
    }).join('');

    // Bind click
    container.querySelectorAll('.khata-card').forEach(card => {
        card.onclick = () => openCustomerProfile(card.dataset.id, false);
    });
}

async function openCustomerProfile(custId, isAdmin = false) {
    currentLedgerCustId = custId;
    ledgerIsAdminView = isAdmin;
    document.getElementById('customerProfileModal').style.display = 'flex';

    document.getElementById('customerProfileInfo').innerHTML = '<div class="khata-loading">লোড হচ্ছে...</div>';
    document.getElementById('customerTransactionBody').innerHTML = '';
    document.getElementById('profileSummaryBar').innerHTML = '';

    // Load data
    let custData = null;
    if (isAdmin) {
        const cached = localStorage.getItem(`admin_cache_customers_${currentDetailUserId}`);
        if (cached) custData = JSON.parse(cached).find(c => c.id === custId);
    } else {
        custData = globalCustomerList.find(c => c.id === custId);
    }

    if (!custData || custData.transactions === undefined) {
        try {
            const snap = await getDoc(doc(db, 'customers', custId));
            if (snap.exists()) {
                custData = { id: snap.id, ...snap.data() };
                updateCustLocalCache(custData, isAdmin);
            }
        } catch (e) { console.warn('Customer fetch error:', e); }
    }

    if (!custData) {
        document.getElementById('customerProfileInfo').innerHTML = '<div style="padding:16px;color:#f87171;">কাস্টমার পাওয়া যায়নি।</div>';
        return;
    }

    renderCustomerProfile(custData, isAdmin);

    // Show/hide action buttons
    const actionRow = document.getElementById('profileActionRow');
    if (actionRow) actionRow.style.display = isAdmin ? 'none' : 'flex';
}

function updateCustLocalCache(custData, isAdmin) {
    if (!isAdmin) {
        const idx = globalCustomerList.findIndex(c => c.id === custData.id);
        if (idx > -1) globalCustomerList[idx] = custData;
        else globalCustomerList.push(custData);
        await appCache.set(`${CACHE_KEYS.CUSTOMERS}_${currentUser}`, globalCustomerList);
    } else if (currentDetailUserId) {
        const cacheKey = `admin_cache_customers_${currentDetailUserId}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            const arr = JSON.parse(cached);
            const idx = arr.findIndex(c => c.id === custData.id);
            if (idx > -1) arr[idx] = custData; else arr.push(custData);
            localStorage.setItem(cacheKey, JSON.stringify(arr));
        }
    }
}

function renderCustomerProfile(custData, isAdmin = false) {
    const sales = parseFloat(custData.totalSales) || 0;
    const paid  = parseFloat(custData.totalPaid)  || 0;
    const bal   = sales - paid;
    const hasDue = bal > 0;

    // Header
    document.getElementById('customerProfileInfo').innerHTML = `
        <div class="khata-prof-head">
            <div class="khata-prof-left">
                <div class="khata-prof-avatar ${hasDue ? 'avatar-due' : 'avatar-clear'}">
                    ${(custData.billTo || '?').trim().slice(0,2).toUpperCase()}
                </div>
                <div>
                    <div class="khata-prof-name">${custData.billTo || ''}</div>
                    ${custData.phone  ? `<div class="khata-prof-meta">📞 ${custData.phone}</div>` : ''}
                    ${custData.shipTo ? `<div class="khata-prof-meta">📍 ${custData.shipTo}</div>` : ''}
                </div>
            </div>
            ${!isAdmin ? `<button class="btn-edit-bal" onclick="openEditCustomerModal('${custData.id}')">✏️ Edit</button>` : ''}
        </div>
    `;

    // Big balance
    document.getElementById('profileSummaryBar').innerHTML = `
        <div class="khata-big-balance ${hasDue ? 'big-bal-due' : 'big-bal-ok'}">
            <div class="big-bal-label">${hasDue ? '⚠️ পাব (বাকি)' : '✅ হিসাব পরিষ্কার'}</div>
            <div class="big-bal-amount">৳${Math.round(Math.abs(bal)).toLocaleString('bn-BD')}</div>
        </div>
        <div class="khata-mini-stats">
            <div class="khata-mini-stat">
                <span class="mini-stat-label">দিলাম (বিক্রয়)</span>
                <span class="mini-stat-val" style="color:#60a5fa;">৳${Math.round(sales).toLocaleString('bn-BD')}</span>
                ${isAdmin ? `<button class="btn-edit-bal" onclick="adminEditCustomerBalance('${custData.id}','totalSales',${sales})">✏️</button>` : ''}
            </div>
            <div class="khata-mini-stat">
                <span class="mini-stat-label">নিলাম (কালেকশন)</span>
                <span class="mini-stat-val" style="color:#4ade80;">৳${Math.round(paid).toLocaleString('bn-BD')}</span>
                ${isAdmin ? `<button class="btn-edit-bal" onclick="adminEditCustomerBalance('${custData.id}','totalPaid',${paid})">✏️</button>` : ''}
            </div>
        </div>
    `;

    // Transactions
    const transactions = (custData.transactions || []).slice().sort((a, b) =>
        new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );

    const listEl = document.getElementById('customerTransactionBody');
    if (!transactions.length) {
        listEl.innerHTML = '<div class="khata-txn-empty">কোনো লেনদেন নেই।<br><small>দিলাম বা নিলাম বাটন দিয়ে লেনদেন যোগ করুন।</small></div>';
        return;
    }

    listEl.innerHTML = transactions.map(txn => {
        const isSale = txn.type === 'sale';
        return `
        <div class="khata-txn-item ${isSale ? 'txn-item-sale' : 'txn-item-pay'}">
            <div class="khata-txn-icon-wrap">
                <span class="khata-txn-icon">${isSale ? '🛒' : '💵'}</span>
            </div>
            <div class="khata-txn-detail">
                <div class="khata-txn-type">${isSale ? 'দিলাম' : 'নিলাম'}</div>
                <div class="khata-txn-date">${txn.date || ''}</div>
                ${txn.note ? `<div class="khata-txn-note">${txn.note}</div>` : ''}
            </div>
            <div class="khata-txn-right">
                <div class="khata-txn-amount ${isSale ? 'txn-amount-sale' : 'txn-amount-pay'}">
                    ${isSale ? '+' : '-'}৳${Math.round(parseFloat(txn.amount || 0)).toLocaleString('bn-BD')}
                </div>
                ${!isAdmin ? `<button class="khata-del-txn" data-txnid="${txn.txnId}" data-type="${txn.type}" data-amount="${txn.amount}">✕</button>` : ''}
            </div>
        </div>`;
    }).join('');

    if (!isAdmin) {
        listEl.querySelectorAll('.khata-del-txn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                deleteTransaction(custData.id, btn.dataset.txnid, btn.dataset.type, parseFloat(btn.dataset.amount));
            };
        });
    }
}

function openAddTransactionModal(type) {
    currentLedgerTxnType = type;
    const isNilam = type === 'payment';
    document.getElementById('addTxnTitle').textContent = isNilam ? '💵 নিলাম (টাকা পেলাম)' : '🛒 দিলাম (পণ্য দিলাম)';
    document.getElementById('saveTxnBtn').className = isNilam ? 'btn btn-success' : 'btn btn-primary';
    document.getElementById('txnAmount').value = '';
    document.getElementById('txnNote').value = '';
    const today = new Date();
    document.getElementById('txnDate').value = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    document.getElementById('addTransactionModal').style.display = 'flex';
    setTimeout(() => document.getElementById('txnAmount').focus(), 100);
}

async function saveTransaction() {
    const amountVal = parseFloat(document.getElementById('txnAmount').value);
    const dateVal   = document.getElementById('txnDate').value;
    const noteVal   = document.getElementById('txnNote').value.trim();
    const saveBtn   = document.getElementById('saveTxnBtn');

    if (!amountVal || amountVal <= 0) return alert('সঠিক পরিমাণ লিখুন!');
    if (!dateVal) return alert('তারিখ দিন!');
    if (!currentLedgerCustId) return;

    const txnEntry = {
        txnId: `txn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: currentLedgerTxnType,
        amount: amountVal,
        date: formatDate(dateVal),
        note: noteVal,
        createdAt: new Date().toISOString()
    };

    saveBtn.disabled = true;
    saveBtn.textContent = 'সেভ হচ্ছে...';

    try {
        const updateObj = {
            transactions: arrayUnion(txnEntry),
            updatedAt: serverTimestamp(),
            lastUpdated: new Date().toISOString()
        };
        if (currentLedgerTxnType === 'payment') updateObj.totalPaid   = increment(amountVal);
        else                                    updateObj.totalSales  = increment(amountVal);

        await updateDoc(doc(db, 'customers', currentLedgerCustId), updateObj);
        await incrementVersion('customerVersion');

        // Update local cache
        const idx = globalCustomerList.findIndex(c => c.id === currentLedgerCustId);
        if (idx > -1) {
            const cust = globalCustomerList[idx];
            if (!cust.transactions) cust.transactions = [];
            cust.transactions = [txnEntry, ...cust.transactions];
            if (currentLedgerTxnType === 'payment') cust.totalPaid  = (parseFloat(cust.totalPaid)  || 0) + amountVal;
            else                                    cust.totalSales = (parseFloat(cust.totalSales) || 0) + amountVal;
            globalCustomerList[idx] = cust;
            await appCache.set(`${CACHE_KEYS.CUSTOMERS}_${currentUser}`, globalCustomerList);
        }

        document.getElementById('addTransactionModal').style.display = 'none';

        const custData = globalCustomerList.find(c => c.id === currentLedgerCustId);
        if (custData) renderCustomerProfile(custData, false);
        loadCustomerLedger(document.getElementById('ledgerSearchInput').value);

    } catch (e) {
        console.error('Save transaction error:', e);
        alert('লেনদেন সেভ করতে সমস্যা হয়েছে!');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '✓ সেভ';
    }
}

async function deleteTransaction(custId, txnId, txnType, txnAmount) {
    if (!confirm('এই লেনদেন মুছে দিতে চান?')) return;
    try {
        const snap = await getDoc(doc(db, 'customers', custId));
        if (!snap.exists()) return;
        const txn = (snap.data().transactions || []).find(t => t.txnId === txnId);
        if (!txn) return alert('লেনদেন পাওয়া যায়নি!');

        const updateObj = {
            transactions: arrayRemove(txn),
            updatedAt: serverTimestamp(),
            lastUpdated: new Date().toISOString()
        };
        if (txnType === 'payment') updateObj.totalPaid  = increment(-Math.abs(txnAmount));
        else                      updateObj.totalSales = increment(-Math.abs(txnAmount));

        await updateDoc(doc(db, 'customers', custId), updateObj);
        await incrementVersion('customerVersion');

        const idx = globalCustomerList.findIndex(c => c.id === custId);
        if (idx > -1) {
            const cust = globalCustomerList[idx];
            cust.transactions = (cust.transactions || []).filter(t => t.txnId !== txnId);
            if (txnType === 'payment') cust.totalPaid  = Math.max(0, (parseFloat(cust.totalPaid)  || 0) - txnAmount);
            else                      cust.totalSales = Math.max(0, (parseFloat(cust.totalSales) || 0) - txnAmount);
            globalCustomerList[idx] = cust;
            await appCache.set(`${CACHE_KEYS.CUSTOMERS}_${currentUser}`, globalCustomerList);
        }

        const custData = globalCustomerList.find(c => c.id === custId);
        if (custData) renderCustomerProfile(custData, false);
        loadCustomerLedger(document.getElementById('ledgerSearchInput').value);

    } catch (e) {
        console.error('Delete transaction error:', e);
        alert('মুছতে সমস্যা হয়েছে!');
    }
}

// --- Add/Edit Customer ---
function openAddCustomerModal() {
    editingCustomerId = null;
    document.getElementById('addEditCustomerTitle').textContent = '👤 নতুন কাস্টমার';
    document.getElementById('custEditName').value = '';
    document.getElementById('custEditPhone').value = '';
    document.getElementById('custEditAddress').value = '';
    document.getElementById('addEditCustomerModal').style.display = 'flex';
    setTimeout(() => document.getElementById('custEditName').focus(), 100);
}

function openEditCustomerModal(custId) {
    const cust = globalCustomerList.find(c => c.id === custId);
    if (!cust) return;
    editingCustomerId = custId;
    document.getElementById('addEditCustomerTitle').textContent = '✏️ কাস্টমার এডিট';
    document.getElementById('custEditName').value    = cust.billTo  || '';
    document.getElementById('custEditPhone').value   = cust.phone   || '';
    document.getElementById('custEditAddress').value = cust.shipTo  || '';
    document.getElementById('addEditCustomerModal').style.display = 'flex';
    setTimeout(() => document.getElementById('custEditName').focus(), 100);
}

async function saveCustomerInfo() {
    const nameVal    = document.getElementById('custEditName').value.trim();
    const phoneVal   = document.getElementById('custEditPhone').value.trim();
    const addressVal = document.getElementById('custEditAddress').value.trim();
    const saveBtn    = document.getElementById('saveCustomerInfoBtn');

    if (!nameVal) return alert('নাম দিন!');

    saveBtn.disabled = true;
    saveBtn.textContent = 'সেভ হচ্ছে...';

    try {
        let docId;
        if (editingCustomerId) {
            // Update existing
            docId = editingCustomerId;
            await updateDoc(doc(db, 'customers', docId), {
                billTo: nameVal,
                phone: phoneVal,
                shipTo: addressVal,
                updatedAt: serverTimestamp(),
                lastUpdated: new Date().toISOString()
            });
            // Update local cache
            const idx = globalCustomerList.findIndex(c => c.id === docId);
            if (idx > -1) {
                globalCustomerList[idx].billTo = nameVal;
                globalCustomerList[idx].phone  = phoneVal;
                globalCustomerList[idx].shipTo = addressVal;
            }
        } else {
            // New customer
            docId = getCustomerDocId(currentUser, nameVal);
            await setDoc(doc(db, 'customers', docId), {
                user: currentUser,
                billTo: nameVal,
                phone: phoneVal,
                shipTo: addressVal,
                totalSales: 0,
                totalPaid: 0,
                transactions: [],
                updatedAt: serverTimestamp(),
                lastUpdated: new Date().toISOString()
            }, { merge: true });
            // Add to local cache if not exists
            if (!globalCustomerList.find(c => c.id === docId)) {
                globalCustomerList.push({
                    id: docId, user: currentUser,
                    billTo: nameVal, phone: phoneVal, shipTo: addressVal,
                    totalSales: 0, totalPaid: 0, transactions: []
                });
            }
        }
        await incrementVersion('customerVersion');
        await appCache.set(`${CACHE_KEYS.CUSTOMERS}_${currentUser}`, globalCustomerList);

        document.getElementById('addEditCustomerModal').style.display = 'none';

        // Refresh ledger
        loadCustomerLedger(document.getElementById('ledgerSearchInput').value);

        // If editing and profile is open, refresh it
        if (editingCustomerId) {
            const custData = globalCustomerList.find(c => c.id === editingCustomerId);
            if (custData && document.getElementById('customerProfileModal').style.display !== 'none') {
                renderCustomerProfile(custData, false);
            }
        }
    } catch (e) {
        console.error('Save customer error:', e);
        alert('সেভ করতে সমস্যা হয়েছে!');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '✓ সেভ';
    }
}

// Admin: open customer profile from Admin Panel
async function openAdminCustomerProfile(custId) {
    await openCustomerProfile(custId, true);
}

// Admin: edit customer totalSales or totalPaid
window.adminEditCustomerBalance = async (custId, field, currentVal) => {
    const label = field === 'totalSales' ? 'মোট বিক্রয় (দিলাম)' : 'মোট কালেকশন (নিলাম)';
    const newValStr = prompt(`${label} পরিবর্তন করুন:\n(+ বা - দিয়ে adjust করুন, অথবা সরাসরি পরিমাণ লিখুন)`, currentVal);
    if (newValStr === null || newValStr.trim() === '') return;
    const trimmed = newValStr.trim();
    let newVal;
    if      (trimmed.startsWith('+')) newVal = (parseFloat(currentVal) || 0) + parseFloat(trimmed.substring(1));
    else if (trimmed.startsWith('-')) newVal = (parseFloat(currentVal) || 0) - parseFloat(trimmed.substring(1));
    else newVal = parseFloat(trimmed);
    if (isNaN(newVal) || newVal < 0) return alert('সঠিক পরিমাণ লিখুন!');
    try {
        await updateDoc(doc(db, 'customers', custId), { [field]: newVal, updatedAt: serverTimestamp() });
        await incrementVersion('customerVersion');

        // Update admin cache
        if (currentDetailUserId) {
            const cacheKey = `admin_cache_customers_${currentDetailUserId}`;
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const arr = JSON.parse(cached);
                const idx = arr.findIndex(c => c.id === custId);
                if (idx > -1) {
                    arr[idx][field] = newVal;
                    localStorage.setItem(cacheKey, JSON.stringify(arr));
                }
            }
        }

        alert('✅ আপডেট সফল!');

        // Refresh profile modal if open
        const profModal = document.getElementById('customerProfileModal');
        if (profModal && profModal.style.display !== 'none' && currentLedgerCustId === custId) {
            const cacheKey = `admin_cache_customers_${currentDetailUserId}`;
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const custData = JSON.parse(cached).find(c => c.id === custId);
                if (custData) renderCustomerProfile(custData, true);
            }
        }

        // Refresh admin ledger customer list if open
        const adminLedger = document.getElementById('adminLedgerModal');
        if (adminLedger && adminLedger.style.display !== 'none' && adminLedgerCurrentUserId) {
            loadAdminLedgerCustomers(adminLedgerCurrentUserId, document.getElementById('adminLedgerSearch').value || '');
        }

        // Also refresh old admin panel shop info if that's open
        if (document.getElementById('adminModal') && document.getElementById('adminModal').style.display !== 'none' && currentDetailUserId) {
            loadUserShopInfo(currentDetailUserId);
        }

    } catch (e) {
        console.error('Admin balance edit error:', e);
        alert('❌ আপডেট ব্যর্থ!');
    }
};

function initAppEvents() {
    document.getElementById('logoutBtn').onclick = logout;
    document.getElementById('addRowBtn').onclick = addInvoiceRow;
    document.getElementById('btnSaveDefault').onclick = async () => { 
        const companyVal = document.getElementById('companyDetails').value;
        const noteVal = document.getElementById('invoiceNote').value;
        try { 
            await setDoc(doc(db, "settings", "company"), { companyDetails: companyVal, defaultNote: noteVal }); 
            await incrementVersion('settingsVersion');
            alert("Default settings saved!"); 
        }
        catch (e) { alert("Error saving!"); }
    };
    setupInvoiceDateEvents();
    document.getElementById('currencySelect').onchange = calculateGrandTotal;
    document.getElementById('discountPercent').oninput = calculateGrandTotal;
    document.getElementById('printBtn').onclick = printInvoice;
    document.getElementById('sellHistoryBtn').onclick = () => openSellHistory();
    document.getElementById('customerLedgerBtn').onclick = openCustomerLedger;
    document.getElementById('viewStockBtn').onclick = openUserStockModal;
    document.getElementById('viewPaymentBtn').onclick = openUserPaymentModal;
    
    document.getElementById('refreshUserStockBtn').onclick = async (e) => {
        const btn = e.target;
        btn.disabled = true;
        btn.textContent = '⏳';
        try {
            await syncProducts();
            await syncStocks();
            openUserStockModal(); // Re-render the list
        } catch (error) {
            console.error("Error refreshing stock:", error);
        } finally {
            btn.disabled = false;
            btn.textContent = '🔄';
        }
    };
    
    document.getElementById('closeUserStockBtn').onclick = () => document.getElementById('userStockModal').style.display = 'none';
    document.getElementById('closeUserPaymentBtn').onclick = () => document.getElementById('userPaymentModal').style.display = 'none';
    document.getElementById('btnUnderstandPayment').onclick = () => document.getElementById('userPaymentModal').style.display = 'none';

    // --- Customer Ledger Modal ---
    document.getElementById('closeCustomerLedgerBtn').onclick = () => document.getElementById('customerLedgerModal').style.display = 'none';
    document.getElementById('ledgerSearchInput').oninput = debounce(function() {
        loadCustomerLedger(this.value);
    }, 400);

    // --- Customer Profile Modal ---
    document.getElementById('backToLedgerBtn').onclick = () => {
        document.getElementById('customerProfileModal').style.display = 'none';
        if (!ledgerIsAdminView) document.getElementById('customerLedgerModal').style.display = 'flex';
    };
    document.getElementById('addCollectionBtn').onclick = () => openAddTransactionModal('payment');
    document.getElementById('addManualSaleBtn').onclick = () => openAddTransactionModal('sale');

    // --- Add Transaction Modal ---
    document.getElementById('closeAddTxnBtn').onclick = () => document.getElementById('addTransactionModal').style.display = 'none';
    document.getElementById('cancelTxnBtn').onclick = () => document.getElementById('addTransactionModal').style.display = 'none';
    document.getElementById('saveTxnBtn').onclick = saveTransaction;
    document.getElementById('txnNote').onkeypress = (e) => { if (e.key === 'Enter') saveTransaction(); };

    // --- Add/Edit Customer Modal ---
    document.getElementById('addNewCustomerBtn').onclick = openAddCustomerModal;
    document.getElementById('closeAddEditCustomerBtn').onclick = () => document.getElementById('addEditCustomerModal').style.display = 'none';
    document.getElementById('cancelAddEditCustomerBtn').onclick = () => document.getElementById('addEditCustomerModal').style.display = 'none';
    document.getElementById('saveCustomerInfoBtn').onclick = saveCustomerInfo;
    document.getElementById('custEditName').onkeypress = (e) => { if (e.key === 'Enter') saveCustomerInfo(); };

    // --- Admin Ledger Modal ---
    document.getElementById('closeAdminLedgerBtn').onclick = () => document.getElementById('adminLedgerModal').style.display = 'none';
    document.getElementById('adminLedgerBackBtn').onclick = () => {
        // Go back to user list
        adminLedgerCurrentUserId = null;
        document.getElementById('adminLedgerTitle').textContent = '📒 সকল ইউজারের খাতা';
        document.getElementById('adminLedgerBackBtn').style.display = 'none';
        document.getElementById('adminLedgerSearch').style.display = 'none';
        document.getElementById('adminLedgerSummary').style.display = 'none';
        document.getElementById('adminLedgerRefreshBtn').style.display = 'none'; // ফিরে গেলে hide
        loadAdminLedgerUserList();
    };
    // --- নতুন Ledger বাটনগুলো ---
    document.getElementById('ledgerRefreshBtn').onclick = ledgerForceRefresh;
    document.getElementById('autoDetectCustomerBtn').onclick = autoDetectMissingCustomers;
    document.getElementById('adminLedgerRefreshBtn').onclick = async () => {
        const btn = document.getElementById('adminLedgerRefreshBtn');
        btn.classList.add('spinning');
        btn.disabled = true;
        try {
            if (!adminLedgerCurrentUserId) {
                // === User List View: সকল user-এর cache clear + Firebase থেকে reload ===
                localStorage.removeItem(ADMIN_USERS_CACHE);
                // সব user-এর admin customer cacheও clear করা হচ্ছে
                Object.keys(localStorage)
                    .filter(k => k.startsWith('admin_cache_customers_'))
                    .forEach(k => localStorage.removeItem(k));
                await loadAdminLedgerUserList();
            } else {
                // === Customer List View: স্পেসিফিক user-এর customer cache clear + reload ===
                localStorage.removeItem(`admin_cache_customers_${adminLedgerCurrentUserId}`);
                const q = query(collection(db, 'customers'), where('user', '==', adminLedgerCurrentUserId));
                const snap = await getDocs(q);
                const fresh = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                localStorage.setItem(`admin_cache_customers_${adminLedgerCurrentUserId}`, JSON.stringify(fresh));
                loadAdminLedgerCustomers(adminLedgerCurrentUserId, document.getElementById('adminLedgerSearch').value);
            }
        } catch (e) {
            alert('রিফ্রেশ সমস্যা: ' + e.message);
        } finally {
            btn.classList.remove('spinning');
            btn.disabled = false;
        }
    };



    document.getElementById('adminPanelBtn').onclick = () => { 
        /*
         * [OLD IN-PAGE ADMIN MODAL]
         * User requested to hide the old in-page admin modal and redirect to the new 
         * standalone Admin Dashboard (admin.html).
         * If they ever want to revert back to the old modal-based dashboard in main.html, 
         * remove the window.location.href line and uncomment the lines below:
         *
         * document.getElementById('adminModal').style.display = 'flex'; 
         * document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
         * document.getElementById('monitorTabBtn').classList.add('active');
         * updateDeleteNotificationBadge();
         * showMonitor(); 
         */
        window.location.href = 'admin.html';
    };
    document.getElementById('closeSellHistoryBtn').onclick = () => document.getElementById('sellHistoryModal').style.display = 'none';
    document.getElementById('closeAdminBtn').onclick = () => document.getElementById('adminModal').style.display = 'none';
    document.getElementById('productTabBtn').onclick = () => { document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active')); document.getElementById('productTabBtn').classList.add('active'); showProducts(); };
    document.getElementById('allUserDetailsTabBtn').onclick = showAllUserDetails;
    document.getElementById('stockTabBtn').onclick = () => { document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active')); document.getElementById('stockTabBtn').classList.add('active'); showStock(); };
    document.getElementById('monitorTabBtn').onclick = () => { document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active')); document.getElementById('monitorTabBtn').classList.add('active'); showMonitor(); };
    document.getElementById('userTabBtn').onclick = () => { document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active')); document.getElementById('userTabBtn').classList.add('active'); showUsers(); };
    document.getElementById('backupTabBtn').onclick = () => { document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active')); document.getElementById('backupTabBtn').classList.add('active'); showBackup(); };
    
    // --- Sub-tabs in User Details ---
    document.getElementById('subTabShopInfo').onclick = () => {
        document.querySelectorAll('#singleUserDetailSubSection .admin-tab-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('subTabShopInfo').classList.add('active');
        document.querySelectorAll('.sub-admin-section').forEach(s => s.style.display = 'none');
        document.getElementById('subSectionShopInfo').style.display = 'block';
        loadUserShopInfo(currentDetailUserId);
    };
    document.getElementById('subTabSalesHistory').onclick = () => {
        document.querySelectorAll('#singleUserDetailSubSection .admin-tab-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('subTabSalesHistory').classList.add('active');
        document.querySelectorAll('.sub-admin-section').forEach(s => s.style.display = 'none');
        document.getElementById('subSectionSalesHistory').style.display = 'block';
        loadUserSalesHistory(currentDetailUserId);
    };
    document.getElementById('subTabCacheControl').onclick = () => {
        document.querySelectorAll('#singleUserDetailSubSection .admin-tab-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('subTabCacheControl').classList.add('active');
        document.querySelectorAll('.sub-admin-section').forEach(s => s.style.display = 'none');
        document.getElementById('subSectionCacheControl').style.display = 'block';
        document.getElementById('remoteCacheStatus').textContent = '';
    };
    document.getElementById('backToUserListBtn').onclick = showAllUserDetails;
    document.getElementById('remoteClearCacheBtn').onclick = () => remoteClearCache(currentDetailUserId);
    document.getElementById('remoteRestoreCacheBtn').onclick = () => remoteRestoreCache(currentDetailUserId);
    document.getElementById('importUserShopInfoFile').onchange = (e) => importUserShopInfo(e, currentDetailUserId);
    document.getElementById('downloadUserShopInfoBtn').onclick = () => downloadUserShopInfo(currentDetailUserId);
    document.getElementById('deleteAllCustomersBtn').onclick = deleteAllCustomers;

    document.getElementById('settingsTabBtn').onclick = () => { 
        document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active')); 
        document.getElementById('settingsTabBtn').classList.add('active'); 
        document.querySelectorAll('.admin-section').forEach(s => s.style.display = 'none'); 
        document.getElementById('settingsSection').style.display = 'block'; 
        updateStorageMonitor();
    };
    document.getElementById('clearCacheBtn').onclick = clearLocalStorageCache;
    document.getElementById('forceGlobalSyncBtn').onclick = forceGlobalSync;
    document.getElementById('btnSaveDefaultInSettings').onclick = () => document.getElementById('btnSaveDefault').click();
    document.getElementById('saveProductsBtn').onclick = saveProducts;
    document.getElementById('addNewProductRowBtn').onclick = () => addProductManagementRow();
    document.getElementById('exportProductsTxtBtn').onclick = exportProductsTxt;
    document.getElementById('importProductsTxtFile').onchange = importProductsTxt;
    document.getElementById('createUserBtn').onclick = createUser;
    document.getElementById('deleteAllSalesBtn').onclick = deleteAllSales;
    document.getElementById('deleteNotifBtn').onclick = openDeleteNotificationPanel;
    document.getElementById('closeDeleteNotifBtn').onclick = () => document.getElementById('deleteNotifModal').style.display = 'none';
    document.getElementById('exportDataBtn').onclick = exportAllData;
    document.getElementById('importFile').onchange = importData;
    document.getElementById('openCleanModalBtn').onclick = () => document.getElementById('cleanConfirmModal').style.display = 'flex';
    document.getElementById('closeCleanModalBtn').onclick = () => document.getElementById('cleanConfirmModal').style.display = 'none';
    document.getElementById('confirmFullCleanBtn').onclick = cleanAllData;
    document.getElementById('cancelProductEditBtn').onclick = resetProductForm;
    document.getElementById('productSearchInput').oninput = debounce(filterProducts, 300);
    document.getElementById('billTo').oninput = debounce(function() {
        filterCustomers();
        autoResize(this);
        repositionCustomerSuggestions();
    }, 300);
    initCustomerSuggestionListeners();
    document.getElementById('productSearchPopup').onclick = (e) => { if (e.target.id === 'productSearchPopup') document.getElementById('productSearchPopup').style.display = 'none'; };
    document.addEventListener('pointerdown', (e) => {
        const box = document.getElementById('customerSuggestions');
        const billTo = document.getElementById('billTo');
        if (!box || box.style.display === 'none') return;
        if (billTo.contains(e.target) || box.contains(e.target)) return;
        hideCustomerSuggestions();
    });
    document.getElementById('companyDetails').oninput = function() { autoResize(this); };
    window.onbeforeprint = beforePrint; window.onafterprint = afterPrint;
}

function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
}

function openUserStockModal() {
    const listContainer = document.getElementById('userStockList');
    listContainer.innerHTML = '';
    
    // Sort products by name
    const sortedProducts = Object.values(globalProductMap).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    
    if (sortedProducts.length === 0) {
        listContainer.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-light);">কোনো পণ্য পাওয়া যায়নি</div>';
    } else {
        let html = '';
        sortedProducts.forEach(p => {
            const qty = globalStockMap[p.id] || 0;
            const isLow = qty <= 10;
            html += `
                <div class="stock-list-item">
                    <div class="stock-name">${escapeHTML(p.name || '')}</div>
                    <div class="stock-qty ${isLow ? 'low-stock' : ''}">${qty}</div>
                </div>
            `;
        });
        listContainer.innerHTML = html;
    }
    document.getElementById('userStockModal').style.display = 'flex';
}

async function openUserPaymentModal() {
    const msgBox = document.getElementById('userPaymentMessage');
    msgBox.innerHTML = 'লোড হচ্ছে...';
    document.getElementById('userPaymentModal').style.display = 'flex';
    
    try {
        const snap = await getDoc(doc(db, "settings", "company"));
        if (snap.exists() && snap.data().paymentInfo) {
            // Replaces newlines with <br> to keep formatting
            const info = escapeHTML(snap.data().paymentInfo).replace(/\n/g, '<br>');
            msgBox.innerHTML = info;
        } else {
            msgBox.innerHTML = 'কোনো পেমেন্ট তথ্য দেওয়া হয়নি।';
        }
    } catch (e) {
        msgBox.innerHTML = 'লোড করা যায়নি। আবার চেষ্টা করুন।';
    }
}

// DOMContentLoaded — Main Invoice Page Guard
window.addEventListener('DOMContentLoaded', async () => {
    // --- Session Guard: redirect to login if not authenticated ---
    const sess = sessionStorage.getItem(LOGIN_SESSION_KEY);
    if (!sess) {
        window.location.href = 'index.html';
        return;
    }
    currentUser = sess;

    // --- Initialize app events and load main app ---
    initAppEvents();
    await showMainApp();

    // --- Admin Print Handling ---
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('action') === 'admin_print') {
        const printDataStr = sessionStorage.getItem('admin_print_invoice');
        if (printDataStr) {
            try {
                const inv = JSON.parse(printDataStr);
                loadInvoiceUI(inv, false);
                
                // Hide action buttons during direct print to avoid confusing admin
                const actionBtns = document.querySelector('.action-buttons');
                if (actionBtns) actionBtns.style.display = 'none';

                setTimeout(() => {
                    window.print();
                    sessionStorage.removeItem('admin_print_invoice');
                    
                    // Optionally close tab after print or restore buttons
                    if (actionBtns) actionBtns.style.display = 'flex';
                }, 800);
            } catch(e) {
                console.error("Admin Print Error:", e);
            }
        }
    }
});
