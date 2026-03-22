/**
 * Database Module
 * IndexedDB initialization and queue refs storage
 */

import { setFilesystemDB } from './filesystem.js';
import { MAX_HISTORY_ITEMS } from './config.js';

// Database state
let db = null;
const DB_VERSION = 6;

// Initialize IndexedDB
export function initDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('NanoBananaDB', DB_VERSION);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
            db = req.result;
            // Share db with filesystem module
            setFilesystemDB(db);
            resolve();
        };
        req.onupgradeneeded = e => {
            const database = e.target.result;

            // History store (v1) — kept for backward compat
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
            // Reference sets store (v4) — kept for backward compat
            if (!database.objectStoreNames.contains('refSets')) {
                const refSetsStore = database.createObjectStore('refSets', { keyPath: 'id' });
                refSetsStore.createIndex('createdAt', 'createdAt');
            }
            // Generation history store (v5) - persistent prompt/config/refs per generation
            if (!database.objectStoreNames.contains('generationHistory')) {
                const ghStore = database.createObjectStore('generationHistory', { keyPath: 'id' });
                ghStore.createIndex('createdAt', 'createdAt');
                ghStore.createIndex('filename', 'filename');
            } else {
                const ghStore = e.target.transaction.objectStore('generationHistory');
                if (!ghStore.indexNames.contains('createdAt')) {
                    ghStore.createIndex('createdAt', 'createdAt');
                }
                if (!ghStore.indexNames.contains('filename')) {
                    ghStore.createIndex('filename', 'filename');
                }
            }
        };
    });
}

// Export db for other modules
export function getDB() {
    return db;
}

// ============================================
// Queue Reference Images Storage (IndexedDB)
// ============================================

/**
 * Save refs for multiple queue items at once
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
 * Load refs for multiple queue items at once
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
 * Delete refs for multiple queue items
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
// Generation History Storage (IndexedDB)
// ============================================

/**
 * Save a generation history entry
 */
export function saveHistoryEntry(entry) {
    if (!db) return Promise.resolve();

    return new Promise((resolve, reject) => {
        const tx = db.transaction('generationHistory', 'readwrite');
        const store = tx.objectStore('generationHistory');
        store.put(entry);
        tx.oncomplete = () => resolve(entry);
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Load a single history entry by ID
 */
export function loadHistoryEntry(id) {
    if (!db) return Promise.resolve(null);

    return new Promise((resolve) => {
        const tx = db.transaction('generationHistory', 'readonly');
        const store = tx.objectStore('generationHistory');
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
    });
}

/**
 * Load N most recent history entries
 */
export function loadRecentHistory(limit = 50) {
    if (!db) return Promise.resolve([]);

    return new Promise((resolve) => {
        const tx = db.transaction('generationHistory', 'readonly');
        const store = tx.objectStore('generationHistory');
        const index = store.index('createdAt');
        const results = [];

        const req = index.openCursor(null, 'prev');
        req.onsuccess = e => {
            const cursor = e.target.result;
            if (cursor && results.length < limit) {
                results.push(cursor.value);
                cursor.continue();
            } else {
                resolve(results);
            }
        };
        req.onerror = () => resolve(results);
    });
}

/**
 * Look up a history entry by output filename
 */
export function getHistoryEntryByFilename(filename) {
    if (!db || !filename) return Promise.resolve(null);

    return new Promise((resolve) => {
        const tx = db.transaction('generationHistory', 'readonly');
        const index = tx.objectStore('generationHistory').index('filename');
        const req = index.get(filename);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
    });
}

/**
 * Delete a single history entry
 */
export function deleteHistoryEntry(id) {
    if (!db) return Promise.resolve();

    return new Promise((resolve) => {
        const tx = db.transaction('generationHistory', 'readwrite');
        tx.objectStore('generationHistory').delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
    });
}

/**
 * Prune history to MAX_HISTORY_ITEMS, deleting oldest entries
 */
export function pruneHistory() {
    if (!db) return Promise.resolve();

    return new Promise((resolve) => {
        const tx = db.transaction('generationHistory', 'readwrite');
        const store = tx.objectStore('generationHistory');
        const index = store.index('createdAt');

        const countReq = store.count();
        countReq.onsuccess = () => {
            const total = countReq.result;
            if (total <= MAX_HISTORY_ITEMS) {
                resolve();
                return;
            }

            const toDelete = total - MAX_HISTORY_ITEMS;
            let deleted = 0;
            index.openCursor().onsuccess = e => {
                const cursor = e.target.result;
                if (cursor && deleted < toDelete) {
                    cursor.delete();
                    deleted++;
                    cursor.continue();
                }
            };
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
    });
}
