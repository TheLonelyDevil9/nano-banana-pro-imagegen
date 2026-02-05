/**
 * Filesystem Module
 * File System Access API for direct file operations
 */

import { showToast } from './ui.js';

// State
let directoryHandle = null;
let db = null;

/**
 * Check if File System Access API is supported
 */
export function isFileSystemSupported() {
    return 'showDirectoryPicker' in window;
}

/**
 * Set the database reference (called from history.js after DB init)
 */
export function setFilesystemDB(database) {
    db = database;
}

/**
 * Get current directory info
 */
export function getDirectoryInfo() {
    return {
        name: directoryHandle?.name || null,
        isSet: directoryHandle !== null
    };
}

/**
 * Select output directory via picker
 */
export async function selectOutputDirectory() {
    if (!isFileSystemSupported()) {
        showToast('File System Access not supported in this browser');
        return false;
    }

    try {
        directoryHandle = await window.showDirectoryPicker({
            mode: 'readwrite',
            startIn: 'pictures'
        });

        await persistDirectoryHandle();
        updateDirectoryUI();
        showToast(`Output folder: ${directoryHandle.name}`);
        return true;
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error('Directory selection failed:', e);
            showToast('Failed to select folder');
        }
        return false;
    }
}

/**
 * Persist directory handle to IndexedDB
 */
async function persistDirectoryHandle() {
    if (!db || !directoryHandle) return;

    return new Promise((resolve, reject) => {
        const tx = db.transaction('settings', 'readwrite');
        tx.objectStore('settings').put({
            id: 'outputDirectory',
            handle: directoryHandle,
            name: directoryHandle.name,
            savedAt: Date.now()
        });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Restore directory handle from IndexedDB (requires permission re-grant)
 */
export async function restoreDirectoryHandle() {
    if (!db || !isFileSystemSupported()) return false;

    try {
        const result = await new Promise((resolve, reject) => {
            const tx = db.transaction('settings', 'readonly');
            const req = tx.objectStore('settings').get('outputDirectory');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        if (result?.handle) {
            // Verify permission
            const permission = await result.handle.queryPermission({ mode: 'readwrite' });

            if (permission === 'granted') {
                directoryHandle = result.handle;
                updateDirectoryUI();
                return true;
            }

            // Try to request permission (will only work with user gesture)
            // Store handle for later permission request
            directoryHandle = result.handle;
            return 'needs-permission';
        }
        return false;
    } catch (e) {
        console.error('Failed to restore directory handle:', e);
        return false;
    }
}

/**
 * Request permission for stored handle (must be called from user gesture)
 */
export async function requestDirectoryPermission() {
    if (!directoryHandle) return false;

    try {
        const permission = await directoryHandle.requestPermission({ mode: 'readwrite' });
        if (permission === 'granted') {
            updateDirectoryUI();
            showToast(`Output folder: ${directoryHandle.name}`);
            return true;
        }
        return false;
    } catch (e) {
        console.error('Permission request failed:', e);
        return false;
    }
}

/**
 * Clear directory selection
 */
export async function clearDirectorySelection() {
    directoryHandle = null;

    if (db) {
        return new Promise((resolve) => {
            const tx = db.transaction('settings', 'readwrite');
            tx.objectStore('settings').delete('outputDirectory');
            tx.oncomplete = () => {
                updateDirectoryUI();
                showToast('Output folder cleared');
                resolve();
            };
            tx.onerror = resolve;
        });
    }

    updateDirectoryUI();
}

/**
 * Check if we have write permission
 */
export async function hasWritePermission() {
    if (!directoryHandle) return false;

    try {
        const permission = await directoryHandle.queryPermission({ mode: 'readwrite' });
        return permission === 'granted';
    } catch {
        return false;
    }
}

/**
 * Generate a meaningful filename from prompt
 */
export function generateFilename(prompt, variationIndex = 0) {
    // Take first 40 chars of prompt
    const snippet = prompt
        .slice(0, 40)
        .trim()
        .toLowerCase()
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '') // Remove invalid filename chars
        .replace(/\s+/g, '_')                   // Spaces to underscores
        .replace(/_+/g, '_')                    // Collapse multiple underscores
        .replace(/^_|_$/g, '')                  // Trim underscores
        || 'image';                             // Fallback if empty

    // ISO timestamp, filesystem-safe
    const timestamp = new Date().toISOString()
        .replace(/:/g, '-')
        .replace(/\.\d{3}Z$/, '');

    // Variation suffix
    const variation = variationIndex > 0 ? `_v${variationIndex + 1}` : '';

    return `${snippet}_${timestamp}${variation}.png`;
}

/**
 * Save image to filesystem
 */
export async function saveImageToFilesystem(imageDataUrl, prompt, variationIndex = 0) {
    // Fallback: trigger browser download
    if (!directoryHandle || !await hasWritePermission()) {
        return triggerDownload(imageDataUrl, prompt, variationIndex);
    }

    try {
        const filename = generateFilename(prompt, variationIndex);
        const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });

        // Convert data URL to blob
        const response = await fetch(imageDataUrl);
        const blob = await response.blob();

        // Write to file
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();

        return {
            filename,
            success: true,
            method: 'filesystem',
            directory: directoryHandle.name
        };
    } catch (e) {
        console.error('Filesystem save failed:', e);

        // Check for specific errors
        if (e.name === 'NotAllowedError') {
            showToast('Permission denied. Please re-select folder.');
            directoryHandle = null;
            updateDirectoryUI();
        } else if (e.name === 'QuotaExceededError') {
            showToast('Disk full. Cannot save image.');
        }

        // Fallback to download
        return triggerDownload(imageDataUrl, prompt, variationIndex);
    }
}

/**
 * Fallback: trigger browser download
 */
function triggerDownload(imageDataUrl, prompt, variationIndex) {
    const filename = generateFilename(prompt, variationIndex);
    const a = document.createElement('a');
    a.href = imageDataUrl;
    a.download = filename;
    a.click();

    return {
        filename,
        success: true,
        method: 'download',
        directory: null
    };
}

/**
 * Load image from filesystem
 */
export async function loadImageFromFilesystem(filename) {
    if (!directoryHandle || !await hasWritePermission()) {
        throw new Error('No directory access');
    }

    try {
        const fileHandle = await directoryHandle.getFileHandle(filename);
        const file = await fileHandle.getFile();

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    } catch (e) {
        console.error('Failed to load image:', e);
        throw e;
    }
}

/**
 * Delete file from filesystem
 */
export async function deleteFromFilesystem(filename) {
    if (!directoryHandle || !await hasWritePermission()) {
        return false;
    }

    try {
        await directoryHandle.removeEntry(filename);
        return true;
    } catch (e) {
        // File might not exist, that's okay
        if (e.name !== 'NotFoundError') {
            console.error('Delete failed:', e);
        }
        return false;
    }
}

/**
 * Check if a file exists in the filesystem
 */
export async function fileExistsInFilesystem(filename) {
    if (!directoryHandle || !filename) {
        return false;
    }

    try {
        await directoryHandle.getFileHandle(filename);
        return true;
    } catch (e) {
        // NotFoundError means file doesn't exist
        return false;
    }
}

/**
 * Get list of all image files in the directory
 */
export async function listFilesInDirectory() {
    if (!directoryHandle || !await hasWritePermission()) {
        return [];
    }

    const files = [];
    try {
        for await (const entry of directoryHandle.values()) {
            if (entry.kind === 'file' && entry.name.match(/\.(png|jpg|jpeg|webp|gif)$/i)) {
                files.push(entry.name);
            }
        }
    } catch (e) {
        console.error('Failed to list directory:', e);
    }
    return files;
}

/**
 * Update directory UI elements
 */
function updateDirectoryUI() {
    const nameEl = document.getElementById('outputDirName');
    const statusEl = document.getElementById('outputDirStatus');
    const clearBtn = document.getElementById('clearDirBtn');
    const selectBtn = document.getElementById('selectDirBtn');

    if (nameEl) {
        nameEl.textContent = directoryHandle?.name || 'Not set';
        nameEl.classList.toggle('selected', !!directoryHandle);
    }

    if (statusEl) {
        statusEl.classList.toggle('active', !!directoryHandle);
    }

    if (clearBtn) {
        clearBtn.classList.toggle('hidden', !directoryHandle);
    }

    if (selectBtn) {
        selectBtn.textContent = directoryHandle ? 'Change' : 'Select Folder';
    }
}

// Export for global access
window.selectOutputDirectory = selectOutputDirectory;
window.clearDirectorySelection = clearDirectorySelection;
window.requestDirectoryPermission = requestDirectoryPermission;
