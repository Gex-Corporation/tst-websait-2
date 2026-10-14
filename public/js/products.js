// ======================================================
//  Invoice Pro — Products Page JS (products.js)
//  GEX Corporation | <Dev Alif/>
// ======================================================

import {
    db, collection, addDoc, getDocs, getDoc, updateDoc, doc,
    query, where, orderBy, serverTimestamp, writeBatch,
    getCurrentUser, requireAdmin, buildPageTopbar,
    formatBDT, escapeHtml, showToast, confirmModal,
    renderLoading, renderEmpty, debounce, CACHE_KEYS,
    getOrMigrateProductsList, saveProductToSingleDoc,
    deleteProductFromSingleDoc, saveBulkProductsToSingleDoc,
    PRODUCTS_DOC_REF, appCache
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
    document.getElementById('openAddProductBtn').onclick  = () => openBulkModal();
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
        const cached = await appCache.get(CACHE_KEYS.PRODUCTS);
        if (cached) {
            try {
                const raw = typeof cached === 'string' ? JSON.parse(cached) : cached;
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
        productMap = await getOrMigrateProductsList();
        await persistCache();
        filteredProds = Object.values(productMap);
        renderTable(filteredProds);
        updateStats(filteredProds);
    } catch (e) {
        console.error("Products load error:", e);
        tbody.innerHTML = `<tr><td colspan="5" style="color:var(--red2);text-align:center;padding:24px">❌ লোড করা যায়নি</td></tr>`;
    }
}

async function syncIncremental() {
    const syncRaw = await appCache.get(CACHE_KEYS.LAST_SYNC);
    const syncData = syncRaw ? (typeof syncRaw === 'string' ? JSON.parse(syncRaw) : syncRaw) : {};
    lastSyncTs = syncData.products || 0;
    try {
        const snap = await getDoc(PRODUCTS_DOC_REF());
        if (!snap.exists()) return false;
        const data = snap.data();
        const serverTs = data.updatedAt?.toMillis ? data.updatedAt.toMillis() : (data.updatedAt?.seconds ? data.updatedAt.seconds * 1000 : 0);
        if (serverTs && serverTs <= lastSyncTs) return false;

        const items = data.items || {};
        productMap = {};
        Object.values(items).forEach(p => {
            if (p && !p.deleted && p.id) productMap[p.id] = p;
        });
        await persistCache();
        lastSyncTs = serverTs || Date.now();
        syncData.products = lastSyncTs;
        await appCache.set(CACHE_KEYS.LAST_SYNC, syncData);
        return true;
    } catch (e) {
        console.warn("Product sync error:", e);
        return false;
    }
}

async function persistCache() {
    const saveMap = {};
    Object.values(productMap).forEach(p => { saveMap[p.id] = p; });
    await appCache.set(CACHE_KEYS.PRODUCTS, saveMap);
}

async function forceRefresh() {
    const btn = document.getElementById('productsRefreshBtn');
    btn.disabled = true; btn.textContent = '⏳';
    await appCache.remove(CACHE_KEYS.PRODUCTS);
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
    if (!product) {
        openBulkModal();
        return;
    }
    document.getElementById('productModalTitle').textContent = '✏️ পণ্য সম্পাদনা';
    document.getElementById('editProductId').value = product.id || '';
    document.getElementById('productNameInput').value  = product.name  || '';
    document.getElementById('productPriceInput').value = product.price || '';
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
        const savedProd = await saveProductToSingleDoc({ id: id || undefined, name, price });
        const savedId = savedProd.id;

        // Update local productMap
        productMap[savedId] = savedProd;
        persistCache();

        // If new product, also update local stock cache with 0 quantity
        if (!id) {
            try {
                const scRaw = (await appCache.get(CACHE_KEYS.STOCKS)) || {};
                const sc = typeof scRaw === 'string' ? JSON.parse(scRaw) : scRaw;
                sc[savedId] = { productId: savedId, quantity: 0, id: savedId };
                await appCache.set(CACHE_KEYS.STOCKS, sc);
            } catch (_) {}
        }

        await incrementProductVersion();
        closeProductModal();
        filteredProds = Object.values(productMap);
        filterProducts();
        updateStats(Object.values(productMap));
        showToast(id ? 'পণ্য আপডেট হয়েছে' : 'নতুন পণ্য যোগ হয়েছে (স্টকে সংযুক্ত)', 'success');
    } catch (e) {
        showToast('সেভ করা যায়নি: ' + e.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = '✅ সেভ করুন';
    }
}

async function deleteProduct(productId) {
    const p = productMap[productId];
    if (!p) return;
    confirmModal(`পণ্য ডিলেট`, `"${p.name}" পণ্যটি মুছে ফেলবেন? এটি স্টক থেকেও মুছে যাবে।`, async () => {
        try {
            await deleteProductFromSingleDoc(productId);
            delete productMap[productId];
            persistCache();

            // Also clean up local stock cache
            try {
                const scRaw = (await appCache.get(CACHE_KEYS.STOCKS)) || {};
                const sc = typeof scRaw === 'string' ? JSON.parse(scRaw) : scRaw;
                delete sc[productId];
                await appCache.set(CACHE_KEYS.STOCKS, sc);
            } catch (_) {}

            await incrementProductVersion();
            filteredProds = filteredProds.filter(p => p.id !== productId);
            renderTable(filteredProds);
            updateStats(Object.values(productMap));
            showToast('পণ্য ও স্টক থেকে ডিলেট হয়েছে', 'success');
        } catch (e) {
            showToast('ডিলেট করা যায়নি', 'error');
        }
    });
}

// ==================== Bulk Add Modal ====================
function openBulkModal() {
    const container = document.getElementById('bulkProductRows');
    container.innerHTML = '';
    addBulkRow();
    addBulkRow();
    addBulkRow();
    updateBulkRowCount();
    document.getElementById('bulkAddModal').classList.remove('hidden');
    setTimeout(() => {
        const firstInput = container.querySelector('.bulk-name');
        if (firstInput) firstInput.focus();
    }, 100);
}

function closeBulkModal() {
    document.getElementById('bulkAddModal').classList.add('hidden');
}

function updateBulkRowCount() {
    const count = document.querySelectorAll('#bulkProductRows .bulk-product-row').length;
    const badge = document.getElementById('bulkRowCountBadge');
    if (badge) badge.textContent = `${count}টি সারি`;
}

function addBulkRow(nameVal = '', priceVal = '', shouldFocus = false) {
    const container = document.getElementById('bulkProductRows');
    const div = document.createElement('div');
    div.className = 'bulk-product-row';
    div.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:10px;';
    div.innerHTML = `
        <div style="flex:2;min-width:0;">
            <input type="text" class="form-input bulk-name" placeholder="পণ্যের নাম লিখুন" value="${escapeHtml(nameVal)}">
        </div>
        <div style="flex:1;min-width:0;">
            <input type="number" class="form-input bulk-price" placeholder="০.০০" min="0" step="0.01" value="${priceVal !== '' ? priceVal : ''}">
        </div>
        <button type="button" class="btn btn-sm btn-danger remove-bulk-row" style="width:34px;height:34px;padding:0;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;" title="সারি মুছুন">✕</button>
    `;
    container.appendChild(div);

    const nameInput = div.querySelector('.bulk-name');
    const priceInput = div.querySelector('.bulk-price');

    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            priceInput.focus();
        }
    });

    priceInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const allPriceInputs = container.querySelectorAll('.bulk-price');
            const isLast = allPriceInputs[allPriceInputs.length - 1] === priceInput;
            if (isLast) {
                addBulkRow('', '', true);
            } else {
                const nextRow = div.nextElementSibling;
                if (nextRow) {
                    const nextName = nextRow.querySelector('.bulk-name');
                    if (nextName) nextName.focus();
                }
            }
        }
    });

    div.querySelector('.remove-bulk-row').onclick = () => {
        if (container.children.length > 1) {
            div.remove();
            updateBulkRowCount();
        } else {
            showToast('কমপক্ষে একটি সারি থাকতে হবে', 'warning');
        }
    };

    updateBulkRowCount();

    if (shouldFocus) {
        setTimeout(() => nameInput.focus(), 50);
    }
}

async function saveBulkProducts() {
    const rows = document.querySelectorAll('#bulkProductRows .bulk-product-row');
    const toSave = [];
    rows.forEach(row => {
        const nameInput = row.querySelector('.bulk-name');
        const priceInput = row.querySelector('.bulk-price');
        const name = nameInput ? nameInput.value.trim() : '';
        const price = priceInput ? (parseFloat(priceInput.value) || 0) : 0;
        if (name) {
            toSave.push({ name, price });
        }
    });

    if (!toSave.length) {
        showToast('কমপক্ষে একটি পণ্যের নাম দিন', 'warning');
        const first = document.querySelector('.bulk-name');
        if (first) first.focus();
        return;
    }

    const btn = document.getElementById('saveBulkProductsBtn');
    btn.disabled = true; btn.textContent = '⏳ সেভ হচ্ছে...';

    try {
        const savedList = await saveBulkProductsToSingleDoc(toSave);

        // Update local productMap & cache
        savedList.forEach(p => {
            productMap[p.id] = p;
        });
        persistCache();

        // Also update local stock cache with 0
        try {
            const scRaw = (await appCache.get(CACHE_KEYS.STOCKS)) || {};
            const sc = typeof scRaw === 'string' ? JSON.parse(scRaw) : scRaw;
            savedList.forEach(p => {
                if (!sc[p.id]) sc[p.id] = { productId: p.id, quantity: 0, id: p.id };
            });
            await appCache.set(CACHE_KEYS.STOCKS, sc);
        } catch (_) {}

        await incrementProductVersion();
        closeBulkModal();
        filteredProds = Object.values(productMap);
        filterProducts();
        updateStats(filteredProds);
        showToast(`${savedList.length}টি পণ্য সফলভাবে যোগ ও স্টকে যুক্ত হয়েছে`, 'success');
    } catch (e) {
        showToast('সেভ করা যায়নি: ' + e.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = '✅ সব পণ্য সেভ করুন';
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

    confirmModal('পণ্য Import', 'TXT ফাইল থেকে পণ্য import করবেন? বিদ্যমান পণ্যের পাশাপাশি যোগ হবে এবং স্টকে অন্তর্ভুক্ত হবে।', async () => {
        const statusEl = document.getElementById('importStatus');
        statusEl.style.display = 'inline-flex';
        statusEl.textContent = '⏳ Import হচ্ছে...';

        try {
            const text = await file.text();
            const products = parseTxt(text);
            if (!products.length) { showToast('কোনো পণ্য পাওয়া যায়নি। ফরম্যাট: নাম, মূল্য, ফাঁকা লাইন', 'warning'); return; }

            await saveBulkProductsToSingleDoc(products);
            await incrementProductVersion();
            statusEl.textContent = `✅ ${products.length}টি পণ্য import হয়েছে`;
            showToast(`${products.length}টি পণ্য import হয়েছে ও স্টকে যুক্ত হয়েছে`, 'success');
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
