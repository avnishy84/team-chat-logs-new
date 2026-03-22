# Requirements Document

## Introduction

The full-chat-history-export feature extends the TeamsChat Archiver Chrome Extension to capture the complete conversation history rather than only the messages currently visible in the viewport. Microsoft Teams renders chat messages using a virtualized list — only a subset of messages are present in the DOM at any given time. To export the full history, the extension must programmatically scroll the chat container to the top, wait for older messages to load, and continue until the entire conversation is present in the DOM before extracting and saving the archive.

## Glossary

- **Extension**: The TeamsChat Archiver Chrome Extension built with Manifest V3.
- **Content_Script**: The JavaScript file (`scraper.js`) injected into the Teams web page that performs DOM scraping.
- **Background_Service_Worker**: The Manifest V3 service worker (`background.js`) that coordinates messaging between the Popup and Content_Script.
- **Popup**: The browser action popup UI presented when the user clicks the extension icon.
- **Scraper**: The logic within the Content_Script responsible for extracting chat data from the DOM.
- **Scroll_Loader**: The component within the Content_Script responsible for scrolling the chat container and waiting for new messages to load.
- **Chat_Container**: The scrollable DOM element in the Teams web application that holds the virtualized message list.
- **Message_Bubble**: A single DOM element representing one chat message within the Chat_Container.
- **Message_Record**: A single extracted unit containing sender name, timestamp, and message content.
- **Archive_File**: The `.txt` output file containing the formatted full chat history.
- **Chat_Name**: The title of the currently active Teams conversation.
- **Download_Manager**: The Chrome `downloads` API used to save the Archive_File to the user's local file system.
- **Sentinel_Element**: A DOM element used as a stable reference point to detect when new messages have been injected above the current scroll position.
- **Load_Timeout**: The maximum time the Scroll_Loader will wait for new messages to appear after a scroll action before concluding that no more messages exist.
- **Teams_Page**: The Microsoft Teams web application running at `https://teams.cloud.microsoft` or `https://teams.microsoft.com`.

---

## Requirements

### Requirement 1: Chat Container Detection

**User Story:** As a developer, I want the Scroll_Loader to reliably locate the scrollable chat container, so that scroll operations target the correct element.

#### Acceptance Criteria

1. WHEN the Scroll_Loader runs, THE Content_Script SHALL locate the Chat_Container using `data-tid` attribute selectors as the primary strategy.
2. WHERE `data-tid` selectors are unavailable, THE Content_Script SHALL fall back to ARIA role selectors (e.g., `role="list"`, `role="log"`) to locate the Chat_Container.
3. IF the Chat_Container cannot be found using any selector strategy, THEN THE Content_Script SHALL throw an error with the message `"Chat container not found. Make sure a chat is open."`.

---

### Requirement 2: Incremental Scroll-to-Top Loading

**User Story:** As a user, I want the extension to automatically scroll through the entire chat history before exporting, so that the saved file contains all messages and not just the ones visible on screen.

#### Acceptance Criteria

1. WHEN the full-history export is triggered, THE Scroll_Loader SHALL scroll the Chat_Container to the top of its scroll position.
2. AFTER each scroll action, THE Scroll_Loader SHALL wait for the Teams application to inject new Message_Bubbles into the DOM before scrolling again.
3. THE Scroll_Loader SHALL repeat the scroll-and-wait cycle until no new Message_Bubbles are injected within the Load_Timeout period.
4. WHEN the scroll-and-wait cycle completes, THE Scroll_Loader SHALL signal the Scraper to begin message extraction.
5. THE Scroll_Loader SHALL preserve the DOM order of Message_Bubbles so that the Scraper processes messages in chronological order.

---

### Requirement 3: New-Message Detection

**User Story:** As a developer, I want the Scroll_Loader to detect when Teams has finished loading a batch of older messages, so that the scroll loop advances only after new content is available.

#### Acceptance Criteria

1. BEFORE each scroll action, THE Scroll_Loader SHALL record the count of Message_Bubbles currently present in the Chat_Container as a baseline.
2. AFTER each scroll action, THE Scroll_Loader SHALL poll the DOM at intervals of no more than 200 ms to detect an increase in the Message_Bubble count above the baseline.
3. WHEN the Message_Bubble count exceeds the baseline, THE Scroll_Loader SHALL treat the batch as loaded and proceed to the next scroll action.
4. WHEN the Message_Bubble count does not exceed the baseline within the Load_Timeout period, THE Scroll_Loader SHALL treat the history as fully loaded and exit the scroll loop.
5. THE Load_Timeout SHALL be configurable and SHALL default to 3000 ms.

---

### Requirement 4: Scroll Position Stability

**User Story:** As a developer, I want the Scroll_Loader to maintain a stable reference point during scrolling, so that Teams' virtualized list does not discard already-loaded messages before they are extracted.

#### Acceptance Criteria

1. AFTER each batch of messages is loaded, THE Scroll_Loader SHALL record a Sentinel_Element (the topmost visible Message_Bubble) before issuing the next scroll action.
2. WHEN the next scroll action is issued, THE Scroll_Loader SHALL scroll to bring the Sentinel_Element back into view, preventing the virtualized renderer from recycling already-loaded DOM nodes.
3. IF the Sentinel_Element is removed from the DOM by the virtualized renderer before extraction completes, THEN THE Content_Script SHALL log a warning and continue extraction with the messages still present in the DOM.

---

### Requirement 5: Progress Feedback During Loading

**User Story:** As a user, I want to see progress while the extension loads the full chat history, so that I know the operation is running and have an indication of how much has been loaded.

#### Acceptance Criteria

1. WHILE the Scroll_Loader is running, THE Popup SHALL display a progress message indicating that chat history is being loaded.
2. THE Background_Service_Worker SHALL relay Message_Bubble count updates from the Content_Script to the Popup at intervals of no more than 1000 ms.
3. WHEN the Scroll_Loader completes, THE Background_Service_Worker SHALL send a final status update to the Popup before initiating the download.
4. IF the user closes the Popup while loading is in progress, THE Content_Script SHALL continue loading and downloading in the background without interruption.

---

### Requirement 6: Timeout and Partial-Export Handling

**User Story:** As a user, I want the extension to save whatever history it has loaded if the loading process stalls, so that I don't lose already-loaded messages due to a network or rendering delay.

#### Acceptance Criteria

1. THE Scroll_Loader SHALL enforce a maximum total loading duration of 120 seconds across all scroll iterations.
2. WHEN the maximum total loading duration is exceeded, THE Content_Script SHALL stop the scroll loop and proceed with extraction of the messages loaded so far.
3. WHEN extraction proceeds after a timeout, THE Content_Script SHALL prepend a warning line to the Archive_File content in the format: `[WARNING] Chat history may be incomplete — loading timed out after {elapsed} seconds.`
4. IF the Content_Script has loaded zero Message_Bubbles when the timeout is reached, THEN THE Content_Script SHALL throw an error rather than saving an empty file.

---

### Requirement 7: Deduplication of Message Records

**User Story:** As a developer, I want the Scraper to deduplicate messages that appear in the DOM multiple times due to virtualized rendering, so that the Archive_File does not contain duplicate entries.

#### Acceptance Criteria

1. WHEN the Scraper processes Message_Bubbles after full history loading, THE Scraper SHALL deduplicate Message_Records using a composite key of sender, timestamp, and content.
2. WHEN duplicate Message_Records are detected, THE Scraper SHALL retain only the first occurrence in DOM order.
3. THE Scraper SHALL perform deduplication after all Message_Bubbles have been collected and before formatting the Archive_File content.

---

### Requirement 8: Backward Compatibility with Viewport-Only Export

**User Story:** As a developer, I want the existing scrape() function to remain callable without triggering the full scroll-load cycle, so that existing tests and any callers that rely on the current behavior are not broken.

#### Acceptance Criteria

1. THE Content_Script SHALL expose a new entry-point function named `scrapeFullHistory()` that executes the Scroll_Loader before calling the Scraper.
2. THE existing `scrape()` function SHALL remain unchanged and SHALL NOT invoke the Scroll_Loader.
3. THE Background_Service_Worker SHALL call `scrapeFullHistory()` instead of `scrape()` when the user clicks "Save Chat".
4. WHEN `scrapeFullHistory()` is called, THE Content_Script SHALL return the same `{ chatName, content }` shape as `scrape()` so that the Background_Service_Worker and Download_Manager require no structural changes.
