/**
 * History Module
 * IndexedDB operations, history UI, favorites
 */

import { HISTORY_PAGE_SIZE } from './config.js';
import { $, showToast, haptic, showConfirmDialog } from './ui.js';
import { setFilesystemDB, loadImageFromFilesystem, deleteFromFilesystem, getDirectoryInfo, fileExistsInFilesystem } from './filesystem.js';

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
        const req = indexedDB.open('NanoBananaDB', 4);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
            db = req.result;
            // Share db with filesystem module
            setFilesystemDB(db);
            resolve();
        };
        req.onupgradeneeded = e => {
            const database = e.target.result;
            const oldVersion = e.oldVersion;

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
            // Settings store (v3) - for filesystem handle persistence
            if (!database.objectStoreNames.contains('settings')) {
                database.createObjectStore('settings', { keyPath: 'id' });
            }
            // Queue refs store (v4) - for persisting queue item reference images
            if (!database.objectStoreNames.contains('queueRefs')) {
                database.createObjectStore('queueRefs', { keyPath: 'itemId' });
            }
            // Reference sets store (v4) - for saving named collections of reference images
            if (!database.objectStoreNames.contains('refSets')) {
                const refSetsStore = database.createObjectStore('refSets', { keyPath: 'id' });
                refSetsStore.createIndex('createdAt', 'createdAt');
            }

            // Migration: mark existing history items as not having filesystem files
            if (oldVersion < 3 && oldVersion > 0) {
                console.log('Migrating history items to v3 schema...');
                // Migration happens after upgrade completes
            }
        };
    }).then(() => migrateHistoryItems());
}

// Migrate existing history items to new schema
async function migrateHistoryItems() {
    if (!db) return;

    return new Promise((resolve) => {
        const tx = db.transaction('history', 'readwrite');
        const store = tx.objectStore('history');
        let migratedCount = 0;

        store.openCursor().onsuccess = e => {
            const cursor = e.target.result;
            if (cursor) {
                const item = cursor.value;
                // Add new fields if missing
                if (item.hasFileSystemFile === undefined) {
                    item.hasFileSystemFile = false;
                    item.filename = null;
                    item.resolution = null;
                    cursor.update(item);
                    migratedCount++;
                }
                cursor.continue();
            }
        };

        tx.oncomplete = () => {
            if (migratedCount > 0) {
                console.log(`Migrated ${migratedCount} history items to v3 schema`);
            }
            resolve();
        };
        tx.onerror = () => resolve();
    });
}

// Export db for other modules
export function getDB() {
    return db;
}

// Save image to history with thumbnail (LEGACY - stores full image)
export function saveToHistory(imageData, promptText, model, refImagesUsed = null) {
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
                isFavorite: false,
                hasFileSystemFile: false,
                filename: null,
                resolution: { width: img.naturalWidth, height: img.naturalHeight },
                refImages: refImagesUsed
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

// Save to history with thumbnail only (for filesystem mode)
export function saveToHistoryThumbnailOnly(imageData, promptText, model, filename, refImagesUsed = null) {
    if (!db) {
        console.error('saveToHistoryThumbnailOnly: Database not initialized');
        return Promise.reject(new Error('Database not initialized'));
    }

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                // Generate thumbnail
                const canvas = document.createElement('canvas');
                const maxSize = 150;
                const ratio = Math.min(maxSize / img.width, maxSize / img.height);
                canvas.width = img.width * ratio;
                canvas.height = img.height * ratio;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const thumbnail = canvas.toDataURL('image/png');

                const tx = db.transaction('history', 'readwrite');
                tx.onerror = (e) => {
                    console.error('saveToHistoryThumbnailOnly transaction error:', e);
                    reject(e);
                };
                tx.objectStore('history').add({
                    id: 'img-' + Date.now(),
                    // NO imageData - only thumbnail for new filesystem-backed items
                    thumbnail: thumbnail,
                    prompt: promptText,
                    model: model,
                    timestamp: Date.now(),
                    isFavorite: false,
                    hasFileSystemFile: !!filename,
                    filename: filename,
                    resolution: { width: img.naturalWidth, height: img.naturalHeight },
                    refImages: refImagesUsed
                });
                tx.oncomplete = () => {
                    console.log('Thumbnail saved to history (filesystem mode)');
                    loadHistory();
                    resolve();
                };
            } catch (e) {
                console.error('saveToHistoryThumbnailOnly error:', e);
                reject(e);
            }
        };
        img.onerror = (e) => {
            console.error('saveToHistoryThumbnailOnly image load error:', e);
            reject(e);
        };
        img.src = imageData;
    });
}

// Load history from IndexedDB
export function loadHistory(append = false) {
    if (isLoadingHistory) return;
    isLoadingHistory = true;

    // Reset offset on full reload
    if (!append) {
        historyOffset = 0;
    }

    const tx = db.transaction('history', 'readonly');
    const items = [];

    // Load ALL items (thumbnails only, so memory-efficient)
    tx.objectStore('history').index('timestamp').openCursor(null, 'prev').onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) {
            const item = cursor.value;
            if (historyFilter === 'favorites' && !item.isFavorite) {
                cursor.continue();
                return;
            }
            items.push(item);
            cursor.continue();
        } else {
            // Cursor exhausted - all items loaded
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
    const hasMore = allHistoryItems.length > endIdx;

    if (allHistoryItems.length === 0) {
        historyList.innerHTML = '<div class="history-empty">' +
            (historyFilter === 'favorites' ? 'No favorites yet' : 'No images yet') + '</div>';
        return;
    }

    // Remove existing "Load More" button before rendering
    const existingLoadMore = historyList.querySelector('.history-load-more');
    if (existingLoadMore) existingLoadMore.remove();

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

    // Add "Load More" button if there are more items
    if (hasMore) {
        const loadMoreBtn = document.createElement('button');
        loadMoreBtn.className = 'history-load-more';
        loadMoreBtn.textContent = `Load more (${allHistoryItems.length - endIdx} remaining)`;
        loadMoreBtn.onclick = () => {
            historyOffset++;
            renderHistoryItems(true);
        };
        historyList.appendChild(loadMoreBtn);
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

    // Auto-fill: if content doesn't overflow, load more pages until it does
    autoFillHistory(historyList);
}

// Auto-fill: keep loading pages until the container overflows or all items are shown
let autoFillIterations = 0;
function autoFillHistory(historyList) {
    const hasMore = allHistoryItems.length > (historyOffset + 1) * HISTORY_PAGE_SIZE;
    const hasOverflow = historyList.scrollHeight > historyList.clientHeight + 50;

    if (!hasMore || hasOverflow || autoFillIterations >= 10) {
        autoFillIterations = 0;
        return;
    }

    autoFillIterations++;
    historyOffset++;
    // Use rAF to let the DOM settle before checking overflow again
    requestAnimationFrame(() => renderHistoryItems(true));
}

// Create a single history item element
function createHistoryItemElement(item) {
    const div = document.createElement('div');
    div.className = 'history-item';
    if (item.hasFileSystemFile) {
        div.classList.add('has-file');
    }
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

    // Quick action: use prompt only (no modal needed)
    const usePromptBtn = document.createElement('button');
    usePromptBtn.className = 'quick-use-btn';
    usePromptBtn.textContent = '\u{1F4DD}';
    usePromptBtn.title = 'Use prompt only';
    usePromptBtn.onclick = (e) => {
        e.stopPropagation();
        $('prompt').value = item.prompt;
        showToast('Prompt loaded');
    };
    div.appendChild(usePromptBtn);

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

// Delete history item (also deletes from filesystem if applicable)
export async function deleteHistoryItem(id, event) {
    event.stopPropagation();

    // First get the item to check if it's favorited and has a file
    const item = await new Promise((resolve) => {
        const tx = db.transaction('history', 'readonly');
        tx.objectStore('history').get(id).onsuccess = e => resolve(e.target.result);
    });

    if (!item) return;

    if (item.isFavorite) {
        showToast('Remove star to delete');
        return;
    }

    // Delete from filesystem if it has a file
    if (item.hasFileSystemFile && item.filename) {
        try {
            await deleteFromFilesystem(item.filename);
            console.log('Deleted file from filesystem:', item.filename);
        } catch (e) {
            console.warn('Could not delete from filesystem:', e);
            // Continue with IndexedDB deletion anyway
        }
    }

    // Delete from IndexedDB
    const tx = db.transaction('history', 'readwrite');
    tx.objectStore('history').delete(id);
    tx.oncomplete = () => {
        loadHistory();
        showToast('Deleted');
    };

    haptic(15);
}

// Load history item for preview
export async function loadHistoryItem(id) {
    const item = await new Promise((resolve) => {
        const tx = db.transaction('history', 'readonly');
        tx.objectStore('history').get(id).onsuccess = e => resolve(e.target.result);
    });

    if (!item) return;

    currentPreviewItem = item;
    $('previewPrompt').textContent = item.prompt;
    $('previewModal').classList.add('open');

    // Determine image source
    let imageSource = null;

    // Try to load from filesystem first if available
    if (item.hasFileSystemFile && item.filename) {
        try {
            const dirInfo = getDirectoryInfo();
            if (dirInfo.isSet) {
                imageSource = await loadImageFromFilesystem(item.filename);
                console.log('Loaded full image from filesystem');
            }
        } catch (e) {
            console.warn('Could not load from filesystem, falling back:', e);
        }
    }

    // Fallback to stored imageData (legacy items)
    if (!imageSource && item.imageData) {
        imageSource = item.imageData;
    }

    // Last resort: use thumbnail
    if (!imageSource) {
        imageSource = item.thumbnail;
        console.log('Using thumbnail as fallback (file not accessible)');
    }

    $('previewImg').src = imageSource;

    // Update currentPreviewItem with the loaded image for use/download
    currentPreviewItem.loadedImageData = imageSource;

    // Update refs button state
    const useRefsBtn = $('useRefsBtn');
    if (useRefsBtn) {
        const hasRefs = item.refImages && item.refImages.length > 0;
        useRefsBtn.disabled = !hasRefs;
        useRefsBtn.textContent = hasRefs ? `Use Refs (${item.refImages.length})` : 'Use Refs';
    }
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

    const imageData = currentPreviewItem.loadedImageData || currentPreviewItem.imageData || currentPreviewItem.thumbnail;

    setCurrentImg(imageData);
    $('prompt').value = currentPreviewItem.prompt;
    $('resultImg').src = imageData;
    $('resultImg').classList.remove('hidden');
    $('placeholder').classList.add('hidden');
    $('imageBox').classList.add('has-image');
    $('iterateBtn').disabled = $('downloadBtn').disabled = $('copyBtn').disabled = false;
    $('regenerateBtn').disabled = false;
    $('clearOutputBtn').disabled = false;

    closePreview();
    toggleHistory();
    resetZoom();
}

// Download preview image
export function downloadPreview() {
    if (!currentPreviewItem) return;
    const imageData = currentPreviewItem.loadedImageData || currentPreviewItem.imageData || currentPreviewItem.thumbnail;
    const a = document.createElement('a');
    a.href = imageData;
    a.download = currentPreviewItem.filename || ('nano-banana-' + Date.now() + '.png');
    a.click();
}

// Clear all non-favorite history (also clears filesystem files)
export async function clearHistory() {
    // First count items to delete
    const itemsToDelete = [];
    await new Promise((resolve) => {
        const tx = db.transaction('history', 'readonly');
        tx.objectStore('history').openCursor().onsuccess = e => {
            const cursor = e.target.result;
            if (cursor) {
                if (!cursor.value.isFavorite) {
                    itemsToDelete.push(cursor.value);
                }
                cursor.continue();
            } else {
                resolve();
            }
        };
    });

    if (itemsToDelete.length === 0) {
        showToast('No items to clear (only favorites remain)');
        return;
    }

    const confirmed = await showConfirmDialog({
        title: 'Clear History',
        message: `Delete ${itemsToDelete.length} history items?`,
        warning: 'This will also delete files from the output folder. Favorites will be kept.',
        confirmText: 'Clear All',
        danger: true
    });

    if (!confirmed) return;

    // Delete files from filesystem
    for (const item of itemsToDelete) {
        if (item.hasFileSystemFile && item.filename) {
            try {
                await deleteFromFilesystem(item.filename);
            } catch (e) {
                console.warn('Could not delete file:', item.filename, e);
            }
        }
    }

    // Delete from IndexedDB
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
    tx.oncomplete = () => {
        loadHistory();
        showToast('Cleared (favorites kept)');
    };
}

// Get current preview item (for external use)
export function getCurrentPreviewItem() {
    return currentPreviewItem;
}

// Use only the prompt from history (don't change image/refs)
export function useHistoryPromptOnly() {
    if (!currentPreviewItem) return;
    $('prompt').value = currentPreviewItem.prompt;
    closePreview();
    toggleHistory();
    showToast('Prompt loaded');
}

// Use the reference images from this history item
export function useHistoryRefs() {
    if (!currentPreviewItem || !currentPreviewItem.refImages || currentPreviewItem.refImages.length === 0) return;

    import('./references.js').then(refModule => {
        refModule.setRefImages(currentPreviewItem.refImages.map(r => ({ ...r })));
        refModule.renderRefs();
        refModule.saveRefImages();
        closePreview();
        toggleHistory();
        showToast(currentPreviewItem.refImages.length + ' reference images loaded');
    });
}

// Sync history with filesystem - remove entries for files that no longer exist
// Favorites are ALWAYS protected and never removed by sync
export async function syncHistoryWithFilesystem() {
    const dirInfo = getDirectoryInfo();
    if (!dirInfo.isSet) {
        showToast('No output folder selected');
        return;
    }

    showToast('Syncing...');

    // Get all history items with filesystem files (excluding favorites)
    const itemsToCheck = await new Promise((resolve) => {
        const items = [];
        const tx = db.transaction('history', 'readonly');
        tx.objectStore('history').openCursor().onsuccess = e => {
            const cursor = e.target.result;
            if (cursor) {
                const item = cursor.value;
                // Only check non-favorited items with filesystem files
                if (item.hasFileSystemFile && item.filename && !item.isFavorite) {
                    items.push(item);
                }
                cursor.continue();
            } else {
                resolve(items);
            }
        };
    });

    // Check each item's file existence
    let removedCount = 0;
    let skippedFavorites = 0;
    for (const item of itemsToCheck) {
        const exists = await fileExistsInFilesystem(item.filename);
        if (!exists) {
            // Double-check it's not favorited (safety)
            if (item.isFavorite) {
                skippedFavorites++;
                continue;
            }
            // Delete this history entry
            await new Promise((resolve) => {
                const tx = db.transaction('history', 'readwrite');
                tx.objectStore('history').delete(item.id);
                tx.oncomplete = resolve;
                tx.onerror = resolve;
            });
            removedCount++;
        }
    }

    loadHistory();

    if (removedCount > 0) {
        showToast(`Removed ${removedCount} orphaned entries (favorites protected)`);
    } else {
        showToast('History is in sync');
    }
}

// ============================================
// Queue Reference Images Storage (IndexedDB)
// ============================================

/**
 * Save reference images for a queue item to IndexedDB
 * @param {string} itemId - Queue item ID
 * @param {Array} refImages - Array of reference image objects
 */
export function saveQueueItemRefs(itemId, refImages) {
    if (!db || !refImages || refImages.length === 0) return Promise.resolve();

    return new Promise((resolve, reject) => {
        const tx = db.transaction('queueRefs', 'readwrite');
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => resolve();
        tx.objectStore('queueRefs').put({
            itemId: itemId,
            refImages: refImages
        });
    });
}

/**
 * Save refs for multiple queue items at once
 * @param {Array} items - Array of {itemId, refImages} objects
 */
export function saveQueueRefsMultiple(items) {
    if (!db || !items || items.length === 0) return Promise.resolve();

    return new Promise((resolve, reject) => {
        const tx = db.transaction('queueRefs', 'readwrite');
        const store = tx.objectStore('queueRefs');
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => resolve();

        items.forEach(({ itemId, refImages }) => {
            if (refImages && refImages.length > 0) {
                store.put({ itemId, refImages });
            }
        });
    });
}

/**
 * Load reference images for a queue item from IndexedDB
 * @param {string} itemId - Queue item ID
 * @returns {Promise<Array>} - Reference images array
 */
export function loadQueueItemRefs(itemId) {
    if (!db) return Promise.resolve([]);

    return new Promise((resolve) => {
        const tx = db.transaction('queueRefs', 'readonly');
        tx.objectStore('queueRefs').get(itemId).onsuccess = e => {
            const result = e.target.result;
            resolve(result ? result.refImages : []);
        };
        tx.onerror = () => resolve([]);
    });
}

/**
 * Load refs for multiple queue items at once
 * @param {Array<string>} itemIds - Array of queue item IDs
 * @returns {Promise<Map>} - Map of itemId -> refImages
 */
export function loadQueueRefsMultiple(itemIds) {
    if (!db || !itemIds || itemIds.length === 0) return Promise.resolve(new Map());

    return new Promise((resolve) => {
        const refsMap = new Map();
        const tx = db.transaction('queueRefs', 'readonly');
        const store = tx.objectStore('queueRefs');

        let pending = itemIds.length;
        itemIds.forEach(itemId => {
            store.get(itemId).onsuccess = e => {
                const result = e.target.result;
                if (result && result.refImages) {
                    refsMap.set(itemId, result.refImages);
                }
                pending--;
                if (pending === 0) resolve(refsMap);
            };
        });

        tx.onerror = () => resolve(refsMap);
    });
}

/**
 * Delete reference images for a queue item
 * @param {string} itemId - Queue item ID
 */
export function deleteQueueItemRefs(itemId) {
    if (!db) return Promise.resolve();

    return new Promise((resolve) => {
        const tx = db.transaction('queueRefs', 'readwrite');
        tx.objectStore('queueRefs').delete(itemId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
    });
}

/**
 * Delete refs for multiple queue items
 * @param {Array<string>} itemIds - Array of queue item IDs
 */
export function deleteQueueRefsMultiple(itemIds) {
    if (!db || !itemIds || itemIds.length === 0) return Promise.resolve();

    return new Promise((resolve) => {
        const tx = db.transaction('queueRefs', 'readwrite');
        const store = tx.objectStore('queueRefs');
        itemIds.forEach(id => store.delete(id));
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
    });
}

/**
 * Clear all queue refs (called when queue is cleared)
 */
export function clearAllQueueRefs() {
    if (!db) return Promise.resolve();

    return new Promise((resolve) => {
        const tx = db.transaction('queueRefs', 'readwrite');
        tx.objectStore('queueRefs').clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
    });
}

// ============================================
// Reference Sets Storage (IndexedDB)
// ============================================

/**
 * Save a reference set
 * @param {string} name - Set name
 * @param {Array} images - Array of reference image objects
 * @returns {Promise<string>} - Created set ID
 */
export function saveRefSet(name, images) {
    if (!db) return Promise.reject(new Error('Database not initialized'));

    return new Promise((resolve, reject) => {
        const id = 'refset_' + Date.now();
        const tx = db.transaction('refSets', 'readwrite');
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => resolve(id);
        tx.objectStore('refSets').add({
            id,
            name,
            createdAt: Date.now(),
            images: images.map(img => ({ data: img.data }))
        });
    });
}

/**
 * Load all reference sets
 * @returns {Promise<Array>} - Array of ref sets (without image data for listing)
 */
export function loadRefSetsList() {
    if (!db) return Promise.resolve([]);

    return new Promise((resolve) => {
        const sets = [];
        const tx = db.transaction('refSets', 'readonly');
        tx.objectStore('refSets').index('createdAt').openCursor(null, 'prev').onsuccess = e => {
            const cursor = e.target.result;
            if (cursor) {
                const set = cursor.value;
                sets.push({
                    id: set.id,
                    name: set.name,
                    createdAt: set.createdAt,
                    imageCount: set.images?.length || 0
                });
                cursor.continue();
            } else {
                resolve(sets);
            }
        };
        tx.onerror = () => resolve([]);
    });
}

/**
 * Load a specific reference set with full image data
 * @param {string} id - Set ID
 * @returns {Promise<Object|null>} - Ref set with images
 */
export function loadRefSet(id) {
    if (!db) return Promise.resolve(null);

    return new Promise((resolve) => {
        const tx = db.transaction('refSets', 'readonly');
        tx.objectStore('refSets').get(id).onsuccess = e => {
            resolve(e.target.result || null);
        };
        tx.onerror = () => resolve(null);
    });
}

/**
 * Delete a reference set
 * @param {string} id - Set ID
 */
export function deleteRefSet(id) {
    if (!db) return Promise.resolve();

    return new Promise((resolve) => {
        const tx = db.transaction('refSets', 'readwrite');
        tx.objectStore('refSets').delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
    });
}

// History column size control
export function setHistoryColumns(cols) {
    const historyList = $('historyList');
    if (historyList) {
        historyList.style.setProperty('--history-columns', cols);
    }
    localStorage.setItem('history_columns', cols);
    // Re-trigger auto-fill since fewer columns may need more items
    autoFillIterations = 0;
    autoFillHistory(historyList);
}

export function restoreHistoryColumns() {
    const saved = localStorage.getItem('history_columns');
    if (saved) {
        const slider = $('historyColumns');
        if (slider) slider.value = saved;
        const historyList = $('historyList');
        if (historyList) historyList.style.setProperty('--history-columns', saved);
    }
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
window.useHistoryPromptOnly = useHistoryPromptOnly;
window.useHistoryRefs = useHistoryRefs;
window.syncHistoryWithFilesystem = syncHistoryWithFilesystem;
window.setHistoryColumns = setHistoryColumns;
