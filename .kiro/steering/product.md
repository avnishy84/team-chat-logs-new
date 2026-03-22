# TeamsChat Archiver

A Chrome Extension (Manifest V3) that lets users archive Microsoft Teams chat conversations as plain-text `.txt` files.

## Core Functionality
- User clicks "Save Chat" in the extension popup while a Teams chat is open
- The extension scrolls back through the full chat history to load all messages
- Messages are extracted, deduplicated, formatted, and downloaded as `{chatName}.txt`

## Supported Hosts
- `https://teams.microsoft.com/`
- `https://teams.cloud.microsoft/`

## Output Format
Each line: `[YYYY-MM-DD HH:MM] Sender: Message content`
Unknown timestamps render as `[unknown]`.
