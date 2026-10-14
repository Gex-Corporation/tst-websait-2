// ======================================================
//  Invoice Pro — Admin Dashboard JS
//  GEX Corporation | <Dev Alif/>
// ======================================================

import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, getDoc, doc, query, orderBy, limit, where } from "firebase/firestore";
import { appCache, getOrMigrateProductsList, getOrSyncCompanyStats, getOrSyncRecentInvoices } from "./shared.js";

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

const LOGIN_SESSION_KEY = 'invoice_logged_in_user_v1';
const REMEMBER_ME_KEY   = 'invoice_remembered_user';

// Cache keys (read-only — same as app.js)
const CACHE_KEYS = {
    PRODUCTS: 'erp_cached_products_v3',
    STOCKS:   'erp_cached_stocks_v3',
};

let db;
let salesChartInstance = null;

// ==================== Init ====================
try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
} catch (e) { console.error("Firebase Init Error:", e); }

// ==================== Auth Guard ====================
function getCurrentUser() {
    return sessionStorage.getItem(LOGIN_SESSION_KEY);
}

function logout() {
    sessionStorage.removeItem(LOGIN_SESSION_KEY);
    window.location.href = 'index.html';
}

// ==================== Time Clock ====================
function startClock() {
    const el = document.getElementById('topbarTime');
    if (!el) return;
    const tick = () => {
        const now = new Date();
        const opts = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true };
        const date = now.toLocaleDateString('bn-BD', { day: '2-digit', month: 'short', year: 'numeric' });
        const time = now.toLocaleTimeString('en-US', opts);
        el.textContent = `${date} • ${time}`;
    };
    tick();
    setInterval(tick, 1000);
}

// ==================== Navigation ====================
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item[data-section]');
    const quickBtns = document.querySelectorAll('.quick-btn[data-section]');

    function switchSection(sectionId) {
        // Update nav active state
        navItems.forEach(n => {
            n.classList.toggle('active', n.dataset.section === sectionId);
        });

        // Show/hide sections
        document.querySelectorAll('.section-view').forEach(s => s.classList.remove('active'));
        const target = document.getElementById('section' + capitalize(sectionId));
        if (target) target.classList.add('active');

        // Update topbar title
        const titles = {
            dashboard: { title: 'ড্যাশবোর্ড', sub: 'স্বাগতম, Admin' },
            mpo: { title: "MPO's তালিকা", sub: 'সকল সেলস রিপ্রেজেনটেটিভ' },
        };
        const t = titles[sectionId] || { title: 'ড্যাশবোর্ড', sub: '' };
        const el1 = document.getElementById('topbarTitle');
        const el2 = document.getElementById('topbarSubtitle');
        if (el1) el1.textContent = t.title;
        if (el2) el2.textContent = t.sub;

        // Load section data on first visit
        if (sectionId === 'mpo') loadMPOFull();
    }

    navItems.forEach(n => {
        n.addEventListener('click', () => switchSection(n.dataset.section));
    });

    quickBtns.forEach(b => {
        b.addEventListener('click', () => switchSection(b.dataset.section));
    });
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ==================== FORMAT HELPERS ====================
function formatBDT(amount) {
    if (isNaN(amount)) return '৳0';
    return '৳' + Number(amount).toLocaleString('en-BD');
}

function avatarBg(name) {
    const colors = ['#7c3aed','#2563eb','#10b981','#f59e0b','#ef4444','#ec4899','#14b8a6','#8b5cf6'];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
    return colors[Math.abs(h) % colors.length];
}

function daysAgoLabel(d) {
    const diff = Math.floor((Date.now() - d) / 86400000);
    if (diff === 0) return 'আজ';
    if (diff === 1) return 'গতকাল';
    return `${diff} দিন আগে`;
}

// ==================== LOAD STAT CARDS ====================
async function loadStats() {
    try {
        // 1 & 2. Single document summary stats (Option 1: 1 read instead of querying entire users collection)
        const stats = await getOrSyncCompanyStats();

        document.getElementById('statMPO').textContent = stats.mpoCount || 0;
        document.getElementById('statSales').textContent = formatBDT(stats.totalSales || 0);
        document.getElementById('statDue').textContent   = formatBDT(stats.totalDue || 0);
        document.getElementById('statSalesBadge').textContent = `${stats.totalInvoices || 0} ইনভয়েস`;

        const duePercent = stats.totalSales > 0 ? Math.round((stats.totalDue / stats.totalSales) * 100) : 0;
        document.getElementById('statDueBadge').textContent = `${duePercent}% বকেয়া`;

        // 3. Products count — from local cache first, then Firebase
        let productCount = 0;
        const cached = await appCache.get(CACHE_KEYS.PRODUCTS);
        if (cached) {
            try {
                const pm = cached;
                productCount = Object.values(pm).filter(p => !p.deleted).length;
            } catch(_) {}
        }
        if (productCount === 0) {
            const pMap = await getOrMigrateProductsList();
            productCount = Object.keys(pMap).length;
        }
        document.getElementById('statProducts').textContent = productCount;

        // Return stats for other widgets
        return { totalSales: stats.totalSales || 0 };

    } catch(e) {
        console.error("Stats load error:", e);
        ['statMPO','statProducts','statSales','statDue'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = 'N/A';
        });
        return { totalSales: 0 };
    }
}

// ==================== LOAD STOCK ALERTS ====================
async function loadStockAlerts() {
    const body = document.getElementById('stockAlertBody');
    if (!body) return;

    try {
        let stockMap = {};
        const cachedStocks = await appCache.get(CACHE_KEYS.STOCKS);
        if (cachedStocks) {
            const raw = cachedStocks;
            Object.values(raw).forEach(s => { stockMap[s.productId] = s.quantity; });
        } else {
            const snap = await getDocs(collection(db, "stocks"));
            snap.forEach(d => { stockMap[d.id] = d.data().quantity || 0; });
        }

        // Get product names — from cache or Firebase
        let productMap = {};
        const cachedProds = await appCache.get(CACHE_KEYS.PRODUCTS);
        if (cachedProds) {
            const raw = cachedProds;
            Object.values(raw).forEach(p => { if (!p.deleted) productMap[p.id] = p; });
        } else {
            productMap = await getOrMigrateProductsList();
        }

        // Find low/out-of-stock
        const LOW_THRESHOLD = 10;
        const alerts = [];
        Object.entries(stockMap).forEach(([pid, qty]) => {
            const prod = productMap[pid];
            if (!prod || prod.deleted) return;
            if (qty <= LOW_THRESHOLD) {
                alerts.push({ name: prod.name || pid, qty, pid });
            }
        });

        alerts.sort((a, b) => a.qty - b.qty);

        const countEl = document.getElementById('stockAlertCount');
        if (countEl) countEl.textContent = alerts.length > 0 ? `${alerts.length}টি সতর্কতা` : '';

        if (alerts.length === 0) {
            body.innerHTML = `<div class="stock-empty"><span>✅</span><span>সব পণ্যের স্টক ঠিক আছে</span></div>`;
            return;
        }

        const html = alerts.slice(0, 8).map(a => {
            let badgeClass = 'low', badgeText = 'কম স্টক';
            if (a.qty === 0) { badgeClass = 'out'; badgeText = 'স্টক শেষ'; }
            else if (a.qty <= 3) { badgeClass = 'critical'; badgeText = 'জরুরি'; }
            return `<div class="stock-item">
                <div class="stock-item-info">
                    <div class="stock-item-name">${a.name}</div>
                    <div class="stock-item-qty">পরিমাণ: ${a.qty} টি</div>
                </div>
                <span class="stock-badge ${badgeClass}">${badgeText}</span>
            </div>`;
        }).join('');

        body.innerHTML = `<div class="stock-list">${html}</div>`;

    } catch(e) {
        console.error("Stock alert error:", e);
        body.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div>লোড করা যায়নি</div>`;
    }
}

// ==================== LOAD SALES CHART ====================
async function loadSalesChart() {
    try {
        const labels = [];
        const data   = [];

        // Last 7 days
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            labels.push(d.toLocaleDateString('bn-BD', { weekday: 'short', day: 'numeric' }));
            data.push(0);
        }

        const statsSnap = await getDoc(doc(db, "settings", "dailyStats"));
        const statsData = statsSnap.exists() ? statsSnap.data() : {};

        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateKey = d.toLocaleDateString('en-CA');
            const idx = 6 - i;
            data[idx] = parseFloat(statsData[dateKey] || 0);
        }

        const ctx = document.getElementById('salesChart');
        if (!ctx) return;

        if (salesChartInstance) salesChartInstance.destroy();

        salesChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'বিক্রয় (৳)',
                    data,
                    backgroundColor: (context) => {
                        const chart = context.chart;
                        const { ctx: c, chartArea } = chart;
                        if (!chartArea) return 'rgba(124,58,237,0.7)';
                        const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                        gradient.addColorStop(0, 'rgba(124,58,237,0.85)');
                        gradient.addColorStop(1, 'rgba(37,99,235,0.45)');
                        return gradient;
                    },
                    borderRadius: 8,
                    borderSkipped: false,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => '৳' + Number(ctx.raw).toLocaleString()
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#94a3b8', font: { size: 11 } }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: {
                            color: '#94a3b8', font: { size: 11 },
                            callback: v => '৳' + Number(v).toLocaleString()
                        },
                        beginAtZero: true
                    }
                }
            }
        });
    } catch(e) {
        console.error("Chart error:", e);
    }
}

// ==================== LOAD MPO RANKING ====================
async function loadMPORanking(mposInput, totalSales) {
    const body = document.getElementById('mpoRankBody');
    if (!body) return;

    let mpos = Array.isArray(mposInput) ? mposInput : [];
    if (!mpos.length) {
        const cached = await appCache.get('admin_cached_users_list_v1');
        if (cached) {
            try {
                const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
                mpos = parsed.filter(u => u.id !== 'admin');
            } catch (_) {}
        }
        if (!mpos.length) {
            try {
                const snap = await getDocs(collection(db, "users"));
                const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                await appCache.set('admin_cached_users_list_v1', all);
                mpos = all.filter(u => u.id !== 'admin');
            } catch (_) {}
        }
    }

    const ranked = [...mpos]
        .sort((a, b) => (b.totalSales || 0) - (a.totalSales || 0))
        .slice(0, 5);

    if (ranked.length === 0) {
        body.innerHTML = `<div class="empty-state"><div class="empty-icon">👤</div>কোনো MPO নেই</div>`;
        return;
    }

    const maxSales = ranked[0]?.totalSales || 1;
    const rankClass = ['r1','r2','r3','rn','rn'];

    const html = ranked.map((u, i) => {
        const pct = Math.round(((u.totalSales || 0) / maxSales) * 100);
        const initials = u.id.substring(0, 2).toUpperCase();
        const bg = avatarBg(u.id);
        return `<div class="mpo-item">
            <div class="mpo-rank ${rankClass[i]}">${i + 1}</div>
            <div class="mpo-avatar" style="background:${bg}">${initials}</div>
            <div class="mpo-info mpo-progress-wrap">
                <div class="mpo-name">${u.id}</div>
                <div class="mpo-meta">${u.invoiceCount || 0}টি ইনভয়েস</div>
                <div class="mpo-progress-bar"><div class="mpo-progress-fill" style="width:${pct}%"></div></div>
            </div>
            <div class="mpo-sales">
                <div class="amount">${formatBDT(u.totalSales || 0)}</div>
                <div class="inv">বিক্রয়</div>
            </div>
        </div>`;
    }).join('');

    body.innerHTML = `<div class="mpo-list">${html}</div>`;
}

// ==================== LOAD RECENT INVOICES ====================
async function loadRecentInvoices() {
    const body = document.getElementById('recentInvBody');
    if (!body) return;

    try {
        // Read from single document settings/recentInvoices (Exact 1 Firestore read!)
        const invoices = await getOrSyncRecentInvoices();

        if (!invoices || invoices.length === 0) {
            body.innerHTML = `<div class="empty-state"><div class="empty-icon">🧾</div>কোনো ইনভয়েস নেই</div>`;
            return;
        }

        const top8 = invoices.slice(0, 8);
        const rows = top8.map(inv => {
            const rawTs = inv.timestamp || inv.updatedAt || inv.date;
            let ago = '—';
            if (rawTs) {
                const ts = rawTs.toDate ? rawTs.toDate() : (rawTs.seconds ? new Date(rawTs.seconds * 1000) : new Date(rawTs));
                if (!isNaN(ts.getTime())) ago = daysAgoLabel(ts.getTime());
            }
            const status = inv.status === 'pending' ? 'pending' : 'active';
            const statusText = inv.status === 'pending' ? 'পেন্ডিং' : 'সক্রিয়';
            return `<tr>
                <td><span class="inv-no">${inv.invoiceNumber || '—'}</span></td>
                <td>${inv.user || '—'}</td>
                <td>${inv.billTo || '—'}</td>
                <td>${formatBDT(inv.grandTotal || 0)}</td>
                <td>${ago}</td>
                <td><span class="status-badge ${status}">${statusText}</span></td>
            </tr>`;
        }).join('');

        body.innerHTML = `<div class="inv-table-wrap">
            <table class="inv-table">
                <thead><tr>
                    <th>ইনভয়েস নং</th>
                    <th>MPO</th>
                    <th>কাস্টমার</th>
                    <th>পরিমাণ</th>
                    <th>তারিখ</th>
                    <th>স্ট্যাটাস</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
    } catch(e) {
        console.error("Recent invoices error:", e);
        body.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div>লোড করা যায়নি</div>`;
    }
}

// ==================== LOAD FULL MPO LIST ====================
let mpoFullLoaded = false;

async function loadMPOFull() {
    const container = document.getElementById('mpoListFull');
    if (!container) return;
    if (mpoFullLoaded) return;

    container.innerHTML = `<div class="loading-center"><div class="spinner"></div><span>লোড হচ্ছে...</span></div>`;

    try {
        const snap = await getDocs(collection(db, "users"));
        const allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const mpos = allUsers.filter(u => u.id !== 'admin');

        if (mpos.length === 0) {
            container.innerHTML = `<div class="empty-state"><div class="empty-icon">👤</div>কোনো MPO নেই</div>`;
            return;
        }

        const html = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;">
            ${mpos.map(u => {
                const due = Math.max(0, (u.totalSales || 0) - (u.totalPaid || 0));
                const initials = u.id.substring(0, 2).toUpperCase();
                const bg = avatarBg(u.id);
                return `<div class="dash-card" style="cursor:default;">
                    <div class="dash-card-body">
                        <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
                            <div class="mpo-avatar" style="background:${bg};width:44px;height:44px;font-size:16px;">${initials}</div>
                            <div>
                                <div style="font-size:15px;font-weight:700;">${u.id}</div>
                                <div style="font-size:11px;color:var(--text-muted);">MPO / Sales Representative</div>
                            </div>
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center;">
                            <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:10px 6px;">
                                <div style="font-size:16px;font-weight:700;color:var(--green2);">${formatBDT(u.totalSales || 0)}</div>
                                <div style="font-size:10px;color:var(--text-muted);margin-top:3px;">মোট বিক্রয়</div>
                            </div>
                            <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:10px 6px;">
                                <div style="font-size:16px;font-weight:700;color:var(--blue2);">${formatBDT(u.totalPaid || 0)}</div>
                                <div style="font-size:10px;color:var(--text-muted);margin-top:3px;">কালেকশন</div>
                            </div>
                            <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:10px 6px;">
                                <div style="font-size:16px;font-weight:700;color:${due > 0 ? 'var(--orange2)' : 'var(--green2)'};">${formatBDT(due)}</div>
                                <div style="font-size:10px;color:var(--text-muted);margin-top:3px;">বাকি</div>
                            </div>
                        </div>
                        <div style="margin-top:12px;display:flex;align-items:center;justify-content:space-between;">
                            <span style="font-size:12px;color:var(--text-muted);">📄 ${u.invoiceCount || 0}টি ইনভয়েস</span>
                            <button onclick="window.location.href='main.html?tab=mpo&user=${encodeURIComponent(u.id)}'"
                                style="font-size:11px;padding:5px 12px;border-radius:7px;border:1px solid var(--border);
                                background:var(--bg-card);color:var(--text-secondary);cursor:pointer;font-family:Inter,sans-serif;
                                transition:all 0.2s;" 
                                onmouseover="this.style.background='var(--bg-card-hover)';this.style.color='var(--text-primary)'"
                                onmouseout="this.style.background='var(--bg-card)';this.style.color='var(--text-secondary)'">
                                বিস্তারিত দেখুন →
                            </button>
                        </div>
                    </div>
                </div>`;
            }).join('')}
        </div>`;

        container.innerHTML = html;
        mpoFullLoaded = true;

    } catch(e) {
        console.error("MPO full load error:", e);
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div>লোড করা যায়নি</div>`;
    }
}

// ==================== MOBILE SIDEBAR ====================
function initMobileSidebar() {
    const menuBtn  = document.getElementById('mobileMenuBtn');
    const sidebar  = document.getElementById('adminSidebar');
    const overlay  = document.getElementById('sidebarOverlay');

    if (!menuBtn || !sidebar || !overlay) return;

    menuBtn.addEventListener('click', () => {
        sidebar.classList.add('open');
        overlay.classList.add('visible');
    });

    overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('visible');
    });

    // Close on nav item click (mobile)
    document.querySelectorAll('.nav-item').forEach(n => {
        n.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('visible');
        });
    });
}

// ==================== MAIN INIT ====================
window.addEventListener('DOMContentLoaded', async () => {
    // Auth guard
    const user = getCurrentUser();
    if (!user || user !== 'admin') {
        window.location.href = 'index.html';
        return;
    }

    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    // MPO Refresh btn
    const mpoRefreshBtn = document.getElementById('mpoRefreshBtn');
    if (mpoRefreshBtn) {
        mpoRefreshBtn.addEventListener('click', () => {
            mpoFullLoaded = false;
            loadMPOFull();
        });
    }

    startClock();
    initNavigation();
    initMobileSidebar();

    // Load dashboard data in parallel (minimize reads)
    const [{ totalSales }] = await Promise.all([
        loadStats(),
        loadStockAlerts(),
        loadSalesChart(),
        loadRecentInvoices(),
    ]);

    loadMPORanking(null, totalSales);
});
