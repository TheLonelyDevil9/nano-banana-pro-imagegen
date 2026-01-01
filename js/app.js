/**
 * Main Application Entry Point
 * Initialization and event setup
 */

import { $, debounce, restoreCollapsibleStates, updateCharCounter, updateAspectPreview, updateThinkingLabel } from './ui.js';
import { restoreAllInputs, setupInputPersistence, updateThinkingNote, saveLastModel } from './persistence.js';
import { authMode, restoreServiceAccount, restoreAuthMode, setupAuthDragDrop } from './auth.js';
import { refreshModels } from './models.js';
import { renderRefs, loadRefImages, setupRefDragDrop, setupClipboardPaste } from './references.js';
import { initDB, loadHistory, useHistoryItem } from './history.js';
import { setupZoomHandlers, resetZoom, setCurrentImgRef } from './zoom.js';
import { generate, loadSessionStats, setCurrentImg } from './generation.js';

// Initialize application
async function init() {
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

    // Setup zoom handlers
    setupZoomHandlers();

    // Make useHistoryItem work with zoom reset
    window.useHistoryItem = () => {
        useHistoryItem(setCurrentImg, resetZoom);
    };

    // Initialize database and load history
    await initDB();
    loadHistory();

    // Load models if API key exists
    if ($('apiKey').value.length > 20) {
        refreshModels();
    }

    console.log('🍌 Nano Banana Pro initialized');
}

// Start app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
