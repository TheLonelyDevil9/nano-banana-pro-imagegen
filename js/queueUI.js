/**
 * Queue UI Module
 * Renders queue panel, progress, setup modal
 */

import { $ } from './ui.js';
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
import { refImages } from './references.js';
import { MAX_VARIATIONS_PER_PROMPT, DEFAULT_QUEUE_DELAY_MS } from './config.js';

/**
 * Initialize queue UI
 */
export function initQueueUI() {
    // Set up progress callback
    setOnProgress(renderQueuePanel);

    // Set up event listeners
    setupQueueSetupModal();

    // Initial render
    renderQueuePanel();
    updateDirectoryDisplay();
}

/**
 * Setup queue modal event listeners
 */
function setupQueueSetupModal() {
    const promptsInput = $('queuePromptsInput');
    const variationsSlider = $('variationsSlider');

    if (promptsInput) {
        promptsInput.addEventListener('input', updateQueueCounts);
    }

    if (variationsSlider) {
        variationsSlider.addEventListener('input', () => {
            $('variationsLabel').textContent = variationsSlider.value;
            updateQueueCounts();
        });
    }
}

/**
 * Update prompt and total image counts
 */
function updateQueueCounts() {
    const promptsInput = $('queuePromptsInput');
    const variationsSlider = $('variationsSlider');

    if (!promptsInput || !variationsSlider) return;

    const prompts = promptsInput.value
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0);

    const promptCount = prompts.length;
    const variations = parseInt(variationsSlider.value) || 1;
    const totalImages = promptCount * variations;

    const promptCountEl = $('promptCount');
    const totalImagesEl = $('totalImagesCount');

    if (promptCountEl) promptCountEl.textContent = promptCount;
    if (totalImagesEl) totalImagesEl.textContent = totalImages;

    // Update start button
    const startBtn = $('startQueueBtn');
    if (startBtn) {
        startBtn.disabled = promptCount === 0;
        startBtn.textContent = promptCount > 0
            ? `Start Batch (${totalImages} images)`
            : 'Start Batch Generation';
    }
}

/**
 * Open queue setup modal
 */
export function openQueueSetup() {
    const modal = $('queueSetupModal');
    if (modal) {
        modal.classList.add('open');
        updateQueueCounts();
        updateDirectoryDisplay();

        // Update use refs checkbox based on current refs
        const useRefsCheckbox = $('useCurrentRefs');
        const refsInfo = $('currentRefsInfo');
        if (useRefsCheckbox && refsInfo) {
            const hasRefs = refImages.length > 0;
            useRefsCheckbox.disabled = !hasRefs;
            useRefsCheckbox.checked = hasRefs;
            refsInfo.textContent = hasRefs
                ? `(${refImages.length} images)`
                : '(none)';
        }
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
}

/**
 * Confirm and start queue from modal
 */
export function confirmAndStartQueue() {
    const promptsInput = $('queuePromptsInput');
    const variationsSlider = $('variationsSlider');
    const delaySelect = $('queueDelaySelect');
    const useRefsCheckbox = $('useCurrentRefs');

    if (!promptsInput) return;

    const prompts = promptsInput.value
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0);

    if (prompts.length === 0) {
        showToast('Enter at least one prompt');
        return;
    }

    const variations = parseInt(variationsSlider?.value) || 1;
    const delayMs = parseInt(delaySelect?.value) || DEFAULT_QUEUE_DELAY_MS;
    const useRefs = useRefsCheckbox?.checked && refImages.length > 0;

    // Get current config
    const config = getCurrentConfig();

    // Set delay
    setQueueDelay(delayMs);

    // Add to queue
    addToQueue(
        prompts,
        variations,
        config,
        useRefs ? [...refImages] : []
    );

    // Close modal
    closeQueueSetup();

    // Clear input for next time
    promptsInput.value = '';
    updateQueueCounts();

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
 * Escape HTML for safe rendering
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Make functions globally available
window.openQueueSetup = openQueueSetup;
window.closeQueueSetup = closeQueueSetup;
window.confirmAndStartQueue = confirmAndStartQueue;
window.toggleQueuePanel = toggleQueuePanel;
window.selectQueueOutputDir = selectQueueOutputDir;
