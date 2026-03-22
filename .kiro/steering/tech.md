# Tech Stack

## Runtime
- Chrome Extension, Manifest V3
- Vanilla JavaScript (no bundler, no transpiler)
- Service worker for background (`background.js`)
- Content script injected on demand via `chrome.scripting.executeScript`

## Testing
- **Jest** v27 (`testEnvironment: "node"`)
- **fast-check** v3 for property-based testing (PBT)
- **jest-chrome** available as a dev dependency for Chrome API mocking
- Tests live in `__tests__/`
- Chrome APIs are manually mocked in test files (global `chrome` object)
- DOM is shimmed with lightweight `MockDocument`/`MockElement` classes — no jsdom

## Build
- Custom Node.js build script (`build.js`) — no webpack/rollup
- Copies extension files to `dist/unpacked/` and zips to `dist/teams-chat-archiver.zip`
- Uses PowerShell `Compress-Archive` on Windows, `zip` on Unix

## Common Commands

```bash
# Run tests (single pass, no watch)
npm test

# Build the extension zip
npm run build
```

## Dependencies
All dependencies are `devDependencies` — the extension itself has no npm runtime dependencies.
