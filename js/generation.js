/**
 * Generation Module
 * Image generation orchestration, stats, conversation management
 */

import { $, showToast, haptic, playNotificationSound, updatePlaceholder, scrollToResult } from './ui.js';
import { authMode, serviceAccount } from './auth.js';
import { generateWithRetry, parseApiError } from './api.js';
import { refImages, renderRefs } from './references.js';
import { saveToHistory, saveToHistoryThumbnailOnly } from './history.js';
import { saveLastModel, persistAllInputs } from './persistence.js';
import { resetZoom, setCurrentImgRef, getCurrentImg } from './zoom.js';
import { MAX_REFS, MAX_CONVERSATION_TURNS } from './config.js';
import { saveImageToFilesystem, getDirectoryInfo } from './filesystem.js';

// Generation state
let currentImg = null;
let abortController = null;
let generationStartTime = null;
let generationCount = 0;
let totalTokensUsed = 0;
let generationStats = {};

// Cached DOM elements
let cachedElements = null;

function getCachedElements() {
    if (!cachedElements) {
        cachedElements = {
            apiKey: $('apiKey'),
            modelSelect: $('modelSelect'),
            prompt: $('prompt'),
            ratio: $('ratio'),
            resolution: $('resolution'),
            searchToggle: $('searchToggle'),
            thinkingToggle: $('thinkingToggle'),
            thinkingBudget: $('thinkingBudget'),
            projectId: $('projectId'),
            generateBtn: $('generateBtn'),
            cancelBtn: $('cancelBtn'),
            spinner: $('spinner'),
            error: $('error'),
            groundingInfo: $('groundingInfo'),
            resultImg: $('resultImg'),
            imageBox: $('imageBox'),
            placeholder: $('placeholder'),
            iterateBtn: $('iterateBtn'),
            downloadBtn: $('downloadBtn'),
            copyBtn: $('copyBtn'),
            regenerateBtn: $('regenerateBtn'),
            clearOutputBtn: $('clearOutputBtn'),
            timeEstimate: $('timeEstimate'),
            genCountStat: $('genCountStat'),
            tokenStat: $('tokenStat')
        };
    }
    return cachedElements;
}

// Set current image
export function setCurrentImg(img) {
    currentImg = img;
    setCurrentImgRef(img);
}

// Get current image
export function getImg() {
    return currentImg;
}

// Estimate tokens
function estimateTokens(promptText, refCount) {
    return Math.round(promptText.length / 4) + (refCount * 1000) + 500;
}

// Update stats display
export function updateStats() {
    const el = getCachedElements();
    el.genCountStat.textContent = generationCount;
    el.tokenStat.textContent = totalTokensUsed.toLocaleString();
    sessionStorage.setItem('session_stats', JSON.stringify({
        generationCount, totalTokensUsed
    }));
}

// Load session stats
export function loadSessionStats() {
    try {
        const sessionStats = JSON.parse(sessionStorage.getItem('session_stats') || '{}');
        generationCount = sessionStats.generationCount || 0;
        totalTokensUsed = sessionStats.totalTokensUsed || 0;
        updateStats();
    } catch { }

    try {
        generationStats = JSON.parse(localStorage.getItem('generation_stats') || '{}');
    } catch { generationStats = {}; }
}

// Get stats key for time estimation
function getStatsKey() {
    const el = getCachedElements();
    return el.modelSelect.value + '_' + el.resolution.value;
}

// Record generation time
function recordGenerationTime(duration) {
    const key = getStatsKey();
    if (!generationStats[key]) generationStats[key] = [];
    generationStats[key].push(duration);
    if (generationStats[key].length > 10) generationStats[key].shift();
    localStorage.setItem('generation_stats', JSON.stringify(generationStats));
}

// Get estimated time
function getEstimatedTime() {
    const key = getStatsKey();
    const times = generationStats[key];
    if (!times || times.length === 0) return null;
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    return Math.round(avg / 1000);
}

// Show time estimate
function showTimeEstimate() {
    const est = getEstimatedTime();
    const el = getCachedElements();
    if (est && el.timeEstimate) {
        el.timeEstimate.textContent = 'Est. ~' + est + 's';
        el.timeEstimate.classList.remove('hidden');
    }
}

// Set generating state
function setGenerating(on) {
    const el = getCachedElements();

    el.generateBtn.classList.toggle('hidden', on);
    el.cancelBtn.classList.toggle('hidden', !on);
    el.spinner.classList.toggle('hidden', !on);

    if (on) {
        el.error.classList.add('hidden');
        el.groundingInfo.classList.add('hidden');
        el.resultImg.classList.add('hidden');
        el.imageBox.classList.remove('has-image', 'is-zoomed');
        el.placeholder.classList.add('hidden');
    }
}

/**
 * Generate a single image - reusable core function for both single and batch generation
 * @param {string} prompt - The prompt text
 * @param {Object} config - Generation configuration
 * @param {string} config.model - Model ID
 * @param {string} [config.ratio] - Aspect ratio
 * @param {string} [config.resolution] - Resolution (1K/2K/4K)
 * @param {number} [config.thinkingBudget] - Thinking budget (-1 for auto, 0 for off)
 * @param {boolean} [config.searchEnabled] - Enable Google Search
 * @param {Array} [refImagesData] - Reference images array [{id, data}]
 * @param {AbortSignal} [signal] - AbortController signal
 * @returns {Promise<string>} - Generated image as data URL
 */
export async function generateSingleImage(prompt, config, refImagesData = [], signal = null) {
    // Build user message parts
    const userParts = [];
    refImagesData.forEach(img => {
        const match = img.data.match(/^data:(.+);base64,(.+)$/);
        if (match) {
            userParts.push({ inlineData: { mimeType: match[1], data: match[2] } });
        }
    });
    userParts.push({ text: prompt });

    const userContent = { role: 'user', parts: userParts };

    // Build generation config
    const genConfig = { responseModalities: ['TEXT', 'IMAGE'] };
    if (config.ratio || config.resolution) {
        genConfig.imageConfig = {};
        if (config.ratio) genConfig.imageConfig.aspectRatio = config.ratio;
        if (config.resolution) genConfig.imageConfig.imageSize = config.resolution;
    }

    // Handle thinking config
    if (config.thinkingBudget !== undefined) {
        if (config.thinkingBudget === 0) {
            genConfig.thinkingConfig = { thinkingBudget: 0 };
        } else if (config.thinkingBudget > 0) {
            genConfig.thinkingConfig = { thinkingBudget: config.thinkingBudget };
        }
        // -1 = auto, don't set config
    }

    const body = { contents: [userContent], generationConfig: genConfig };

    if (config.searchEnabled) {
        body.tools = [{ google_search: {} }];
    }

    const data = await generateWithRetry(config.model, body, signal);

    const candidate = data.candidates?.[0];
    const contentParts = candidate?.content?.parts;
    const imgPart = contentParts?.find(p => p.inlineData && !p.thought);

    if (!imgPart) {
        const txtPart = contentParts?.find(p => p.text);
        throw new Error(txtPart?.text || 'No image returned');
    }

    const imageData = 'data:' + (imgPart.inlineData.mimeType || 'image/png') + ';base64,' + imgPart.inlineData.data;

    return {
        imageData,
        grounding: candidate?.groundingMetadata
    };
}

/**
 * Get current generation config from UI
 */
export function getCurrentConfig() {
    const el = getCachedElements();
    return {
        model: el.modelSelect.value,
        ratio: el.ratio.value,
        resolution: el.resolution.value,
        thinkingBudget: el.thinkingToggle.checked
            ? parseInt(el.thinkingBudget.value)
            : 0,
        searchEnabled: el.searchToggle.checked
    };
}

// Main generate function - each call is a fresh start (no conversation history)
export async function generate() {
    const el = getCachedElements();

    // Validation
    if (authMode === 'apikey') {
        if (!el.apiKey.value) return showToast('Enter API key');
    } else if (authMode === 'vertex') {
        if (!serviceAccount) return showToast('Load service account');
        if (!el.projectId.value) return showToast('Enter project ID');
    }
    if (!el.modelSelect.value) return showToast('Select model');
    if (!el.prompt.value.trim()) return showToast('Enter prompt');

    abortController = new AbortController();
    generationStartTime = Date.now();
    setGenerating(true);
    showTimeEstimate();

    try {
        const config = getCurrentConfig();
        const result = await generateSingleImage(
            el.prompt.value,
            config,
            refImages,
            abortController.signal
        );

        currentImg = result.imageData;
        setCurrentImgRef(currentImg);

        el.resultImg.src = currentImg;
        el.resultImg.classList.remove('hidden');
        el.placeholder.classList.add('hidden');
        el.imageBox.classList.add('has-image');
        el.iterateBtn.disabled = el.downloadBtn.disabled = el.copyBtn.disabled = false;
        el.regenerateBtn.disabled = false;
        el.clearOutputBtn.disabled = false;
        resetZoom();

        // Handle grounding info
        if (result.grounding?.webSearchQueries?.length) {
            el.groundingInfo.innerHTML = '🔍 ' + result.grounding.webSearchQueries.join(', ');
            el.groundingInfo.classList.remove('hidden');
        }

        // Record time and update stats
        if (generationStartTime) {
            recordGenerationTime(Date.now() - generationStartTime);
        }
        generationCount++;
        totalTokensUsed += estimateTokens(el.prompt.value, refImages.length);
        updateStats();

        saveLastModel();

        // Save to filesystem and/or history
        const dirInfo = getDirectoryInfo();
        if (dirInfo.isSet) {
            // Filesystem mode: save to folder + thumbnail-only history
            try {
                const saveResult = await saveImageToFilesystem(currentImg, el.prompt.value, 0);
                await saveToHistoryThumbnailOnly(currentImg, el.prompt.value, el.modelSelect.value, saveResult.filename);

                if (saveResult.method === 'filesystem') {
                    console.log('Saved to filesystem:', saveResult.filename);
                } else {
                    console.log('Downloaded (fallback):', saveResult.filename);
                }
            } catch (e) {
                console.error('Filesystem save failed:', e);
                // Fallback to full history save
                saveToHistory(currentImg, el.prompt.value, el.modelSelect.value);
            }
        } else {
            // Legacy mode: save full image to history
            saveToHistory(currentImg, el.prompt.value, el.modelSelect.value);
        }

        playNotificationSound();
        haptic(200);
        showToast('Generated!');
        scrollToResult();

    } catch (e) {
        if (e.name === 'AbortError') {
            showToast('Canceled');
        } else {
            const parsed = parseApiError(e, e.status);
            el.error.textContent = parsed.message;
            el.error.classList.remove('hidden');
        }
        el.placeholder.classList.remove('hidden');
        updatePlaceholder('Ready to create!');
    } finally {
        setGenerating(false);
        abortController = null;
        generationStartTime = null;
        el.timeEstimate?.classList.add('hidden');
    }
}

// Cancel generation
export function cancelGeneration() {
    if (abortController) abortController.abort();
}

// Regenerate (same prompt)
export function regenerate() {
    const el = getCachedElements();
    if (!el.prompt.value.trim()) return;
    generate();
}

// Iterate (add current image to references)
export function iterate() {
    if (!currentImg) return;
    if (refImages.length >= MAX_REFS) {
        showToast('Maximum ' + MAX_REFS + ' reference images reached');
        return;
    }
    refImages.push({ id: Date.now() + Math.random(), data: currentImg });
    renderRefs();
    persistAllInputs();
    showToast('Added to references');
}

// Download current image
export function download() {
    if (!currentImg) return;
    const a = document.createElement('a');
    a.href = currentImg;
    a.download = 'nano-banana-' + Date.now() + '.png';
    a.click();
}

// Copy current image to clipboard
export async function copyImg() {
    if (!currentImg) return;
    try {
        // ClipboardItem only supports image/png in most browsers
        // Convert to PNG using canvas
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = currentImg;
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        showToast('Copied!');
    } catch (e) {
        console.error('Copy failed:', e);
        showToast('Copy failed');
    }
}

// Clear output
export function clearOutput() {
    if (!currentImg) return;
    const el = getCachedElements();
    currentImg = null;
    setCurrentImgRef(null);
    el.resultImg.src = '';
    el.resultImg.classList.add('hidden');
    el.placeholder.classList.remove('hidden');
    updatePlaceholder('Ready to create!');
    el.imageBox.classList.remove('has-image', 'is-zoomed');
    el.error.classList.add('hidden');
    el.groundingInfo.classList.add('hidden');
    el.iterateBtn.disabled = el.downloadBtn.disabled = el.copyBtn.disabled = true;
    el.regenerateBtn.disabled = true;
    el.clearOutputBtn.disabled = true;
    resetZoom();
    showToast('Output cleared');
}

// Clear all: refs, prompt, and output
export function clearAll() {
    const el = getCachedElements();

    // Clear reference images (without undo toast)
    if (typeof window.clearRefsQuiet === 'function') {
        window.clearRefsQuiet();
    } else {
        // Fallback: directly clear refs
        import('./references.js').then(m => {
            m.setRefImages([]);
            m.renderRefs();
        });
    }

    // Clear prompt
    el.prompt.value = '';
    import('./ui.js').then(m => m.updateCharCounter());

    // Clear output if any
    if (currentImg) {
        currentImg = null;
        setCurrentImgRef(null);
        el.resultImg.src = '';
        el.resultImg.classList.add('hidden');
        el.placeholder.classList.remove('hidden');
        updatePlaceholder('Ready to create!');
        el.imageBox.classList.remove('has-image', 'is-zoomed');
        el.error.classList.add('hidden');
        el.groundingInfo.classList.add('hidden');
        el.iterateBtn.disabled = el.downloadBtn.disabled = el.copyBtn.disabled = true;
        el.regenerateBtn.disabled = true;
        el.clearOutputBtn.disabled = true;
        resetZoom();
    }

    // Persist cleared state
    import('./persistence.js').then(m => m.persistAllInputs());

    showToast('All cleared');
}

// Make functions globally available for HTML onclick handlers
window.generate = generate;
window.cancelGeneration = cancelGeneration;
window.regenerate = regenerate;
window.iterate = iterate;
window.download = download;
window.copyImg = copyImg;
window.clearOutput = clearOutput;
window.clearAll = clearAll;
