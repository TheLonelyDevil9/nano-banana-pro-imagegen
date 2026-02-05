/**
 * Queue UI Module
 * Prompt boxes management, rendering, import/export
 */

import { $, showToast } from './ui.js';
import {
    getQueueState,
    getQueueStats,
    addToQueue,
    setOnProgress,
    setQueueDelay,
    QueueStatus
} from './queue.js';
import { getCurrentConfig } from './generation.js';
import { getDirectoryInfo, selectOutputDirectory } from './filesystem.js';
import { refImages, compressImage } from './references.js';
import { MAX_REFS, DEFAULT_QUEUE_DELAY_MS } from './config.js';

// Prompt boxes state
let promptBoxes = [];
let currentBoxForRefs = null;
let bulkRefMode = false;  // When true, file input adds to selected boxes

// Multi-select state
let selectedBoxIds = new Set();

// Sticky defaults - remember last prompt box settings for new boxes
let stickyDefaults = {
    variations: 1,
    refImages: null  // null = use global, [...] = custom refs
};

/**
 * Initialize queue UI
 */
export function initQueueUI() {
    // Set up progress callback
    setOnProgress(renderQueuePanel);

    // Set up box ref input handler
    const boxRefInput = $('boxRefInput');
    if (boxRefInput) {
        boxRefInput.addEventListener('change', handleBoxRefInput);
    }

    // Initial render
    renderQueuePanel();
    updateDirectoryDisplay();
}

/**
 * Generate unique ID for prompt box
 */
function generateBoxId() {
    return 'pb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Add a new prompt box
 * When called with no explicit variations/refs, uses sticky defaults from last box
 */
export function addPromptBox(prompt = '', variations = null, boxRefImages = undefined) {
    const box = {
        id: generateBoxId(),
        prompt: prompt,
        variations: variations !== null ? variations : stickyDefaults.variations,
        refImages: boxRefImages !== undefined ? boxRefImages :
            (stickyDefaults.refImages ? stickyDefaults.refImages.map(r => ({ ...r, id: Date.now() + Math.random() })) : null)
    };
    promptBoxes.push(box);
    renderPromptBoxes();
    updateTotalCount();

    // Focus the new textarea
    setTimeout(() => {
        const textarea = document.querySelector(`[data-box-id="${box.id}"] .prompt-box-textarea`);
        if (textarea) textarea.focus();
    }, 50);
}

/**
 * Remove a prompt box
 */
export function removePromptBox(id) {
    promptBoxes = promptBoxes.filter(box => box.id !== id);
    renderPromptBoxes();
    updateTotalCount();
}

/**
 * Update a prompt box
 */
export function updatePromptBox(id, updates) {
    const box = promptBoxes.find(b => b.id === id);
    if (box) {
        Object.assign(box, updates);
        updateTotalCount();
    }
}

/**
 * Set variations for a prompt box
 */
export function setBoxVariations(id, variations) {
    const v = parseInt(variations) || 1;
    updatePromptBox(id, { variations: v });
    stickyDefaults.variations = v;
    // Re-render just the variation buttons
    const footer = document.querySelector(`[data-box-id="${id}"] .prompt-box-footer`);
    if (footer) {
        const box = promptBoxes.find(b => b.id === id);
        if (box) {
            const btns = footer.querySelectorAll('.variation-btn');
            btns.forEach(btn => {
                btn.classList.toggle('active', parseInt(btn.dataset.val) === box.variations);
            });
        }
    }
}

/**
 * Open file picker for box refs
 */
export function openBoxRefPicker(boxId) {
    currentBoxForRefs = boxId;
    const input = $('boxRefInput');
    if (input) {
        input.value = '';
        input.click();
    }
}

/**
 * Handle box ref file input
 */
async function handleBoxRefInput(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Determine which boxes to add refs to
    let targetBoxIds = [];
    if (bulkRefMode && selectedBoxIds.size > 0) {
        targetBoxIds = [...selectedBoxIds];
        bulkRefMode = false;
    } else if (currentBoxForRefs) {
        targetBoxIds = [currentBoxForRefs];
    } else {
        return;
    }

    // Process files first
    const newRefs = [];
    for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        try {
            const dataUrl = await fileToDataUrl(file);
            const compressed = await compressImage(dataUrl);
            newRefs.push({ data: compressed });
        } catch (err) {
            console.error('Error processing file:', err);
        }
    }

    if (newRefs.length === 0) {
        currentBoxForRefs = null;
        return;
    }

    // Add refs to each target box
    for (const boxId of targetBoxIds) {
        const box = promptBoxes.find(b => b.id === boxId);
        if (!box) continue;

        // Initialize refImages array if null
        if (!box.refImages) {
            box.refImages = [];
        }

        for (const ref of newRefs) {
            if (box.refImages.length >= MAX_REFS) {
                break;
            }
            // Each box gets its own copy with unique ID
            box.refImages.push({ id: Date.now() + Math.random(), data: ref.data });
        }
    }

    // Update sticky defaults if single box mode
    if (targetBoxIds.length === 1) {
        const box = promptBoxes.find(b => b.id === targetBoxIds[0]);
        if (box && box.refImages && box.refImages.length > 0) {
            stickyDefaults.refImages = box.refImages.map(r => ({ ...r }));
        }
    }

    renderPromptBoxes();
    currentBoxForRefs = null;

    if (targetBoxIds.length > 1) {
        showToast(`Added ${newRefs.length} ref(s) to ${targetBoxIds.length} prompts`);
    }
}

/**
 * Clear custom refs from a box (revert to global)
 */
export function clearBoxRefs(id) {
    updatePromptBox(id, { refImages: null });
    stickyDefaults.refImages = null;
    renderPromptBoxes();
}

/**
 * Remove a single ref from a box
 */
export function removeBoxRef(boxId, refId) {
    const box = promptBoxes.find(b => b.id === boxId);
    if (box && box.refImages) {
        box.refImages = box.refImages.filter(r => r.id !== refId);
        if (box.refImages.length === 0) {
            box.refImages = null;  // Revert to global
        }
        renderPromptBoxes();
    }
}

/**
 * Toggle box selection for bulk operations
 */
export function toggleBoxSelection(boxId, isSelected) {
    if (isSelected) {
        selectedBoxIds.add(boxId);
    } else {
        selectedBoxIds.delete(boxId);
    }
    renderBulkActionsBar();
    // Update checkbox visually without full re-render
    const checkbox = document.querySelector(`[data-box-id="${boxId}"] .box-select-checkbox`);
    if (checkbox) {
        checkbox.checked = isSelected;
    }
}

/**
 * Select all prompt boxes
 */
export function selectAllBoxes() {
    promptBoxes.forEach(box => selectedBoxIds.add(box.id));
    renderPromptBoxes();
    renderBulkActionsBar();
}

/**
 * Deselect all prompt boxes
 */
export function deselectAllBoxes() {
    selectedBoxIds.clear();
    renderPromptBoxes();
    renderBulkActionsBar();
}

/**
 * Open file picker for bulk ref add (add to all selected boxes)
 */
export function openBulkRefPicker() {
    if (selectedBoxIds.size === 0) {
        showToast('Select prompts first');
        return;
    }
    bulkRefMode = true;
    const input = $('boxRefInput');
    if (input) {
        input.value = '';
        input.click();
    }
}

/**
 * Render bulk actions bar
 */
function renderBulkActionsBar() {
    const container = $('bulkActionsBar');
    if (!container) return;

    const count = selectedBoxIds.size;
    if (count === 0) {
        container.classList.remove('visible');
        return;
    }

    container.classList.add('visible');
    container.innerHTML = `
        <span class="bulk-selection-count">${count} selected</span>
        <button class="btn-secondary btn-sm" onclick="openBulkRefPicker()">Add Refs to Selected</button>
        <button class="btn-secondary btn-sm" onclick="clearSelectedBoxRefs()">Clear Refs from Selected</button>
        <button class="btn-secondary btn-sm" onclick="deselectAllBoxes()">Deselect All</button>
    `;
}

/**
 * Clear refs from all selected boxes
 */
export function clearSelectedBoxRefs() {
    selectedBoxIds.forEach(id => {
        updatePromptBox(id, { refImages: null });
    });
    renderPromptBoxes();
    showToast(`Cleared refs from ${selectedBoxIds.size} prompts`);
}

/**
 * Update total count display
 */
function updateTotalCount() {
    const promptCount = promptBoxes.filter(b => b.prompt.trim().length > 0).length;
    const totalImages = promptBoxes.reduce((sum, box) => {
        return sum + (box.prompt.trim().length > 0 ? box.variations : 0);
    }, 0);

    const promptCountEl = $('promptBoxCount');
    const totalImagesEl = $('totalImagesCount');
    const startBtn = $('startQueueBtn');

    if (promptCountEl) promptCountEl.textContent = promptCount;
    if (totalImagesEl) totalImagesEl.textContent = totalImages;

    if (startBtn) {
        startBtn.disabled = promptCount === 0;
        startBtn.textContent = promptCount > 0 ? `Start Batch (${totalImages})` : 'Start Batch';
    }
}

/**
 * Render all prompt boxes
 */
function renderPromptBoxes() {
    const container = $('promptBoxesContainer');
    if (!container) return;

    if (promptBoxes.length === 0) {
        container.innerHTML = '';
        renderBulkActionsBar();
        return;
    }

    container.innerHTML = promptBoxes.map((box, index) => {
        const hasCustomRefs = box.refImages && box.refImages.length > 0;
        const isSelected = selectedBoxIds.has(box.id);

        return `
            <div class="prompt-box ${isSelected ? 'selected' : ''}" data-box-id="${box.id}">
                <div class="prompt-box-header">
                    <label class="box-select-label">
                        <input type="checkbox" class="box-select-checkbox"
                            ${isSelected ? 'checked' : ''}
                            onchange="toggleBoxSelection('${box.id}', this.checked)">
                        <span class="prompt-box-title">Prompt ${index + 1}</span>
                    </label>
                    <button class="prompt-box-remove" onclick="removePromptBox('${box.id}')" title="Remove">×</button>
                </div>
                <div class="prompt-box-body">
                    <textarea class="prompt-box-textarea"
                        placeholder="Enter your prompt..."
                        oninput="updateBoxPrompt('${box.id}', this.value)">${escapeHtml(box.prompt)}</textarea>
                </div>
                <div class="prompt-box-footer">
                    <div class="prompt-box-variations">
                        <label>Variations:</label>
                        <div class="variation-btns">
                            ${[1, 2, 3, 4, 5].map(v => `
                                <button class="variation-btn ${box.variations === v ? 'active' : ''}"
                                    data-val="${v}"
                                    onclick="setBoxVariations('${box.id}', ${v})">${v}</button>
                            `).join('')}
                        </div>
                    </div>
                    <div class="prompt-box-refs">
                        <label>Refs:</label>
                        ${hasCustomRefs ? `
                            <div class="prompt-box-refs-thumbs">
                                ${box.refImages.slice(0, 4).map(ref => `
                                    <img src="${ref.data}" class="prompt-box-ref-thumb" title="Click to remove" onclick="removeBoxRef('${box.id}', ${ref.id})">
                                `).join('')}
                                ${box.refImages.length > 4 ? `<span style="color:var(--text-muted);font-size:0.75rem;">+${box.refImages.length - 4}</span>` : ''}
                            </div>
                        ` : `
                            <span class="prompt-box-refs-info">(using global)</span>
                        `}
                        <div class="prompt-box-refs-actions">
                            <button class="btn-secondary btn-sm" onclick="openBoxRefPicker('${box.id}')">Add</button>
                            ${hasCustomRefs ? `
                                <button class="btn-secondary btn-sm" onclick="clearBoxRefs('${box.id}')">Clear</button>
                            ` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    renderBulkActionsBar();
}

/**
 * Update box prompt from textarea
 */
export function updateBoxPrompt(id, value) {
    const box = promptBoxes.find(b => b.id === id);
    if (box) {
        box.prompt = value;
        updateTotalCount();
    }
}

/**
 * Open queue setup modal
 */
export function openQueueSetup() {
    const modal = $('queueSetupModal');
    if (modal) {
        modal.classList.add('open');

        // Add one empty box if none exist
        if (promptBoxes.length === 0) {
            addPromptBox();
        } else {
            renderPromptBoxes();
        }

        // Update global refs display
        const globalRefsInfo = $('globalRefsInfo');
        const useGlobalRefs = $('useGlobalRefs');
        if (globalRefsInfo && useGlobalRefs) {
            const hasRefs = refImages.length > 0;
            globalRefsInfo.textContent = hasRefs ? `(${refImages.length} images)` : '(none)';
            useGlobalRefs.disabled = !hasRefs;
            useGlobalRefs.checked = hasRefs;
        }

        updateDirectoryDisplay();
        updateTotalCount();
    }
}

/**
 * Close queue setup modal
 */
export function closeQueueSetup() {
    const modal = $('queueSetupModal');
    if (modal) {
        modal.classList.remove('open');
    }
    // Reset sticky defaults and selection when closing modal
    stickyDefaults = { variations: 1, refImages: null };
    selectedBoxIds.clear();
}

/**
 * Confirm and start queue from modal
 */
export function confirmAndStartQueue() {
    const delaySelect = $('queueDelaySelect');
    const useGlobalRefs = $('useGlobalRefs');

    // Filter to only boxes with prompts
    const validBoxes = promptBoxes.filter(box => box.prompt.trim().length > 0);

    if (validBoxes.length === 0) {
        showToast('Enter at least one prompt');
        return;
    }

    const delayMs = parseInt(delaySelect?.value) || DEFAULT_QUEUE_DELAY_MS;
    const shouldUseGlobalRefs = useGlobalRefs?.checked && refImages.length > 0;

    console.log(`[QueueUI] Starting batch: ${validBoxes.length} prompts, globalRefs: ${shouldUseGlobalRefs}, global ref count: ${refImages.length}`);

    // Get current config from main page
    const config = getCurrentConfig();

    // Set delay
    setQueueDelay(delayMs);

    // Add each box to queue
    for (const box of validBoxes) {
        // Determine which refs to use
        let boxRefs = [];
        if (box.refImages && box.refImages.length > 0) {
            boxRefs = [...box.refImages];
            console.log(`[QueueUI] Box "${box.prompt.slice(0, 20)}..." has ${box.refImages.length} custom refs`);
        } else if (shouldUseGlobalRefs) {
            boxRefs = [...refImages];
            console.log(`[QueueUI] Box "${box.prompt.slice(0, 20)}..." using ${refImages.length} global refs`);
        } else {
            console.log(`[QueueUI] Box "${box.prompt.slice(0, 20)}..." has NO refs`);
        }

        // Add to queue
        addToQueue([box.prompt], box.variations, config, boxRefs);
    }

    // Close modal
    closeQueueSetup();

    // Clear prompt boxes for next time
    promptBoxes = [];

    // Open queue panel
    toggleQueuePanel(true);

    // Auto-start
    import('./queue.js').then(m => m.startQueue());
}

/**
 * Toggle queue panel visibility
 */
export function toggleQueuePanel(forceOpen = null) {
    const panel = $('queuePanel');
    const overlay = $('queueOverlay');

    if (!panel) return;

    const shouldOpen = forceOpen !== null ? forceOpen : !panel.classList.contains('open');

    panel.classList.toggle('open', shouldOpen);
    if (overlay) {
        overlay.classList.toggle('open', shouldOpen);
    }

    if (shouldOpen) {
        renderQueuePanel();
    }
}

/**
 * Render queue panel content
 */
export function renderQueuePanel() {
    const state = getQueueState();
    const stats = getQueueStats();

    // Update progress bar
    const progressBar = $('queueProgressBar');
    if (progressBar) {
        progressBar.style.width = stats.percentComplete + '%';
    }

    // Update progress text
    const progressText = $('queueProgressText');
    if (progressText) {
        if (stats.total === 0) {
            progressText.textContent = 'No items';
        } else {
            let text = `${stats.completed}/${stats.total} completed`;
            if (stats.failed > 0) {
                text += ` • ${stats.failed} failed`;
            }
            progressText.textContent = text;
        }
    }

    // Update status
    const statusEl = $('queueStatus');
    if (statusEl) {
        const currentItem = state.items.find(i => i.status === QueueStatus.GENERATING);

        if (state.isRunning && !state.isPaused && currentItem) {
            const promptSnippet = currentItem.prompt.slice(0, 30);
            statusEl.textContent = `Generating: "${promptSnippet}..." (${currentItem.variationIndex + 1}/${currentItem.totalVariations})`;
        } else if (state.isPaused) {
            statusEl.textContent = 'Paused';
        } else if (stats.pending > 0) {
            statusEl.textContent = `${stats.pending} items pending`;
        } else if (stats.total > 0) {
            statusEl.textContent = 'Complete';
        } else {
            statusEl.textContent = 'Queue empty';
        }
    }

    // Update control buttons
    const startBtn = $('queueStartBtn');
    const pauseBtn = $('queuePauseBtn');
    const resumeBtn = $('queueResumeBtn');
    const cancelBtn = $('queueCancelBtn');

    if (startBtn) startBtn.classList.toggle('hidden', state.isRunning);
    if (pauseBtn) pauseBtn.classList.toggle('hidden', !state.isRunning || state.isPaused);
    if (resumeBtn) resumeBtn.classList.toggle('hidden', !state.isPaused);
    if (cancelBtn) cancelBtn.disabled = !state.isRunning && stats.total === 0;

    // Render item list
    renderQueueItemList(state.items);
}

/**
 * Render queue item list
 */
function renderQueueItemList(items) {
    const list = $('queueItemList');
    if (!list) return;

    if (items.length === 0) {
        list.innerHTML = '<div class="queue-empty">No items in queue</div>';
        return;
    }

    list.innerHTML = items.map(item => `
        <div class="queue-item queue-item-${item.status}" data-id="${item.id}">
            <div class="queue-item-status">
                ${getStatusIcon(item.status)}
            </div>
            <div class="queue-item-info">
                <div class="queue-item-prompt">${escapeHtml(item.prompt.slice(0, 40))}${item.prompt.length > 40 ? '...' : ''}</div>
                <div class="queue-item-meta">
                    v${item.variationIndex + 1}/${item.totalVariations}
                    ${item.error ? `<span class="queue-error-text">${escapeHtml(item.error)}</span>` : ''}
                </div>
            </div>
            ${item.status === 'pending' ? `
                <button class="queue-item-remove" onclick="removeQueueItem('${item.id}')">×</button>
            ` : ''}
        </div>
    `).join('');
}

/**
 * Get status icon for queue item
 */
function getStatusIcon(status) {
    switch (status) {
        case QueueStatus.PENDING: return '⏳';
        case QueueStatus.GENERATING: return '<div class="mini-spinner"></div>';
        case QueueStatus.COMPLETED: return '✓';
        case QueueStatus.FAILED: return '✗';
        case QueueStatus.CANCELLED: return '⊘';
        default: return '';
    }
}

/**
 * Update directory display in UI
 */
export function updateDirectoryDisplay() {
    const dirInfo = getDirectoryInfo();

    // Update main folder indicator
    const nameEl = $('outputDirName');
    const statusEl = $('outputDirStatus');
    const clearBtn = $('clearDirBtn');
    const selectBtn = $('selectDirBtn');

    if (nameEl) {
        nameEl.textContent = dirInfo.name || 'Not set';
        nameEl.classList.toggle('selected', dirInfo.isSet);
    }

    if (statusEl) {
        statusEl.classList.toggle('active', dirInfo.isSet);
    }

    if (clearBtn) {
        clearBtn.classList.toggle('hidden', !dirInfo.isSet);
    }

    if (selectBtn) {
        selectBtn.textContent = dirInfo.isSet ? 'Change' : 'Select Folder';
    }

    // Update modal folder display
    const modalDirName = $('queueDirName');
    if (modalDirName) {
        modalDirName.textContent = dirInfo.isSet ? dirInfo.name : 'Not set';
        modalDirName.classList.toggle('selected', dirInfo.isSet);
    }
}

/**
 * Select output directory (wrapper)
 */
export async function selectQueueOutputDir() {
    await selectOutputDirectory();
    updateDirectoryDisplay();
}

/**
 * Import batch from folder (expects batch.json + refs/ subfolder)
 * This is the folder-based import for structured batch folders
 */
export async function importBatchFolder() {
    try {
        const dirHandle = await window.showDirectoryPicker();

        // Look for batch.json
        let jsonHandle;
        try {
            jsonHandle = await dirHandle.getFileHandle('batch.json');
        } catch {
            showToast('No batch.json found in folder');
            return;
        }

        const jsonFile = await jsonHandle.getFile();
        await processBatchJson(jsonFile, dirHandle);

    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('Import error:', err);
            showToast('Import failed: ' + err.message);
        }
    }
}

/**
 * Import batch from JSON file directly (prompts only, no refs from file paths)
 * This is the file-based import for simple JSON files
 */
export async function importBatchFile() {
    try {
        const [fileHandle] = await window.showOpenFilePicker({
            types: [{
                description: 'JSON Files',
                accept: { 'application/json': ['.json'] }
            }],
            multiple: false
        });

        const file = await fileHandle.getFile();
        await processBatchJson(file, null);

    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('Import error:', err);
            showToast('Import failed: ' + err.message);
        }
    }
}

/**
 * Process batch JSON file
 * @param {File} jsonFile - The JSON file to process
 * @param {FileSystemDirectoryHandle|null} dirHandle - Optional directory handle for loading refs
 */
async function processBatchJson(jsonFile, dirHandle) {
    const jsonText = await jsonFile.text();
    const batch = JSON.parse(jsonText);

    if (!batch.prompts || !Array.isArray(batch.prompts)) {
        showToast('Invalid batch.json format');
        return;
    }

    // Clear existing prompt boxes
    promptBoxes = [];

    // Process each prompt
    for (const item of batch.prompts) {
        if (!item.prompt) continue;

        const box = {
            id: generateBoxId(),
            prompt: item.prompt,
            variations: item.variations || 1,
            refImages: null
        };

        // Load refs if specified AND we have a directory handle
        if (item.refs && Array.isArray(item.refs) && item.refs.length > 0 && dirHandle) {
            box.refImages = [];
            for (const refPath of item.refs) {
                try {
                    // Handle nested paths (e.g., "refs/image.png")
                    const pathParts = refPath.split('/');
                    let fileHandle = dirHandle;

                    for (let i = 0; i < pathParts.length - 1; i++) {
                        fileHandle = await fileHandle.getDirectoryHandle(pathParts[i]);
                    }
                    fileHandle = await fileHandle.getFileHandle(pathParts[pathParts.length - 1]);

                    const file = await fileHandle.getFile();
                    const dataUrl = await fileToDataUrl(file);
                    const compressed = await compressImage(dataUrl);
                    box.refImages.push({ id: Date.now() + Math.random(), data: compressed });
                } catch (err) {
                    console.warn('Could not load ref:', refPath, err);
                }
            }
            if (box.refImages.length === 0) {
                box.refImages = null;
            }
        }

        promptBoxes.push(box);
    }

    // Set delay if specified
    if (batch.delay && $('queueDelaySelect')) {
        $('queueDelaySelect').value = batch.delay.toString();
    }

    renderPromptBoxes();
    updateTotalCount();

    const totalImages = promptBoxes.reduce((sum, b) => sum + b.variations, 0);
    const refsNote = dirHandle ? '' : ' (refs ignored - use Import Folder for refs)';
    showToast(`Imported ${promptBoxes.length} prompts (${totalImages} images)${refsNote}`);
}

/**
 * Export current prompt boxes to JSON
 */
export async function exportBatchJson() {
    if (promptBoxes.length === 0) {
        showToast('No prompts to export');
        return;
    }

    const batch = {
        delay: parseInt($('queueDelaySelect')?.value) || DEFAULT_QUEUE_DELAY_MS,
        prompts: promptBoxes.map(box => {
            const item = {
                prompt: box.prompt,
                variations: box.variations
            };
            // Note: We don't export ref image data, just indicate if custom refs were set
            if (box.refImages && box.refImages.length > 0) {
                item.refs = box.refImages.map((_, i) => `refs/prompt_${box.id}_ref_${i}.png`);
            }
            return item;
        })
    };

    const jsonStr = JSON.stringify(batch, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'batch.json';
    a.click();

    URL.revokeObjectURL(url);
    showToast('Exported batch.json');
}

/**
 * Convert File to data URL
 */
function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * Escape HTML for safe rendering
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Download a sample batch.json template
 */
export function downloadBatchTemplate() {
    const template = {
        _comment: 'Batch import template for Nano Banana Pro',
        _instructions: 'Place this file in a folder with a refs/ subfolder containing your reference images',
        delay: 3000,
        prompts: [
            {
                prompt: 'Your first prompt goes here...',
                variations: 2,
                refs: ['refs/example1.png', 'refs/example2.png']
            },
            {
                prompt: 'Second prompt (no custom refs - uses global)',
                variations: 1
            }
        ]
    };

    const jsonStr = JSON.stringify(template, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'batch-template.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Template downloaded');
}

// Make functions globally available
window.openQueueSetup = openQueueSetup;
window.closeQueueSetup = closeQueueSetup;
window.confirmAndStartQueue = confirmAndStartQueue;
window.toggleQueuePanel = toggleQueuePanel;
window.selectQueueOutputDir = selectQueueOutputDir;
window.addPromptBox = addPromptBox;
window.removePromptBox = removePromptBox;
window.updateBoxPrompt = updateBoxPrompt;
window.setBoxVariations = setBoxVariations;
window.openBoxRefPicker = openBoxRefPicker;
window.clearBoxRefs = clearBoxRefs;
window.removeBoxRef = removeBoxRef;
window.importBatchFolder = importBatchFolder;
window.importBatchFile = importBatchFile;
window.exportBatchJson = exportBatchJson;
window.downloadBatchTemplate = downloadBatchTemplate;
window.toggleBoxSelection = toggleBoxSelection;
window.selectAllBoxes = selectAllBoxes;
window.deselectAllBoxes = deselectAllBoxes;
window.openBulkRefPicker = openBulkRefPicker;
window.clearSelectedBoxRefs = clearSelectedBoxRefs;
