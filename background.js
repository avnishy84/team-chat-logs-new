// TeamsChat Archiver — Background Service Worker (Manifest V3)

const TEAMS_ORIGINS = [
  'https://teams.microsoft.com/',
  'https://teams.cloud.microsoft/',
];

function isTeamsUrl(url) {
  return url && TEAMS_ORIGINS.some(origin => url.startsWith(origin));
}

/**
 * Message listener entry point.
 * Returns `true` to keep the message channel open for the async response.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'scrape') {
    handleScrapeRequest(sendResponse);
    return true; // keep channel open for async sendResponse
  }
});

/**
 * Progress relay listener.
 * Forwards { action: "progress", loaded: N } messages from the content script
 * to the popup tab so the popup can display live progress.
 */
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action === 'progress' && sender.tab && sender.tab.id) {
    chrome.tabs.sendMessage(sender.tab.id, message).catch(() => {
      // Popup may be closed — swallow the error
    });
  }
});

/**
 * Validates the active tab URL, injects scraper.js, triggers download.
 *
 * @param {function} sendResponse - Callback to send result back to popup
 */
async function handleScrapeRequest(sendResponse) {
  // Query the active tab in the current window
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url || !isTeamsUrl(tab.url)) {
    sendResponse({ error: 'This extension only works on teams.microsoft.com' });
    return;
  }

  let results;
  try {
    // First inject scraper.js into the tab, then execute scrapeFullHistory()
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['scraper.js'],
    });
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => scrapeFullHistory(),
    });
  } catch (err) {
    const errorMsg = `Failed to run scraper: ${err.message}`;
    chrome.tabs.sendMessage(tab.id, { action: 'done', error: errorMsg }).catch(() => {});
    sendResponse({ error: errorMsg });
    return;
  }

  // executeScript returns an array of InjectionResult; take the first frame's result
  const result = results && results[0] && results[0].result;

  if (!result || result.error) {
    const errorMsg = result ? result.error : 'Scraper returned no result';
    chrome.tabs.sendMessage(tab.id, { action: 'done', error: errorMsg }).catch(() => {});
    sendResponse({ error: errorMsg });
    return;
  }

  try {
    await downloadArchive(result.chatName, result.content);
  } catch (err) {
    const errorMsg = `Download failed: ${err.message}`;
    chrome.tabs.sendMessage(tab.id, { action: 'done', error: errorMsg }).catch(() => {});
    sendResponse({ error: errorMsg });
    return;
  }

  chrome.tabs.sendMessage(tab.id, { action: 'done', success: true }).catch(() => {});
  sendResponse({ success: true });
}


/**
 * Creates a UTF-8 Blob from `content`, generates an object URL, and triggers
 * a download named `{chatName}.txt`.
 *
 * Does NOT set conflictAction: "overwrite" — the browser handles naming conflicts
 * by appending a counter suffix (requirement 7.4).
 *
 * @param {string} chatName - Sanitized chat name (used as filename stem)
 * @param {string} content  - Plain-text archive content
 * @returns {Promise<number>} Resolves with the Chrome download ID
 */
async function downloadArchive(chatName, content) {
  // MV3 service workers don't have URL.createObjectURL — use a data: URI instead
  const encoded = btoa(unescape(encodeURIComponent(content)));
  const url = `data:text/plain;charset=utf-8;base64,${encoded}`;
  const filename = chatName + '.txt';

  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename }, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(downloadId);
      }
    });
  });
}

// Allow Jest to import this module while still working as a plain service worker
if (typeof module !== 'undefined') {
  module.exports = { handleScrapeRequest, downloadArchive };
}
