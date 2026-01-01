/**
 * Models Module
 * Model loading and selection
 */

import { VERTEX_MODELS } from './config.js';
import { authMode, serviceAccount, getVertexAccessToken } from './auth.js';
import { $, showToast } from './ui.js';
import { restoreLastModel } from './persistence.js';

// Refresh models list
export async function refreshModels() {
    const refreshBtn = $('refreshBtn');
    const modelStatus = $('modelStatus');

    refreshBtn.classList.add('loading');
    modelStatus.textContent = 'Loading...';
    modelStatus.className = 'model-status';

    try {
        if (authMode === 'apikey') {
            await refreshModelsAPIKey();
        } else {
            await refreshModelsVertex();
        }
    } catch (e) {
        modelStatus.textContent = e.message.slice(0, 50);
        modelStatus.className = 'model-status error';
    } finally {
        refreshBtn.classList.remove('loading');
        restoreLastModel();
    }
}

// Refresh models for API Key auth
async function refreshModelsAPIKey() {
    const apiKey = $('apiKey').value;
    const modelStatus = $('modelStatus');
    const modelSelect = $('modelSelect');

    if (!apiKey) {
        modelStatus.textContent = 'Enter API key';
        modelStatus.className = 'model-status error';
        return;
    }

    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    const models = data.models || [];
    modelSelect.innerHTML = models.map(m => {
        const id = m.name.replace('models/', '');
        return '<option value="' + id + '">' + id + '</option>';
    }).join('');

    modelStatus.textContent = models.length + ' models';
    modelStatus.className = 'model-status success';
}

// Refresh models for Vertex AI auth
async function refreshModelsVertex() {
    const modelStatus = $('modelStatus');
    const modelSelect = $('modelSelect');

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
        modelSelect.innerHTML = VERTEX_MODELS.map(id => '<option value="' + id + '">' + id + '</option>').join('');
        modelStatus.textContent = 'Authenticated ✓';
        modelStatus.className = 'model-status success';
    } catch (e) {
        throw new Error('Auth failed: ' + e.message);
    }
}

// Make functions globally available for HTML onclick handlers
window.refreshModels = refreshModels;
