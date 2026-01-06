/**
 * Authentication Module
 * API Key and Vertex AI authentication handling
 */

import { VERTEX_SCOPE } from './config.js';
import { $, showToast } from './ui.js';
import { persistInput, loadPersistedInput } from './persistence.js';

// Auth state
export let authMode = 'apikey';
export let serviceAccount = null;
export let vertexAccessToken = null;
export let tokenExpiry = 0;
let jsrsasignLoaded = false;
let jsrsasignLoading = false;

// Lazy-load jsrsasign library (only needed for Vertex AI)
async function loadJsrsasign() {
    if (jsrsasignLoaded) return;
    if (jsrsasignLoading) {
        // Wait for existing load to complete
        while (jsrsasignLoading) {
            await new Promise(r => setTimeout(r, 100));
        }
        return;
    }

    jsrsasignLoading = true;
    try {
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jsrsasign/11.1.0/jsrsasign-all-min.js';
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load jsrsasign library'));
            document.head.appendChild(script);
        });
        jsrsasignLoaded = true;
    } finally {
        jsrsasignLoading = false;
    }
}

// Set auth mode
export function setAuthMode(mode) {
    authMode = mode;
}

// Set service account
export function setServiceAccount(sa) {
    serviceAccount = sa;
}

// Clear token (for retry on auth errors)
export function clearToken() {
    vertexAccessToken = null;
    tokenExpiry = 0;
}

// Switch between API Key and Vertex AI modes
export function switchAuthMode(mode) {
    authMode = mode;
    persistInput('authMode', mode);

    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.mode === mode);
    });
    document.querySelectorAll('.auth-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === mode + 'Panel');
    });

    const modelSelect = $('modelSelect');
    const modelStatus = $('modelStatus');
    modelSelect.innerHTML = '<option value="">Select auth method first...</option>';
    modelStatus.textContent = '';

    // Dynamically import to avoid circular dependency
    import('./models.js').then(m => {
        if (mode === 'apikey' && $('apiKey').value.length > 20) {
            m.refreshModels();
        } else if (mode === 'vertex' && serviceAccount && $('projectId').value) {
            m.refreshModels();
        }
    });
}

// Restore auth mode from storage
export function restoreAuthMode() {
    const savedMode = loadPersistedInput('authMode', 'apikey');
    if (savedMode !== authMode) {
        switchAuthMode(savedMode);
    }
}

// Handle service account file
export function handleSAFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const json = JSON.parse(e.target.result);
            if (!json.client_email || !json.private_key || !json.project_id) {
                throw new Error('Invalid service account JSON');
            }
            serviceAccount = json;
            localStorage.setItem('vertex_service_account', JSON.stringify(json));

            $('projectId').value = json.project_id;
            localStorage.setItem('vertex_project_id', json.project_id);

            const saDropZone = $('saDropZone');
            const saInfo = $('saInfo');
            saDropZone.classList.add('loaded');
            saDropZone.innerHTML = '<div>✅ ' + json.client_email.split('@')[0] + '</div>';
            saInfo.textContent = 'Project: ' + json.project_id;
            saInfo.className = 'sa-info success';

            vertexAccessToken = null;
            tokenExpiry = 0;
            showToast('Service account loaded!');

            if ($('projectId').value) {
                import('./models.js').then(m => m.refreshModels());
            }
        } catch (err) {
            const saInfo = $('saInfo');
            saInfo.textContent = 'Error: ' + err.message;
            saInfo.className = 'sa-info';
            showToast('Invalid service account file');
        }
    };
    reader.readAsText(file);
}

// Get Vertex AI access token using JWT
export async function getVertexAccessToken() {
    if (vertexAccessToken && Date.now() < tokenExpiry - 60000) {
        return vertexAccessToken;
    }
    if (!serviceAccount) {
        throw new Error('No service account loaded');
    }

    // Lazy-load jsrsasign library
    await loadJsrsasign();

    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 3600;
    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = {
        iss: serviceAccount.client_email,
        sub: serviceAccount.client_email,
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: expiry,
        scope: VERTEX_SCOPE
    };

    const sHeader = JSON.stringify(header);
    const sPayload = JSON.stringify(claims);
    const prvKey = KEYUTIL.getKey(serviceAccount.private_key);
    const sJWT = KJUR.jws.JWS.sign('RS256', sHeader, sPayload, prvKey);

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: sJWT
        })
    });

    const tokenData = await tokenResponse.json();
    if (tokenData.error) {
        throw new Error('Token error: ' + (tokenData.error_description || tokenData.error));
    }

    vertexAccessToken = tokenData.access_token;
    tokenExpiry = Date.now() + (tokenData.expires_in * 1000);
    return vertexAccessToken;
}

// Setup drag and drop for service account
export function setupAuthDragDrop() {
    const dropZone = $('saDropZone');

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, e => {
            e.preventDefault();
            e.stopPropagation();
        });
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'));
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'));
    });

    dropZone.addEventListener('drop', e => {
        const file = e.dataTransfer.files[0];
        if (file && file.name.endsWith('.json')) {
            handleSAFile(file);
        } else {
            showToast('Please drop a JSON file');
        }
    });
}

// Restore service account from localStorage
export function restoreServiceAccount() {
    const savedSA = localStorage.getItem('vertex_service_account');
    if (savedSA) {
        try {
            serviceAccount = JSON.parse(savedSA);
            const saDropZone = $('saDropZone');
            const saInfo = $('saInfo');
            saDropZone.classList.add('loaded');
            saDropZone.innerHTML = '<div>✅ ' + serviceAccount.client_email.split('@')[0] + '</div>';
            saInfo.textContent = 'Project: ' + serviceAccount.project_id;
            saInfo.className = 'sa-info success';
        } catch (e) {
            localStorage.removeItem('vertex_service_account');
        }
    }
}

// Make functions globally available for HTML onclick handlers
window.switchAuthMode = switchAuthMode;
window.handleSAFile = handleSAFile;
