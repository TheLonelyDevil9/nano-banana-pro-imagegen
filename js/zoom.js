/**
 * Zoom Module
 * Pinch-to-zoom for image box and fullscreen modal
 */

import { FS_MAX_ZOOM, FS_MIN_ZOOM, IMAGE_BOX_MAX_ZOOM, IMAGE_BOX_MIN_ZOOM, DOUBLE_TAP_THRESHOLD, DOUBLE_TAP_ZOOM } from './config.js';
import { $, haptic } from './ui.js';

// Image box zoom state
let scale = 1, posX = 0, posY = 0, lastScale = 1, lastX = 0, lastY = 0;
let startDist = 0, startX = 0, startY = 0, pinching = false, dragging = false, lastTap = 0;

// Fullscreen zoom state
let fsScale = 1, fsPosX = 0, fsPosY = 0, fsLastScale = 1, fsLastX = 0, fsLastY = 0;
let fsStartDist = 0, fsStartX = 0, fsStartY = 0, fsPinching = false, fsDragging = false, fsLastTap = 0;
let zoomLevelTimeout = null;
let fsMouseDown = false, fsMouseStartX = 0, fsMouseStartY = 0;

// Current image reference (set externally)
let currentImg = null;

export function setCurrentImgRef(img) {
    currentImg = img;
}

export function getCurrentImg() {
    return currentImg;
}

// Helper functions
function getDist(t) {
    return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
}

function getMid(t) {
    return { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 };
}

// Image box zoom
function updateZoom() {
    const resultImg = $('resultImg');
    const imageBox = $('imageBox');
    resultImg.style.transform = 'translate(' + posX + 'px,' + posY + 'px) scale(' + scale + ')';
    imageBox.classList.toggle('is-zoomed', scale > 1.05);
}

export function resetZoom() {
    scale = 1; posX = 0; posY = 0; lastScale = 1; lastX = 0; lastY = 0;
    updateZoom();
}

function clampPos() {
    const imageBox = $('imageBox');
    const resultImg = $('resultImg');

    if (scale <= 1) { posX = posY = 0; return; }
    const boxRect = imageBox.getBoundingClientRect();
    const imgRect = resultImg.getBoundingClientRect();
    const scaledImgW = (imgRect.width / scale) * scale;
    const scaledImgH = (imgRect.height / scale) * scale;
    const maxX = Math.max(0, (scaledImgW - boxRect.width) / 2);
    const maxY = Math.max(0, (scaledImgH - boxRect.height) / 2);
    posX = Math.max(-maxX, Math.min(maxX, posX));
    posY = Math.max(-maxY, Math.min(maxY, posY));
}

// Fullscreen zoom
function updateFullscreenZoom() {
    $('fullscreenImg').style.transform = 'translate(' + fsPosX + 'px,' + fsPosY + 'px) scale(' + fsScale + ')';
    $('fullscreenModal').classList.toggle('zoomed', fsScale > 1.05);
    showZoomLevel();
}

function showZoomLevel() {
    const zoomEl = $('fullscreenZoomLevel');
    zoomEl.textContent = Math.round(fsScale * 100) + '%';
    zoomEl.classList.add('visible');
    clearTimeout(zoomLevelTimeout);
    zoomLevelTimeout = setTimeout(() => zoomEl.classList.remove('visible'), 1500);
}

export function fsResetZoom() {
    fsScale = 1; fsPosX = 0; fsPosY = 0; fsLastScale = 1; fsLastX = 0; fsLastY = 0;
    updateFullscreenZoom();
}

export function fsZoomIn() {
    fsScale = Math.min(FS_MAX_ZOOM, fsScale * 1.5);
    fsClampPos();
    updateFullscreenZoom();
}

export function fsZoomOut() {
    const oldScale = fsScale;
    fsScale = Math.max(FS_MIN_ZOOM, fsScale / 1.5);
    if (oldScale !== fsScale) {
        const factor = fsScale / oldScale;
        fsPosX *= factor;
        fsPosY *= factor;
    }
    fsClampPos();
    updateFullscreenZoom();
}

function fsClampPos() {
    if (fsScale <= 1) { fsPosX = 0; fsPosY = 0; return; }
    const container = $('fullscreenContainer');
    const img = $('fullscreenImg');
    if (!container || !img) return;
    const containerRect = container.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();
    const baseWidth = imgRect.width / fsScale;
    const baseHeight = imgRect.height / fsScale;
    const maxX = Math.max(0, (baseWidth * fsScale - containerRect.width) / 2);
    const maxY = Math.max(0, (baseHeight * fsScale - containerRect.height) / 2);
    fsPosX = Math.max(-maxX, Math.min(maxX, fsPosX));
    fsPosY = Math.max(-maxY, Math.min(maxY, fsPosY));
}

// Open fullscreen modal
export function openFullscreen() {
    if (!currentImg) return;
    $('fullscreenImg').src = currentImg;
    $('fullscreenModal').classList.add('open');
    fsResetZoom();
}

export function closeFullscreen() {
    $('fullscreenModal').classList.remove('open');
}

// Get current scale (for external checks)
export function getScale() {
    return scale;
}

// Setup all zoom event handlers
export function setupZoomHandlers() {
    const imageBox = $('imageBox');
    const resultImg = $('resultImg');
    const fsContainer = $('fullscreenContainer');

    // Image box touch handlers
    imageBox.addEventListener('touchstart', e => {
        if (resultImg.classList.contains('hidden')) return;
        const now = Date.now();
        if (e.touches.length === 1 && now - lastTap < DOUBLE_TAP_THRESHOLD) {
            e.preventDefault();
            if (scale > 1.05) {
                resetZoom();
            } else {
                scale = lastScale = DOUBLE_TAP_ZOOM;
                updateZoom();
            }
            lastTap = 0;
            return;
        }
        lastTap = now;
        if (e.touches.length === 2) {
            e.preventDefault();
            pinching = true; dragging = false;
            startDist = getDist(e.touches); lastScale = scale;
            const m = getMid(e.touches);
            startX = m.x; startY = m.y; lastX = posX; lastY = posY;
        } else if (e.touches.length === 1 && scale > 1) {
            dragging = true; pinching = false;
            startX = e.touches[0].clientX; startY = e.touches[0].clientY;
            lastX = posX; lastY = posY;
        }
    }, { passive: false });

    imageBox.addEventListener('touchmove', e => {
        if (resultImg.classList.contains('hidden')) return;
        if (pinching && e.touches.length === 2) {
            e.preventDefault();
            scale = Math.max(IMAGE_BOX_MIN_ZOOM, Math.min(IMAGE_BOX_MAX_ZOOM, lastScale * getDist(e.touches) / startDist));
            const m = getMid(e.touches);
            posX = lastX + m.x - startX; posY = lastY + m.y - startY;
            clampPos(); updateZoom();
        } else if (dragging && e.touches.length === 1 && scale > 1) {
            e.preventDefault();
            posX = lastX + e.touches[0].clientX - startX;
            posY = lastY + e.touches[0].clientY - startY;
            clampPos(); updateZoom();
        }
    }, { passive: false });

    imageBox.addEventListener('touchend', e => {
        if (e.touches.length < 2) { pinching = false; lastScale = scale; lastX = posX; lastY = posY; }
        if (e.touches.length === 0) { dragging = false; if (scale < 1.1) resetZoom(); }
    });

    // Image box wheel zoom
    imageBox.addEventListener('wheel', e => {
        if (resultImg.classList.contains('hidden')) return;
        e.preventDefault();
        const rect = imageBox.getBoundingClientRect();
        const cursorX = e.clientX - rect.left - rect.width / 2;
        const cursorY = e.clientY - rect.top - rect.height / 2;
        const oldScale = scale;
        scale = Math.max(IMAGE_BOX_MIN_ZOOM, Math.min(IMAGE_BOX_MAX_ZOOM, scale * (e.deltaY > 0 ? 0.9 : 1.1)));
        if (scale !== oldScale) {
            const scaleFactor = scale / oldScale;
            posX = cursorX - (cursorX - posX) * scaleFactor;
            posY = cursorY - (cursorY - posY) * scaleFactor;
        }
        clampPos(); updateZoom();
    }, { passive: false });

    // Image box click for fullscreen
    imageBox.addEventListener('click', e => {
        if (!resultImg.classList.contains('hidden') && scale <= 1.05 && currentImg) {
            openFullscreen();
        }
    });

    // Image load reset
    resultImg.addEventListener('load', resetZoom);

    // Fullscreen container handlers
    fsContainer.addEventListener('click', e => {
        if (fsScale <= 1.05 && !fsDragging && e.target === fsContainer) {
            closeFullscreen();
        }
    });

    fsContainer.addEventListener('dblclick', e => {
        e.preventDefault();
        if (fsScale > 1.05) {
            fsResetZoom();
        } else {
            const rect = fsContainer.getBoundingClientRect();
            const clickX = e.clientX - rect.left - rect.width / 2;
            const clickY = e.clientY - rect.top - rect.height / 2;
            fsScale = 3;
            fsPosX = -clickX * 2;
            fsPosY = -clickY * 2;
            fsClampPos();
            updateFullscreenZoom();
        }
    });

    fsContainer.addEventListener('wheel', e => {
        e.preventDefault();
        const rect = fsContainer.getBoundingClientRect();
        const cursorX = e.clientX - rect.left - rect.width / 2;
        const cursorY = e.clientY - rect.top - rect.height / 2;
        const oldScale = fsScale;
        fsScale = Math.max(FS_MIN_ZOOM, Math.min(FS_MAX_ZOOM, fsScale * (e.deltaY > 0 ? 0.85 : 1.18)));
        if (fsScale !== oldScale) {
            const factor = fsScale / oldScale;
            fsPosX = cursorX - (cursorX - fsPosX) * factor;
            fsPosY = cursorY - (cursorY - fsPosY) * factor;
        }
        fsClampPos();
        updateFullscreenZoom();
    }, { passive: false });

    // Mouse drag for fullscreen panning
    fsContainer.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        fsMouseDown = true;
        fsDragging = false;
        fsMouseStartX = e.clientX;
        fsMouseStartY = e.clientY;
        fsLastX = fsPosX;
        fsLastY = fsPosY;
        fsContainer.classList.add('dragging');
        e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
        if (!fsMouseDown) return;
        const dx = e.clientX - fsMouseStartX;
        const dy = e.clientY - fsMouseStartY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) fsDragging = true;
        fsPosX = fsLastX + dx;
        fsPosY = fsLastY + dy;
        fsClampPos();
        updateFullscreenZoom();
    });

    document.addEventListener('mouseup', e => {
        if (fsMouseDown) {
            fsMouseDown = false;
            fsContainer.classList.remove('dragging');
            setTimeout(() => fsDragging = false, 10);
        }
    });

    // Touch handlers for fullscreen
    fsContainer.addEventListener('touchstart', e => {
        const now = Date.now();
        if (e.touches.length === 1 && now - fsLastTap < DOUBLE_TAP_THRESHOLD) {
            e.preventDefault();
            if (fsScale > 1.05) {
                fsResetZoom();
            } else {
                fsScale = 3;
                updateFullscreenZoom();
            }
            fsLastTap = 0;
            return;
        }
        fsLastTap = now;

        if (e.touches.length === 2) {
            e.preventDefault();
            fsPinching = true;
            fsDragging = false;
            fsStartDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            fsLastScale = fsScale;
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            fsStartX = midX;
            fsStartY = midY;
            fsLastX = fsPosX;
            fsLastY = fsPosY;
        } else if (e.touches.length === 1) {
            fsDragging = true;
            fsPinching = false;
            fsStartX = e.touches[0].clientX;
            fsStartY = e.touches[0].clientY;
            fsLastX = fsPosX;
            fsLastY = fsPosY;
        }
    }, { passive: false });

    fsContainer.addEventListener('touchmove', e => {
        if (fsPinching && e.touches.length === 2) {
            e.preventDefault();
            const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            fsScale = Math.max(FS_MIN_ZOOM, Math.min(FS_MAX_ZOOM, fsLastScale * dist / fsStartDist));
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            fsPosX = fsLastX + midX - fsStartX;
            fsPosY = fsLastY + midY - fsStartY;
            fsClampPos();
            updateFullscreenZoom();
        } else if (fsDragging && e.touches.length === 1 && fsScale > 1) {
            e.preventDefault();
            fsPosX = fsLastX + e.touches[0].clientX - fsStartX;
            fsPosY = fsLastY + e.touches[0].clientY - fsStartY;
            fsClampPos();
            updateFullscreenZoom();
        }
    }, { passive: false });

    fsContainer.addEventListener('touchend', e => {
        if (e.touches.length < 2) { fsPinching = false; fsLastScale = fsScale; fsLastX = fsPosX; fsLastY = fsPosY; }
        if (e.touches.length === 0) { fsDragging = false; if (fsScale < 1.1) fsResetZoom(); }
    });

    // Keyboard shortcuts in fullscreen
    document.addEventListener('keydown', e => {
        if (!$('fullscreenModal').classList.contains('open')) return;
        if (e.key === 'Escape') closeFullscreen();
        else if (e.key === '+' || e.key === '=') fsZoomIn();
        else if (e.key === '-') fsZoomOut();
        else if (e.key === '0') fsResetZoom();
    });
}

// Make functions globally available for HTML onclick handlers
window.openFullscreen = openFullscreen;
window.closeFullscreen = closeFullscreen;
window.fsZoomIn = fsZoomIn;
window.fsZoomOut = fsZoomOut;
window.fsResetZoom = fsResetZoom;
