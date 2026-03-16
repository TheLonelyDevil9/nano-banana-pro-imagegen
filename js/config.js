/**
 * Configuration Constants
 * All magic numbers and configuration values
 */

// API Configuration
export const MAX_RETRIES = 3;
export const RETRY_DELAYS = [2000, 4000, 8000];

// Image Configuration
export const MAX_REF_IMAGE_SIZE = 2560;
export const MAX_REFS = 14;

// Queue Configuration
export const DEFAULT_QUEUE_DELAY_MS = 3000;
export const MAX_QUEUE_ITEMS = 100;
export const MAX_VARIATIONS_PER_PROMPT = 10;
export const QUEUE_STORAGE_KEY = 'queue_state';

// History Configuration
export const MAX_HISTORY_ITEMS = 500;

// Zoom Configuration
export const FS_MAX_ZOOM = 10;
export const FS_MIN_ZOOM = 1;
export const DOUBLE_TAP_THRESHOLD = 300;
