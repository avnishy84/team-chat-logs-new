// popup.js — TeamsChat Archiver popup UI logic

/**
 * Handles the Save Chat button click.
 * @param {Document} doc - The document to operate on (injectable for testing)
 */
function handleSaveClick(doc) {
  const btn = doc.getElementById('save-btn');
  const status = doc.getElementById('status');

  btn.disabled = true;
  status.textContent = 'Saving\u2026';

  chrome.runtime.sendMessage({ action: 'scrape' }, function (response) {
    if (response && response.success) {
      status.textContent = 'Saved successfully.';
    } else if (response && response.error) {
      status.textContent = response.error;
    }
    btn.disabled = false;
  });
}

/**
 * Registers a chrome.runtime.onMessage listener that updates the UI
 * with live progress and final status from the background service worker.
 * @param {Document} doc
 */
function registerProgressListener(doc) {
  chrome.runtime.onMessage.addListener(function (message) {
    const status = doc.getElementById('status');
    const btn = doc.getElementById('save-btn');

    if (message && message.action === 'progress' && typeof message.loaded === 'number') {
      if (status) {
        status.textContent = 'Loading\u2026 ' + message.loaded + ' messages loaded';
      }
    } else if (message && message.action === 'done') {
      if (message.success) {
        if (status) status.textContent = 'Chat saved successfully!';
      } else if (message.error) {
        if (status) status.textContent = message.error;
      }
      if (btn) btn.disabled = false;
    }
  });
}

/**
 * Attaches the click handler to #save-btn and registers the progress listener.
 * @param {Document} doc
 */
function init(doc) {
  const btn = doc.getElementById('save-btn');
  if (btn) {
    btn.addEventListener('click', function () {
      handleSaveClick(doc);
    });
  }
  registerProgressListener(doc);
}

// Auto-init when running in the browser (not in Node/Jest)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { init, handleSaveClick, registerProgressListener };
} else {
  document.addEventListener('DOMContentLoaded', function () {
    init(document);
  });
}
