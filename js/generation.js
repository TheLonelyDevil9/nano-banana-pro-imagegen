/**
 * Generation Module
 * Image generation orchestration, stats, conversation management
 */

import { $, showToast, haptic, playNotificationSound, updatePlaceholder, scrollToResult } from './ui.js';
import { authMode, serviceAccount } from './auth.js';
import { generateWithRetry, parseApiError } from './api.js';
import { refImages, renderRefs } from './references.js';
import { saveToHistory } from './history.js';
import { saveLastModel, persistAllInputs } from './persistence.js';
import { resetZoom, setCurrentImgRef, getCurrentImg } from './zoom.js';
import { MAX_REFS } from './config.js';

// Generation state
let currentImg = null;
let abortController = null;
let conversationHistory = [];
let generationStartTime = null;
let generationCount = 0;
let totalTokensUsed = 0;
let generationStats = {};

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
    $('genCountStat').textContent = generationCount;
    $('tokenStat').textContent = totalTokensUsed.toLocaleString();
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
    return $('modelSelect').value + '_' + $('resolution').value;
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
    const el = $('timeEstimate');
    if (est && el) {
        el.textContent = 'Est. ~' + est + 's';
        el.classList.remove('hidden');
    }
}

// Update conversation indicator
function updateConversationIndicator() {
    const indicator = $('conversationIndicator');
    if (indicator) {
        const turns = Math.floor(conversationHistory.length / 2);
        indicator.textContent = turns > 0 ? 'Turn ' + (turns + 1) : '';
        indicator.style.display = turns > 0 ? 'inline' : 'none';
    }
    const clearBtn = $('clearConversationBtn');
    if (clearBtn) {
        clearBtn.style.display = conversationHistory.length > 0 ? 'inline-block' : 'none';
    }
}

// Clear conversation
export function clearConversation() {
    conversationHistory = [];
    updateConversationIndicator();
    showToast('New conversation started');
}

// Set generating state
function setGenerating(on) {
    const generateBtn = $('generateBtn');
    const cancelBtn = $('cancelBtn');
    const spinner = $('spinner');
    const error = $('error');
    const groundingInfo = $('groundingInfo');
    const resultImg = $('resultImg');
    const imageBox = $('imageBox');
    const placeholder = $('placeholder');

    generateBtn.classList.toggle('hidden', on);
    cancelBtn.classList.toggle('hidden', !on);
    spinner.classList.toggle('hidden', !on);

    if (on) {
        error.classList.add('hidden');
        groundingInfo.classList.add('hidden');
        resultImg.classList.add('hidden');
        imageBox.classList.remove('has-image', 'is-zoomed');
        placeholder.classList.add('hidden');
    }
}

// Main generate function
export async function generate() {
    const apiKey = $('apiKey').value;
    const modelSelect = $('modelSelect');
    const prompt = $('prompt');
    const ratio = $('ratio');
    const resolution = $('resolution');
    const searchToggle = $('searchToggle');
    const thinkingToggle = $('thinkingToggle');
    const thinkingBudget = $('thinkingBudget');

    // Validation
    if (authMode === 'apikey') {
        if (!apiKey) return showToast('Enter API key');
    } else {
        if (!serviceAccount) return showToast('Load service account');
        if (!$('projectId').value) return showToast('Enter project ID');
    }
    if (!modelSelect.value) return showToast('Select model');
    if (!prompt.value.trim()) return showToast('Enter prompt');

    abortController = new AbortController();
    generationStartTime = Date.now();
    setGenerating(true);
    showTimeEstimate();

    try {
        // Build user message parts
        const userParts = [];
        refImages.forEach(img => {
            const match = img.data.match(/^data:(.+);base64,(.+)$/);
            if (match) {
                userParts.push({ inlineData: { mimeType: match[1], data: match[2] } });
            }
        });
        userParts.push({ text: prompt.value });

        const userContent = { role: 'user', parts: userParts };

        // Build config
        const config = { responseModalities: ['TEXT', 'IMAGE'] };
        if (ratio.value || resolution.value) {
            config.imageConfig = {};
            if (ratio.value) config.imageConfig.aspectRatio = ratio.value;
            if (resolution.value) config.imageConfig.imageSize = resolution.value;
        }
        if (!thinkingToggle.checked) {
            config.thinkingConfig = { thinkingBudget: 0 };
        } else if (parseInt(thinkingBudget.value) !== -1) {
            config.thinkingConfig = { thinkingBudget: parseInt(thinkingBudget.value) };
        }

        // Build request body with conversation history
        const allContents = [...conversationHistory, userContent];
        const body = { contents: allContents, generationConfig: config };

        if (searchToggle.checked) body.tools = [{ google_search: {} }];

        const data = await generateWithRetry(modelSelect.value, body, abortController.signal);

        const candidate = data.candidates && data.candidates[0];
        const contentParts = candidate && candidate.content && candidate.content.parts;
        const imgPart = contentParts && contentParts.find(p => p.inlineData && !p.thought);

        if (!imgPart) {
            const txtPart = contentParts && contentParts.find(p => p.text);
            const txt = txtPart && txtPart.text;
            if (txt) {
                $('error').innerHTML = '<strong>Text response (no image generated):</strong><br><br>' + txt.replace(/\n/g, '<br>');
                $('error').classList.remove('hidden');
                $('placeholder').classList.remove('hidden');
                updatePlaceholder('No image in response');
                return;
            }
            throw new Error('No image returned');
        }

        // Store conversation history
        const modelParts = contentParts.filter(p => !p.thought).map(p => {
            const part = { ...p };
            if (p.thought_signature) {
                part.thought_signature = p.thought_signature;
            }
            return part;
        });

        conversationHistory.push(userContent);
        conversationHistory.push({ role: 'model', parts: modelParts });
        updateConversationIndicator();

        currentImg = 'data:' + (imgPart.inlineData.mimeType || 'image/png') + ';base64,' + imgPart.inlineData.data;
        setCurrentImgRef(currentImg);

        const resultImg = $('resultImg');
        resultImg.src = currentImg;
        resultImg.classList.remove('hidden');
        $('placeholder').classList.add('hidden');
        $('imageBox').classList.add('has-image');
        $('iterateBtn').disabled = $('downloadBtn').disabled = $('copyBtn').disabled = false;
        $('regenerateBtn').disabled = false;
        $('clearOutputBtn').disabled = false;
        resetZoom();

        const grounding = candidate && candidate.groundingMetadata;
        if (grounding && grounding.webSearchQueries && grounding.webSearchQueries.length) {
            $('groundingInfo').innerHTML = '🔍 ' + grounding.webSearchQueries.join(', ');
            $('groundingInfo').classList.remove('hidden');
        }

        // Record time and update stats
        if (generationStartTime) {
            recordGenerationTime(Date.now() - generationStartTime);
        }
        generationCount++;
        totalTokensUsed += estimateTokens(prompt.value, refImages.length);
        updateStats();

        saveLastModel();
        saveToHistory(currentImg, prompt.value, modelSelect.value);

        playNotificationSound();
        haptic(200);
        showToast('Generated!');
        scrollToResult();

    } catch (e) {
        if (e.name === 'AbortError') {
            showToast('Canceled');
        } else {
            const parsed = parseApiError(e, e.status);
            $('error').textContent = parsed.message;
            $('error').classList.remove('hidden');
        }
        $('placeholder').classList.remove('hidden');
        updatePlaceholder('Ready to create!');
    } finally {
        setGenerating(false);
        abortController = null;
        generationStartTime = null;
        $('timeEstimate')?.classList.add('hidden');
    }
}

// Cancel generation
export function cancelGeneration() {
    if (abortController) abortController.abort();
}

// Regenerate (same prompt)
export function regenerate() {
    if (!$('prompt').value.trim()) return;
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
        const blob = await (await fetch(currentImg)).blob();
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
        showToast('Copied!');
    } catch (e) {
        showToast('Copy failed');
    }
}

// Clear output
export function clearOutput() {
    if (!currentImg) return;
    currentImg = null;
    setCurrentImgRef(null);
    $('resultImg').src = '';
    $('resultImg').classList.add('hidden');
    $('placeholder').classList.remove('hidden');
    updatePlaceholder('Ready to create!');
    $('imageBox').classList.remove('has-image', 'is-zoomed');
    $('error').classList.add('hidden');
    $('groundingInfo').classList.add('hidden');
    $('iterateBtn').disabled = $('downloadBtn').disabled = $('copyBtn').disabled = true;
    $('regenerateBtn').disabled = true;
    $('clearOutputBtn').disabled = true;
    resetZoom();
    showToast('Output cleared');
}

// Clear all: refs, prompt, and output
export function clearAll() {
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
    $('prompt').value = '';
    import('./ui.js').then(m => m.updateCharCounter());

    // Clear output if any
    if (currentImg) {
        currentImg = null;
        setCurrentImgRef(null);
        $('resultImg').src = '';
        $('resultImg').classList.add('hidden');
        $('placeholder').classList.remove('hidden');
        updatePlaceholder('Ready to create!');
        $('imageBox').classList.remove('has-image', 'is-zoomed');
        $('error').classList.add('hidden');
        $('groundingInfo').classList.add('hidden');
        $('iterateBtn').disabled = $('downloadBtn').disabled = $('copyBtn').disabled = true;
        $('regenerateBtn').disabled = true;
        $('clearOutputBtn').disabled = true;
        resetZoom();
    }

    // Clear conversation history
    conversationHistory = [];
    updateConversationIndicator();

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
window.clearConversation = clearConversation;
window.clearAll = clearAll;

