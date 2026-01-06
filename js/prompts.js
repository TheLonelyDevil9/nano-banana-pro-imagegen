/**
 * Saved Prompts Module
 * Save, load, delete prompts using IndexedDB
 */

import { getDB } from './history.js';
import { $, showToast, haptic } from './ui.js';

let savedPrompts = [];
let dropdownOpen = false;

// Load all saved prompts from IndexedDB
export async function loadSavedPrompts() {
    const db = getDB();
    if (!db) return;

    return new Promise((resolve) => {
        const tx = db.transaction('savedPrompts', 'readonly');
        const store = tx.objectStore('savedPrompts');
        const items = [];

        store.index('createdAt').openCursor(null, 'prev').onsuccess = e => {
            const cursor = e.target.result;
            if (cursor) {
                items.push(cursor.value);
                cursor.continue();
            } else {
                savedPrompts = items;
                updatePromptsCount();
                resolve(items);
            }
        };
    });
}

// Save current prompt to IndexedDB
export function saveCurrentPrompt() {
    const db = getDB();
    const promptText = $('prompt').value.trim();

    if (!promptText) {
        showToast('Enter a prompt first');
        return;
    }

    if (!db) {
        showToast('Database not ready');
        return;
    }

    // Check for duplicates
    if (savedPrompts.some(p => p.text === promptText)) {
        showToast('Prompt already saved');
        return;
    }

    const tx = db.transaction('savedPrompts', 'readwrite');
    tx.objectStore('savedPrompts').add({
        id: 'prompt-' + Date.now(),
        text: promptText,
        createdAt: Date.now()
    });

    tx.oncomplete = () => {
        loadSavedPrompts();
        showToast('Prompt saved');
        haptic(15);
    };

    tx.onerror = () => {
        showToast('Failed to save');
    };
}

// Delete a saved prompt
export function deletePrompt(id, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }

    const db = getDB();
    if (!db) return;

    const tx = db.transaction('savedPrompts', 'readwrite');
    tx.objectStore('savedPrompts').delete(id);

    tx.oncomplete = () => {
        loadSavedPrompts().then(() => renderPromptsDropdown());
        showToast('Prompt deleted');
        haptic(15);
    };
}

// Use a saved prompt (load into textarea)
export function usePrompt(id) {
    const prompt = savedPrompts.find(p => p.id === id);
    if (prompt) {
        $('prompt').value = prompt.text;
        $('prompt').dispatchEvent(new Event('input'));
        closePromptsDropdown();
        showToast('Prompt loaded');
        haptic(10);
    }
}

// Toggle dropdown visibility
export function togglePromptsDropdown() {
    if (dropdownOpen) {
        closePromptsDropdown();
    } else {
        openPromptsDropdown();
    }
}

// Open dropdown
function openPromptsDropdown() {
    renderPromptsDropdown();
    $('promptsDropdown').classList.remove('hidden');
    dropdownOpen = true;
}

// Close dropdown
export function closePromptsDropdown() {
    $('promptsDropdown').classList.add('hidden');
    dropdownOpen = false;
}

// Check if dropdown is open
export function isDropdownOpen() {
    return dropdownOpen;
}

// Render the prompts dropdown list
function renderPromptsDropdown() {
    const list = $('savedPromptsList');
    const emptyMsg = $('noPromptsMsg');

    if (savedPrompts.length === 0) {
        list.innerHTML = '';
        emptyMsg.classList.remove('hidden');
        return;
    }

    emptyMsg.classList.add('hidden');
    list.innerHTML = savedPrompts.map(p => {
        const truncated = p.text.length > 50 ? p.text.slice(0, 50) + '...' : p.text;
        return '<div class="dropdown-item" onclick="usePrompt(\'' + p.id + '\')">' +
            '<span class="dropdown-item-text">' + escapeHtml(truncated) + '</span>' +
            '<button class="dropdown-item-delete" onclick="deletePrompt(\'' + p.id + '\', event)" title="Delete">&times;</button>' +
            '</div>';
    }).join('');
}

// Update the saved prompts count badge
function updatePromptsCount() {
    const badge = $('savedPromptsCount');
    if (badge) {
        badge.textContent = savedPrompts.length;
        badge.classList.toggle('hidden', savedPrompts.length === 0);
    }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Make functions globally available for HTML onclick handlers
window.saveCurrentPrompt = saveCurrentPrompt;
window.deletePrompt = deletePrompt;
window.usePrompt = usePrompt;
window.togglePromptsDropdown = togglePromptsDropdown;
window.closePromptsDropdown = closePromptsDropdown;
