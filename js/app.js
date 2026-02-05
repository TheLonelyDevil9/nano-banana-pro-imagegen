/**
 * Main Application Entry Point
 * Initialization and event setup
 */

import { $, debounce, restoreCollapsibleStates, updateCharCounter, updateAspectPreview, updateThinkingLabel, openPromptEditor, closePromptEditor, updatePromptEditorCounter, showToast, restoreTheme } from './ui.js';
import { restoreAllInputs, setupInputPersistence, updateThinkingNote, saveLastModel } from './persistence.js';
import { authMode, restoreServiceAccount, restoreAuthMode, setupAuthDragDrop } from './auth.js';
import { refreshModels } from './models.js';
import { renderRefs, loadRefImages, setupRefDragDrop, setupClipboardPaste, setupRefPreviewSwipe } from './references.js';
import { initDB, loadHistory, useHistoryItem, toggleHistory } from './history.js';
import { setupZoomHandlers, resetZoom, setCurrentImgRef } from './zoom.js';
import { generate, loadSessionStats, setCurrentImg } from './generation.js';
import { loadSavedPrompts, isDropdownOpen, closePromptsDropdown, saveCurrentPrompt } from './prompts.js';
import { isFileSystemSupported, restoreDirectoryHandle } from './filesystem.js';
import { restoreQueueState, hasResumableQueue } from './queue.js';
import { initQueueUI, updateDirectoryDisplay, handleBatchButtonClick, toggleQueuePanel, closeQueueSetup } from './queueUI.js';

// Initialize application
async function init() {
    // Restore theme first (before any rendering)
    restoreTheme();

    // Restore credentials from localStorage
    $('apiKey').value = localStorage.getItem('gemini_api_key') || '';
    $('projectId').value = localStorage.getItem('vertex_project_id') || '';
    $('vertexLocation').value = localStorage.getItem('vertex_location') || 'global';

    // Restore service account
    restoreServiceAccount();

    // Load stats
    loadSessionStats();

    // Restore all inputs and UI state
    restoreAllInputs();
    restoreCollapsibleStates();
    setupInputPersistence();

    // Load reference images
    loadRefImages();

    // Restore auth mode (must be after refs are loaded)
    restoreAuthMode();

    // Initialize UI elements
    updateCharCounter();
    updateAspectPreview();

    // API key change handler
    $('apiKey').addEventListener('input', debounce(() => {
        localStorage.setItem('gemini_api_key', $('apiKey').value);
        if (authMode === 'apikey' && $('apiKey').value.length > 20) refreshModels();
    }, 500));

    // Project ID change handler
    $('projectId').addEventListener('input', debounce(() => {
        localStorage.setItem('vertex_project_id', $('projectId').value);
    }, 500));

    // Vertex location change handler
    $('vertexLocation').addEventListener('change', () => {
        localStorage.setItem('vertex_location', $('vertexLocation').value);
    });

    // Thinking toggle handler
    $('thinkingToggle').addEventListener('change', () => {
        $('thinkingRow').style.display = $('thinkingToggle').checked ? 'block' : 'none';
    });

    // Model select handler
    $('modelSelect').addEventListener('change', () => {
        saveLastModel();
        updateThinkingNote();
    });

    // Thinking budget handler
    $('thinkingBudget').addEventListener('input', updateThinkingLabel);

    // Prompt character counter
    $('prompt').addEventListener('input', updateCharCounter);

    // Aspect ratio preview
    $('ratio').addEventListener('change', updateAspectPreview);

    // Ctrl+Enter to generate
    $('prompt').addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.ctrlKey) generate();
    });

    // Setup drag and drop
    setupAuthDragDrop();
    setupRefDragDrop();
    setupClipboardPaste();
    setupRefPreviewSwipe();

    // Setup zoom handlers
    setupZoomHandlers();

    // Make useHistoryItem work with zoom reset
    window.useHistoryItem = () => {
        useHistoryItem(setCurrentImg, resetZoom);
    };

    // Initialize database and load history
    await initDB();
    loadHistory();
    loadSavedPrompts();

    // Initialize filesystem module
    if (isFileSystemSupported()) {
        const restored = await restoreDirectoryHandle();
        if (restored === 'needs-permission') {
            // Handle permission request on user gesture
            console.log('Directory handle restored, needs permission on next action');
        }
    } else {
        // Show warning that File System Access is not supported
        const warningEl = $('fsSupportWarning');
        if (warningEl) {
            warningEl.style.display = 'block';
        }
    }

    // Restore queue state (async - loads refs from IndexedDB)
    const savedQueue = await restoreQueueState();

    // Initialize queue UI
    initQueueUI();

    // Check for resumable queue
    if (savedQueue && hasResumableQueue()) {
        showToast('Previous queue found. Open Batch Queue to resume.');
    }

    // Click outside to close prompts dropdown
    document.addEventListener('click', e => {
        if (isDropdownOpen() && !e.target.closest('.dropdown-container') && !e.target.closest('.dropdown')) {
            closePromptsDropdown();
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
        // Don't trigger shortcuts when typing in inputs/textareas (except Escape)
        const isTyping = e.target.matches('input, textarea, [contenteditable]');

        // Escape - close any open modal/panel
        if (e.key === 'Escape') {
            e.preventDefault();
            closeAllModals();
            return;
        }

        // Skip other shortcuts if typing
        if (isTyping) return;

        // Ctrl+Enter - Generate image
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            const generateBtn = $('generateBtn');
            if (generateBtn && !generateBtn.disabled) {
                generateBtn.click();
            }
            return;
        }

        // Ctrl+Shift+F - Open fullscreen prompt editor
        if (e.ctrlKey && e.shiftKey && e.key === 'F') {
            e.preventDefault();
            openPromptEditor();
            return;
        }

        // Ctrl+B - Open batch setup
        if (e.ctrlKey && e.key === 'b') {
            e.preventDefault();
            handleBatchButtonClick();
            return;
        }

        // Ctrl+H - Toggle history panel
        if (e.ctrlKey && e.key === 'h') {
            e.preventDefault();
            toggleHistory();
            return;
        }

        // Ctrl+S - Save current prompt (if prompts dropdown exists)
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            if (typeof saveCurrentPrompt === 'function') {
                saveCurrentPrompt();
            }
            return;
        }
    });

    // Prompt editor textarea input handler
    $('promptEditorTextarea')?.addEventListener('input', updatePromptEditorCounter);

    // Load models if API key exists
    if ($('apiKey').value.length > 20) {
        refreshModels();
    }

    console.log('🍌 Nano Banana Pro initialized');
}

/**
 * Close all open modals and panels
 */
function closeAllModals() {
    // Close preview modal
    const previewModal = $('previewModal');
    if (previewModal?.classList.contains('open')) {
        previewModal.classList.remove('open');
        return;
    }

    // Close queue setup modal
    const queueSetupModal = $('queueSetupModal');
    if (queueSetupModal?.classList.contains('open')) {
        closeQueueSetup();
        return;
    }

    // Close queue panel
    const queuePanel = $('queuePanel');
    if (queuePanel?.classList.contains('open')) {
        toggleQueuePanel(false);
        return;
    }

    // Close history panel
    const historyPanel = $('historyPanel');
    if (historyPanel?.classList.contains('open')) {
        toggleHistory();
        return;
    }

    // Close prompt editor
    const promptEditor = $('promptEditorModal');
    if (promptEditor?.classList.contains('open')) {
        closePromptEditor();
        return;
    }
}

// Start app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
