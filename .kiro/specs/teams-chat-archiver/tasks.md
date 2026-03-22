# Implementation Plan: TeamsChat Archiver Chrome Extension

## Overview

Implement a Manifest V3 Chrome Extension with five files: `manifest.json`, `background.js`, `scraper.js`, `popup.html`, and `popup.js`. Tasks progress from the manifest and core scraping logic through orchestration, UI, and finally wiring everything together. Tests are co-located with each component.

## Tasks

- [x] 1. Create manifest.json
  - Write the MV3 manifest with `manifest_version: 3`, `name`, `version`, and `description`
  - Add `"permissions": ["activeTab", "storage", "downloads", "scripting"]`
  - Add `"host_permissions": ["https://teams.microsoft.com/*"]`
  - Register `background.js` as the service worker under `"background": { "service_worker": "background.js" }`
  - Add `"action": { "default_popup": "popup.html" }`
  - Do NOT declare `scraper.js` in `content_scripts` — it is injected on demand
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 1.1 Write unit tests for manifest validation
    - Verify `manifest_version` equals `3`
    - Verify `permissions` array contains `activeTab`, `storage`, `downloads`, `scripting`
    - Verify `host_permissions` contains `https://teams.microsoft.com/*`
    - Verify `background.service_worker` equals `"background.js"`
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

- [x] 2. Implement `sanitizeFilename` in `scraper.js`
  - Create `scraper.js` with the `sanitizeFilename(name)` function
  - Replace `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|` with `_`
  - _Requirements: 2.3_

  - [x] 2.1 Write unit tests for `sanitizeFilename`
    - Test each invalid character is replaced with `_`
    - Test strings with no invalid characters are returned unchanged
    - _Requirements: 2.3_

  - [x] 2.2 Write property test for `sanitizeFilename` (P1)
    - `// Feature: teams-chat-archiver, Property 1: Chat Name Sanitization`
    - Use `fc.string()` to generate arbitrary strings
    - Assert sanitized output contains none of `/\:*?"<>|`
    - Assert all occurrences of those characters are replaced with `_`
    - Minimum 100 runs
    - **Property 1: Chat Name Sanitization**
    - **Validates: Requirements 2.3**

- [x] 3. Implement chat name extraction and message scraping in `scraper.js`
  - Implement `extractChatName()`: query `[data-tid]` header element first, fall back to ARIA label selectors, return `"teams-chat"` if nothing found
  - Implement `extractMessages()`: iterate all message bubble elements using `[data-tid]` selectors, fall back to `[role="listitem"]` ARIA selectors
  - For each bubble: extract sender via `data-tid`/ARIA, extract timestamp via `data-tid`/ARIA, extract plain-text content (strip HTML)
  - Carry forward the last known sender when a bubble has no sender element (consecutive messages)
  - Use `""` for timestamp when no parseable timestamp is found
  - Throw an error with message `"No messages found. Make sure a chat is open."` if no bubbles are found
  - Do not use CSS class name selectors anywhere
  - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 8.1, 8.2, 8.3, 8.4_

  - [x] 3.1 Write unit tests for `extractChatName`
    - Test returns correct name when `data-tid` element is present
    - Test returns `"teams-chat"` fallback when no element is found
    - _Requirements: 2.1, 2.2_

  - [x] 3.2 Write unit tests for `extractMessages`
    - Test sender carry-forward for consecutive messages
    - Test empty string timestamp when timestamp element is absent
    - Test throws when no message bubbles are found
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 8.4_

  - [x] 3.3 Write property test for message extraction completeness (P2)
    - `// Feature: teams-chat-archiver, Property 2: Message Extraction Completeness and Sender Continuity`
    - Use `fc.array(fc.record({hasSender: fc.boolean(), content: fc.string()}))` to generate mock DOM structures
    - Assert output array length equals number of input bubbles
    - Assert every record has a non-empty `sender` field
    - Minimum 100 runs
    - **Property 2: Message Extraction Completeness and Sender Continuity**
    - **Validates: Requirements 3.1, 3.2, 3.5**

  - [x] 3.4 Write property test for HTML stripping (P3)
    - `// Feature: teams-chat-archiver, Property 3: HTML Stripping`
    - Generate strings with random HTML tags injected into message content
    - Assert extracted `content` field contains no substrings matching `<[^>]*>`
    - Minimum 100 runs
    - **Property 3: HTML Stripping**
    - **Validates: Requirements 3.4**

  - [x] 3.5 Write property test for ARIA fallback (P8)
    - `// Feature: teams-chat-archiver, Property 8: DOM Resilience — ARIA Fallback`
    - Build mock DOM with ARIA attributes (`aria-label`, `role`) but no `data-tid` attributes
    - Assert scraper still returns a valid `chatName` and non-empty `MessageRecord` array
    - Minimum 100 runs
    - **Property 8: DOM Resilience — ARIA Fallback**
    - **Validates: Requirements 2.1, 8.2**

- [x] 4. Implement message formatting in `scraper.js`
  - Implement `formatRecord(record)`: normalize timestamp to `YYYY-MM-DD HH:MM`, produce `[YYYY-MM-DD HH:MM] Sender: Message`
  - When `record.timestamp` is `""`, produce `[unknown] Sender: Message`
  - Implement `scrape()` entry point: call `extractChatName()`, call `extractMessages()`, map records through `formatRecord()`, join with `\n`, return `{chatName, content}`
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 4.1 Write unit tests for `formatRecord`
    - Test known-timestamp record produces correct `[YYYY-MM-DD HH:MM] Sender: Message` string
    - Test empty-timestamp record produces `[unknown] Sender: Message`
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 4.2 Write property test for message formatting pattern (P4)
    - `// Feature: teams-chat-archiver, Property 4: Message Formatting Pattern`
    - Use `fc.record({sender: fc.string(), timestamp: fc.oneof(fc.constant(""), fc.string()), content: fc.string()})` 
    - Assert non-empty normalizable timestamps produce lines matching `/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] .+: /`
    - Assert empty timestamps produce lines matching `/^\[unknown\] .+: /`
    - Minimum 100 runs
    - **Property 4: Message Formatting Pattern**
    - **Validates: Requirements 4.1, 4.2, 4.3**

  - [x] 4.3 Write property test for output order and structure (P5)
    - `// Feature: teams-chat-archiver, Property 5: Output Order and Structure`
    - Use `fc.array(fc.record({sender: fc.string(), timestamp: fc.constant(""), content: fc.string()}))` 
    - Assert formatted lines in output appear in the same order as input records
    - Assert consecutive records are separated by exactly one `\n`
    - Minimum 100 runs
    - **Property 5: Output Order and Structure**
    - **Validates: Requirements 4.4, 4.5**

- [x] 5. Checkpoint — Ensure all scraper tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement `background.js` (service worker)
  - Create `background.js` with a `chrome.runtime.onMessage.addListener` handler
  - Implement `handleScrapeRequest(sendResponse)`: query the active tab, validate URL matches `https://teams.microsoft.com/*`, return `{error: "This extension only works on teams.microsoft.com"}` if not
  - Inject `scraper.js` via `chrome.scripting.executeScript({target: {tabId}, func: scrape})` and await the result
  - Wrap `executeScript` in try/catch; on exception return `{error: "Failed to run scraper: <message>"}`
  - Call `downloadArchive(chatName, content)` on success; return `{success: true}` to popup
  - Implement `downloadArchive(chatName, content)`: create a UTF-8 `Blob` with `type: "text/plain;charset=utf-8"`, create an object URL, call `chrome.downloads.download({url, filename: chatName + ".txt"})` without setting `conflictAction: "overwrite"`
  - Return `true` from the message listener to keep the channel open for async response
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4_

  - [x] 6.1 Write unit tests for `background.js` orchestration
    - Test `chrome.scripting.executeScript` is called with the active tab ID on a valid Teams URL
    - Test `{error: "This extension only works on teams.microsoft.com"}` returned for non-Teams tab
    - Test `{error: "Failed to run scraper: ..."}` returned when `executeScript` throws
    - Test `chrome.downloads.download` is called with correct arguments after successful scrape
    - Test Blob is created with `type: "text/plain;charset=utf-8"`
    - Test download options do not include `conflictAction: "overwrite"`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.1, 7.3, 7.4_

  - [x] 6.2 Write property test for non-Teams tab rejection (P6)
    - `// Feature: teams-chat-archiver, Property 6: Non-Teams Tab Rejection`
    - Use `fc.webUrl()` filtered to exclude `https://teams.microsoft.com/*`
    - Assert response always contains an `error` field and never a `success` field
    - Minimum 100 runs
    - **Property 6: Non-Teams Tab Rejection**
    - **Validates: Requirements 6.3**

  - [x] 6.3 Write property test for download filename pattern (P7)
    - `// Feature: teams-chat-archiver, Property 7: Download Filename Pattern`
    - Use `fc.string({minLength: 1})` filtered to alphanumeric-safe strings as sanitized chat names
    - Assert filename passed to `chrome.downloads.download` equals `chatName + ".txt"` exactly
    - Minimum 100 runs
    - **Property 7: Download Filename Pattern**
    - **Validates: Requirements 7.2**

- [x] 7. Implement `popup.html` and `popup.js`
  - Create `popup.html` with a `<button id="save-btn">Save Chat</button>` and `<p id="status"></p>`
  - Create `popup.js`: attach click handler to `#save-btn`
  - On click: disable `#save-btn`, set `#status` text to `"Saving…"`, send `{action: "scrape"}` via `chrome.runtime.sendMessage`
  - On success response (`response.success`): set `#status` to `"Saved successfully."`
  - On error response (`response.error`): set `#status` to the error message string
  - Re-enable `#save-btn` after either outcome
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 7.1 Write unit tests for `popup.js`
    - Test clicking `#save-btn` sends `{action: "scrape"}` to background
    - Test button is disabled and status shows `"Saving…"` while in progress
    - Test status shows `"Saved successfully."` on success response
    - Test status shows the error string on error response
    - Test button is re-enabled after completion
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 8. Set up Jest and fast-check test infrastructure
  - Initialize `package.json` with `jest` and `jest-chrome` and `fast-check` as dev dependencies
  - Configure Jest to use `jest-chrome` for Chrome API mocking (set up `globals` or `setupFiles`)
  - Create `__tests__/` directory with the five test files: `manifest.test.js`, `sanitize.test.js`, `scraper.test.js`, `background.test.js`, `popup.test.js`
  - Ensure test files import the modules under test and the `jest-chrome` mock setup
  - _Requirements: (testing infrastructure for all requirements)_

- [x] 9. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use fast-check with a minimum of 100 runs each (`{numRuns: 100}`)
- `scraper.js` is injected on demand — never declared in `content_scripts`
- No CSS class selectors anywhere in `scraper.js`
