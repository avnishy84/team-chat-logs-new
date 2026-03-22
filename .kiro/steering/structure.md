# Project Structure

```
/
├── manifest.json        # Chrome Extension manifest (MV3)
├── background.js        # Service worker — handles scrape requests, downloads
├── scraper.js           # Content script — DOM extraction, scroll loader, formatter
├── popup.html           # Extension popup UI
├── popup.js             # Popup logic — button handler, progress listener
├── build.js             # Build script — copies files, creates dist zip
├── package.json
├── __tests__/           # Jest test suite
│   ├── background.test.js
│   ├── scraper.test.js
│   ├── popup.test.js
│   ├── full-history.test.js
│   ├── sanitize.test.js
│   └── manifest.test.js
└── dist/                # Build output (gitignored)
    ├── unpacked/        # Loose extension files for local loading
    └── teams-chat-archiver.zip
```

## Key Conventions

- **No modules in extension files** — `background.js`, `scraper.js`, and `popup.js` use a `typeof module !== 'undefined'` guard to dual-export for Jest while remaining plain scripts in the browser
- **Selector strategy** — DOM queries always try `data-tid` attributes first, then fall back to ARIA roles/labels; never rely on class names or tag structure alone
- **Error messages** — user-facing errors use the exact string `'No messages found. Make sure a chat is open.'` and `'Chat container not found. Make sure a chat is open.'`
- **Test isolation** — each test file sets up its own Chrome API mocks; `global.document` is set/deleted per test using `afterEach`
- **Property tests** use `fc.assert` + `fc.property` from fast-check with `{ numRuns: 100 }` as the standard run count
