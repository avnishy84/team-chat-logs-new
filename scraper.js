// TeamsChat Archiver — Content Script (injected on demand via chrome.scripting.executeScript)

/**
 * Sanitizes a string for use as a filename by replacing characters that are
 * invalid in file names with underscores.
 *
 * Invalid characters replaced: / \ : * ? " < > |
 *
 * @param {string} name - The raw chat name to sanitize
 * @returns {string} The sanitized filename-safe string
 */
function sanitizeFilename(name) {
  return name.replace(/[/\\:*?"<>|]/g, '_');
}

/**
 * Extracts the chat name from the Teams conversation header.
 * Tries data-tid attribute selectors first, falls back to ARIA label selectors,
 * and returns "teams-chat" if nothing is found.
 *
 * @returns {string} Sanitized chat name
 */
function extractChatName() {
  // Primary: data-tid selectors for the chat header title
  const dataTidSelectors = [
    '[data-tid="chat-header-title"]',
    '[data-tid="chat-title"]',
    '[data-tid="conversation-title"]',
  ];

  for (const sel of dataTidSelectors) {
    const el = document.querySelector(sel);
    if (el && el.textContent.trim()) {
      return sanitizeFilename(el.textContent.trim());
    }
  }

  // Fallback: ARIA label on a header element
  const ariaSelectors = [
    'header [aria-label]',
    '[role="heading"][aria-label]',
    '[aria-label][data-tid]',
  ];

  for (const sel of ariaSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const label = el.getAttribute('aria-label') || el.textContent.trim();
      if (label) return sanitizeFilename(label);
    }
  }

  return 'teams-chat';
}

/**
 * @typedef {Object} MessageRecord
 * @property {string} sender    - Display name of the message sender
 * @property {string} timestamp - ISO-like timestamp string, or "" if unavailable
 * @property {string} content   - Plain-text message body (HTML stripped)
 */

/**
 * Extracts all visible message records from the Teams chat container.
 * Tries multiple selector strategies to find message bubbles.
 * Carries forward the last known sender for consecutive messages.
 *
 * @returns {MessageRecord[]}
 * @throws {Error} If no message bubbles are found
 */
function extractMessages() {
  // Try progressively broader selectors until we find bubbles
  const bubbleSelectors = [
    '[data-tid="message-body"]',
    '[data-tid="chat-pane-message"]',
    '[data-tid="messageBody"]',
    '[data-tid="message-content"]',
    '[role="listitem"]',
    '[role="article"]',
    '[data-scroll-id]',
  ];

  let bubbles = [];
  for (const sel of bubbleSelectors) {
    const found = document.querySelectorAll(sel);
    if (found && found.length > 0) {
      bubbles = Array.from(found);
      break;
    }
  }

  if (bubbles.length === 0) {
    throw new Error('No messages found. Make sure a chat is open.');
  }

  const records = [];
  let lastSender = '';

  for (const bubble of bubbles) {
    // --- Sender extraction ---
    let sender = '';

    const senderSelectors = [
      '[data-tid="message-author-name"]',
      '[data-tid="sender-name"]',
      '[data-tid="author"]',
      '[data-tid="authorName"]',
      '[data-tid="message-author"]',
      // Teams web sometimes uses a plain <span> with an id containing "author"
      'span[id*="author"]',
      'span[id*="Author"]',
    ];

    for (const sel of senderSelectors) {
      const el = bubble.querySelector(sel);
      if (el && el.textContent.trim()) {
        sender = el.textContent.trim();
        break;
      }
    }

    if (!sender) {
      // Fallback 1: aria-roledescription="author" on any descendant
      const authorEl = bubble.querySelector('[aria-roledescription="author"]');
      if (authorEl) {
        sender = (authorEl.getAttribute('aria-label') || authorEl.textContent || '').trim();
      }
    }

    if (!sender) {
      // Fallback 2: avatar/persona element — Teams sets aria-label="<Name>'s avatar" or similar
      const avatarEl =
        bubble.querySelector('[aria-label*="avatar"]') ||
        bubble.querySelector('[aria-label*="Avatar"]') ||
        bubble.querySelector('[aria-label*="profile picture"]') ||
        bubble.querySelector('[aria-label*="Profile picture"]');
      if (avatarEl) {
        const raw = avatarEl.getAttribute('aria-label') || '';
        // Strip trailing " avatar", "'s avatar", " profile picture" etc.
        sender = raw.replace(/['']s\s+(avatar|profile\s+picture|photo)/gi, '')
                    .replace(/\s+(avatar|profile\s+picture|photo)/gi, '')
                    .trim();
      }
    }

    if (!sender) {
      // Fallback 3: any focusable element with aria-label that isn't a known UI action
      const UI_ACTION_LABELS = /^(more message options|react|like|reply|forward|edit|delete)/i;
      const ariaEl = bubble.querySelector('[aria-label][tabindex]');
      if (ariaEl) {
        const label = (ariaEl.getAttribute('aria-label') || '').trim();
        if (label && !UI_ACTION_LABELS.test(label)) {
          sender = label;
        }
      }
    }

    // Carry forward last known sender if none found
    if (sender) {
      lastSender = sender;
    } else {
      sender = lastSender;
    }

    // --- Timestamp extraction ---
    let timestamp = '';

    const tsSelectors = [
      '[data-tid="message-timestamp"]',
      '[data-tid="timestamp"]',
      '[data-tid="messageTimestamp"]',
    ];

    for (const sel of tsSelectors) {
      const el = bubble.querySelector(sel);
      if (el) {
        timestamp = el.getAttribute('datetime') || el.getAttribute('aria-label') || el.textContent.trim();
        if (timestamp) break;
      }
    }

    if (!timestamp) {
      const timeEl = bubble.querySelector('time[datetime]') || bubble.querySelector('time');
      if (timeEl) {
        timestamp = timeEl.getAttribute('datetime') || timeEl.textContent.trim();
      }
    }

    // --- Content extraction (plain text, HTML stripped) ---
    // Build a set of text strings that belong to noise sub-elements (sender, timestamp,
    // UI buttons) so we can subtract them from the full bubble text. This avoids
    // cloneNode (not available in the test shim) while still working in the real DOM.
    const noiseTexts = new Set();

    // Collect sender/timestamp element text to exclude
    const NOISE_TIDS = [
      '[data-tid="message-author-name"]', '[data-tid="sender-name"]',
      '[data-tid="author"]', '[data-tid="authorName"]', '[data-tid="message-author"]',
      '[data-tid="message-timestamp"]', '[data-tid="timestamp"]', '[data-tid="messageTimestamp"]',
      '[data-tid="reactions-bar"]', '[data-tid="message-reactions"]',
    ];
    NOISE_TIDS.forEach(sel => {
      const el = bubble.querySelector(sel);
      if (el) {
        const t = (el.innerText || el.textContent || '').trim();
        if (t) noiseTexts.add(t);
      }
    });

    // Collect time element text
    const timeEl2 = bubble.querySelector('time');
    if (timeEl2) {
      const t = (timeEl2.innerText || timeEl2.textContent || '').trim();
      if (t) noiseTexts.add(t);
    }

    // Collect aria-label text from known UI action buttons
    const UI_ACTION_ARIA = [
      'More message options', 'React to this message', 'Like', 'Forward',
    ];
    UI_ACTION_ARIA.forEach(label => {
      // In the real DOM these are buttons; in the mock they may not exist — safe either way
      const btns = bubble.querySelectorAll ? bubble.querySelectorAll(`[aria-label="${label}"]`) : [];
      Array.from(btns).forEach(btn => {
        const t = (btn.innerText || btn.textContent || '').trim();
        if (t) noiseTexts.add(t);
        // Also add the aria-label itself in case it leaks as text
        noiseTexts.add(label);
      });
    });

    // Prefer a targeted content element if Teams provides one
    const contentEl =
      bubble.querySelector('[data-tid="messageBodyContent"]') ||
      bubble.querySelector('[data-tid="message-body-content"]');

    let rawContent = contentEl
      ? (contentEl.innerText || contentEl.textContent || '')
      : (bubble.innerText || bubble.textContent || '');

    // Remove noise substrings. Work line-by-line so we don't accidentally strip
    // mid-sentence occurrences of short noise strings like "Like".
    let contentLines = rawContent.split('\n').map(line => {
      const trimmed = line.trim();
      // Drop lines that are entirely a known noise string
      if (noiseTexts.has(trimmed)) return '';
      // Drop lines that are entirely a known UI action label
      if (UI_ACTION_ARIA.some(label => trimmed === label || trimmed.startsWith(label + ':'))) return '';
      return line;
    });

    const content = contentLines.join('\n').trim();

    // Skip bubbles that have absolutely no text in the entire element
    // (e.g. pure date-separator divs). Preserve bubbles with whitespace-only
    // message content so record counts stay consistent with bubble counts.
    const fullBubbleText = (bubble.innerText || bubble.textContent || '').trim();
    if (!fullBubbleText) continue;

    records.push({ sender, timestamp, content });
  }

  if (records.length === 0) {
    throw new Error('No messages found. Make sure a chat is open.');
  }

  return records;
}

/**
 * Normalizes a timestamp string to "YYYY-MM-DD HH:MM" format.
 * Returns null if the timestamp is empty or cannot be parsed.
 *
 * @param {string} timestamp - Raw timestamp string (ISO, locale string, etc.)
 * @returns {string|null} Normalized "YYYY-MM-DD HH:MM" string, or null
 */
function normalizeTimestamp(timestamp) {
  if (!timestamp) return null;

  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return null;

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

/**
 * Formats a single MessageRecord into a human-readable archive line.
 *
 * - If timestamp is "" or unparseable: "[unknown] Sender: Message"
 * - Otherwise: "[YYYY-MM-DD HH:MM] Sender: Message"
 *
 * @param {MessageRecord} record
 * @returns {string}
 */
function formatRecord(record) {
  const normalized = normalizeTimestamp(record.timestamp);
  const ts = normalized ? normalized : 'unknown';
  return `[${ts}] ${record.sender}: ${record.content}`;
}

/**
 * Removes duplicate MessageRecords using a composite key of sender, timestamp, and content.
 * Retains the first occurrence in DOM order; filters all subsequent duplicates.
 *
 * @param {MessageRecord[]} records
 * @returns {MessageRecord[]}
 */
function deduplicateRecords(records) {
  const seen = new Set();
  return records.filter(({ sender, timestamp, content }) => {
    const key = `${sender}|${timestamp}|${content}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Locates the scrollable chat container element.
 * Tries data-tid selectors first, then falls back to ARIA role selectors.
 *
 * @returns {Element}
 * @throws {Error} "Chat container not found. Make sure a chat is open."
 */
function findChatContainer() {
  const selectors = [
    '[data-tid="chat-messages-list"]',
    '[data-tid="message-pane"]',
    '[role="list"]',
    '[role="log"]',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }

  throw new Error('Chat container not found. Make sure a chat is open.');
}

/**
 * Incrementally scrolls the chat container to the top, waiting for Teams to
 * inject older message bubbles after each scroll, until the bubble count
 * stabilises or the hard time cap is reached.
 *
 * @param {object}   opts
 * @param {number}   [opts.loadTimeout=3000]   ms to wait for new bubbles per scroll step
 * @param {number}   [opts.maxTotalMs=120000]  hard cap on total loading time
 * @param {number}   [opts.pollInterval=200]   ms between DOM polls
 * @param {function} [opts.onProgress]         callback(loadedCount) — called after each batch
 * @returns {Promise<{ timedOut: boolean, elapsedSeconds: number }>}
 */
async function scrollLoadHistory(opts = {}) {
  const loadTimeout  = opts.loadTimeout  !== undefined ? opts.loadTimeout  : 3000;
  const maxTotalMs   = opts.maxTotalMs   !== undefined ? opts.maxTotalMs   : 120000;
  const pollInterval = opts.pollInterval !== undefined ? opts.pollInterval : 200;
  const onProgress   = typeof opts.onProgress === 'function' ? opts.onProgress : null;

  const chatContainer = findChatContainer();
  const startTime = Date.now();
  let timedOut = false;

  // Bubble selector — mirrors the primary selector used by extractMessages()
  const BUBBLE_SEL = '[data-tid="message-body"], [data-tid="chat-pane-message"], [data-tid="messageBody"], [data-tid="message-content"], [role="listitem"], [role="article"], [data-scroll-id]';

  function getBubbleCount() {
    // Count children of the container that match any bubble selector
    const all = chatContainer.querySelectorAll(BUBBLE_SEL);
    return all ? all.length : 0;
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  while (true) {
    // Check hard time cap before each iteration
    if (Date.now() - startTime >= maxTotalMs) {
      timedOut = true;
      break;
    }

    const baseline = getBubbleCount();
    // Record sentinel — first child bubble for virtualiser stability
    const bubbles = chatContainer.querySelectorAll(BUBBLE_SEL);
    const sentinel = bubbles && bubbles.length > 0 ? bubbles[0] : null;

    // Scroll to top to trigger loading of older messages
    chatContainer.scrollTop = 0;

    // Poll until count grows or loadTimeout elapses
    const stepStart = Date.now();
    let newCount = baseline;
    let countGrew = false;

    while (Date.now() - stepStart < loadTimeout) {
      await wait(pollInterval);
      newCount = getBubbleCount();
      if (newCount > baseline) {
        countGrew = true;
        break;
      }
    }

    // Check if sentinel was removed from DOM by the virtualiser
    if (sentinel && !chatContainer.contains(sentinel)) {
      console.warn('[scrollLoadHistory] Sentinel element was removed by the virtualised renderer; continuing with remaining DOM nodes.');
    }

    if (countGrew) {
      // New bubbles appeared — report progress and continue
      if (onProgress) onProgress(newCount);
      // Re-check hard time cap after the batch
      if (Date.now() - startTime >= maxTotalMs) {
        timedOut = true;
        break;
      }
    } else {
      // Count stable — history fully loaded
      timedOut = false;
      break;
    }
  }

  const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
  return { timedOut, elapsedSeconds };
}

/**
 * Entry point called by chrome.scripting.executeScript.
 * Extracts the chat name and all messages, formats them, and returns
 * a serializable result object.
 *
 * @returns {{ chatName: string, content: string }}
 */
function scrape() {
  const chatName = extractChatName();
  const records = extractMessages();
  const content = records.map(formatRecord).join('\n');
  return { chatName, content };
}

/**
 * Full-history entry point. Runs the scroll-loader then the scraper.
 * Returns the same { chatName, content } shape as scrape().
 *
 * @returns {Promise<{ chatName: string, content: string }>}
 */
async function scrapeFullHistory() {
  // Call via module.exports so tests can patch scrollLoadHistory
  const _scrollLoadHistory = (typeof module !== 'undefined' && module.exports && module.exports.scrollLoadHistory)
    ? module.exports.scrollLoadHistory
    : scrollLoadHistory;

  const { timedOut, elapsedSeconds } = await _scrollLoadHistory({
    onProgress(loaded) {
      try {
        chrome.runtime.sendMessage({ action: 'progress', loaded });
      } catch (_) {
        // swallow — popup may be closed
      }
    },
  });

  // Count bubbles currently in the DOM — try each selector individually
  const BUBBLE_SELECTORS = [
    '[data-tid="message-body"]',
    '[data-tid="chat-pane-message"]',
    '[data-tid="messageBody"]',
    '[data-tid="message-content"]',
    '[role="listitem"]',
    '[role="article"]',
    '[data-scroll-id]',
  ];
  let bubbleCount = 0;
  for (const sel of BUBBLE_SELECTORS) {
    const found = document.querySelectorAll(sel);
    if (found && found.length > 0) {
      bubbleCount = found.length;
      break;
    }
  }

  if (timedOut && bubbleCount === 0) {
    throw new Error('Chat history loading timed out before any messages were loaded.');
  }

  const chatName = extractChatName();
  const records = extractMessages();
  const deduped = deduplicateRecords(records);
  let content = deduped.map(formatRecord).join('\n');

  if (timedOut) {
    content = `[WARNING] Chat history may be incomplete — loading timed out after ${elapsedSeconds} seconds.\n` + content;
  }

  return { chatName, content };
}

// Allow Jest to import this file while still working as a plain injected script
if (typeof module !== 'undefined') module.exports = { sanitizeFilename, extractChatName, extractMessages, formatRecord, findChatContainer, deduplicateRecords, scrollLoadHistory, scrape, scrapeFullHistory };
