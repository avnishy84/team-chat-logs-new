// Feature: teams-chat-archiver — background.js unit and property tests

const fc = require('fast-check');

// ─── Chrome API mock setup ────────────────────────────────────────────────────
// jest-chrome is not available as a setupFile here, so we manually mock the
// chrome global before requiring background.js.

let mockTabs = [];
let mockExecuteScriptResult = null;
let mockExecuteScriptError = null;
let mockDownloadId = 1;
let mockDownloadError = null;
let capturedDownloadArgs = null;
let mockLastError = null;

global.chrome = {
  runtime: {
    onMessage: {
      addListener: jest.fn(),
    },
    get lastError() {
      return mockLastError;
    },
  },
  tabs: {
    query: jest.fn((_opts, cb) => {
      if (cb) cb(mockTabs);
      return Promise.resolve(mockTabs);
    }),
    sendMessage: jest.fn(() => Promise.resolve()),
  },
  scripting: {
    executeScript: jest.fn(() => {
      if (mockExecuteScriptError) return Promise.reject(mockExecuteScriptError);
      return Promise.resolve(mockExecuteScriptResult);
    }),
  },
  downloads: {
    download: jest.fn((opts, cb) => {
      capturedDownloadArgs = opts;
      if (mockDownloadError) {
        mockLastError = { message: mockDownloadError };
      } else {
        mockLastError = null;
      }
      if (cb) cb(mockDownloadError ? undefined : mockDownloadId);
    }),
  },
};

// Provide a minimal Blob implementation for Node (not available in Node < 18 without flag)
if (typeof global.Blob === 'undefined') {
  global.Blob = class Blob {
    constructor(parts, opts = {}) {
      this._parts = parts;
      this.type = opts.type || '';
    }
  };
}

// Provide URL.createObjectURL stub
if (!global.URL) global.URL = {};
global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = jest.fn();

// ─── Module under test ────────────────────────────────────────────────────────

const { handleScrapeRequest, downloadArchive } = require('../background');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resetMocks() {
  mockTabs = [];
  mockExecuteScriptResult = null;
  mockExecuteScriptError = null;
  mockDownloadId = 1;
  mockDownloadError = null;
  capturedDownloadArgs = null;
  mockLastError = null;
  jest.clearAllMocks();
  // Re-attach stubs cleared by clearAllMocks
  global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
  global.URL.revokeObjectURL = jest.fn();
  global.chrome.tabs.query = jest.fn((_opts, cb) => {
    if (cb) cb(mockTabs);
    return Promise.resolve(mockTabs);
  });
  global.chrome.tabs.sendMessage = jest.fn(() => Promise.resolve());
  global.chrome.scripting.executeScript = jest.fn(() => {
    if (mockExecuteScriptError) return Promise.reject(mockExecuteScriptError);
    return Promise.resolve(mockExecuteScriptResult);
  });
  global.chrome.downloads.download = jest.fn((opts, cb) => {
    capturedDownloadArgs = opts;
    mockLastError = mockDownloadError ? { message: mockDownloadError } : null;
    if (cb) cb(mockDownloadError ? undefined : mockDownloadId);
  });
}

function makeTab(url, id = 42) {
  return { id, url };
}

function makeScriptResult(result) {
  return [{ result }];
}

// ─── Unit Tests: handleScrapeRequest ─────────────────────────────────────────

describe('handleScrapeRequest — unit tests', () => {
  beforeEach(resetMocks);

  test('calls executeScript with the active tab ID on a valid Teams URL', async () => {
    mockTabs = [makeTab('https://teams.microsoft.com/l/chat/123')];
    mockExecuteScriptResult = makeScriptResult({ chatName: 'Alice', content: 'Hello' });

    const sendResponse = jest.fn();
    await handleScrapeRequest(sendResponse);

    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 42 } })
    );
  });

  test('returns error for non-Teams tab URL', async () => {
    mockTabs = [makeTab('https://www.google.com/')];

    const sendResponse = jest.fn();
    await handleScrapeRequest(sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      error: 'This extension only works on teams.microsoft.com',
    });
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  test('returns error when no active tab is found', async () => {
    mockTabs = [];

    const sendResponse = jest.fn();
    await handleScrapeRequest(sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      error: 'This extension only works on teams.microsoft.com',
    });
  });

  test('returns descriptive error when executeScript throws', async () => {
    mockTabs = [makeTab('https://teams.microsoft.com/')];
    mockExecuteScriptError = new Error('Script injection failed');

    const sendResponse = jest.fn();
    await handleScrapeRequest(sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      error: 'Failed to run scraper: Script injection failed',
    });
  });

  test('calls chrome.downloads.download with correct arguments after successful scrape', async () => {
    mockTabs = [makeTab('https://teams.microsoft.com/')];
    mockExecuteScriptResult = makeScriptResult({ chatName: 'MyChat', content: 'Hello world' });

    const sendResponse = jest.fn();
    await handleScrapeRequest(sendResponse);

    expect(chrome.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'MyChat.txt' }),
      expect.any(Function)
    );
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  test('returns {success: true} to popup on successful scrape and download', async () => {
    mockTabs = [makeTab('https://teams.microsoft.com/')];
    mockExecuteScriptResult = makeScriptResult({ chatName: 'Chat', content: 'content' });

    const sendResponse = jest.fn();
    await handleScrapeRequest(sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  test('returns error when scraper result contains an error field', async () => {
    mockTabs = [makeTab('https://teams.microsoft.com/')];
    mockExecuteScriptResult = makeScriptResult({ error: 'No messages found.' });

    const sendResponse = jest.fn();
    await handleScrapeRequest(sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({ error: 'No messages found.' });
  });
});

// ─── Unit Tests: downloadArchive ─────────────────────────────────────────────

describe('downloadArchive — unit tests', () => {
  beforeEach(resetMocks);

  test('passes a data: URI with base64-encoded content to chrome.downloads.download', async () => {
    await downloadArchive('MyChat', 'some content');

    expect(capturedDownloadArgs).not.toBeNull();
    expect(capturedDownloadArgs.url).toMatch(/^data:text\/plain;charset=utf-8;base64,/);
  });

  test('filename passed to chrome.downloads.download is chatName + ".txt"', async () => {
    await downloadArchive('ProjectAlpha', 'content');

    expect(capturedDownloadArgs).toMatchObject({ filename: 'ProjectAlpha.txt' });
  });

  test('download options do NOT include conflictAction: "overwrite"', async () => {
    await downloadArchive('Chat', 'content');

    expect(capturedDownloadArgs.conflictAction).toBeUndefined();
  });

  test('data: URI encodes the content correctly', async () => {
    await downloadArchive('Chat', 'content');

    // btoa(unescape(encodeURIComponent('content'))) === 'Y29udGVudA=='
    expect(capturedDownloadArgs.url).toBe('data:text/plain;charset=utf-8;base64,Y29udGVudA==');
  });
});

// ─── Property Test P6: Non-Teams Tab Rejection ───────────────────────────────
// Feature: teams-chat-archiver, Property 6: Non-Teams Tab Rejection
// Validates: Requirements 6.3

describe('P6: Non-Teams Tab Rejection', () => {
  beforeEach(resetMocks);

  test('any non-Teams URL always returns an error response, never success', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate URLs that are NOT teams.microsoft.com
        fc.webUrl().filter(url => !url.startsWith('https://teams.microsoft.com/')),
        async (url) => {
          resetMocks();
          mockTabs = [makeTab(url)];

          let response;
          const sendResponse = (r) => { response = r; };
          await handleScrapeRequest(sendResponse);

          return (
            response !== undefined &&
            'error' in response &&
            !('success' in response)
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property Test P7: Download Filename Pattern ─────────────────────────────
// Feature: teams-chat-archiver, Property 7: Download Filename Pattern
// Validates: Requirements 7.2

describe('P7: Download Filename Pattern', () => {
  beforeEach(resetMocks);

  test('filename passed to chrome.downloads.download is always chatName + ".txt"', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Alphanumeric-safe sanitized chat names (no special chars)
        fc.stringMatching(/^[A-Za-z0-9_\- ]{1,50}$/),
        async (chatName) => {
          resetMocks();
          await downloadArchive(chatName, 'some content');
          return capturedDownloadArgs && capturedDownloadArgs.filename === chatName + '.txt';
        }
      ),
      { numRuns: 100 }
    );
  });
});
