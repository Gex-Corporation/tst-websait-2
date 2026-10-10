// ======================================================
//  Invoice Pro — Products Page JS (products.js)
//  GEX Corporation | <Dev Alif/>
// ======================================================

import {
    db, collection, addDoc, getDocs, getDoc, updateDoc, doc,
    query, where, orderBy, serverTimestamp, writeBatch,
    getCurrentUser, requireAdmin, buildPageTopbar,
    formatBDT, escapeHtml, showToast, confirmModal,
    renderLoading, renderEmpty, debounce, CACHE_KEYS
} from '../js/shared.js';

// ==================== State ====================
let productMap    = {};   // id → { id, name, price, updatedAt }
let filteredProds = [];
let lastSyncTs    = 0;

// ==================== Init ====================
window.addEventListener('DOMContentLoaded', async () => {
    if (!requireAdmin()) return;

    buildPageTopbar({
        title: '🛍️ পণ্য ব্যবস্থাপনা',
        subtitle: 'পণ্য যোগ, সম্পাদনা ও মুছুন',
        backUrl: '../admin.html'
    });

    bindUI();
    await loadProducts();
});

// ==================== Bind UI ====================
function bindUI() {
    document.getElementById('productSearch').addEventListener('input', debounce(filterProducts, 250));
    document.getElementById('productsRefreshBtn').onclick = () => forceRefresh();
    document.getElementById('openAddProductBtn').onclick  = () => openProductModal();
    document.getElementById('exportProductsBtn').onclick  = exportTxt;
    document.getElementById('importProductsInput').addEventListener('change', importTxt);

    // Single add/edit modal
    document.getElementById('closeProductModal').onclick  = closeProductModal;
    document.getElementById('cancelProductModal').onclick = closeProductModal;
    document.getElementById('saveProductBtn').onclick     = saveProduct;
    document.getElementById('productModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeProductModal(); });
    document.getElementById('productNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('productPriceInput').focus(); });
    document.getElementById('productPriceInput').addEventListener('keydown', e => { if (e.key === 'Enter') saveProduct(); });

    // Bulk add modal
    document.getElementById('closeBulkAdd').onclick   = closeBulkModal;
    document.getElementById('cancelBulkAdd').onclick  = closeBulkModal;
    document.getElementById('addBulkRowBtn').onclick  = addBulkRow;
    document.getElementById('saveBulkProductsBtn').onclick = saveBulkProducts;
    document.getElementById('bulkAddModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeBulkModal(); });
}

// ==================== Load Products ====================
async function loadProducts(force = false) {
    const tbody = document.getElementById('productTableBody');

    // Cache first
    if (!force) {
        const cached = localStorage.getItem(CACHE_KEYS.PRODUCTS);
        if (cached) {
            try {
                const raw = JSON.parse(cached);
                productMap = {};
                Object.values(raw).forEach(p => { if (!p.deleted) productMap[p.id] = p; });
                filteredProds = Object.values(productMap);
                renderTable(filteredProds);
                updateStats(filteredProds);
                // Background sync
                syncIncremental().then(changed => {
                    if (changed) { filteredProds = Object.values(productMap); filterProducts(); updateStats(filteredProds); }
                });
                return;
            } catch {}
        }
    }

    tbody.innerHTML = `<tr><td colspan="5"><div class="loading-center"><div class="spinner"></div><span>লোড হচ্ছে...</span></div></td></tr>`;
    try {
        const snap = await getDocs(collection(db, "products"));
        productMap = {};
        snap.docs.forEach(d => {
            const p = { id: d.id, ...d.data() };
            if (!p.deleted) productMap[p.id] = p;
        });
        persistCache();
        filteredProds = Object.values(productMap);
        renderTable(filteredProds);
        updateStats(filteredProds);
    } catch (e) {
        console.error("Products load error:", e);
        tbody.innerHTML = `<tr><td colspan="5" style="color:var(--red2);text-align:center;padding:24px">❌ লোড করা যায়নি</td></tr>`;
    }
}

async function syncIncremental() {
    const syncData = JSON.parse(localStorage.getItem(CACHE_KEYS.LAST_SYNC) || '{}');
    lastSyncTs = syncData.products || 0;
    try {
        const q = query(
            collection(db, "products"),
            where("updatedAt", ">", new Date(lastSyncTs)),
            orderBy("updatedAt", "asc")
        );
        const snap = await getDocs(q);
        if (snap.empty) return false;
        snap.docs.forEach(d => {
            const p = { id: d.id, ...d.data() };
            if (p.deleted) delete productMap[p.id];
            else productMap[p.id] = p;
            const ts = p.updatedAt?.seconds ? p.updatedAt.seconds * 1000 : Date.now();
            if (ts > lastSyncTs) lastSyncTs = ts;
        });
        persistCache();
        syncData.products = lastSyncTs;
        localStorage.setItem(CACHE_KEYS.LAST_SYNC, JSON.stringify(syncData));
        return true;
    } catch (e) {
        if (e.code !== 'failed-precondition') console.warn("Product sync error:", e);
        return false;
    }
}

function persistCache() {
    const saveMap = {};
    Object.values(productMap).forEach(p => { saveMap[p.id] = p; });
    localStorage.setItem(CACHE_KEYS.PRODUCTS, JSON.stringify(saveMap));
}

async function forceRefresh() {
    const btn = document.getElementById('productsRefreshBtn');
    btn.disabled = true; btn.textContent = '⏳';
    localStorage.removeItem(CACHE_KEYS.PRODUCTS);
    productMap = {};
    await loadProducts(true);
    btn.disabled = false; btn.textContent = '🔄';
    showToast('পণ্য তালিকা আপডেট হয়েছে', 'success');
}

// ==================== Render Table ====================
function filterProducts() {
    const q = document.getElementById('productSearch').value.trim().toLowerCase();
    filteredProds = q
        ? Object.values(productMap).filter(p => p.name.toLowerCase().includes(q))
        : Object.values(productMap);
    renderTable(filteredProds);
}

function renderTable(products) {
    const tbody = document.getElementById('productTableBody');
    if (!products.length) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">🛍️</div>কোনো পণ্য নেই</div></td></tr>`;
        return;
    }

    const sorted = [...products].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    tbody.innerHTML = sorted.map((p, idx) => `
        <tr data-id="${escapeHtml(p.id)}">
            <td class="text-muted text-small">${idx + 1}</td>
            <td class="bold">${escapeHtml(p.name)}</td>
            <td style="color:var(--green2);font-weight:600">${formatBDT(p.price || 0)}</td>
            <td><span class="badge badge-green">সক্রিয়</span></td>
            <td>
                <div style="display:flex;gap:6px;">
                    <button class="btn btn-sm edit-prod-btn" data-id="${escapeHtml(p.id)}">✏️ সম্পাদনা</button>
                    <button class="btn btn-sm btn-danger del-prod-btn" data-id="${escapeHtml(p.id)}">🗑️</button>
                </div>
            </td>
        </tr>
    `).join('');

    tbody.querySelectorAll('.edit-prod-btn').forEach(btn => {
        btn.onclick = () => {
            const p = productMap[btn.dataset.id];
            if (p) openProductModal(p);
        };
    });
    tbody.querySelectorAll('.del-prod-btn').forEach(btn => {
        btn.onclick = () => deleteProduct(btn.dataset.id);
    });
}

// ==================== Stats ====================
function updateStats(products) {
    const prods = products.filter(p => p.price > 0);
    document.getElementById('statProductCount').textContent = products.length;
    document.getElementById('statMaxPrice').textContent     = prods.length > 0 ? formatBDT(Math.max(...prods.map(p => p.price))) : '—';
    document.getElementById('statAvgPrice').textContent     = prods.length > 0 ? formatBDT(prods.reduce((s, p) => s + p.price, 0) / prods.length) : '—';

    // Products added today
    const today = new Date().toDateString();
    const todayCount = products.filter(p => {
        const ts = p.updatedAt?.seconds ? new Date(p.updatedAt.seconds * 1000) : null;
        return ts && ts.toDateString() === today;
    }).length;
    document.getElementById('statNewToday').textContent = todayCount;
}

// ==================== Add / Edit Modal ====================
function openProductModal(product = null) {
    document.getElementById('productModalTitle').textContent = product ? '✏️ পণ্য সম্পাদনা' : '➕ নতুন পণ্য যোগ';
    document.getElementById('editProductId').value = product?.id || '';
    document.getElementById('productNameInput').value  = product?.name  || '';
    document.getElementById('productPriceInput').value = product?.price || '';
    document.getElementById('productModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('productNameInput').focus(), 100);
}

function closeProductModal() {
    document.getElementById('productModal').classList.add('hidden');
}

async function saveProduct() {
    const name  = document.getElementById('productNameInput').value.trim();
    const price = parseFloat(document.getElementById('productPriceInput').value) || 0;
    const id    = document.getElementById('editProductId').value;

    if (!name) { showToast('পণ্যের নাম দিন', 'warning'); document.getElementById('productNameInput').focus(); return; }

    const btn = document.getElementById('saveProductBtn');
    btn.disabled = true; btn.textContent = '⏳ সেভ হচ্ছে...';

    try {
        const productData = { name, price, updatedAt: serverTimestamp() };
        let savedId = id;

        if (id) {
            await updateDoc(doc(db, "products", id), productData);
        } else {
            const ref = await addDoc(collection(db, "products"), productData);
            savedId = ref.id;
        }

        // Update local
        productMap[savedId] = { id: savedId, name, price };
        persistCache();
        await incrementProductVersion();
        closeProductModal();
        filteredProds = Object.values(productMap);
        filterProducts();
        updateStats(Object.values(productMap));
        showToast(id ? 'পণ্য আপডেট হয়েছে' : 'নতুন পণ্য যোগ হয়েছে', 'success');
    } catch (e) {
        showToast('সেভ করা যায়নি: ' + e.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = '✅ সেভ করুন';
    }
}

async function deleteProduct(productId) {
    const p = productMap[productId];
    if (!p) return;
    confirmModal(`পণ্য ডিলেট`, `"${p.name}" পণ্যটি মুছে ফেলবেন?`, async () => {
        try {
            await updateDoc(doc(db, "products", productId), { deleted: true, updatedAt: serverTimestamp() });
            delete productMap[productId];
            persistCache();
            await incrementProductVersion();
            filteredProds = filteredProds.filter(p => p.id !== productId);
            renderTable(filteredProds);
            updateStats(Object.values(productMap));
            showToast('পণ্য ডিলেট হয়েছে', 'success');
        } catch (e) {
            showToast('ডিলেট করা যায়নি', 'error');
        }
    });
}

// ==================== Bulk Add Modal ====================
function openBulkModal() {
    document.getElementById('bulkProductRows').innerHTML = '';
    addBulkRow(); addBulkRow(); addBulkRow();
    document.getElementById('bulkAddModal').classList.remove('hidden');
}

function closeBulkModal() {
    document.getElementById('bulkAddModal').classList.add('hidden');
}

function addBulkRow() {
    const container = document.getElementById('bulkProductRows');
    const div = document.createElement('div');
    div.className = 'form-row mb-16';
    div.style.cssText = 'align-items:center;gap:10px;';
    div.innerHTML = `
        <div class="form-group" style="margin:0;flex:2">
            <input type="text" class="form-input bulk-name" placeholder="পণ্যের নাম">
        </div>
        <div class="form-group" style="margin:0;flex:1">
            <input type="number" class="form-input bulk-price" placeholder="মূল্য" min="0" step="0.01">
        </div>
        <button class="btn btn-sm btn-danger remove-bulk-row" style="flex-shrink:0;">✕</button>
    `;
    container.appendChild(div);
    div.querySelector('.remove-bulk-row').onclick = () => {
        if (container.children.length > 1) div.remove();
        else showToast('কমপক্ষে একটি row থাকতে হবে', 'warning');
    };
}

async function saveBulkProducts() {
    const rows = document.querySelectorAll('.bulk-name');
    const toSave = [];
    rows.forEach(input => {
        const name = input.value.trim();
        const priceInput = input.closest('.form-row').querySelector('.bulk-price');
        const price = parseFloat(priceInput?.value) || 0;
        if (name) toSave.push({ name, price });
    });

    if (!toSave.length) { showToast('কমপক্ষে একটি পণ্যের নাম দিন', 'warning'); return; }

    const btn = document.getElementById('saveBulkProductsBtn');
    btn.disabled = true; btn.textContent = '⏳ সেভ হচ্ছে...';

    try {
        for (let i = 0; i < toSave.length; i += 400) {
            const chunk = toSave.slice(i, i + 400);
            const batch = writeBatch(db);
            chunk.forEach(p => {
                const ref = doc(collection(db, "products"));
                batch.set(ref, { name: p.name, price: p.price, updatedAt: serverTimestamp() });
            });
            await batch.commit();
        }
        await incrementProductVersion();
        closeBulkModal();
        showToast(`${toSave.length}টি পণ্য যোগ হয়েছে`, 'success');
        await loadProducts(true);
    } catch (e) {
        showToast('সেভ করা যায়নি: ' + e.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = '✅ সব সেভ করুন';
    }
}

// ==================== Export / Import TXT ====================
function exportTxt() {
    const products = Object.values(productMap);
    if (!products.length) { showToast('কোনো পণ্য নেই', 'warning'); return; }
    let content = '';
    products.sort((a, b) => a.name.localeCompare(b.name)).forEach(p => {
        content += `${p.name}\n${p.price || 0}\n\n`;
    });
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `products_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`${products.length}টি পণ্য export হয়েছে`, 'success');
}

async function importTxt(event) {
    const file = event.target.files[0];
    if (!file) return;

    confirmModal('পণ্য Import', 'TXT ফাইল থেকে পণ্য import করবেন? বিদ্যমান পণ্যের পাশাপাশি যোগ হবে।', async () => {
        const statusEl = document.getElementById('importStatus');
        statusEl.style.display = 'inline-flex';
        statusEl.textContent = '⏳ Import হচ্ছে...';

        try {
            const text = await file.text();
            const products = parseTxt(text);
            if (!products.length) { showToast('কোনো পণ্য পাওয়া যায়নি। ফরম্যাট: নাম, মূল্য, ফাঁকা লাইন', 'warning'); return; }

            let count = 0;
            for (let i = 0; i < products.length; i += 400) {
                const chunk = products.slice(i, i + 400);
                const batch = writeBatch(db);
                chunk.forEach(p => {
                    batch.set(doc(collection(db, "products")), { name: p.name, price: p.price, updatedAt: serverTimestamp() });
                });
                await batch.commit();
                count += chunk.length;
            }
            await incrementProductVersion();
            statusEl.textContent = `✅ ${count}টি পণ্য import হয়েছে`;
            showToast(`${count}টি পণ্য import হয়েছে`, 'success');
            await loadProducts(true);
        } catch (e) {
            statusEl.textContent = '❌ Import করা যায়নি';
            showToast('Import করা যায়নি: ' + e.message, 'error');
        }
        setTimeout(() => { statusEl.style.display = 'none'; }, 5000);
    }, false);

    event.target.value = '';
}

function parseTxt(text) {
    const lines = text.split('\n').map(l => l.trim());
    const products = [];
    let i = 0;
    while (i < lines.length) {
        const name = lines[i];
        if (name) {
            const price = parseFloat(lines[i + 1]) || 0;
            products.push({ name, price });
            i += 2;
            while (i < lines.length && !lines[i]) i++;
        } else { i++; }
    }
    return products;
}

// ==================== Version Helper ====================
async function incrementProductVersion() {
    try {
        const configRef = doc(db, "settings", "appConfig");
        await updateDoc(configRef, { productVersion: (await getDoc(configRef)).data()?.productVersion + 1 || 1 });
    } catch {}
}
