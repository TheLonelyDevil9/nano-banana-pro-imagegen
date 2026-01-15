/**
 * Models Module
 * Model loading and selection
 */

import { VERTEX_MODELS, ANTIGRAVITY_MODELS } from './config.js';
import { authMode, serviceAccount, getVertexAccessToken } from './auth.js';
import { $, showToast } from './ui.js';
import { restoreLastModel } from './persistence.js';

// Model cache with TTL
const MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let modelCache = { data: null, timestamp: 0, authMode: null, key: null };

// Refresh models list
export async function refreshModels(forceRefresh = false) {
    const refreshBtn = $('refreshBtn');
    const modelStatus = $('modelStatus');

    // Check cache for API key mode
    if (!forceRefresh && authMode === 'apikey') {
        const apiKey = $('apiKey').value;
        if (modelCache.data &&
            modelCache.authMode === 'apikey' &&
            modelCache.key === apiKey &&
            Date.now() - modelCache.timestamp < MODEL_CACHE_TTL) {
            // Use cached data
            renderModels(modelCache.data);
            modelStatus.textContent = modelCache.data.length + ' models (cached)';
            modelStatus.className = 'model-status success';
            restoreLastModel();
            return;
        }
    }

    refreshBtn.classList.add('loading');
    modelStatus.textContent = 'Loading...';
    modelStatus.className = 'model-status';

    try {
        if (authMode === 'apikey') {
            await refreshModelsAPIKey();
        } else if (authMode === 'vertex') {
            await refreshModelsVertex();
        } else if (authMode === 'antigravity') {
            await refreshModelsAntigravity();
        }
    } catch (e) {
        modelStatus.textContent = e.message.slice(0, 50);
        modelStatus.className = 'model-status error';
    } finally {
        refreshBtn.classList.remove('loading');
        restoreLastModel();
    }
}

// Render models to select element
function renderModels(models) {
    const modelSelect = $('modelSelect');
    modelSelect.innerHTML = models.map(id => '<option value="' + id + '">' + id + '</option>').join('');
}

// Refresh models for API Key auth
async function refreshModelsAPIKey() {
    const apiKey = $('apiKey').value;
    const modelStatus = $('modelStatus');

    if (!apiKey) {
        modelStatus.textContent = 'Enter API key';
        modelStatus.className = 'model-status error';
        return;
    }

    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    const models = (data.models || []).map(m => m.name.replace('models/', ''));

    // Cache the results
    modelCache = {
        data: models,
        timestamp: Date.now(),
        authMode: 'apikey',
        key: apiKey
    };

    renderModels(models);
    modelStatus.textContent = models.length + ' models';
    modelStatus.className = 'model-status success';
}

// Refresh models for Vertex AI auth
async function refreshModelsVertex() {
    const modelStatus = $('modelStatus');

    if (!serviceAccount) {
        modelStatus.textContent = 'Load service account JSON';
        modelStatus.className = 'model-status error';
        return;
    }

    if (!$('projectId').value) {
        modelStatus.textContent = 'Enter project ID';
        modelStatus.className = 'model-status error';
        return;
    }

    try {
        await getVertexAccessToken();
        renderModels(VERTEX_MODELS);
        modelStatus.textContent = 'Authenticated ✓';
        modelStatus.className = 'model-status success';
    } catch (e) {
        throw new Error('Auth failed: ' + e.message);
    }
}

// Refresh models for Antigravity auth
async function refreshModelsAntigravity() {
    const modelStatus = $('modelStatus');
    const url = $('antigravityUrl')?.value;

    if (!url) {
        modelStatus.textContent = 'Enter server URL';
        modelStatus.className = 'model-status error';
        return;
    }

    // Use predefined models for Antigravity
    renderModels(ANTIGRAVITY_MODELS);
    modelStatus.textContent = 'Connected to Antigravity';
    modelStatus.className = 'model-status success';
}

// Make functions globally available for HTML onclick handlers
window.refreshModels = refreshModels;
