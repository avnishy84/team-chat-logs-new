/**
 * @jest-environment jsdom
 */
// Feature: teams-chat-archiver — popup.js unit tests

const { init, handleSaveClick, registerProgressListener } = require('../popup');

// ─── Chrome API mock ──────────────────────────────────────────────────────────

let mockSendMessageCallback = null;
let onMessageListeners = [];

global.chrome = {
  runtime: {
    sendMessage: jest.fn((message, callback) => {
      mockSendMessageCallback = callback;
    }),
    onMessage: {
      addListener: jest.fn((fn) => {
        onMessageListeners.push(fn);
      }),
    },
  },
};

function simulateMessage(msg) {
  onMessageListeners.forEach((fn) => fn(msg));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupDOM() {
  document.body.innerHTML = `
    <button id="save-btn">Save Chat</button>
    <p id="status"></p>
  `;
  mockSendMessageCallback = null;
  onMessageListeners = [];
  jest.clearAllMocks();
  global.chrome.runtime.sendMessage = jest.fn((message, callback) => {
    mockSendMessageCallback = callback;
  });
  global.chrome.runtime.onMessage.addListener = jest.fn((fn) => {
    onMessageListeners.push(fn);
  });
}

// ─── Unit Tests ───────────────────────────────────────────────────────────────

describe('popup.js — unit tests', () => {
  beforeEach(setupDOM);

  test('clicking #save-btn sends {action: "scrape"} to background', () => {
    init(document);
    document.getElementById('save-btn').click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: 'scrape' },
      expect.any(Function)
    );
  });

  test('button is disabled and status shows "Saving…" while in progress', () => {
    init(document);
    document.getElementById('save-btn').click();

    const btn = document.getElementById('save-btn');
    const status = document.getElementById('status');

    expect(btn.disabled).toBe(true);
    expect(status.textContent).toBe('Saving\u2026');
  });

  test('status shows "Saved successfully." on success response', () => {
    init(document);
    document.getElementById('save-btn').click();

    // Simulate background responding with success
    mockSendMessageCallback({ success: true });

    expect(document.getElementById('status').textContent).toBe('Saved successfully.');
  });

  test('status shows the error string on error response', () => {
    init(document);
    document.getElementById('save-btn').click();

    mockSendMessageCallback({ error: 'No messages found. Make sure a chat is open.' });

    expect(document.getElementById('status').textContent).toBe(
      'No messages found. Make sure a chat is open.'
    );
  });

  test('button is re-enabled after success response', () => {
    init(document);
    document.getElementById('save-btn').click();

    expect(document.getElementById('save-btn').disabled).toBe(true);
    mockSendMessageCallback({ success: true });
    expect(document.getElementById('save-btn').disabled).toBe(false);
  });

  test('button is re-enabled after error response', () => {
    init(document);
    document.getElementById('save-btn').click();

    expect(document.getElementById('save-btn').disabled).toBe(true);
    mockSendMessageCallback({ error: 'Something went wrong.' });
    expect(document.getElementById('save-btn').disabled).toBe(false);
  });
});

// ─── Progress listener tests ──────────────────────────────────────────────────

describe('popup.js — progress listener', () => {
  beforeEach(setupDOM);

  test('init registers a chrome.runtime.onMessage listener', () => {
    init(document);
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledWith(expect.any(Function));
  });

  test('progress message updates #status with loaded count', () => {
    init(document);
    simulateMessage({ action: 'progress', loaded: 42 });
    expect(document.getElementById('status').textContent).toBe('Loading\u2026 42 messages loaded');
  });

  test('progress message updates #status with each new count', () => {
    init(document);
    simulateMessage({ action: 'progress', loaded: 10 });
    expect(document.getElementById('status').textContent).toBe('Loading\u2026 10 messages loaded');
    simulateMessage({ action: 'progress', loaded: 25 });
    expect(document.getElementById('status').textContent).toBe('Loading\u2026 25 messages loaded');
  });

  test('done message with success shows "Chat saved successfully!" and re-enables button', () => {
    init(document);
    document.getElementById('save-btn').disabled = true;
    simulateMessage({ action: 'done', success: true });
    expect(document.getElementById('status').textContent).toBe('Chat saved successfully!');
    expect(document.getElementById('save-btn').disabled).toBe(false);
  });

  test('done message with error shows the error and re-enables button', () => {
    init(document);
    document.getElementById('save-btn').disabled = true;
    simulateMessage({ action: 'done', error: 'Something went wrong.' });
    expect(document.getElementById('status').textContent).toBe('Something went wrong.');
    expect(document.getElementById('save-btn').disabled).toBe(false);
  });
});
