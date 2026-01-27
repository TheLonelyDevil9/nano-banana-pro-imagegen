/**
 * History Module
 * IndexedDB operations, history UI, favorites
 */

import { HISTORY_PAGE_SIZE } from './config.js';
import { $, showToast, haptic } from './ui.js';

// History state
let db = null;
let historyFilter = 'all';
let historyOffset = 0;
let allHistoryItems = [];
let isLoadingHistory = false;
let currentPreviewItem = null;

// Initialize IndexedDB
export function initDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('NanoBananaDB', 2);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => { db = req.result; resolve(); };
        req.onupgradeneeded = e => {
            const database = e.target.result;
            // History store (v1)
            if (!database.objectStoreNames.contains('history')) {
                const historyStore = database.createObjectStore('history', { keyPath: 'id' });
                historyStore.createIndex('timestamp', 'timestamp');
            }
            // Saved prompts store (v2)
            if (!database.objectStoreNames.contains('savedPrompts')) {
                const promptsStore = database.createObjectStore('savedPrompts', { keyPath: 'id' });
                promptsStore.createIndex('createdAt', 'createdAt');
            }
            // Reference images store (v2)
            if (!database.objectStoreNames.contains('refImages')) {
                database.createObjectStore('refImages', { keyPath: 'id' });
            }
        };
    });
}

// Export db for other modules
export function getDB() {
    return db;
}

// Save image to history with thumbnail
export function saveToHistory(imageData, promptText, model) {
    if (!db) {
        console.error('saveToHistory: Database not initialized');
        return;
    }
    
    const img = new Image();
    img.onload = () => {
        try {
            const canvas = document.createElement('canvas');
            const maxSize = 150;
            const ratio = Math.min(maxSize / img.width, maxSize / img.height);
            canvas.width = img.width * ratio;
            canvas.height = img.height * ratio;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const thumbnail = canvas.toDataURL('image/png');

            const tx = db.transaction('history', 'readwrite');
            tx.onerror = (e) => console.error('saveToHistory transaction error:', e);
            tx.objectStore('history').add({
                id: 'img-' + Date.now(),
                imageData: imageData,
                thumbnail: thumbnail,
                prompt: promptText,
                model: model,
                timestamp: Date.now(),
                isFavorite: false
            });
            tx.oncomplete = () => {
                console.log('Image saved to history');
                loadHistory();
            };
        } catch (e) {
            console.error('saveToHistory error:', e);
        }
    };
    img.onerror = (e) => console.error('saveToHistory image load error:', e);
    img.src = imageData;
}

// Load history from IndexedDB
export function loadHistory(append = false) {
    if (isLoadingHistory) return;
    isLoadingHistory = true;

    const tx = db.transaction('history', 'readonly');
    const items = [];

    tx.objectStore('history').index('timestamp').openCursor(null, 'prev').onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) {
            const item = cursor.value;
            if (historyFilter === 'favorites' && !item.isFavorite) {
                cursor.continue();
                return;
            }
            items.push(item);
            if (items.length < HISTORY_PAGE_SIZE * 3) {
                cursor.continue();
            }
        }
        if (!cursor || items.length >= HISTORY_PAGE_SIZE * 3) {
            allHistoryItems = items;
            renderHistoryItems(append);
            isLoadingHistory = false;
        }
    };
}

// Render history items
function renderHistoryItems(append = false) {
    const historyList = $('historyList');
    const startIdx = append ? historyOffset * HISTORY_PAGE_SIZE : 0;
    const endIdx = (historyOffset + 1) * HISTORY_PAGE_SIZE;
    const itemsToShow = allHistoryItems.slice(startIdx, endIdx);

    if (allHistoryItems.length === 0) {
        historyList.innerHTML = '<div class="history-empty">' +
            (historyFilter === 'favorites' ? 'No favorites yet' : 'No images yet') + '</div>';
        return;
    }

    // Create elements using DocumentFragment for better performance
    if (append) {
        const fragment = document.createDocumentFragment();
        itemsToShow.forEach(i => {
            fragment.appendChild(createHistoryItemElement(i));
        });
        historyList.appendChild(fragment);
    } else {
        // Full re-render
        historyList.innerHTML = '';
        const fragment = document.createDocumentFragment();
        allHistoryItems.slice(0, endIdx).forEach(i => {
            fragment.appendChild(createHistoryItemElement(i));
        });
        historyList.appendChild(fragment);
    }

    // Setup infinite scroll
    if (!historyList.dataset.scrollSetup) {
        historyList.dataset.scrollSetup = 'true';
        historyList.addEventListener('scroll', () => {
            if (historyList.scrollTop + historyList.clientHeight >= historyList.scrollHeight - 100) {
                if (allHistoryItems.length > (historyOffset + 1) * HISTORY_PAGE_SIZE) {
                    historyOffset++;
                    renderHistoryItems(true);
                }
            }
        });
    }
}

// Create a single history item element
function createHistoryItemElement(item) {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.onclick = () => loadHistoryItem(item.id);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = '🗑';
    deleteBtn.onclick = (e) => deleteHistoryItem(item.id, e);

    const favBtn = document.createElement('button');
    favBtn.className = 'favorite-btn' + (item.isFavorite ? ' active' : '');
    favBtn.textContent = item.isFavorite ? '★' : '☆';
    favBtn.onclick = (e) => toggleFavorite(item.id, e);

    const img = document.createElement('img');
    img.src = item.thumbnail || item.imageData;
    img.loading = 'lazy';

    const info = document.createElement('div');
    info.className = 'history-item-info';
    info.textContent = item.prompt.slice(0, 20);

    div.appendChild(deleteBtn);
    div.appendChild(favBtn);
    div.appendChild(img);
    div.appendChild(info);

    return div;
}

// Toggle history panel
export function toggleHistory() {
    $('historyPanel').classList.toggle('open');
    $('overlay').classList.toggle('open');
}

// Set history filter
export function setHistoryFilter(filter) {
    historyFilter = filter;
    $('filterAll').classList.toggle('active', filter === 'all');
    $('filterFavorites').classList.toggle('active', filter === 'favorites');
    historyOffset = 0;
    loadHistory();
}

// Toggle favorite status
export function toggleFavorite(id, event) {
    event.stopPropagation();
    const tx = db.transaction('history', 'readwrite');
    const store = tx.objectStore('history');
    store.get(id).onsuccess = e => {
        const item = e.target.result;
        if (item) {
            item.isFavorite = !item.isFavorite;
            store.put(item);
            tx.oncomplete = () => loadHistory();
        }
    };
    haptic(15);
}

// Delete history item
export function deleteHistoryItem(id, event) {
    event.stopPropagation();
    const tx = db.transaction('history', 'readwrite');
    const store = tx.objectStore('history');
    store.get(id).onsuccess = e => {
        const item = e.target.result;
        if (item && item.isFavorite) {
            showToast('Remove star to delete');
            return;
        }
        store.delete(id);
        tx.oncomplete = () => {
            loadHistory();
            showToast('Deleted');
        };
    };
    haptic(15);
}

// Load history item for preview
export function loadHistoryItem(id) {
    const tx = db.transaction('history', 'readonly');
    tx.objectStore('history').get(id).onsuccess = e => {
        const item = e.target.result;
        if (item) {
            currentPreviewItem = item;
            $('previewImg').src = item.imageData;
            $('previewPrompt').textContent = item.prompt;
            $('previewModal').classList.add('open');
        }
    };
}

// Close preview modal
export function closePreview(e) {
    if (e && e.target !== $('previewModal')) return;
    $('previewModal').classList.remove('open');
    currentPreviewItem = null;
}

// Use history item (load prompt and image)
export function useHistoryItem(setCurrentImg, resetZoom) {
    if (!currentPreviewItem) return;

    setCurrentImg(currentPreviewItem.imageData);
    $('prompt').value = currentPreviewItem.prompt;
    $('resultImg').src = currentPreviewItem.imageData;
    $('resultImg').classList.remove('hidden');
    $('placeholder').classList.add('hidden');
    $('imageBox').classList.add('has-image');
    $('iterateBtn').disabled = $('downloadBtn').disabled = $('copyBtn').disabled = false;

    closePreview();
    toggleHistory();
    resetZoom();
}

// Download preview image
export function downloadPreview() {
    if (!currentPreviewItem) return;
    const a = document.createElement('a');
    a.href = currentPreviewItem.imageData;
    a.download = 'nano-banana-' + Date.now() + '.png';
    a.click();
}

// Clear all non-favorite history
export function clearHistory() {
    if (!confirm('Clear all non-favorite history?')) return;
    const tx = db.transaction('history', 'readwrite');
    const store = tx.objectStore('history');
    store.openCursor().onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) {
            if (!cursor.value.isFavorite) {
                cursor.delete();
            }
            cursor.continue();
        }
    };
    tx.oncomplete = () => { loadHistory(); showToast('Cleared (favorites kept)'); };
}

// Get current preview item (for external use)
export function getCurrentPreviewItem() {
    return currentPreviewItem;
}

// Make functions globally available for HTML onclick handlers
window.toggleHistory = toggleHistory;
window.setHistoryFilter = setHistoryFilter;
window.toggleFavorite = toggleFavorite;
window.deleteHistoryItem = deleteHistoryItem;
window.loadHistoryItem = loadHistoryItem;
window.closePreview = closePreview;
window.downloadPreview = downloadPreview;
window.clearHistory = clearHistory;
