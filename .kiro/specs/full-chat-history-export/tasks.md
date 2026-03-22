# Implementation Plan: full-chat-history-export

## Overview

Implement incremental scroll-to-top loading in `scraper.js`, wire it into `background.js`, add live
progress display to `popup.js`, and cover all correctness properties with property-based tests in
`__tests__/full-history.test.js`.

## Tasks

- [x] 1. Implement `findChatContainer` in scraper.js
  - Add `findChatContainer()` that tries selectors in order:
    `[data-tid="chat-messages-list"]`, `[data-tid="message-pane"]`, `[role="list"]`, `[role="log"]`
  - Throw `"Chat container not found. Make sure a chat is open."` when no selector matches
  - _Requirements: 1.1, 1.2, 1.3_

  - [x] 1.1 Write property test for `findChatContainer` — data-tid / ARIA fallback (Property 1)
    - **Property 1: Container detection — data-tid primary, ARIA fallback**
    - **Validates: Requirements 1.1, 1.2**

  - [x] 1.2 Write property test for `findChatContainer` — no match throws exact message (Property 2)
    - **Property 2: Container not found throws exact message**
    - **Validates: Requirements 1.3**

- [x] 2. Implement `deduplicateRecords` in scraper.js
  - Add `deduplicateRecords(records)` using a `Set` of composite keys `sender|timestamp|content`
  - Retain first occurrence in DOM order; filter subsequent duplicates
  - _Requirements: 7.1, 7.2, 7.3_

  - [x] 2.1 Write property test for deduplication — unique keys, first occurrence retained (Property 8)
    - **Property 8: Deduplication retains first occurrence and removes all duplicates**
    - **Validates: Requirements 7.1, 7.2**

  - [x] 2.2 Write property test for deduplication — idempotent (Property 9)
    - **Property 9: Deduplication is idempotent**
    - **Validates: Requirements 7.3**

- [x] 3. Implement `scrollLoadHistory` in scraper.js
  - Add `async scrollLoadHistory(opts = {})` with defaults `loadTimeout=3000`, `maxTotalMs=120000`,
    `pollInterval=200`
  - Each iteration: record baseline bubble count, set `scrollTop = 0`, poll every `pollInterval` ms
  - Advance when count grows; break when count is stable within `loadTimeout`; set `timedOut: true`
    when `maxTotalMs` exceeded
  - Call `opts.onProgress(newCount)` after each batch; log warning if sentinel is removed
  - Return `{ timedOut, elapsedSeconds }`
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 6.1, 6.2_

  - [x] 3.1 Write property test — scroll loop continues while new bubbles appear (Property 3)
    - **Property 3: Scroll loop continues while new bubbles keep appearing**
    - **Validates: Requirements 2.1, 2.2, 2.3, 3.3**

  - [x] 3.2 Write property test — scroll loop exits when bubble count is stable (Property 4)
    - **Property 4: Scroll loop exits when bubble count is stable**
    - **Validates: Requirements 2.3, 3.4**

  - [x] 3.3 Write property test — onProgress receives strictly increasing counts (Property 5)
    - **Property 5: Progress callback receives strictly increasing counts**
    - **Validates: Requirements 5.2**

- [x] 4. Checkpoint — ensure unit tests for `findChatContainer`, `deduplicateRecords`, and `scrollLoadHistory` pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement `scrapeFullHistory` in scraper.js
  - Add `async scrapeFullHistory()` that:
    1. Calls `scrollLoadHistory({ onProgress })` where `onProgress` sends
       `chrome.runtime.sendMessage({ action: "progress", loaded: N })`; swallow send errors
    2. Throws if `timedOut` and zero bubbles loaded
    3. Calls `extractChatName()` and `extractMessages()`
    4. Calls `deduplicateRecords(records)`
    5. Prepends warning line when `timedOut` with ≥1 bubble
    6. Returns `{ chatName, content }` — same shape as `scrape()`
  - Leave existing `scrape()` function completely unchanged
  - _Requirements: 5.1, 6.3, 6.4, 7.3, 8.1, 8.2, 8.4_

  - [x] 5.1 Write property test — timeout warning prepended when partial export (Property 6)
    - **Property 6: Timeout warning is prepended when loading times out with messages present**
    - **Validates: Requirements 6.2, 6.3**

  - [x] 5.2 Write property test — zero-bubble timeout throws (Property 7)
    - **Property 7: Zero-bubble timeout throws instead of saving**
    - **Validates: Requirements 6.4**

  - [x] 5.3 Write property test — result shape matches scrape() (Property 10)
    - **Property 10: scrapeFullHistory returns the same { chatName, content } shape as scrape()**
    - **Validates: Requirements 8.1, 8.4**

  - [x] 5.4 Write property test — scrape() is unaffected by new code (Property 11)
    - **Property 11: scrape() is unaffected by the new code**
    - **Validates: Requirements 8.2**

- [x] 6. Update background.js to call `scrapeFullHistory` and relay progress
  - Replace the `scrape()` call in `handleScrapeRequest` with `scrapeFullHistory()`
  - Register a `chrome.runtime.onMessage` listener for `{ action: "progress" }` and forward to the
    popup tab via `chrome.tabs.sendMessage`
  - Send `{ action: "done", success: true }` (or `{ action: "done", error }`) to the popup after
    the download completes
  - _Requirements: 5.2, 5.3, 5.4, 8.3_

- [x] 7. Update popup.js to display live progress
  - Register a `chrome.runtime.onMessage` listener on `DOMContentLoaded`
  - Update `#status` text when `{ action: "progress", loaded: N }` is received
  - Handle `{ action: "done" }` to show final status and re-enable the save button
  - _Requirements: 5.1, 5.3, 5.4_

- [x] 8. Final checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- All property tests go in `__tests__/full-history.test.js` using fast-check (already configured)
- Each property test must include a comment referencing its design property number
- `scrape()` must remain untouched throughout — verified by Property 11
