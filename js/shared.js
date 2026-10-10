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
    increment, arrayUnion, arrayRemove, Timestamp, startAfter
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
    increment, arrayUnion, arrayRemove, Timestamp, startAfter
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

