/**
 * UI Utilities
 * DOM helpers, toast, haptic feedback, sound notifications
 */

// DOM helper
export const $ = id => document.getElementById(id);

// Toast notification
let toastTimeout = null;
export function showToast(msg) {
    const toast = $('toast');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.add('hidden'), 3000);
}

// Haptic feedback
export function haptic(duration = 10) {
    if ($('hapticToggle')?.checked && navigator.vibrate) {
        navigator.vibrate(duration);
    }
}

// Play notification sound
export function playNotificationSound() {
    if (!$('soundToggle')?.checked) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
        osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.1); // D6
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
    } catch (e) { /* Audio not supported */ }
}

// Debounce utility
export function debounce(fn, ms) {
    let t;
    return function () {
        const args = arguments;
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), ms);
    };
}

// Toggle collapsible sections
export function toggleCollapsible(id) {
    const el = $(id);
    el.classList.toggle('collapsed');
    localStorage.setItem('collapsed_' + id, el.classList.contains('collapsed'));
}

// Restore collapsible states from localStorage
export function restoreCollapsibleStates() {
    ['aboutCollapsible', 'authCollapsible', 'advancedCollapsible', 'settingsCollapsible'].forEach(id => {
        const el = $(id);
        if (el && localStorage.getItem('collapsed_' + id) === 'true') {
            el.classList.add('collapsed');
        } else if (el && localStorage.getItem('collapsed_' + id) === 'false') {
            el.classList.remove('collapsed');
        }
    });
}

// Toggle API key visibility
export function toggleApiKeyVisibility() {
    const input = $('apiKey');
    input.type = input.type === 'password' ? 'text' : 'password';
}

// Update character counter
export function updateCharCounter() {
    const len = $('prompt').value.length;
    $('charCounter').textContent = len.toLocaleString();
}

// Update aspect ratio preview
export function updateAspectPreview() {
    const val = $('ratio').value;
    const inner = $('aspectPreviewInner');
    if (!val) {
        inner.style.width = '20px';
        inner.style.height = '20px';
        return;
    }
    const [w, h] = val.split(':').map(Number);
    const maxSize = 22;
    if (w > h) {
        inner.style.width = maxSize + 'px';
        inner.style.height = Math.round(maxSize * h / w) + 'px';
    } else {
        inner.style.height = maxSize + 'px';
        inner.style.width = Math.round(maxSize * w / h) + 'px';
    }
}

// Update thinking label
export function updateThinkingLabel() {
    const v = parseInt($('thinkingBudget').value);
    $('thinkingLabel').textContent = v === -1 ? 'Auto' : v === 0 ? 'Off' : v.toLocaleString();
}

// Update placeholder text
export function updatePlaceholder(msg) {
    const placeholder = $('placeholder');
    const placeholderDiv = placeholder.querySelector('div');
    if (placeholderDiv) placeholderDiv.textContent = msg;
}

// Scroll to result smoothly
export function scrollToResult() {
    setTimeout(() => {
        $('imageBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
}

// Fullscreen Prompt Editor
export function openPromptEditor() {
    const modal = $('promptEditorModal');
    const textarea = $('promptEditorTextarea');
    const mainPrompt = $('prompt');

    // Copy current prompt to editor
    textarea.value = mainPrompt.value;
    updatePromptEditorCounter();

    modal.classList.add('open');

    // Focus textarea after animation
    setTimeout(() => textarea.focus(), 100);
}

export function closePromptEditor() {
    $('promptEditorModal').classList.remove('open');
}

export function applyPromptEditor() {
    const textarea = $('promptEditorTextarea');
    const mainPrompt = $('prompt');

    // Copy editor content back to main prompt
    mainPrompt.value = textarea.value;
    updateCharCounter();

    // Trigger persistence
    import('./persistence.js').then(m => m.persistAllInputs());

    closePromptEditor();
    showToast('Prompt updated');
}

export function updatePromptEditorCounter() {
    const len = $('promptEditorTextarea').value.length;
    $('promptEditorCounter').textContent = len.toLocaleString() + ' characters';
}

// Make functions globally available for HTML onclick handlers
window.toggleCollapsible = toggleCollapsible;
window.toggleApiKeyVisibility = toggleApiKeyVisibility;
window.openPromptEditor = openPromptEditor;
window.closePromptEditor = closePromptEditor;
window.applyPromptEditor = applyPromptEditor;
