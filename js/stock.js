// Invoice Pro — Stock Page JS (stock.js)
import {
    db, collection, getDocs, getDoc, updateDoc, setDoc, doc,
    query, where, orderBy, serverTimestamp,
    requireAdmin, buildPageTopbar, formatBDT, escapeHtml,
    showToast, confirmModal, debounce, CACHE_KEYS
} from '../js/shared.js';

let productMap = {}, stockMap = {}, filteredData = [];
let currentProductId = null, stockMode = 'in';

window.addEventListener('DOMContentLoaded', async () => {
    if (!requireAdmin()) return;
    buildPageTopbar({ title: '📦 স্টক ব্যবস্থাপনা', subtitle: 'পণ্যের স্টক ইন/আউট নিয়ন্ত্রণ', backUrl: '../admin.html' });
    bindUI();
    await loadStockData();
});

function bindUI() {
    document.getElementById('stockSearch').addEventListener('input', debounce(filterStock, 250));
    document.getElementById('stockFilter').addEventListener('change', filterStock);
    document.getElementById('stockRefreshBtn').onclick = () => { localStorage.removeItem(CACHE_KEYS.PRODUCTS); localStorage.removeItem(CACHE_KEYS.STOCKS); loadStockData(true); };
    document.getElementById('closeStockModal').onclick = closeStockModal;
    document.getElementById('cancelStockModal').onclick = closeStockModal;
    document.getElementById('stockModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeStockModal(); });

    document.getElementById('stockInBtn').onclick  = () => setMode('in');
    document.getElementById('stockOutBtn').onclick = () => setMode('out');
    document.getElementById('stockSetBtn').onclick = () => setMode('set');
    document.getElementById('stockChangeInput').addEventListener('input', updatePreview);
    document.getElementById('saveStockBtn').onclick = saveStock;
}

function setMode(mode) {
    stockMode = mode;
    ['in','out','set'].forEach(m => {
        const btn = document.getElementById(`stock${m.charAt(0).toUpperCase()+m.slice(1)}Btn`);
        btn.style.fontWeight = m === mode ? '700' : '500';
        btn.style.background = m === mode ? 'rgba(255,255,255,0.08)' : '';
    });
    updatePreview();
}

function updatePreview() {
    const current = stockMap[currentProductId] || 0;
    const change = parseFloat(document.getElementById('stockChangeInput').value) || 0;
    let newVal;
    if (stockMode === 'in')  newVal = current + change;
    if (stockMode === 'out') newVal = Math.max(0, current - change);
    if (stockMode === 'set') newVal = change;
    document.getElementById('stockPreview').textContent = newVal !== undefined ? newVal + ' টি' : '—';
    document.getElementById('stockPreview').style.color = newVal === 0 ? 'var(--red2)' : newVal <= 10 ? 'var(--orange2)' : 'var(--green2)';
}

async function loadStockData(force = false) {
    const tbody = document.getElementById('stockTableBody');
    try {
        // Products
        const cachedProds = localStorage.getItem(CACHE_KEYS.PRODUCTS);
        if (cachedProds && !force) {
            const raw = JSON.parse(cachedProds);
            Object.values(raw).forEach(p => { if (!p.deleted) productMap[p.id] = p; });
        } else {
            const snap = await getDocs(collection(db, "products"));
            productMap = {};
            snap.docs.forEach(d => { const p = { id: d.id, ...d.data() }; if (!p.deleted) productMap[p.id] = p; });
            const saveMap = {};
            Object.values(productMap).forEach(p => { saveMap[p.id] = p; });
            localStorage.setItem(CACHE_KEYS.PRODUCTS, JSON.stringify(saveMap));
        }

        // Stocks
        const cachedStocks = localStorage.getItem(CACHE_KEYS.STOCKS);
        if (cachedStocks && !force) {
            stockMap = {};
            Object.values(JSON.parse(cachedStocks)).forEach(s => { stockMap[s.productId || s.id] = s.quantity || 0; });
        } else {
            const snap = await getDocs(collection(db, "stocks"));
            stockMap = {};
            snap.docs.forEach(d => { stockMap[d.id] = d.data().quantity || 0; });
            const saveMap = {};
            Object.entries(stockMap).forEach(([id, qty]) => { saveMap[id] = { productId: id, quantity: qty, id }; });
            localStorage.setItem(CACHE_KEYS.STOCKS, JSON.stringify(saveMap));
        }

        filteredData = buildData();
        renderTable(filteredData);
        updateStats(filteredData);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" style="color:var(--red2);text-align:center;padding:24px">❌ লোড করা যায়নি</td></tr>`;
    }
}

function buildData() {
    return Object.values(productMap).map(p => ({ ...p, stock: stockMap[p.id] || 0 })).sort((a, b) => a.name.localeCompare(b.name));
}

function filterStock() {
    const q = document.getElementById('stockSearch').value.trim().toLowerCase();
    const f = document.getElementById('stockFilter').value;
    filteredData = buildData().filter(item => {
        if (q && !item.name.toLowerCase().includes(q)) return false;
        if (f === 'out' && item.stock > 0) return false;
        if (f === 'low' && (item.stock === 0 || item.stock > 10)) return false;
        if (f === 'ok' && item.stock <= 10) return false;
        return true;
    });
    renderTable(filteredData);
}

function renderTable(data) {
    const tbody = document.getElementById('stockTableBody');
    if (!data.length) { tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">📦</div>কোনো পণ্য নেই</div></td></tr>`; return; }
    tbody.innerHTML = data.map((item, idx) => {
        let badgeClass = 'badge-green', badgeText = 'পর্যাপ্ত';
        if (item.stock === 0) { badgeClass = 'badge-red'; badgeText = 'শেষ'; }
        else if (item.stock <= 3) { badgeClass = 'badge-red'; badgeText = 'জরুরি'; }
        else if (item.stock <= 10) { badgeClass = 'badge-orange'; badgeText = 'কম'; }
        const stockColor = item.stock === 0 ? 'var(--red2)' : item.stock <= 10 ? 'var(--orange2)' : 'var(--green2)';
        return `<tr>
            <td class="text-muted text-small">${idx + 1}</td>
            <td class="bold">${escapeHtml(item.name)}</td>
            <td style="color:var(--blue2)">${formatBDT(item.price || 0)}</td>
            <td style="color:${stockColor};font-size:16px;font-weight:700">${item.stock} টি</td>
            <td><span class="badge ${badgeClass}">${badgeText}</span></td>
            <td><button class="btn btn-sm btn-primary update-stock-btn" data-id="${escapeHtml(item.id)}">📦 আপডেট</button></td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('.update-stock-btn').forEach(btn => {
        btn.onclick = () => openStockModal(btn.dataset.id);
    });
}

function updateStats(data) {
    document.getElementById('statTotalProd').textContent = data.length;
    document.getElementById('statOutStock').textContent  = data.filter(i => i.stock === 0).length;
    document.getElementById('statLowStock').textContent  = data.filter(i => i.stock > 0 && i.stock <= 10).length;
    document.getElementById('statGoodStock').textContent = data.filter(i => i.stock > 10).length;
}

function openStockModal(productId) {
    currentProductId = productId;
    const p = productMap[productId];
    if (!p) return;
    document.getElementById('stockModalTitle').textContent = `📦 ${p.name}`;
    document.getElementById('stockModalProductName').textContent = p.name;
    document.getElementById('stockModalCurrentQty').textContent = (stockMap[productId] || 0) + ' টি';
    document.getElementById('stockChangeInput').value = '';
    document.getElementById('stockPreview').textContent = '—';
    stockMode = 'in';
    setMode('in');
    document.getElementById('stockModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('stockChangeInput').focus(), 100);
}

function closeStockModal() { document.getElementById('stockModal').classList.add('hidden'); currentProductId = null; }

async function saveStock() {
    const change  = parseFloat(document.getElementById('stockChangeInput').value);
    if (isNaN(change) || change < 0) { showToast('সঠিক পরিমাণ দিন', 'warning'); return; }
    const current = stockMap[currentProductId] || 0;
    let newQty;
    if (stockMode === 'in')  newQty = current + change;
    if (stockMode === 'out') newQty = Math.max(0, current - change);
    if (stockMode === 'set') newQty = change;

    const btn = document.getElementById('saveStockBtn');
    btn.disabled = true; btn.textContent = '⏳';
    try {
        await setDoc(doc(db, "stocks", currentProductId), { productId: currentProductId, quantity: newQty, updatedAt: serverTimestamp() }, { merge: true });
        stockMap[currentProductId] = newQty;
        // Update local cache
        const cached = JSON.parse(localStorage.getItem(CACHE_KEYS.STOCKS) || '{}');
        cached[currentProductId] = { productId: currentProductId, quantity: newQty, id: currentProductId };
        localStorage.setItem(CACHE_KEYS.STOCKS, JSON.stringify(cached));
        closeStockModal();
        filteredData = buildData();
        filterStock();
        updateStats(filteredData);
        showToast('স্টক আপডেট হয়েছে', 'success');
    } catch (e) { showToast('আপডেট করা যায়নি', 'error'); }
    finally { btn.disabled = false; btn.textContent = '✅ সেভ করুন'; }
}
