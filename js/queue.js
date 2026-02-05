/**
 * Queue Module
 * Multi-generation queue management with persistence
 */

import { DEFAULT_QUEUE_DELAY_MS, MAX_QUEUE_ITEMS, MAX_VARIATIONS_PER_PROMPT, QUEUE_STORAGE_KEY } from './config.js';
import { generateSingleImage, getCurrentConfig } from './generation.js';
import { saveToHistoryThumbnailOnly } from './history.js';
import { saveImageToFilesystem, getDirectoryInfo } from './filesystem.js';
import { showToast, haptic, playNotificationSound } from './ui.js';
import { refImages } from './references.js';

// Queue item statuses
export const QueueStatus = {
    PENDING: 'pending',
    GENERATING: 'generating',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
};

// Queue state
let queueState = {
    items: [],
    isRunning: false,
    isPaused: false,
    delayBetweenMs: DEFAULT_QUEUE_DELAY_MS,
    completedCount: 0,
    failedCount: 0,
    startedAt: null
};

let abortController = null;
let onProgressCallback = null;

/**
 * Generate unique ID
 */
function generateId() {
    return 'qi_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Get current queue state
 */
export function getQueueState() {
    return { ...queueState };
}

/**
 * Set progress callback
 */
export function setOnProgress(callback) {
    onProgressCallback = callback;
}

/**
 * Add prompts to queue
 * @param {string[]} prompts - Array of prompt strings
 * @param {number} variationsPerPrompt - Number of variations per prompt
 * @param {Object} config - Generation config
 * @param {Array} refImagesSnapshot - Reference images to use
 * @returns {Object[]} - Created queue items
 */
export function addToQueue(prompts, variationsPerPrompt, config, refImagesSnapshot = []) {
    const newItems = [];
    const timestamp = Date.now();

    // Debug: log what refs we're receiving
    console.log('[Queue] addToQueue called with', refImagesSnapshot?.length || 0, 'refs');

    prompts.forEach((prompt, promptIndex) => {
        const promptGroupId = 'pg_' + timestamp + '_' + promptIndex;

        for (let v = 0; v < variationsPerPrompt; v++) {
            if (queueState.items.length + newItems.length >= MAX_QUEUE_ITEMS) {
                showToast(`Queue limit reached (${MAX_QUEUE_ITEMS})`);
                break;
            }

            // Create a copy of refs for each variation to avoid shared reference issues
            const itemRefs = refImagesSnapshot && refImagesSnapshot.length > 0
                ? refImagesSnapshot.map(r => ({ ...r }))
                : [];

            newItems.push({
                id: generateId(),
                prompt: prompt.trim(),
                variationIndex: v,
                totalVariations: variationsPerPrompt,
                promptGroupId,
                status: QueueStatus.PENDING,
                createdAt: timestamp,
                startedAt: null,
                completedAt: null,
                error: null,
                filename: null,
                config: { ...config },
                refImages: itemRefs
            });

            console.log(`[Queue] Created item v${v + 1}/${variationsPerPrompt} with ${itemRefs.length} refs`);
        }
    });

    queueState.items.push(...newItems);
    persistQueueState();
    notifyProgress();

    return newItems;
}

/**
 * Remove item from queue
 */
export function removeQueueItem(id) {
    const index = queueState.items.findIndex(item => item.id === id);
    if (index !== -1) {
        const item = queueState.items[index];
        if (item.status === QueueStatus.PENDING) {
            queueState.items.splice(index, 1);
            persistQueueState();
            notifyProgress();
        }
    }
}

/**
 * Clear all queue items
 */
export function clearQueue() {
    if (queueState.isRunning) {
        cancelQueue();
    }
    queueState.items = [];
    queueState.completedCount = 0;
    queueState.failedCount = 0;
    persistQueueState();
    notifyProgress();
}

/**
 * Start queue processing
 */
export async function startQueue() {
    if (queueState.isRunning) return;
    if (queueState.items.filter(i => i.status === QueueStatus.PENDING).length === 0) {
        showToast('No pending items in queue');
        return;
    }

    queueState.isRunning = true;
    queueState.isPaused = false;
    queueState.startedAt = Date.now();
    abortController = new AbortController();

    persistQueueState();
    notifyProgress();

    await processQueue();
}

/**
 * Pause queue processing
 */
export function pauseQueue() {
    if (!queueState.isRunning) return;
    queueState.isPaused = true;
    persistQueueState();
    notifyProgress();
    showToast('Queue paused');
}

/**
 * Resume queue processing
 */
export async function resumeQueue() {
    if (!queueState.isRunning || !queueState.isPaused) return;
    queueState.isPaused = false;
    persistQueueState();
    notifyProgress();
    showToast('Queue resumed');
    await processQueue();
}

/**
 * Cancel queue processing
 */
export function cancelQueue() {
    if (abortController) {
        abortController.abort();
    }
    queueState.isRunning = false;
    queueState.isPaused = false;

    // Mark any generating items as cancelled
    queueState.items.forEach(item => {
        if (item.status === QueueStatus.GENERATING) {
            item.status = QueueStatus.CANCELLED;
            item.error = 'Cancelled by user';
        }
    });

    persistQueueState();
    notifyProgress();
    showToast('Queue cancelled');
}

/**
 * Set delay between generations
 */
export function setQueueDelay(ms) {
    queueState.delayBetweenMs = ms;
    persistQueueState();
}

/**
 * Main queue processing loop
 */
async function processQueue() {
    while (queueState.isRunning && !queueState.isPaused) {
        const item = getNextPendingItem();
        if (!item) {
            // Queue complete
            queueState.isRunning = false;
            onQueueComplete();
            break;
        }

        // Debug: log refs for this item
        console.log(`[Queue] Processing item ${item.id}, variation ${item.variationIndex + 1}/${item.totalVariations}`);
        console.log(`[Queue] Item has ${item.refImages?.length || 0} refs`);

        // Process this item
        item.status = QueueStatus.GENERATING;
        item.startedAt = Date.now();
        persistQueueState();
        notifyProgress();

        try {
            // Generate image
            console.log(`[Queue] Calling generateSingleImage with ${item.refImages?.length || 0} refs`);
            const result = await generateSingleImage(
                item.prompt,
                item.config,
                item.refImages,
                abortController.signal
            );

            // Save to filesystem
            const dirInfo = getDirectoryInfo();
            let filename = null;

            if (dirInfo.isSet) {
                try {
                    const saveResult = await saveImageToFilesystem(
                        result.imageData,
                        item.prompt,
                        item.variationIndex
                    );
                    filename = saveResult.filename;
                } catch (e) {
                    console.error('Filesystem save failed:', e);
                }
            }

            // Save to history (thumbnail only)
            const refsUsed = item.refImages && item.refImages.length > 0 ? item.refImages : null;
            await saveToHistoryThumbnailOnly(
                result.imageData,
                item.prompt,
                item.config.model,
                filename,
                refsUsed
            );

            // Mark completed
            item.status = QueueStatus.COMPLETED;
            item.completedAt = Date.now();
            item.filename = filename;
            queueState.completedCount++;

        } catch (e) {
            if (e.name === 'AbortError') {
                item.status = QueueStatus.CANCELLED;
                item.error = 'Cancelled';
                break;
            }

            // Handle rate limits with exponential backoff
            if (e.message?.includes('429') || e.message?.toLowerCase().includes('rate limit')) {
                item.status = QueueStatus.PENDING;
                item.startedAt = null;
                queueState.delayBetweenMs = Math.min(queueState.delayBetweenMs * 2, 60000);
                showToast(`Rate limited. Delay increased to ${queueState.delayBetweenMs / 1000}s`);
                await delay(queueState.delayBetweenMs);
                continue;
            }

            item.status = QueueStatus.FAILED;
            item.error = e.message || 'Unknown error';
            item.completedAt = Date.now();
            queueState.failedCount++;
        }

        persistQueueState();
        notifyProgress();

        // Delay before next generation
        if (getNextPendingItem() && queueState.isRunning && !queueState.isPaused) {
            await delay(queueState.delayBetweenMs);
        }
    }
}

/**
 * Get next pending item
 */
function getNextPendingItem() {
    return queueState.items.find(item => item.status === QueueStatus.PENDING);
}

/**
 * Called when queue completes
 */
function onQueueComplete() {
    const completed = queueState.completedCount;
    const failed = queueState.failedCount;

    playNotificationSound();
    haptic(300);

    if (failed === 0) {
        showToast(`Queue complete! ${completed} images generated`);
    } else {
        showToast(`Queue complete: ${completed} success, ${failed} failed`);
    }

    notifyProgress();
}

/**
 * Notify progress callback
 */
function notifyProgress() {
    if (onProgressCallback) {
        onProgressCallback(getQueueState());
    }
}

/**
 * Persist queue state to localStorage
 */
export function persistQueueState() {
    try {
        // Don't persist reference images (too large)
        const stateToSave = {
            ...queueState,
            items: queueState.items.map(item => ({
                ...item,
                refImages: [] // Don't persist ref images
            }))
        };
        localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (e) {
        console.error('Failed to persist queue state:', e);
    }
}

/**
 * Restore queue state from localStorage
 */
export function restoreQueueState() {
    try {
        const saved = localStorage.getItem(QUEUE_STORAGE_KEY);
        if (!saved) return null;

        const state = JSON.parse(saved);

        // Reset any "generating" items to "pending" (interrupted)
        state.items.forEach(item => {
            if (item.status === QueueStatus.GENERATING) {
                item.status = QueueStatus.PENDING;
                item.startedAt = null;
            }
        });

        // Mark as paused if was running
        if (state.isRunning) {
            state.isPaused = true;
        }

        queueState = state;
        return state;
    } catch (e) {
        console.error('Failed to restore queue state:', e);
        return null;
    }
}

/**
 * Check if queue has pending items from previous session
 */
export function hasResumableQueue() {
    return queueState.items.some(item => item.status === QueueStatus.PENDING);
}

/**
 * Get queue statistics
 */
export function getQueueStats() {
    const total = queueState.items.length;
    const pending = queueState.items.filter(i => i.status === QueueStatus.PENDING).length;
    const completed = queueState.completedCount;
    const failed = queueState.failedCount;
    const inProgress = queueState.items.filter(i => i.status === QueueStatus.GENERATING).length;

    return {
        total,
        pending,
        completed,
        failed,
        inProgress,
        percentComplete: total > 0 ? Math.round((completed / total) * 100) : 0
    };
}

/**
 * Utility: delay helper
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Make functions globally available
window.startQueue = startQueue;
window.pauseQueue = pauseQueue;
window.resumeQueue = resumeQueue;
window.cancelQueue = cancelQueue;
window.clearQueue = clearQueue;
window.removeQueueItem = removeQueueItem;
