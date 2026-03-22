# Requirements Document

## Introduction

TeamsChat Archiver is a Chrome Extension (Manifest V3) that enables users to archive Microsoft Teams chat conversations as plain-text files. The extension scrapes the currently visible chat thread from the Teams web application, formats messages chronologically with sender names and timestamps, and saves the result as a `.txt` file named after the active conversation. The tool targets productivity users who need a lightweight, local record of their Teams conversations without relying on Microsoft's export APIs.

## Glossary

- **Extension**: The TeamsChat Archiver Chrome Extension built with Manifest V3.
- **Content_Script**: The JavaScript file injected into the Teams web page that performs DOM scraping.
- **Background_Service_Worker**: The Manifest V3 service worker that coordinates messaging between the popup and content script.
- **Popup**: The browser action popup UI presented when the user clicks the extension icon.
- **Scraper**: The logic within the Content_Script responsible for extracting chat data from the DOM.
- **Chat_Name**: The title of the currently active Teams conversation (individual contact name or group name).
- **Message_Record**: A single extracted unit containing sender name, timestamp, and message content.
- **Archive_File**: The `.txt` output file containing the formatted chat history.
- **Teams_Page**: The Microsoft Teams web application running at `https://teams.microsoft.com`.
- **Download_Manager**: The Chrome `downloads` API used to save the Archive_File to the user's local file system.

---

## Requirements

### Requirement 1: Extension Manifest and Permissions

**User Story:** As a developer loading the extension unpacked, I want the manifest to declare all necessary permissions and host access, so that the extension can inject scripts and save files without runtime errors.

#### Acceptance Criteria

1. THE Extension SHALL use Manifest Version 3.
2. THE Extension SHALL declare the `activeTab`, `storage`, `downloads`, and `scripting` permissions in the manifest.
3. THE Extension SHALL declare `https://teams.microsoft.com/*` as a host permission in the manifest.
4. THE Extension SHALL register the Content_Script to run on `https://teams.microsoft.com/*` pages.
5. THE Extension SHALL register the Background_Service_Worker in the manifest.

---

### Requirement 2: Chat Name Extraction

**User Story:** As a user archiving a conversation, I want the extension to automatically detect the name of the current chat, so that the saved file is named correctly without manual input.

#### Acceptance Criteria

1. WHEN the Scraper runs, THE Content_Script SHALL extract the Chat_Name from the Teams conversation header using `data-tid` attributes or ARIA labels present in the Teams DOM.
2. IF the Chat_Name cannot be found in the DOM, THEN THE Content_Script SHALL return a fallback Chat_Name value of `"teams-chat"`.
3. THE Content_Script SHALL sanitize the Chat_Name by replacing characters that are invalid in file names (e.g., `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`) with an underscore character.

---

### Requirement 3: Message Extraction

**User Story:** As a user, I want the extension to extract all visible messages from the current chat thread, so that I get a complete record of the conversation shown on screen.

#### Acceptance Criteria

1. WHEN the Scraper runs, THE Content_Script SHALL iterate over all message bubble elements visible in the Teams chat container.
2. FOR each message bubble, THE Content_Script SHALL extract the sender name using `data-tid` attributes or ARIA labels.
3. FOR each message bubble, THE Content_Script SHALL extract the timestamp using `data-tid` attributes or ARIA labels.
4. FOR each message bubble, THE Content_Script SHALL extract the plain-text message content, stripping any HTML markup.
5. WHEN a message bubble does not contain a visible sender name (e.g., consecutive messages from the same sender), THE Content_Script SHALL reuse the sender name from the most recently extracted Message_Record.
6. WHEN a message bubble does not contain a parseable timestamp, THE Content_Script SHALL use an empty string for the timestamp field of that Message_Record.

---

### Requirement 4: Message Formatting

**User Story:** As a user reading the archive file, I want messages formatted consistently with timestamps and sender names, so that the chat history is easy to read.

#### Acceptance Criteria

1. THE Content_Script SHALL format each Message_Record using the pattern: `[YYYY-MM-DD HH:MM] Sender: Message`.
2. THE Content_Script SHALL normalize all extracted timestamps to the `YYYY-MM-DD HH:MM` format before formatting.
3. WHEN a Message_Record has an empty timestamp, THE Content_Script SHALL format the entry as `[unknown] Sender: Message`.
4. THE Content_Script SHALL join all formatted Message_Records with a newline character to produce the Archive_File content.
5. THE Content_Script SHALL output Message_Records in the chronological order they appear in the DOM.

---

### Requirement 5: Popup User Interface

**User Story:** As a user, I want a simple popup with a "Save Chat" button, so that I can trigger the archive with a single click.

#### Acceptance Criteria

1. THE Popup SHALL display a "Save Chat" button that is visible and interactive when the extension icon is clicked on a Teams_Page.
2. WHEN the user clicks the "Save Chat" button, THE Popup SHALL send a message to the Background_Service_Worker to initiate the scraping workflow.
3. WHILE the scraping and download workflow is in progress, THE Popup SHALL display a status indicator communicating that the operation is running.
4. WHEN the scraping and download workflow completes successfully, THE Popup SHALL display a confirmation message to the user.
5. IF the scraping workflow returns an error, THEN THE Popup SHALL display a descriptive error message to the user.

---

### Requirement 6: Scraping Orchestration

**User Story:** As a developer, I want the background service worker to coordinate between the popup and the content script, so that the scraping and download flow is reliable.

#### Acceptance Criteria

1. WHEN the Background_Service_Worker receives a scrape request from the Popup, THE Background_Service_Worker SHALL use the `scripting` API to execute the Content_Script in the active tab.
2. WHEN the Content_Script returns extracted data, THE Background_Service_Worker SHALL pass the Chat_Name and formatted content to the Download_Manager.
3. IF the active tab is not a Teams_Page, THEN THE Background_Service_Worker SHALL return an error message to the Popup indicating the extension only works on `teams.microsoft.com`.
4. IF the Content_Script execution throws an exception, THEN THE Background_Service_Worker SHALL return a descriptive error message to the Popup.

---

### Requirement 7: File Download

**User Story:** As a user, I want the archive to be saved automatically to my downloads folder, so that I don't have to copy-paste content manually.

#### Acceptance Criteria

1. WHEN the Download_Manager receives the Archive_File content and Chat_Name, THE Extension SHALL use the `chrome.downloads` API to save the file.
2. THE Extension SHALL name the Archive_File using the sanitized Chat_Name with a `.txt` extension, following the pattern `{Chat_Name}.txt`.
3. THE Extension SHALL encode the Archive_File content as a UTF-8 Blob before passing it to the `chrome.downloads` API.
4. WHEN a file with the same name already exists in the downloads folder, THE Extension SHALL allow the browser's default download behavior to handle the naming conflict (e.g., appending a counter suffix).

---

### Requirement 8: DOM Resilience

**User Story:** As a user, I want the extension to keep working even when Microsoft updates the Teams UI, so that I don't lose functionality after Teams updates.

#### Acceptance Criteria

1. THE Content_Script SHALL use `data-tid` attribute selectors as the primary strategy for locating chat elements.
2. WHERE `data-tid` selectors are unavailable, THE Content_Script SHALL fall back to ARIA label selectors (`aria-label`, `role`) to locate chat elements.
3. THE Content_Script SHALL not rely on obfuscated or minified CSS class names as primary selectors.
4. IF no message bubbles are found using any selector strategy, THEN THE Content_Script SHALL return an error indicating that no messages were detected, rather than saving an empty file.
