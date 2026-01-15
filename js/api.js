/**
 * API Module
 * Gemini and Vertex AI API calls with retry logic
 */

import { MAX_RETRIES, RETRY_DELAYS } from './config.js';
import { authMode, getVertexAccessToken, clearToken, antigravityUrl, antigravityApiKey } from './auth.js';
import { $, updatePlaceholder } from './ui.js';

// Check if error should trigger retry
export function shouldRetry(err, status) {
    if (err.name === 'AbortError') return false;
    if (status === 400 || status === 401 || status === 403) return false;
    return true;
}

// Parse API errors for user-friendly messages
export function parseApiError(error, status) {
    const msg = error.message || error.toString();

    if (status === 429) {
        const match = msg.match(/(\d+)\s*seconds?/i);
        const seconds = match ? parseInt(match[1]) : 60;
        return { type: 'rate_limit', message: 'Rate limited. Try again in ' + seconds + 's', countdown: seconds };
    }

    if (msg.toLowerCase().includes('safety') || msg.toLowerCase().includes('policy') || msg.toLowerCase().includes('blocked')) {
        return { type: 'content_policy', message: 'Prompt may contain restricted content. Try rephrasing.' };
    }

    if (status === 401 || status === 403) {
        return { type: 'auth', message: 'Authentication failed. Check your credentials.' };
    }

    return { type: 'generic', message: msg };
}

// Get Vertex endpoint URL
export function getVertexEndpoint(model) {
    const location = $('vertexLocation').value;
    const project = $('projectId').value;

    if (location === 'global') {
        return 'https://aiplatform.googleapis.com/v1/projects/' + project + '/locations/global/publishers/google/models/' + model + ':generateContent';
    }

    return 'https://' + location + '-aiplatform.googleapis.com/v1/projects/' + project + '/locations/' + location + '/publishers/google/models/' + model + ':generateContent';
}

// Vertex AI generate content
export async function vertexGenerateContent(model, body, signal) {
    const token = await getVertexAccessToken();
    const endpoint = getVertexEndpoint(model);

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: signal
    });

    const data = await response.json();
    if (data.error) {
        const err = new Error(data.error.message);
        err.status = response.status;
        throw err;
    }
    return data;
}

// API Key generate content
export async function apiKeyGenerateContent(model, body, apiKey, signal) {
    const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: signal
        }
    );

    const data = await response.json();
    if (data.error) {
        const err = new Error(data.error.message);
        err.status = response.status;
        throw err;
    }
    return data;
}

// Antigravity (OpenAI-compatible) generate content
export async function antigravityGenerateContent(model, body, signal) {
    const url = $('antigravityUrl')?.value || antigravityUrl || 'http://localhost:3000';
    const apiKey = $('antigravityApiKey')?.value || antigravityApiKey;

    // Extract prompt and images from Gemini format body
    const userContent = body.contents?.[0];
    const textPart = userContent?.parts?.find(p => p.text);
    const imageParts = userContent?.parts?.filter(p => p.inlineData) || [];

    // Build OpenAI-compatible messages
    const messageContent = [];

    // Add images first
    imageParts.forEach(p => {
        messageContent.push({
            type: 'image_url',
            image_url: {
                url: 'data:' + p.inlineData.mimeType + ';base64,' + p.inlineData.data
            }
        });
    });

    // Add text prompt
    if (textPart?.text) {
        messageContent.push({
            type: 'text',
            text: textPart.text
        });
    }

    const requestBody = {
        model: model,
        messages: [{
            role: 'user',
            content: messageContent.length === 1 && messageContent[0].type === 'text'
                ? messageContent[0].text
                : messageContent
        }],
        max_tokens: 4096
    };

    const headers = {
        'Content-Type': 'application/json'
    };

    if (apiKey) {
        headers['Authorization'] = 'Bearer ' + apiKey;
    }

    const response = await fetch(url + '/v1/chat/completions', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody),
        signal: signal
    });

    const data = await response.json();

    if (data.error) {
        const err = new Error(data.error.message || data.error);
        err.status = response.status;
        throw err;
    }

    // Convert OpenAI response to Gemini format
    const choice = data.choices?.[0];
    const content = choice?.message?.content;

    // Handle different response formats
    if (typeof content === 'string') {
        // Check if it's a base64 image data URI
        if (content.startsWith('data:image')) {
            const match = content.match(/^data:(.+);base64,(.+)$/);
            if (match) {
                return {
                    candidates: [{
                        content: {
                            parts: [{
                                inlineData: {
                                    mimeType: match[1],
                                    data: match[2]
                                }
                            }]
                        }
                    }]
                };
            }
        }
        // Text response
        return {
            candidates: [{
                content: {
                    parts: [{ text: content }]
                }
            }]
        };
    }

    // Array content - look for image
    if (Array.isArray(content)) {
        const imgPart = content.find(p => p.type === 'image_url' || p.type === 'image');
        if (imgPart) {
            const imgUrl = imgPart.image_url?.url || imgPart.url || imgPart.data;
            const match = imgUrl?.match(/^data:(.+);base64,(.+)$/);
            if (match) {
                return {
                    candidates: [{
                        content: {
                            parts: [{
                                inlineData: {
                                    mimeType: match[1],
                                    data: match[2]
                                }
                            }]
                        }
                    }]
                };
            }
        }
    }

    // Fallback - return as text
    return {
        candidates: [{
            content: {
                parts: [{ text: typeof content === 'string' ? content : JSON.stringify(content) }]
            }
        }]
    };
}

// Generate content with retry logic
export async function generateWithRetry(model, body, signal) {
    const apiKey = $('apiKey').value;
    let data;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            updatePlaceholder('Generating... (Attempt ' + attempt + '/' + MAX_RETRIES + ')');

            if (authMode === 'apikey') {
                data = await apiKeyGenerateContent(model, body, apiKey, signal);
            } else if (authMode === 'vertex') {
                data = await vertexGenerateContent(model, body, signal);
            } else if (authMode === 'antigravity') {
                data = await antigravityGenerateContent(model, body, signal);
            }
            break;
        } catch (e) {
            if (!shouldRetry(e, e.status) || attempt === MAX_RETRIES) {
                throw e;
            }

            // Clear token on auth errors for Vertex
            if (authMode === 'vertex' && (e.status === 401 || e.status === 403)) {
                clearToken();
            }

            const delay = RETRY_DELAYS[attempt - 1];
            updatePlaceholder('Retry in ' + (delay / 1000) + 's...');
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    return data;
}
