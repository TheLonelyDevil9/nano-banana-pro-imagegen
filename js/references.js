/**
 * Reference Images Module
 * Reference image handling, compression, drag-drop
 */

import { MAX_REF_IMAGE_SIZE, MAX_REFS } from './config.js';
import { $, showToast } from './ui.js';
import { persistInput, loadPersistedInput } from './persistence.js';

// Reference images state
export let refImages = [];

// Set reference images (for persistence restore)
export function setRefImages(images) {
    refImages = images;
}

// Load ref images from storage
export function loadRefImages() {
    refImages = loadPersistedInput('refImages', []);
    renderRefs();
}

// Save ref images to storage
export function saveRefImages() {
    persistInput('refImages', refImages);
}

// Compress image to max size
export function compressImage(dataUrl) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            let w = img.width, h = img.height;
            if (w > MAX_REF_IMAGE_SIZE || h > MAX_REF_IMAGE_SIZE) {
                const scale = MAX_REF_IMAGE_SIZE / Math.max(w, h);
                w = Math.round(w * scale);
                h = Math.round(h * scale);
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/png'));
        };
        img.src = dataUrl;
    });
}

// Add reference images from files
export async function addRefImages(files) {
    const fileArray = Array.from(files);
    let addedCount = 0;

    for (const f of fileArray) {
        if (refImages.length >= MAX_REFS) {
            showToast('Maximum ' + MAX_REFS + ' reference images reached');
            break;
        }
        if (!f.type.startsWith('image/')) continue;

        try {
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsDataURL(f);
            });
            const compressed = await compressImage(dataUrl);
            refImages.push({ id: Date.now() + Math.random(), data: compressed });
            addedCount++;
        } catch (err) {
            console.error('Error processing file:', f.name, err);
        }
    }

    if (addedCount > 0) {
        renderRefs();
        saveRefImages();
        showToast(addedCount + ' image' + (addedCount > 1 ? 's' : '') + ' added');
    }
    $('refInput').value = '';
}

// Render reference images grid
export function renderRefs() {
    const refGrid = $('refGrid');
    const refCount = $('refCount');

    const addBtn = refImages.length < MAX_REFS
        ? '<button class="ref-add" onclick="document.getElementById(\'refInput\').click()">+</button>'
        : '';

    refGrid.innerHTML = refImages.map((img, idx) =>
        '<div class="ref-thumb-wrap">' +
        '<span class="ref-order-badge">' + (idx + 1) + '</span>' +
        '<img src="' + img.data + '" class="ref-thumb" onclick="viewRefImage(' + img.id + ')">' +
        '<button class="ref-remove" onclick="removeRef(' + img.id + ')">×</button>' +
        '</div>'
    ).join('') + addBtn;

    refCount.textContent = refImages.length ? '(' + refImages.length + '/' + MAX_REFS + ')' : '';
}

// Remove reference image by ID
export function removeRef(id) {
    refImages = refImages.filter(r => r.id !== id);
    renderRefs();
    saveRefImages();
}

// View reference image in fullscreen
export function viewRefImage(id) {
    const ref = refImages.find(r => r.id === id);
    if (ref) {
        $('fullscreenImg').src = ref.data;
        $('fullscreenModal').classList.add('open');
    }
}

// Clear all reference images with undo
let undoRefsBackup = null;
let undoTimeout = null;

export function clearRefs() {
    if (refImages.length === 0) return;
    undoRefsBackup = [...refImages];
    refImages = [];
    renderRefs();
    saveRefImages();

    $('undoToast').classList.add('show');
    clearTimeout(undoTimeout);
    undoTimeout = setTimeout(() => {
        $('undoToast').classList.remove('show');
        undoRefsBackup = null;
    }, 5000);
}

export function undoClearRefs() {
    if (undoRefsBackup) {
        refImages = undoRefsBackup;
        undoRefsBackup = null;
        renderRefs();
        saveRefImages();
        $('undoToast').classList.remove('show');
        showToast('Restored!');
    }
}

// Setup drag and drop for reference images
export function setupRefDragDrop() {
    const refSection = $('refGrid').parentElement;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        refSection.addEventListener(eventName, e => {
            e.preventDefault();
            e.stopPropagation();
        });
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        refSection.addEventListener(eventName, () => refSection.classList.add('dragover'));
    });

    ['dragleave', 'drop'].forEach(eventName => {
        refSection.addEventListener(eventName, () => refSection.classList.remove('dragover'));
    });

    refSection.addEventListener('drop', e => {
        const files = e.dataTransfer.files;
        const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
        if (imageFiles.length > 0) {
            addRefImages(imageFiles);
        }
    });
}

// Setup clipboard paste for reference images
export function setupClipboardPaste() {
    document.addEventListener('paste', async e => {
        const items = e.clipboardData?.items;
        if (!items) return;

        const imageFiles = [];
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) imageFiles.push(file);
            }
        }

        if (imageFiles.length === 0) return;
        e.preventDefault();

        let addedCount = 0;
        for (const file of imageFiles) {
            if (refImages.length >= MAX_REFS) {
                showToast('Maximum ' + MAX_REFS + ' reference images reached');
                break;
            }
            try {
                const dataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = ev => resolve(ev.target.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
                const compressed = await compressImage(dataUrl);
                refImages.push({ id: Date.now() + Math.random(), data: compressed });
                addedCount++;
            } catch (err) {
                console.error('Error processing pasted image:', err);
            }
        }

        if (addedCount > 0) {
            renderRefs();
            saveRefImages();
            showToast(addedCount + ' image' + (addedCount > 1 ? 's' : '') + ' pasted to references');
        }
    });
}

// Clear refs quietly (for clearAll - no undo toast)
export function clearRefsQuiet() {
    refImages = [];
    renderRefs();
    saveRefImages();
}

// Make functions globally available for HTML onclick handlers
window.addRefImages = addRefImages;
window.removeRef = removeRef;
window.viewRefImage = viewRefImage;
window.clearRefs = clearRefs;
window.undoClearRefs = undoClearRefs;
window.clearRefsQuiet = clearRefsQuiet;
