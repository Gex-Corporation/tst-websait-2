// ======================================================
//  Invoice Pro — Shared Module (shared.js)
//  GEX Corporation | <Dev Alif/>
//  সব নতুন পেজ এই ফাইল import করবে
// ======================================================

import { initializeApp } from "firebase/app";
import {
    getFirestore, collection, addDoc, getDocs, getDoc,
    setDoc, updateDoc, deleteDoc, doc, query, where,
    orderBy, limit, serverTimestamp, writeBatch,
    increment, arrayUnion, arrayRemove, Timestamp, startAfter,
    deleteField
} from "firebase/firestore";

// ==================== Firebase Config ====================
const firebaseConfig = {
    apiKey: "AIzaSyCng8ZDKd6zOc2ydbf-wUljOzEAViWSOQI",
    authDomain: "computer-kaaj.firebaseapp.com",
    projectId: "computer-kaaj",
    storageBucket: "computer-kaaj.firebasestorage.app",
    messagingSenderId: "786670596427",
    appId: "1:786670596427:web:db95ddef44d9f35739f8ce",
    measurementId: "G-007FD30DQ6"
};

let _app, _db;
try {
    _app = initializeApp(firebaseConfig);
    _db  = getFirestore(_app);
} catch (e) {
    console.error("Firebase Init Error:", e);
}

export const db = _db;
export {
    collection, addDoc, getDocs, getDoc,
    setDoc, updateDoc, deleteDoc, doc, query, where,
    orderBy, limit, serverTimestamp, writeBatch,
    increment, arrayUnion, arrayRemove, Timestamp, startAfter,
    deleteField
};

// ==================== Auth Constants ====================
export const LOGIN_SESSION_KEY = 'invoice_logged_in_user_v1';
export const REMEMBER_ME_KEY   = 'invoice_remembered_user';

// ==================== Cache Keys ====================
export const CACHE_KEYS = {
    PRODUCTS:    'erp_cached_products_v3',
    STOCKS:      'erp_cached_stocks_v3',
    CUSTOMERS:   'erp_cached_customers_v3',
    SETTINGS:    'erp_cached_settings_v3',
    LAST_SYNC:   'erp_last_sync_timestamps_v3',
    VERSIONS:    'erp_global_versions_v3',
    SELL_HISTORY:'erp_sell_history_v3'
};
export const ADMIN_USERS_CACHE   = 'admin_cached_users_list_v1';
export const ADMIN_MONITOR_CACHE = 'admin_sales_monitor_cache_v1';

// ==================== Auth Guard ====================
export function getCurrentUser() {
    return sessionStorage.getItem(LOGIN_SESSION_KEY) || null;
}

export function requireAdmin() {
    const user = getCurrentUser();
    if (!user || user !== 'admin') {
        window.location.href = '../index.html';
        return null;
    }
    return user;
}

export function logout() {
    sessionStorage.removeItem(LOGIN_SESSION_KEY);
    window.location.href = '../index.html';
}

// ==================== Format Helpers ====================
export function formatBDT(amount) {
    if (isNaN(amount) || amount === null || amount === undefined) return '৳০';
    const n = Number(amount);
    return '৳' + n.toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function formatDate(tsOrDate) {
    if (!tsOrDate) return '—';
    let d;
    if (tsOrDate?.toDate) d = tsOrDate.toDate();
    else if (tsOrDate instanceof Date) d = tsOrDate;
    else d = new Date(tsOrDate);
    return d.toLocaleDateString('bn-BD', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function daysAgoLabel(d) {
    const diff = Math.floor((Date.now() - (d instanceof Date ? d.getTime() : d)) / 86400000);
    if (diff === 0) return 'আজ';
    if (diff === 1) return 'গতকাল';
    return `${diff} দিন আগে`;
}

export function avatarBg(name = '') {
    const colors = ['#7c3aed','#2563eb','#10b981','#f59e0b','#ef4444','#ec4899','#14b8a6','#8b5cf6'];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
    return colors[Math.abs(h) % colors.length];
}

export function debounce(func, wait = 300) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => func(...args), wait); };
}

export function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ==================== Toast Notification ====================
export function showToast(msg, type = 'info', duration = 3000) {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.style.cssText = `
            position: fixed; bottom: 24px; right: 24px;
            display: flex; flex-direction: column; gap: 8px;
            z-index: 9999; pointer-events: none;
        `;
        document.body.appendChild(container);
    }

    const colors = {
        success: { bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.35)', color: '#34d399' },
        error:   { bg: 'rgba(239,68,68,0.15)',  border: 'rgba(239,68,68,0.35)',  color: '#f87171' },
        warning: { bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.35)', color: '#fbbf24' },
        info:    { bg: 'rgba(37,99,235,0.15)',  border: 'rgba(37,99,235,0.35)',  color: '#60a5fa' },
    };
    const c = colors[type] || colors.info;
    const icon = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' }[type] || 'ℹ️';

    const toast = document.createElement('div');
    toast.style.cssText = `
        display: flex; align-items: center; gap: 10px;
        padding: 12px 16px; border-radius: 10px;
        background: ${c.bg}; border: 1px solid ${c.border};
        color: ${c.color}; font-size: 13px; font-weight: 500;
        backdrop-filter: blur(12px);
        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        pointer-events: all;
        animation: toastIn 0.3s ease;
        min-width: 220px; max-width: 340px;
        font-family: 'Inter', sans-serif;
    `;
    toast.innerHTML = `<span style="flex-shrink:0">${icon}</span><span>${escapeHtml(msg)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 280);
    }, duration);
}

// Inject toast animations once
if (!document.getElementById('toastStyles')) {
    const s = document.createElement('style');
    s.id = 'toastStyles';
    s.textContent = `
        @keyframes toastIn  { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:none; } }
        @keyframes toastOut { from { opacity:1; transform:none; } to { opacity:0; transform:translateY(12px); } }
    `;
    document.head.appendChild(s);
}

// ==================== Confirm Modal ====================
export function confirmModal(title, message, onConfirm, danger = true) {
    const existing = document.getElementById('sharedConfirmModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'sharedConfirmModal';
    modal.style.cssText = `
        position: fixed; inset: 0; z-index: 9000;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,0.6); backdrop-filter: blur(6px);
        animation: fadeIn 0.2s ease;
    `;
    modal.innerHTML = `
        <div style="
            background: #111827; border: 1px solid rgba(255,255,255,0.1);
            border-radius: 16px; padding: 28px; max-width: 400px; width: 90%;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
            animation: slideUp 0.25s ease;
        ">
            <div style="font-size:17px;font-weight:700;color:#f1f5f9;margin-bottom:10px;">${escapeHtml(title)}</div>
            <div style="font-size:13.5px;color:#94a3b8;line-height:1.6;margin-bottom:24px;">${escapeHtml(message)}</div>
            <div style="display:flex;gap:10px;justify-content:flex-end;">
                <button id="confirmCancel" style="
                    padding:8px 18px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);
                    background:rgba(255,255,255,0.05);color:#94a3b8;cursor:pointer;
                    font-size:13px;font-family:'Inter',sans-serif;transition:all 0.2s;
                ">বাতিল</button>
                <button id="confirmOk" style="
                    padding:8px 18px;border-radius:8px;border:none;cursor:pointer;
                    font-size:13px;font-weight:600;font-family:'Inter',sans-serif;transition:all 0.2s;
                    background:${danger ? 'linear-gradient(135deg,#ef4444,#dc2626)' : 'linear-gradient(135deg,#7c3aed,#2563eb)'};
                    color:white;
                ">নিশ্চিত করুন</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#confirmCancel').onclick = () => modal.remove();
    modal.querySelector('#confirmOk').onclick = () => { modal.remove(); onConfirm(); };
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

// ==================== Loading State Helpers ====================
export function setLoading(el, isLoading, text = 'লোড হচ্ছে...') {
    if (!el) return;
    if (isLoading) {
        el.dataset.prevHtml = el.innerHTML;
        el.disabled = true;
        el.style.opacity = '0.7';
        el.innerHTML = `<span class="btn-spinner"></span> ${text}`;
    } else {
        el.innerHTML = el.dataset.prevHtml || el.innerHTML;
        el.disabled = false;
        el.style.opacity = '';
    }
}

export function renderLoading(container, msg = 'লোড হচ্ছে...') {
    if (!container) return;
    container.innerHTML = `
        <div class="loading-center">
            <div class="spinner"></div>
            <span>${msg}</span>
        </div>
    `;
}

export function renderEmpty(container, icon = '📭', msg = 'কোনো তথ্য নেই') {
    if (!container) return;
    container.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">${icon}</div>
            <div>${msg}</div>
        </div>
    `;
}

// ==================== Real-time Clock ====================
export function startClock(elId = 'topbarTime') {
    const el = document.getElementById(elId);
    if (!el) return;
    const tick = () => {
        const now = new Date();
        const date = now.toLocaleDateString('bn-BD', { day: '2-digit', month: 'short', year: 'numeric' });
        const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
        el.textContent = `${date} • ${time}`;
    };
    tick();
    setInterval(tick, 1000);
}

// ==================== Topbar Builder ====================
export function buildPageTopbar({ title, subtitle = '', backUrl = '../admin.html', actions = [] } = {}) {
    const topbar = document.getElementById('pageTopbar');
    if (!topbar) return;

    const currentUser = getCurrentUser();
    const initials = (currentUser || 'A').substring(0, 1).toUpperCase();

    const actionsHtml = actions.map(a => `
        <button class="topbar-btn ${a.class || ''}" id="${a.id || ''}" onclick="${a.onclick || ''}">
            ${a.icon || ''} ${a.label}
        </button>
    `).join('');

    topbar.innerHTML = `
        <div class="topbar-left">
            <a href="${backUrl}" class="back-btn" title="ড্যাশবোর্ডে ফিরুন">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <polyline points="15 18 9 12 15 6"/>
                </svg>
            </a>
            <div>
                <h1 class="page-title">${title}</h1>
                ${subtitle ? `<div class="page-subtitle">${subtitle}</div>` : ''}
            </div>
        </div>
        <div class="topbar-right">
            <div class="topbar-time" id="topbarTime"></div>
            ${actionsHtml}
            <div class="topbar-user-avatar" title="${currentUser || 'Admin'}">${initials}</div>
            <button class="topbar-btn danger" onclick="import('../js/shared.js').then(m=>m.logout())">
                🚪
            </button>
        </div>
    `;
    startClock();
}

// ==================== IndexedDB Cache Manager ====================
export const appCache = {
    _db: null,
    async _initDB() {
        if (this._db) return this._db;
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('InvoiceProCache', 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('store')) {
                    db.createObjectStore('store');
                }
            };
            req.onsuccess = (e) => {
                this._db = e.target.result;
                resolve(this._db);
            };
            req.onerror = (e) => reject(e.target.error);
        });
    },
    async set(key, value) {
        const db = await this._initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('store', 'readwrite');
            const req = tx.objectStore('store').put(value, key);
            req.onsuccess = () => resolve();
            req.onerror = (e) => reject(e.target.error);
        });
    },
    async get(key) {
        const db = await this._initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('store', 'readonly');
            const req = tx.objectStore('store').get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = (e) => reject(e.target.error);
        });
    },
    async remove(key) {
        const db = await this._initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('store', 'readwrite');
            const req = tx.objectStore('store').delete(key);
            req.onsuccess = () => resolve();
            req.onerror = (e) => reject(e.target.error);
        });
    },
    async clear() {
        const db = await this._initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('store', 'readwrite');
            const req = tx.objectStore('store').clear();
            req.onsuccess = () => resolve();
            req.onerror = (e) => reject(e.target.error);
        });
    },
    async keys() {
        const db = await this._initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('store', 'readonly');
            const req = tx.objectStore('store').getAllKeys();
            req.onsuccess = () => resolve(req.result);
            req.onerror = (e) => reject(e.target.error);
        });
    }
};

/**
 * Automatically migrates legacy business caches from localStorage to IndexedDB.
 * Preserves ONLY the Remember Me login credentials in localStorage.
 */
export async function migrateAllLocalStorageToIndexedDB() {
    try {
        const keysToMigrate = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k !== REMEMBER_ME_KEY && k !== LOGIN_SESSION_KEY && !k.startsWith('local_cache_version_')) {
                keysToMigrate.push(k);
            }
        }
        for (const k of keysToMigrate) {
            try {
                const val = localStorage.getItem(k);
                if (val !== null) {
                    let parsed = val;
                    try { parsed = JSON.parse(val); } catch (_) {}
                    await appCache.set(k, parsed);
                    localStorage.removeItem(k);
                }
            } catch (_) {}
        }
    } catch (_) {}
}
// Run non-blocking background migration on load
if (typeof window !== 'undefined') {
    setTimeout(() => { migrateAllLocalStorageToIndexedDB().catch(() => {}); }, 100);
}

// ==================== Monthly Stats & Invoice Range Helpers ====================
export function extractInvoiceNumber(str) {
    if (!str && str !== 0) return 0;
    if (typeof str === 'number') return str;
    const matches = String(str).match(/\d+/g);
    if (!matches) return 0;
    return parseInt(matches[matches.length - 1], 10) || 0;
}

export function getInvoiceMonthKey(dateInput) {
    let d = new Date();
    if (dateInput) {
        if (dateInput.toMillis) d = new Date(dateInput.toMillis());
        else if (dateInput.seconds) d = new Date(dateInput.seconds * 1000);
        else {
            const parsed = new Date(dateInput);
            if (!isNaN(parsed.getTime())) d = parsed;
        }
    }
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`; // e.g. "2026-10"
}

export function getMonthNameBangla(monthKey) {
    if (!monthKey || typeof monthKey !== 'string') return '';
    const parts = monthKey.split('-');
    if (parts.length < 2) return monthKey;
    const y = parts[0];
    const m = parts[1];
    const bnMonths = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];
    const idx = parseInt(m, 10) - 1;
    return `${bnMonths[idx] || m} ${y}`;
}

export async function updateUserMonthlyStatsOnCreate(userId, invData, batchInstance = null) {
    if (!userId || !db) return;
    try {
        const userRef = doc(db, "users", userId);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) return;

        const userData = userSnap.data();
        const saleAmount = parseFloat(invData.grandTotal || 0);
        const invNum = extractInvoiceNumber(invData.invoiceNumber);
        const monthKey = getInvoiceMonthKey(invData.timestamp || invData.date || new Date());
        const monthName = getMonthNameBangla(monthKey);

        const monthlyStats = userData.monthlyStats || {};
        const curMonth = monthlyStats[monthKey] || {
            monthKey,
            monthName,
            totalSales: 0,
            invoiceCount: 0,
            startInvoice: invNum,
            endInvoice: invNum,
            targetAmount: 0
        };

        curMonth.totalSales = (parseFloat(curMonth.totalSales) || 0) + saleAmount;
        curMonth.invoiceCount = (parseInt(curMonth.invoiceCount) || 0) + 1;
        if (!curMonth.startInvoice || curMonth.startInvoice === 0) {
            curMonth.startInvoice = invNum;
        } else if (invNum > 0) {
            curMonth.startInvoice = Math.min(curMonth.startInvoice, invNum);
        }
        if (invNum > 0) {
            curMonth.endInvoice = Math.max(curMonth.endInvoice || invNum, invNum);
        }
        curMonth.updatedAt = new Date().toISOString();

        const updates = {
            [`monthlyStats.${monthKey}`]: curMonth,
            currentMonthKey: monthKey
        };

        if (batchInstance) {
            batchInstance.update(userRef, updates);
        } else {
            await updateDoc(userRef, updates);
        }
    } catch (e) {
        console.error("Error in updateUserMonthlyStatsOnCreate:", e);
    }
}

export async function updateUserMonthlyStatsOnDelete(userId, invData) {
    if (!userId || !db) return;
    try {
        const userRef = doc(db, "users", userId);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) return;

        const userData = userSnap.data();
        const delAmount = parseFloat(invData.grandTotal || 0);
        const delInvNum = extractInvoiceNumber(invData.invoiceNumber);
        const monthKey = getInvoiceMonthKey(invData.timestamp || invData.date || new Date());

        const monthlyStats = userData.monthlyStats || {};
        const curMonth = monthlyStats[monthKey];

        const updates = {};

        // 1. Roll back invoiceCounter if this was the latest invoice created
        const currentCounter = parseInt(userData.invoiceCounter) || 0;
        if (currentCounter === delInvNum && delInvNum > 0) {
            updates.invoiceCounter = Math.max(0, delInvNum - 1);
        }

        // 2. Adjust monthlyStats for this month
        if (curMonth) {
            const newSales = Math.max(0, (parseFloat(curMonth.totalSales) || 0) - delAmount);
            const newCount = Math.max(0, (parseInt(curMonth.invoiceCount) || 0) - 1);
            curMonth.totalSales = newSales;
            curMonth.invoiceCount = newCount;

            if (newCount === 0) {
                curMonth.startInvoice = 0;
                curMonth.endInvoice = 0;
            } else {
                if (curMonth.endInvoice === delInvNum) {
                    curMonth.endInvoice = Math.max(curMonth.startInvoice || 0, delInvNum - 1);
                }
                if (curMonth.startInvoice === delInvNum) {
                    curMonth.startInvoice = Math.min(curMonth.endInvoice || delInvNum + 1, delInvNum + 1);
                }
            }
            curMonth.updatedAt = new Date().toISOString();
            updates[`monthlyStats.${monthKey}`] = curMonth;
        }

        if (Object.keys(updates).length > 0) {
            await updateDoc(userRef, updates);
        }
    } catch (e) {
        console.error("Error in updateUserMonthlyStatsOnDelete:", e);
    }
}

export async function syncUserMonthlyStats(userId) {
    if (!userId || !db) return null;
    try {
        let userInvoices = [];
        try {
            const bucketQ = query(collection(db, "mpo_invoices"), where("mpo", "==", userId));
            const bucketSnap = await getDocs(bucketQ);
            if (!bucketSnap.empty) {
                bucketSnap.docs.forEach(bDoc => {
                    const bData = bDoc.data();
                    if (bData && bData.invoices) {
                        userInvoices.push(...Object.values(bData.invoices));
                    }
                });
            }
        } catch (_) {}

        try {
            const q = query(collection(db, "invoices"), where("user", "==", userId));
            const snap = await getDocs(q);
            snap.docs.forEach(docSnap => {
                const inv = { id: docSnap.id, ...docSnap.data() };
                if (!userInvoices.some(i => i.id === inv.id)) {
                    userInvoices.push(inv);
                }
            });
        } catch (_) {}

        const userRef = doc(db, "users", userId);
        const userSnap = await getDoc(userRef);
        const userData = userSnap.exists() ? userSnap.data() : {};
        const existingMonthly = userData.monthlyStats || {};

        const newMonthly = {};
        let maxOverallInvNum = 0;

        userInvoices.forEach(inv => {
            const amt = parseFloat(inv.grandTotal || 0);
            const invNum = extractInvoiceNumber(inv.invoiceNumber);
            if (invNum > maxOverallInvNum) maxOverallInvNum = invNum;

            const mKey = getInvoiceMonthKey(inv.timestamp || inv.date || inv.updatedAt);
            if (!newMonthly[mKey]) {
                newMonthly[mKey] = {
                    monthKey: mKey,
                    monthName: getMonthNameBangla(mKey),
                    totalSales: 0,
                    invoiceCount: 0,
                    startInvoice: invNum,
                    endInvoice: invNum,
                    targetAmount: existingMonthly[mKey]?.targetAmount || 0,
                    updatedAt: new Date().toISOString()
                };
            }
            newMonthly[mKey].totalSales += amt;
            newMonthly[mKey].invoiceCount += 1;
            if (invNum > 0) {
                if (!newMonthly[mKey].startInvoice || newMonthly[mKey].startInvoice === 0) {
                    newMonthly[mKey].startInvoice = invNum;
                } else {
                    newMonthly[mKey].startInvoice = Math.min(newMonthly[mKey].startInvoice, invNum);
                }
                newMonthly[mKey].endInvoice = Math.max(newMonthly[mKey].endInvoice || 0, invNum);
            }
        });

        // Calculate customer collections from customers collection
        let totalCustCollection = 0;
        try {
            const custQ = query(collection(db, "customers"), where("user", "==", userId));
            const custSnap = await getDocs(custQ);
            custSnap.docs.forEach(cDoc => {
                const c = cDoc.data();
                const txns = Array.isArray(c.transactions) ? c.transactions : [];
                let foundPaymentTxns = false;
                txns.forEach(t => {
                    if (t.type === 'payment') {
                        foundPaymentTxns = true;
                        const amt = parseFloat(t.amount || 0);
                        if (amt > 0) {
                            totalCustCollection += amt;
                            const mKey = getInvoiceMonthKey(t.date || t.createdAt);
                            if (!newMonthly[mKey]) {
                                newMonthly[mKey] = {
                                    monthKey: mKey,
                                    monthName: getMonthNameBangla(mKey),
                                    totalSales: 0,
                                    customerCollection: 0,
                                    invoiceCount: 0,
                                    startInvoice: 0,
                                    endInvoice: 0,
                                    targetAmount: existingMonthly[mKey]?.targetAmount || 0,
                                    updatedAt: new Date().toISOString()
                                };
                            }
                            newMonthly[mKey].customerCollection = (parseFloat(newMonthly[mKey].customerCollection || 0)) + amt;
                        }
                    }
                });
                if (!foundPaymentTxns && parseFloat(c.totalPaid || 0) > 0) {
                    const legacyAmt = parseFloat(c.totalPaid || 0);
                    totalCustCollection += legacyAmt;
                    const curMKey = getInvoiceMonthKey(c.lastUpdated || c.updatedAt || new Date());
                    if (!newMonthly[curMKey]) {
                        newMonthly[curMKey] = {
                            monthKey: curMKey,
                            monthName: getMonthNameBangla(curMKey),
                            totalSales: 0,
                            customerCollection: 0,
                            invoiceCount: 0,
                            startInvoice: 0,
                            endInvoice: 0,
                            targetAmount: existingMonthly[curMKey]?.targetAmount || 0,
                            updatedAt: new Date().toISOString()
                        };
                    }
                    newMonthly[curMKey].customerCollection = (parseFloat(newMonthly[curMKey].customerCollection || 0)) + legacyAmt;
                }
            });
        } catch (cErr) {
            console.warn("Sync customer collection error:", cErr);
        }

        // Calculate office deposits (MPO payments to owner) from user.payments
        const mpoPayments = Array.isArray(userData.payments) ? userData.payments : [];
        let totalMPOPayments = 0;
        mpoPayments.forEach(p => {
            const amt = parseFloat(p.amount || 0);
            if (amt > 0) {
                totalMPOPayments += amt;
                const mKey = getInvoiceMonthKey(p.date || p.createdAt);
                if (!newMonthly[mKey]) {
                    newMonthly[mKey] = {
                        monthKey: mKey,
                        monthName: getMonthNameBangla(mKey),
                        totalSales: 0,
                        customerCollection: 0,
                        totalPaid: 0,
                        invoiceCount: 0,
                        startInvoice: 0,
                        endInvoice: 0,
                        targetAmount: existingMonthly[mKey]?.targetAmount || 0,
                        updatedAt: new Date().toISOString()
                    };
                }
                newMonthly[mKey].totalPaid = (parseFloat(newMonthly[mKey].totalPaid || 0)) + amt;
            }
        });

        // Preserve previous targets and months
        Object.entries(existingMonthly).forEach(([k, prev]) => {
            if (!newMonthly[k]) {
                newMonthly[k] = { ...prev };
            } else {
                if (prev.targetAmount && !newMonthly[k].targetAmount) {
                    newMonthly[k].targetAmount = prev.targetAmount;
                }
                if (prev.totalPaid != null && newMonthly[k].totalPaid == null) {
                    newMonthly[k].totalPaid = prev.totalPaid;
                }
            }
        });

        // Save to Firestore
        const userUpdatePayload = {
            monthlyStats: newMonthly,
            customerCollection: totalCustCollection,
            invoiceCounter: Math.max(parseInt(userData.invoiceCounter) || 0, maxOverallInvNum),
            updatedAt: serverTimestamp()
        };
        if (mpoPayments.length > 0) {
            userUpdatePayload.totalPaid = totalMPOPayments;
        }
        await updateDoc(userRef, userUpdatePayload);

        return newMonthly;
    } catch (e) {
        console.error("Error syncing monthly stats:", e);
        return null;
    }
}

// ==================== MPO Office Deposit / Accounting Helpers (অফিস জমা ও রোলব্যাক) ====================
/**
 * Records an MPO payment to the office/owner:
 * 1. Appends payment entry to users/{userId}.payments array.
 * 2. Increments users/{userId}.totalPaid.
 * 3. Adds amount to users/{userId}.monthlyStats[monthKey].totalPaid.
 * 4. Bumps salesVersion in settings/appConfig.
 */
export async function recordMPOPayment(userId, amount, dateInput, noteInput) {
    if (!userId || !amount || amount <= 0 || !db) throw new Error("Invalid payment parameters");
    const userRef = doc(db, "users", userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) throw new Error("MPO user not found");

    const userData = userSnap.data();
    const dateStr = dateInput || new Date().toISOString().slice(0, 10);
    const noteStr = (noteInput || '').trim() || 'অফিস ক্যাশ জমা';
    const monthKey = getInvoiceMonthKey(dateStr);
    const monthName = getMonthNameBangla(monthKey);

    const paymentEntry = {
        paymentId: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        amount: parseFloat(amount),
        date: dateStr,
        note: noteStr,
        createdAt: new Date().toISOString()
    };

    const monthlyStats = userData.monthlyStats || {};
    const curMonth = monthlyStats[monthKey] || {
        monthKey,
        monthName,
        totalSales: 0,
        customerCollection: 0,
        totalPaid: 0,
        invoiceCount: 0,
        startInvoice: 0,
        endInvoice: 0,
        targetAmount: 0
    };
    curMonth.totalPaid = (parseFloat(curMonth.totalPaid || 0)) + amount;
    curMonth.updatedAt = new Date().toISOString();

    await updateDoc(userRef, {
        payments: arrayUnion(paymentEntry),
        totalPaid: increment(amount),
        [`monthlyStats.${monthKey}`]: curMonth,
        updatedAt: serverTimestamp()
    });

    try {
        await setDoc(COMPANY_STATS_DOC_REF(), {
            totalPaid: increment(amount),
            updatedAt: serverTimestamp()
        }, { merge: true });
    } catch (_) {}

    try {
        await updateDoc(doc(db, "settings", "appConfig"), {
            salesVersion: increment(1)
        });
    } catch (_) {}
    try { localStorage.removeItem(`admin_cache_sales_${userId}`); } catch (_) {}
    try { localStorage.removeItem(CACHE_KEYS.USERS); } catch (_) {}
    try { localStorage.removeItem(ADMIN_USERS_CACHE); } catch (_) {}
    try { localStorage.removeItem(CACHE_COMPANY_STATS); } catch (_) {}
    try {
        await appCache.remove(`admin_cache_sales_${userId}`);
        await appCache.remove(CACHE_KEYS.USERS);
        await appCache.remove(ADMIN_USERS_CACHE);
        await appCache.remove(CACHE_COMPANY_STATS);
    } catch (_) {}

    return paymentEntry;
}

/**
 * Deletes an MPO payment entry:
 * 1. Removes payment entry from users/{userId}.payments array.
 * 2. Decrements users/{userId}.totalPaid.
 * 3. Decrements users/{userId}.monthlyStats[monthKey].totalPaid.
 * 4. Bumps salesVersion in settings/appConfig.
 */
export async function deleteMPOPayment(userId, paymentId) {
    if (!userId || !paymentId || !db) throw new Error("Invalid parameters");
    const userRef = doc(db, "users", userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) throw new Error("MPO user not found");

    const userData = userSnap.data();
    const payments = Array.isArray(userData.payments) ? userData.payments : [];
    const targetPayment = payments.find(p => p.paymentId === paymentId);
    if (!targetPayment) throw new Error("Payment entry not found");

    const amount = parseFloat(targetPayment.amount || 0);
    const curTotalPaid = parseFloat(userData.totalPaid || 0);
    const newTotalPaid = Math.max(0, curTotalPaid - amount);

    const monthKey = getInvoiceMonthKey(targetPayment.date || targetPayment.createdAt);
    const monthlyStats = userData.monthlyStats || {};
    const curMonth = monthlyStats[monthKey];

    const updates = {
        payments: arrayRemove(targetPayment),
        totalPaid: newTotalPaid,
        updatedAt: serverTimestamp()
    };

    if (curMonth) {
        curMonth.totalPaid = Math.max(0, (parseFloat(curMonth.totalPaid || 0)) - amount);
        curMonth.updatedAt = new Date().toISOString();
        updates[`monthlyStats.${monthKey}`] = curMonth;
    }

    await updateDoc(userRef, updates);

    try {
        await setDoc(COMPANY_STATS_DOC_REF(), {
            totalPaid: increment(-amount),
            updatedAt: serverTimestamp()
        }, { merge: true });
    } catch (_) {}

    try {
        await updateDoc(doc(db, "settings", "appConfig"), {
            salesVersion: increment(1)
        });
    } catch (_) {}
    try { localStorage.removeItem(`admin_cache_sales_${userId}`); } catch (_) {}
    try { localStorage.removeItem(CACHE_KEYS.USERS); } catch (_) {}
    try { localStorage.removeItem(ADMIN_USERS_CACHE); } catch (_) {}
    try { localStorage.removeItem(CACHE_COMPANY_STATS); } catch (_) {}
    try {
        await appCache.remove(`admin_cache_sales_${userId}`);
        await appCache.remove(CACHE_KEYS.USERS);
        await appCache.remove(ADMIN_USERS_CACHE);
        await appCache.remove(CACHE_COMPANY_STATS);
    } catch (_) {}

    return { targetPayment, newTotalPaid };
}

// ==================== Customer Collection Helpers (নিলাম ও রিকভারি) ====================
/**
 * Records a customer payment ("নিলাম") in the MPO's user profile:
 * 1. Permanently adds to users/{userId}.customerCollection (lifetime total).
 * 2. Adds to monthlyStats[monthKey].customerCollection (monthly total for that specific month).
 */
export async function recordCustomerCollection(userId, amount, dateInput) {
    if (!userId || !amount || amount <= 0 || !db) return;
    try {
        const userRef = doc(db, "users", userId);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) return;

        const userData = userSnap.data();
        const monthKey = getInvoiceMonthKey(dateInput || new Date());
        const monthName = getMonthNameBangla(monthKey);

        const monthlyStats = userData.monthlyStats || {};
        const curMonth = monthlyStats[monthKey] || {
            monthKey,
            monthName,
            totalSales: 0,
            customerCollection: 0,
            invoiceCount: 0,
            startInvoice: 0,
            endInvoice: 0,
            targetAmount: 0
        };

        curMonth.customerCollection = (parseFloat(curMonth.customerCollection || 0)) + amount;
        curMonth.updatedAt = new Date().toISOString();

        await updateDoc(userRef, {
            customerCollection: increment(amount),
            [`monthlyStats.${monthKey}`]: curMonth,
            updatedAt: serverTimestamp()
        });

        try {
            await updateDoc(doc(db, "settings", "appConfig"), {
                salesVersion: increment(1)
            });
        } catch (_) {}
        try { localStorage.removeItem(`admin_cache_sales_${userId}`); } catch (_) {}
        try { localStorage.removeItem(CACHE_KEYS.USERS); } catch (_) {}
        try {
            await appCache.remove(`admin_cache_sales_${userId}`);
            await appCache.remove(CACHE_KEYS.USERS);
            await appCache.remove(ADMIN_USERS_CACHE);
            await appCache.remove(CACHE_COMPANY_STATS);
        } catch (_) {}
    } catch (e) {
        console.error("Error in recordCustomerCollection:", e);
    }
}

/**
 * Rolls back a customer payment when a "নিলাম" entry is deleted:
 * 1. Deducts amount from users/{userId}.customerCollection (permanent lifetime total).
 * 2. Deducts amount from monthlyStats[monthKey].customerCollection (that specific month's total).
 */
export async function rollbackCustomerCollection(userId, amount, dateInput) {
    if (!userId || !amount || amount <= 0 || !db) return;
    try {
        const userRef = doc(db, "users", userId);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) return;

        const userData = userSnap.data();
        const curTotal = parseFloat(userData.customerCollection || 0);
        const newTotal = Math.max(0, curTotal - amount);

        const monthKey = getInvoiceMonthKey(dateInput || new Date());
        const monthlyStats = userData.monthlyStats || {};
        const curMonth = monthlyStats[monthKey];

        const updates = {
            customerCollection: newTotal,
            updatedAt: serverTimestamp()
        };

        if (curMonth) {
            curMonth.customerCollection = Math.max(0, (parseFloat(curMonth.customerCollection || 0)) - amount);
            curMonth.updatedAt = new Date().toISOString();
            updates[`monthlyStats.${monthKey}`] = curMonth;
        }

        await updateDoc(userRef, updates);

        try {
            await updateDoc(doc(db, "settings", "appConfig"), {
                salesVersion: increment(1)
            });
        } catch (_) {}
        try { localStorage.removeItem(`admin_cache_sales_${userId}`); } catch (_) {}
        try { localStorage.removeItem(CACHE_KEYS.USERS); } catch (_) {}
        try {
            await appCache.remove(`admin_cache_sales_${userId}`);
            await appCache.remove(CACHE_KEYS.USERS);
            await appCache.remove(ADMIN_USERS_CACHE);
            await appCache.remove(CACHE_COMPANY_STATS);
        } catch (_) {}
    } catch (e) {
        console.error("Error in rollbackCustomerCollection:", e);
    }
}

// ==================== Company Stats Helpers (Option 1: Single Summary Document) ====================
export const COMPANY_STATS_DOC_REF = () => doc(db, "settings", "companyStats");
export const CACHE_COMPANY_STATS = 'erp_cached_company_stats_v1';

/**
 * Loads company stats from settings/companyStats.
 * If document doesn't exist yet, auto-syncs from all users in Firestore and saves it.
 * Uses a short-lived IndexedDB cache (15s) to prevent redundant reads on fast page switches.
 */
export async function getOrSyncCompanyStats(force = false) {
    if (!db) return { totalSales: 0, totalPaid: 0, totalInvoices: 0, mpoCount: 0, totalDue: 0 };

    if (!force) {
        try {
            const cached = await appCache.get(CACHE_COMPANY_STATS);
            if (cached) {
                const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
                if (parsed && (Date.now() - (parsed._cachedAt || 0) < 15000)) {
                    return parsed;
                }
            }
        } catch (_) {}
    }

    try {
        const statsRef = COMPANY_STATS_DOC_REF();
        const snap = await getDoc(statsRef);
        if (snap.exists()) {
            const data = snap.data();
            const totalSales = parseFloat(data.totalSales || 0);
            const totalPaid  = parseFloat(data.totalPaid || 0);
            const totalInvoices = parseInt(data.totalInvoices || 0);
            const mpoCount = parseInt(data.mpoCount || 0);
            const totalDue = Math.max(0, totalSales - totalPaid);

            const result = {
                totalSales,
                totalPaid,
                totalInvoices,
                mpoCount,
                totalDue,
                _cachedAt: Date.now()
            };
            try { await appCache.set(CACHE_COMPANY_STATS, result); } catch (_) {}
            return result;
        }

        // If doc does not exist, run initial sync/migration from users collection
        return await syncCompanyStats();
    } catch (e) {
        console.error("Error fetching company stats:", e);
        try {
            const cached = await appCache.get(CACHE_COMPANY_STATS);
            if (cached) return typeof cached === 'string' ? JSON.parse(cached) : cached;
        } catch (_) {}
        return { totalSales: 0, totalPaid: 0, totalInvoices: 0, mpoCount: 0, totalDue: 0 };
    }
}

/**
 * Calculates totalSales, totalPaid, totalInvoices, and mpoCount from users collection,
 * saves to settings/companyStats, and updates local cache.
 */
export async function syncCompanyStats() {
    if (!db) return { totalSales: 0, totalPaid: 0, totalInvoices: 0, mpoCount: 0, totalDue: 0 };
    try {
        const usersSnap = await getDocs(collection(db, "users"));
        const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const mpos = allUsers.filter(u => u.id !== 'admin');

        let totalSales = 0, totalPaid = 0, totalInvoices = 0;
        mpos.forEach(u => {
            totalSales += parseFloat(u.totalSales || 0);
            totalPaid  += parseFloat(u.totalPaid  || 0);
            totalInvoices += parseInt(u.invoiceCount || 0);
        });
        const mpoCount = mpos.length;
        const totalDue = Math.max(0, totalSales - totalPaid);

        const statsData = {
            totalSales,
            totalPaid,
            totalInvoices,
            mpoCount,
            updatedAt: serverTimestamp()
        };

        await setDoc(COMPANY_STATS_DOC_REF(), statsData, { merge: true });

        const result = {
            totalSales,
            totalPaid,
            totalInvoices,
            mpoCount,
            totalDue,
            _cachedAt: Date.now()
        };
        try { await appCache.set(CACHE_COMPANY_STATS, result); } catch (_) {}
        return result;
    } catch (e) {
        console.error("Error syncing company stats:", e);
        return { totalSales: 0, totalPaid: 0, totalInvoices: 0, mpoCount: 0, totalDue: 0 };
    }
}

// ==================== Customer Summary Helpers (Single Summary Document) ====================
export const CUSTOMERS_SUMMARY_DOC = 'customersSummary';
export const CUSTOMERS_SUMMARY_DOC_REF = () => doc(db, "settings", CUSTOMERS_SUMMARY_DOC);
export const CACHE_CUSTOMERS_SUMMARY = 'erp_cached_customers_summary_v1';

/**
 * Normalizes customer summary data from Firestore document snapshot.
 * Handles both standard nested `list: { custId: { ... } }` and flat dotted keys (`list.custId.field`).
 */
export function normalizeCustomerSummaryData(data) {
    if (!data) return { list: {}, hadFlatKeys: false };
    const list = {};
    let hadFlatKeys = false;

    // 1. If standard nested 'list' map exists
    if (data.list && typeof data.list === 'object') {
        Object.entries(data.list).forEach(([id, cust]) => {
            if (cust && typeof cust === 'object') {
                list[id] = { id, ...cust };
            }
        });
    }

    // 2. Parse flat dotted keys like "list.c_alif_123.billTo" or "c_alif_123.billTo"
    Object.entries(data).forEach(([key, val]) => {
        if (key === 'list' || key === 'updatedAt' || key === 'count' || key === 'version') return;

        if (key.startsWith('list.')) {
            hadFlatKeys = true;
            const parts = key.split('.');
            if (parts.length >= 3) {
                const custId = parts[1];
                const field = parts.slice(2).join('.');
                if (!list[custId]) list[custId] = { id: custId };
                list[custId][field] = val;
            }
        } else if (key.includes('.')) {
            hadFlatKeys = true;
            const parts = key.split('.');
            if (parts.length === 2 && parts[0].startsWith('c_')) {
                const custId = parts[0];
                const field = parts[1];
                if (!list[custId]) list[custId] = { id: custId };
                list[custId][field] = val;
            }
        }
    });

    // Normalize types & values for each customer
    Object.values(list).forEach(c => {
        c.totalSales = parseFloat(c.totalSales || 0);
        c.totalPaid  = parseFloat(c.totalPaid || 0);
        c.billTo = (c.billTo || '').trim();
        c.shipTo = (c.shipTo || '').trim();
        c.phone  = (c.phone || '').trim();
        c.mpo    = c.mpo || c.user || '';
    });

    return { list, hadFlatKeys };
}

/**
 * Loads the complete customer summary map from doc(db, "settings", "customersSummary").
 * If the doc does not exist, it automatically auto-migrates from the `customers` collection.
 * Guaranteed 1 Firestore read on normal operation (and 0 reads from cache).
 */
export async function getOrSyncCustomersSummary(force = false) {
    if (!db) return {};

    if (!force) {
        try {
            const cached = await appCache.get(CACHE_CUSTOMERS_SUMMARY);
            if (cached) {
                const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
                if (parsed && (Date.now() - (parsed._cachedAt || 0) < 15000)) {
                    return parsed.list || {};
                }
            }
        } catch (_) {}
    }

    try {
        const snap = await getDoc(CUSTOMERS_SUMMARY_DOC_REF());
        if (snap.exists()) {
            const data = snap.data();
            const { list, hadFlatKeys } = normalizeCustomerSummaryData(data);

            // If it had flat keys or nested list was missing, auto-clean and save clean map
            if (hadFlatKeys || !data.list || Object.keys(data.list).length === 0) {
                if (Object.keys(list).length > 0) {
                    try {
                        await setDoc(CUSTOMERS_SUMMARY_DOC_REF(), {
                            list: list,
                            count: Object.keys(list).length,
                            updatedAt: serverTimestamp()
                        });
                    } catch (cleanErr) {
                        console.warn("Cleanup customersSummary warning:", cleanErr);
                    }
                } else {
                    return await syncCustomersSummary();
                }
            }

            try {
                await appCache.set(CACHE_CUSTOMERS_SUMMARY, { list, _cachedAt: Date.now() });
            } catch (_) {}
            return list;
        }

        // If doc does not exist, run initial migration/sync
        return await syncCustomersSummary();
    } catch (e) {
        console.error("Error fetching customersSummary:", e);
        try {
            const cached = await appCache.get(CACHE_CUSTOMERS_SUMMARY);
            if (cached) {
                const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
                return parsed?.list || {};
            }
        } catch (_) {}
        return {};
    }
}

/**
 * Calculates customer summary map directly from `customers` collection,
 * saves to doc(db, "settings", "customersSummary"), and updates cache.
 */
export async function syncCustomersSummary() {
    if (!db) return {};
    try {
        const snap = await getDocs(collection(db, "customers"));
        const summaryList = {};

        snap.docs.forEach(d => {
            const data = d.data();
            if (data.deleted) return;
            const billTo = (data.billTo || '').trim();
            if (!billTo && !data.user) return;

            summaryList[d.id] = {
                id: d.id,
                mpo: data.user || data.mpo || '',
                billTo: billTo,
                shipTo: (data.shipTo || '').trim(),
                phone: (data.phone || '').trim(),
                totalSales: parseFloat(data.totalSales || 0),
                totalPaid: parseFloat(data.totalPaid || 0),
                updatedAt: data.updatedAt ? (data.updatedAt.toDate ? data.updatedAt.toDate().toISOString() : String(data.updatedAt)) : new Date().toISOString()
            };
        });

        await setDoc(CUSTOMERS_SUMMARY_DOC_REF(), {
            list: summaryList,
            count: Object.keys(summaryList).length,
            updatedAt: serverTimestamp()
        });

        try {
            await appCache.set(CACHE_CUSTOMERS_SUMMARY, { list: summaryList, _cachedAt: Date.now() });
        } catch (_) {}

        return summaryList;
    } catch (e) {
        console.error("Error in syncCustomersSummary:", e);
        return {};
    }
}

// ==================== Customer ID Generation ====================
export function getCustomerDocId(userId, billTo) {
    const normalized = (billTo || '').trim().toLowerCase();
    let h = 0;
    const s = `${userId}|${normalized}`;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h) + s.charCodeAt(i);
        h |= 0;
    }
    return `c_${userId}_${Math.abs(h)}`;
}

// ==================== Unified Invoice Delete With Complete Rollback ====================
/**
 * Permanently deletes an invoice and performs full atomic rollback:
 * 1. Restores product stock (increment quantity for each item) in Firestore 'stocks'.
 * 2. Deducts invoice amount from MPO user's permanent sales ('totalSales') and count ('invoiceCount').
 * 3. Rolls back MPO user's current month sales ('monthlyStats[monthKey].totalSales') and invoice range.
 * 4. Rolls back customer's sales ('customers[custId].totalSales' / 'দিলাম') and removes the corresponding transaction entry.
 * 5. Deducts invoice amount from dailyStats ('settings/dailyStats').
 * 6. Deletes the invoice document ('invoices/{id}') and any associated delete request ('deleteRequests/{id}').
 * 7. Bumps versions in 'settings/appConfig' (salesVersion, historyVersion, stockVersion, customerVersion).
 * 8. Cleans up local caches (admin_cache_sales, admin_cache_customers, etc.).
 *
 * @param {string} invoiceId - ID of invoice to delete
 * @param {object} [existingInvData] - Optional pre-loaded invoice data
 * @returns {Promise<object>} - Rollback summary
 */
export async function deleteInvoiceWithRestore(invoiceId, existingInvData = null) {
    if (!invoiceId || !db) throw new Error("Invalid invoice ID or DB not connected");

    // 1. Fetch invoice data if not provided
    let inv = existingInvData;
    const invRef = doc(db, "invoices", invoiceId);
    if (!inv) {
        try {
            const snap = await getDoc(invRef);
            if (snap.exists()) {
                inv = { id: invoiceId, ...snap.data() };
            }
        } catch (_) {}

        if (!inv) {
            try {
                const recentSnap = await getDoc(RECENT_INVOICES_DOC_REF());
                if (recentSnap.exists()) {
                    const rData = recentSnap.data();
                    const list = rData.list || {};
                    if (list[invoiceId]) {
                        inv = { id: invoiceId, ...list[invoiceId] };
                    }
                }
            } catch (_) {}
        }

        if (!inv) {
            try {
                const delSnap = await getDoc(doc(db, "deleteRequests", invoiceId));
                if (delSnap.exists()) {
                    const dData = delSnap.data();
                    inv = { id: invoiceId, ...dData };
                }
            } catch (_) {}
        }

        if (!inv) throw new Error("Invoice not found");
    }

    const rawTotal = String(inv.grandTotal || '0').replace(/[^0-9.-]/g, '');
    const grandTotal = parseFloat(rawTotal) || 0;
    const userId = inv.user;
    const billTo = (inv.billTo || '').trim();
    const batch = writeBatch(db);

    // 2. Stock Recovery: loop through items (handling both qty and quantity fields)
    const restoredStocks = {};
    if (Array.isArray(inv.items)) {
        for (const item of inv.items) {
            const rawQty = item.qty != null ? item.qty : (item.quantity != null ? item.quantity : 0);
            const qty = parseFloat(rawQty) || 0;
            if (item.productId && qty > 0) {
                const stockRef = doc(db, "stocks", item.productId);
                batch.set(stockRef, {
                    productId: item.productId,
                    quantity: increment(qty),
                    updatedAt: serverTimestamp()
                }, { merge: true });
                restoredStocks[item.productId] = (restoredStocks[item.productId] || 0) + qty;
            }
        }
    }

    // 3. User Accounting Rollback (Permanent Account + Current Month / চলিত হিসাব)
    let userSnapData = null;
    if (userId) {
        const userRef = doc(db, "users", userId);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            userSnapData = userSnap.data();
            const curSales = parseFloat(userSnapData.totalSales || 0);
            const curCount = parseInt(userSnapData.invoiceCount || 0);
            const newSales = Math.max(0, curSales - grandTotal);
            const newCount = Math.max(0, curCount - 1);

            const userUpdates = {
                totalSales: newSales,
                invoiceCount: newCount,
                updatedAt: serverTimestamp()
            };

            // Monthly stats rollback (চলিত হিসাব)
            const monthKey = getInvoiceMonthKey(inv.timestamp || inv.date || inv.updatedAt || new Date());
            const monthlyStats = userSnapData.monthlyStats || {};
            const curMonth = monthlyStats[monthKey];
            const delInvNum = extractInvoiceNumber(inv.invoiceNumber);

            if (curMonth) {
                const newMonthSales = Math.max(0, (parseFloat(curMonth.totalSales || 0)) - grandTotal);
                const newMonthCount = Math.max(0, (parseInt(curMonth.invoiceCount || 0)) - 1);
                curMonth.totalSales = newMonthSales;
                curMonth.invoiceCount = newMonthCount;

                if (newMonthCount === 0) {
                    curMonth.startInvoice = 0;
                    curMonth.endInvoice = 0;
                } else {
                    if (curMonth.endInvoice === delInvNum) {
                        curMonth.endInvoice = Math.max(curMonth.startInvoice || 0, delInvNum - 1);
                    }
                    if (curMonth.startInvoice === delInvNum) {
                        curMonth.startInvoice = Math.min(curMonth.endInvoice || (delInvNum + 1), delInvNum + 1);
                    }
                }
                curMonth.updatedAt = new Date().toISOString();
                userUpdates[`monthlyStats.${monthKey}`] = curMonth;
            }

            // Roll back invoiceCounter if this was the latest invoice created
            const curCounter = parseInt(userSnapData.invoiceCounter || 0);
            if (curCounter === delInvNum && delInvNum > 0) {
                userUpdates.invoiceCounter = Math.max(0, delInvNum - 1);
            }

            batch.update(userRef, userUpdates);
        }
    }

    // 4. Customer Ledger Rollback (স্পেসিফিক কাস্টমারের বিক্রয় এর টাকা / দিলাম ও লেনদেন ট্রানজ্যাকশন রিভার্স)
    let targetCustDocId = null;
    let targetCustDocRef = null;
    let updatedCustData = null;

    if (userId && billTo) {
        const custDocId = getCustomerDocId(userId, billTo);
        targetCustDocId = custDocId;
        targetCustDocRef = doc(db, "customers", custDocId);
        let custSnap = await getDoc(targetCustDocRef);

        // Fallback: If not found by deterministic hash ID, check by user + billTo query
        if (!custSnap.exists()) {
            const q = query(collection(db, "customers"), where("user", "==", userId));
            const qSnap = await getDocs(q);
            const found = qSnap.docs.find(d => {
                const dData = d.data();
                return (dData.billTo || '').trim().toLowerCase() === billTo.toLowerCase();
            });
            if (found) {
                custSnap = found;
                targetCustDocId = found.id;
                targetCustDocRef = doc(db, "customers", targetCustDocId);
            }
        }

        if (custSnap.exists()) {
            const custData = custSnap.data();
            const curCustSales = parseFloat(custData.totalSales || 0);
            const newCustSales = Math.max(0, curCustSales - grandTotal);

            // Filter out the transaction entry belonging to this deleted invoice
            const txns = Array.isArray(custData.transactions) ? custData.transactions : [];
            let removed = false;
            const remainingTxns = [];

            for (const t of txns) {
                if (!removed) {
                    const invNum = inv.invoiceNumber != null ? String(inv.invoiceNumber).trim() : '';
                    const tNote = t.note != null ? String(t.note).trim() : '';
                    const isNoteExact = invNum && tNote === invNum;
                    const isNoteContained = invNum && tNote.length > 0 && (tNote.includes(invNum) || invNum.includes(tNote));
                    const isTypeSaleMatch = (!invNum || !tNote) && t.type === 'sale' && Math.abs((parseFloat(t.amount) || 0) - grandTotal) < 0.01;

                    if (isNoteExact || isNoteContained || isTypeSaleMatch) {
                        removed = true;
                        continue; // Skip/remove this transaction
                    }
                }
                remainingTxns.push(t);
            }

            updatedCustData = {
                ...custData,
                id: targetCustDocId,
                totalSales: newCustSales,
                transactions: remainingTxns
            };

            batch.update(targetCustDocRef, {
                totalSales: newCustSales,
                transactions: remainingTxns,
                lastUpdated: new Date().toISOString(),
                updatedAt: serverTimestamp()
            });

            // 4b. Customer Summary Document Rollback (Single Document)
            batch.set(CUSTOMERS_SUMMARY_DOC_REF(), {
                list: {
                    [targetCustDocId]: {
                        totalSales: increment(-grandTotal),
                        updatedAt: serverTimestamp()
                    }
                },
                updatedAt: serverTimestamp()
            }, { merge: true });
        }
    }

    // 5. Daily Stats Rollback
    if (grandTotal > 0 && (inv.timestamp || inv.date || inv.updatedAt)) {
        let tsDate = new Date();
        if (inv.timestamp) {
            const t = new Date(inv.timestamp);
            if (!isNaN(t.getTime())) tsDate = t;
        } else if (inv.date) {
            const t = new Date(inv.date);
            if (!isNaN(t.getTime())) tsDate = t;
        }
        const dateKey = tsDate.toLocaleDateString('en-CA');
        batch.set(doc(db, "settings", "dailyStats"), {
            [dateKey]: increment(-grandTotal)
        }, { merge: true });
    }

    // 5b. Company Stats Rollback (মোট বিক্রয় ও ইনভয়েস সংখ্যা থেকে মাইনাস, মোট বাকি স্বয়ংক্রিয়ভাবে হ্রাস)
    if (grandTotal > 0) {
        batch.set(COMPANY_STATS_DOC_REF(), {
            totalSales: increment(-grandTotal),
            totalInvoices: increment(-1),
            updatedAt: serverTimestamp()
        }, { merge: true });
    }

    // 6. Delete the Invoice and DeleteRequest
    batch.delete(invRef);
    batch.delete(doc(db, "deleteRequests", invoiceId));

    // Remove from mpo_invoices bucket if bucketId or user is known
    const bucketId = inv.bucketId || (inv.user ? `${inv.user}_part_${inv.part || 1}` : null);
    if (bucketId) {
        batch.set(doc(db, "mpo_invoices", bucketId), {
            count: increment(-1),
            invoices: {
                [invoiceId]: deleteField()
            },
            updatedAt: serverTimestamp()
        }, { merge: true });
    }

    // Remove from global recentInvoices feed
    batch.set(RECENT_INVOICES_DOC_REF(), {
        list: {
            [invoiceId]: deleteField()
        },
        updatedAt: serverTimestamp()
    }, { merge: true });

    // 7. Bump Version Counters in settings/appConfig
    const configRef = doc(db, "settings", "appConfig");
    const versionBumps = {
        salesVersion: increment(1),
        historyVersion: increment(1)
    };
    if (Object.keys(restoredStocks).length > 0) versionBumps.stockVersion = increment(1);
    if (targetCustDocId) versionBumps.customerVersion = increment(1);
    batch.set(configRef, versionBumps, { merge: true });

    // Commit all changes in a single atomic Firestore batch!
    await batch.commit();

    // 8. Cache Invalidation
    if (userId) {
        try { localStorage.removeItem(`admin_cache_sales_${userId}`); } catch (_) {}
        try { localStorage.removeItem(`admin_cache_customers_${userId}`); } catch (_) {}
        try {
            await appCache.remove(`admin_cache_sales_${userId}`);
            await appCache.remove(`admin_cache_customers_${userId}`);
        } catch (_) {}
    }
    try { localStorage.removeItem(CACHE_KEYS.USERS); } catch (_) {}
    try { localStorage.removeItem('cachedUsers_v1_1'); } catch (_) {}
    try { localStorage.removeItem(CACHE_COMPANY_STATS); } catch (_) {}
    try { localStorage.removeItem(CACHE_CUSTOMERS_SUMMARY); } catch (_) {}
    try {
        await appCache.remove(CACHE_KEYS.USERS);
        await appCache.remove('cachedUsers_v1_1');
        await appCache.remove(ADMIN_USERS_CACHE);
        await appCache.remove(CACHE_COMPANY_STATS);
        await appCache.remove(CACHE_CUSTOMERS_SUMMARY);
    } catch (_) {}

    return {
        invoice: inv,
        restoredStocks,
        userId,
        targetCustDocId,
        updatedCustData
    };
}

// ==================== Single-Document Product Storage Helpers ====================
export const PRODUCTS_DOC_REF = () => doc(db, "settings", "productsList");

/**
 * Loads the complete products map from doc(db, "settings", "productsList").
 * If the doc does not exist or has empty items, it checks the legacy `products` collection,
 * migrates all active products into `settings/productsList`, and saves it.
 * Guaranteed 1 Firestore read on normal operation.
 */
export async function getOrMigrateProductsList() {
    if (!db) return {};
    try {
        const prodDoc = await getDoc(PRODUCTS_DOC_REF());
        if (prodDoc.exists()) {
            const data = prodDoc.data();
            const items = data.items || {};
            // Return only active (not deleted) products map
            const active = {};
            Object.values(items).forEach(p => {
                if (p && !p.deleted && p.id) active[p.id] = p;
            });
            return active;
        }

        // Auto-migration from legacy "products" collection
        console.log("Migrating products to single document 'settings/productsList'...");
        const legacySnap = await getDocs(collection(db, "products"));
        const migratedItems = {};
        legacySnap.docs.forEach(d => {
            const data = d.data();
            if (!data.deleted) {
                migratedItems[d.id] = {
                    id: d.id,
                    name: data.name || '',
                    price: parseFloat(data.price) || 0,
                    boxSize: data.boxSize || 1,
                    unit: data.unit || ''
                };
            }
        });

        await setDoc(PRODUCTS_DOC_REF(), {
            items: migratedItems,
            updatedAt: serverTimestamp(),
            count: Object.keys(migratedItems).length
        });

        return migratedItems;
    } catch (e) {
        console.error("Error in getOrMigrateProductsList:", e);
        // Fallback to local cache if offline or error
        try {
            const cached = await appCache.get(CACHE_KEYS.PRODUCTS);
            if (cached) return cached;
            const local = localStorage.getItem(CACHE_KEYS.PRODUCTS);
            if (local) return JSON.parse(local);
        } catch (_) {}
        return {};
    }
}

/**
 * Saves or updates a single product in doc(db, "settings", "productsList").
 * If it's a new product, automatically initializes doc(db, "stocks", productId) with quantity 0.
 */
export async function saveProductToSingleDoc(product) {
    if (!db) throw new Error("Database not connected");
    const id = product.id || doc(collection(db, "products")).id;
    const isNew = !product.id;

    const prodEntry = {
        id,
        name: product.name,
        price: parseFloat(product.price) || 0,
        boxSize: product.boxSize || 1,
        unit: product.unit || '',
        updatedAt: new Date().toISOString()
    };

    // Update single doc in settings/productsList
    await setDoc(PRODUCTS_DOC_REF(), {
        items: {
            [id]: prodEntry
        },
        updatedAt: serverTimestamp()
    }, { merge: true });

    // If new product, initialize stock document with 0
    if (isNew) {
        try {
            const stockRef = doc(db, "stocks", id);
            const stockSnap = await getDoc(stockRef);
            if (!stockSnap.exists()) {
                await setDoc(stockRef, {
                    productId: id,
                    quantity: 0,
                    updatedAt: serverTimestamp()
                });
            }
        } catch (stockErr) {
            console.warn("Stock init error:", stockErr);
        }
    }

    return prodEntry;
}

/**
 * Deletes a product from doc(db, "settings", "productsList")
 * AND automatically deletes doc(db, "stocks", productId).
 */
export async function deleteProductFromSingleDoc(productId) {
    if (!db || !productId) return;
    // 1. Remove from settings/productsList
    await updateDoc(PRODUCTS_DOC_REF(), {
        [`items.${productId}`]: deleteField(),
        updatedAt: serverTimestamp()
    });

    // 2. Automatically delete from stocks collection
    try {
        await deleteDoc(doc(db, "stocks", productId));
    } catch (e) {
        console.warn("Stock cleanup error:", e);
    }
}

/**
 * Bulk saves products into doc(db, "settings", "productsList")
 * and initializes stock documents for new products with quantity 0.
 */
export async function saveBulkProductsToSingleDoc(productsList, overwriteAll = false) {
    if (!db || !Array.isArray(productsList) || !productsList.length) return [];
    const itemsMap = {};
    const newItems = [];

    productsList.forEach(p => {
        const id = p.id || doc(collection(db, "products")).id;
        const entry = {
            id,
            name: p.name,
            price: parseFloat(p.price) || 0,
            boxSize: p.boxSize || 1,
            unit: p.unit || '',
            updatedAt: new Date().toISOString()
        };
        itemsMap[id] = entry;
        if (!p.id) newItems.push(entry);
    });

    // Save to settings/productsList
    if (overwriteAll) {
        await setDoc(PRODUCTS_DOC_REF(), {
            items: itemsMap,
            updatedAt: serverTimestamp(),
            count: Object.keys(itemsMap).length
        });
    } else {
        await setDoc(PRODUCTS_DOC_REF(), {
            items: itemsMap,
            updatedAt: serverTimestamp()
        }, { merge: true });
    }

    // Initialize stocks in batches of 400
    for (let i = 0; i < newItems.length; i += 400) {
        const chunk = newItems.slice(i, i + 400);
        const batch = writeBatch(db);
        chunk.forEach(p => {
            batch.set(doc(db, "stocks", p.id), {
                productId: p.id,
                quantity: 0,
                updatedAt: serverTimestamp()
            }, { merge: true });
        });
        await batch.commit();
    }

    return Object.values(itemsMap);
}

// ==================== MPO 500-Invoice Bucket & Global Recent Invoices Architecture ====================
export const MPO_INVOICE_BUCKET_LIMIT = 500;
export const RECENT_INVOICES_LIMIT = 50;
export const RECENT_INVOICES_DOC = 'recentInvoices';
export const RECENT_INVOICES_DOC_REF = () => doc(db, "settings", RECENT_INVOICES_DOC);
export const CACHE_RECENT_INVOICES = 'erp_cached_recent_invoices_v1';
export const MPO_INVOICE_BUCKET_REF = (userId, part) => doc(db, "mpo_invoices", `${userId}_part_${part}`);

/**
 * Normalizes recent invoices from doc(db, "settings", "recentInvoices").
 * Supports both map format `{ list: { [id]: inv } }` and array format `{ list: [ ... ] }`.
 * Returns array sorted by date / updatedAt descending.
 */
export function normalizeRecentInvoices(data) {
    if (!data) return [];
    let list = [];
    if (Array.isArray(data.list)) {
        list = data.list;
    } else if (data.list && typeof data.list === 'object') {
        list = Object.entries(data.list).map(([id, inv]) => ({ id, ...inv }));
    } else {
        // Flat keys fallback
        Object.entries(data).forEach(([k, v]) => {
            if (k !== 'updatedAt' && k !== 'count' && v && typeof v === 'object' && v.grandTotal !== undefined) {
                list.push({ id: k, ...v });
            }
        });
    }

    const getTs = (inv) => {
        const u = inv.updatedAt || inv.timestamp || inv.date;
        if (!u) return 0;
        if (u.seconds) return u.seconds * 1000;
        if (u.toMillis) return u.toMillis();
        const d = new Date(u);
        return isNaN(d.getTime()) ? 0 : d.getTime();
    };

    return list.sort((a, b) => getTs(b) - getTs(a));
}

/**
 * Gets or initializes the recent invoices feed.
 * Guaranteed 1 read on normal visits.
 */
export async function getOrSyncRecentInvoices(force = false) {
    if (!db) return [];
    try {
        const snap = await getDoc(RECENT_INVOICES_DOC_REF());
        if (snap.exists()) {
            const data = snap.data();
            const invoices = normalizeRecentInvoices(data);
            if (invoices.length > 0 || !force) return invoices;
        }

        // Auto-migration from legacy invoices collection if recentInvoices is empty
        console.log("Populating initial settings/recentInvoices...");
        const q = query(collection(db, "invoices"), orderBy("updatedAt", "desc"), limit(RECENT_INVOICES_LIMIT));
        let qSnap;
        try {
            qSnap = await getDocs(q);
        } catch (_) {
            qSnap = await getDocs(query(collection(db, "invoices"), limit(RECENT_INVOICES_LIMIT)));
        }

        const map = {};
        const items = [];
        qSnap.docs.forEach(d => {
            const inv = { id: d.id, ...d.data() };
            map[d.id] = inv;
            items.push(inv);
        });

        if (items.length > 0) {
            await setDoc(RECENT_INVOICES_DOC_REF(), {
                list: map,
                updatedAt: serverTimestamp(),
                count: items.length
            });
        }
        return items;
    } catch (e) {
        console.error("Error in getOrSyncRecentInvoices:", e);
        return [];
    }
}

/**
 * Loads invoices for a specific MPO user from mpo_invoices bucket.
 * Handles auto-migration from legacy invoices collection on Part 1.
 */
export async function getMpoInvoices(userId, part = 1) {
    if (!db || !userId) return { invoices: [], count: 0, part };
    try {
        const bucketRef = MPO_INVOICE_BUCKET_REF(userId, part);
        const snap = await getDoc(bucketRef);

        if (snap.exists()) {
            const data = snap.data();
            const invMap = data.invoices || {};
            const invList = Object.entries(invMap).map(([id, inv]) => ({ id, ...inv }));
            const count = data.count !== undefined ? data.count : invList.length;
            return { invoices: invList, count, part };
        }

        // If part is 1 and bucket doesn't exist, check legacy invoices collection
        if (part === 1) {
            const q = query(collection(db, "invoices"), where("user", "==", userId));
            const legSnap = await getDocs(q);
            if (!legSnap.empty) {
                const legInvoices = [];
                const invMap = {};
                legSnap.docs.forEach(d => {
                    const inv = {
                        id: d.id,
                        bucketId: `${userId}_part_1`,
                        part: 1,
                        ...d.data()
                    };
                    legInvoices.push(inv);
                    invMap[d.id] = inv;
                });

                // Auto-migrate to mpo_invoices/${userId}_part_1
                await setDoc(bucketRef, {
                    mpo: userId,
                    part: 1,
                    count: legInvoices.length,
                    invoices: invMap,
                    updatedAt: serverTimestamp()
                });

                return { invoices: legInvoices, count: legInvoices.length, part: 1 };
            }
        }

        return { invoices: [], count: 0, part };
    } catch (e) {
        console.error("Error in getMpoInvoices:", e);
        return { invoices: [], count: 0, part };
    }
}

/**
 * Determines the target active bucket for a user when creating a new invoice.
 * Checks current count of activeBucketPart. If count >= 500, increments to next part.
 */
export async function determineMpoActiveBucket(userId, userSnapData = null) {
    if (!userId || !db) return { part: 1, bucketId: `${userId}_part_1` };
    try {
        let currentPart = userSnapData?.activeBucketPart || 1;
        if (!userSnapData) {
            const uSnap = await getDoc(doc(db, "users", userId));
            if (uSnap.exists()) {
                currentPart = uSnap.data().activeBucketPart || 1;
            }
        }

        const bucketRef = MPO_INVOICE_BUCKET_REF(userId, currentPart);
        const bSnap = await getDoc(bucketRef);

        let activeCount = 0;
        if (bSnap.exists()) {
            const bData = bSnap.data();
            activeCount = bData.count !== undefined ? bData.count : Object.keys(bData.invoices || {}).length;
        }

        // If current bucket has 500 or more invoices, switch to next part!
        if (activeCount >= MPO_INVOICE_BUCKET_LIMIT) {
            const nextPart = currentPart + 1;
            return { part: nextPart, bucketId: `${userId}_part_${nextPart}`, isNewPart: true };
        }

        return { part: currentPart, bucketId: `${userId}_part_${currentPart}`, isNewPart: false };
    } catch (e) {
        console.warn("determineMpoActiveBucket fallback:", e);
        return { part: 1, bucketId: `${userId}_part_1`, isNewPart: false };
    }
}


