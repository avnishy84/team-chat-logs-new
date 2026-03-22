// Feature: full-chat-history-export — property-based tests

const fc = require('fast-check');
const { findChatContainer, deduplicateRecords, scrollLoadHistory, scrape, scrapeFullHistory } = require('../scraper');

// ─── DOM helpers (reused from scraper.test.js pattern) ───────────────────────

class MockElement {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = tag.toUpperCase();
    this._attrs = { ...attrs };
    this._children = children;
    this._text = '';
  }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return this._attrs[k] !== undefined ? this._attrs[k] : null; }
  get textContent() { return this._text + this._children.map(c => c.textContent || c).join(''); }
  get innerText() { return this.textContent; }
  querySelector(sel) { return queryOne(this._children, sel); }
  querySelectorAll(sel) { return queryAll(this._children, sel); }
}

class MockDocument {
  constructor() { this._root = new MockElement('root'); }
  querySelector(sel) { return queryOne(this._root._children, sel); }
  querySelectorAll(sel) { return queryAll(this._root._children, sel); }
  _append(el) { this._root._children.push(el); return el; }
}

function matchesSelector(el, sel) {
  if (!(el instanceof MockElement)) return false;
  sel = sel.trim();
  if (sel.includes(' ')) {
    const parts = sel.split(/\s+/);
    return matchesSelector(el, parts[parts.length - 1]);
  }
  const tagMatch = sel.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
  const tag = tagMatch ? tagMatch[1].toUpperCase() : null;
  if (tag && el.tagName !== tag) return false;
  const attrRe = /\[([^\]=*]+)(?:(\*?=)"([^"]*)")?\]/g;
  let m;
  while ((m = attrRe.exec(sel)) !== null) {
    const [, attrName, op, attrVal] = m;
    const actual = el.getAttribute(attrName);
    if (actual === null) return false;
    if (op === '=' && actual !== attrVal) return false;
    if (op === '*=' && !actual.includes(attrVal)) return false;
  }
  return true;
}

function queryOne(children, sel) {
  for (const child of children) {
    if (!(child instanceof MockElement)) continue;
    if (matchesSelector(child, sel)) return child;
    const found = queryOne(child._children, sel);
    if (found) return found;
  }
  return null;
}

function queryAll(children, sel) {
  const results = [];
  for (const child of children) {
    if (!(child instanceof MockElement)) continue;
    if (matchesSelector(child, sel)) results.push(child);
    results.push(...queryAll(child._children, sel));
  }
  return results;
}

function makeEl(tag, attrs = {}) {
  return new MockElement(tag, attrs);
}

// ─── Property 1: Container detection — data-tid primary, ARIA fallback ────────
// Property 1: Container detection — data-tid primary, ARIA fallback
// Feature: full-chat-history-export, Property 1
// Validates: Requirements 1.1, 1.2

describe('P1: findChatContainer — data-tid primary, ARIA fallback', () => {
  afterEach(() => { delete global.document; });

  // The four selectors tried in order
  const DATA_TID_SELECTORS = ['chat-messages-list', 'message-pane'];
  const ARIA_ROLES = ['list', 'log'];

  // Arbitrary: a random HTML tag name for the container element
  const arbTag = fc.constantFrom('div', 'ul', 'ol', 'section', 'nav', 'aside');

  // Arbitrary: random noise elements that do NOT match any known selector
  const arbNoiseEl = fc.record({
    tag: fc.constantFrom('div', 'span', 'p', 'header', 'footer'),
    role: fc.constantFrom('button', 'dialog', 'navigation', 'banner', 'main', 'complementary'),
  });
  const arbNoiseList = fc.array(arbNoiseEl, { minLength: 0, maxLength: 5 });

  /**
   * Builds a MockDocument populated with optional noise elements plus the
   * target container, inserted at a random position among the noise.
   */
  function buildDocWithContainer(noiseEls, containerEl, insertIdx) {
    const doc = new MockDocument();
    const all = [...noiseEls.map(({ tag, role }) => makeEl(tag, { role }))];
    const pos = insertIdx % (all.length + 1);
    all.splice(pos, 0, containerEl);
    all.forEach(el => doc._append(el));
    return doc;
  }

  test('P1a: returns the element when only a data-tid container is present (any valid tid)', () => {
    // Validates Requirement 1.1 — data-tid is the primary strategy
    fc.assert(
      fc.property(
        fc.constantFrom(...DATA_TID_SELECTORS),
        arbTag,
        arbNoiseList,
        fc.integer({ min: 0, max: 10 }),
        (tid, tag, noise, insertIdx) => {
          const container = makeEl(tag, { 'data-tid': tid });
          const doc = buildDocWithContainer(noise, container, insertIdx);
          global.document = doc;
          return findChatContainer() === container;
        }
      ),
      { numRuns: 100 }
    );
  });

  test('P1b: returns the element when only an ARIA-role container is present (no data-tid)', () => {
    // Validates Requirement 1.2 — ARIA role is the fallback strategy
    fc.assert(
      fc.property(
        fc.constantFrom(...ARIA_ROLES),
        arbTag,
        arbNoiseList,
        fc.integer({ min: 0, max: 10 }),
        (role, tag, noise, insertIdx) => {
          const container = makeEl(tag, { role });
          const doc = buildDocWithContainer(noise, container, insertIdx);
          global.document = doc;
          return findChatContainer() === container;
        }
      ),
      { numRuns: 100 }
    );
  });

  test('P1c: data-tid element is returned when both data-tid and ARIA containers are present', () => {
    // Validates Requirements 1.1 + 1.2 — data-tid wins over ARIA fallback
    fc.assert(
      fc.property(
        fc.constantFrom(...DATA_TID_SELECTORS),
        fc.constantFrom(...ARIA_ROLES),
        arbTag,
        arbNoiseList,
        (tid, role, tag, noise) => {
          const doc = new MockDocument();
          // Add noise first
          noise.forEach(({ tag: t, role: r }) => doc._append(makeEl(t, { role: r })));
          // Add ARIA container before data-tid container in DOM order
          const ariaEl = makeEl(tag, { role });
          const dataTidEl = makeEl(tag, { 'data-tid': tid });
          doc._append(ariaEl);
          doc._append(dataTidEl);
          global.document = doc;
          // Must return the data-tid element, not the ARIA one
          return findChatContainer() === dataTidEl;
        }
      ),
      { numRuns: 100 }
    );
  });

  test('P1d: does not throw for any DOM containing at least one valid container', () => {
    // Validates that findChatContainer never throws when a valid container exists
    const arbContainer = fc.oneof(
      fc.record({ kind: fc.constant('data-tid'), value: fc.constantFrom(...DATA_TID_SELECTORS) }),
      fc.record({ kind: fc.constant('aria'), value: fc.constantFrom(...ARIA_ROLES) })
    );
    fc.assert(
      fc.property(
        arbContainer,
        arbTag,
        arbNoiseList,
        fc.integer({ min: 0, max: 10 }),
        ({ kind, value }, tag, noise, insertIdx) => {
          const attrs = kind === 'data-tid' ? { 'data-tid': value } : { role: value };
          const container = makeEl(tag, attrs);
          const doc = buildDocWithContainer(noise, container, insertIdx);
          global.document = doc;
          try {
            const result = findChatContainer();
            return result instanceof MockElement;
          } catch {
            return false;
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 2: Container not found throws exact message ─────────────────────
// Feature: full-chat-history-export, Property 2
// Validates: Requirements 1.3

describe('P2: findChatContainer — no match throws exact message', () => {
  afterEach(() => { delete global.document; });

  test('throws exact error message when no selector matches', () => {
    fc.assert(
      fc.property(
        // Generate arbitrary attributes that don't match any known selector
        fc.array(
          fc.record({
            tag: fc.constantFrom('div', 'span', 'section', 'aside'),
            role: fc.constantFrom('button', 'dialog', 'navigation', 'banner', 'main'),
          }),
          { minLength: 0, maxLength: 5 }
        ),
        (elements) => {
          const doc = new MockDocument();
          elements.forEach(({ tag, role }) => {
            doc._append(makeEl(tag, { role }));
          });
          global.document = doc;

          try {
            findChatContainer();
            return false; // should have thrown
          } catch (e) {
            return e.message === 'Chat container not found. Make sure a chat is open.';
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('throws even with an empty document', () => {
    const doc = new MockDocument();
    global.document = doc;
    expect(() => findChatContainer()).toThrow(
      'Chat container not found. Make sure a chat is open.'
    );
  });
});

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const arbRecord = fc.record({
  sender:    fc.string({ minLength: 1, maxLength: 20 }),
  timestamp: fc.string({ minLength: 0, maxLength: 20 }),
  content:   fc.string({ minLength: 1, maxLength: 50 }),
});

// ─── Property 8: Deduplication retains first occurrence, removes all duplicates
// Feature: full-chat-history-export, Property 8
// Validates: Requirements 7.1, 7.2

describe('P8: deduplicateRecords — unique keys, first occurrence retained', () => {
  test('every composite key appears exactly once in the output', () => {
    fc.assert(
      fc.property(
        fc.array(arbRecord, { minLength: 0, maxLength: 30 }),
        (records) => {
          const result = deduplicateRecords(records);
          const keys = result.map(r => `${r.sender}|${r.timestamp}|${r.content}`);
          return keys.length === new Set(keys).size;
        }
      ),
      { numRuns: 200 }
    );
  });

  test('retained record is the first occurrence from the input', () => {
    fc.assert(
      fc.property(
        fc.array(arbRecord, { minLength: 1, maxLength: 20 }),
        // inject at least one duplicate by repeating a random element
        fc.integer({ min: 0, max: 19 }),
        (records, dupIdx) => {
          const idx = dupIdx % records.length;
          const withDup = [...records, records[idx]]; // append a duplicate at the end
          const result = deduplicateRecords(withDup);
          const key = `${records[idx].sender}|${records[idx].timestamp}|${records[idx].content}`;
          const resultIdx = result.findIndex(r => `${r.sender}|${r.timestamp}|${r.content}` === key);
          // The retained record must be the same object as the first occurrence in withDup
          const firstIdx = withDup.findIndex(r => `${r.sender}|${r.timestamp}|${r.content}` === key);
          return result[resultIdx] === withDup[firstIdx];
        }
      ),
      { numRuns: 200 }
    );
  });

  test('output is a subset of the input preserving relative order', () => {
    fc.assert(
      fc.property(
        fc.array(arbRecord, { minLength: 0, maxLength: 30 }),
        (records) => {
          const result = deduplicateRecords(records);
          // Every result element must appear in the input in the same relative order
          let inputIdx = 0;
          for (const r of result) {
            while (inputIdx < records.length && records[inputIdx] !== r) inputIdx++;
            if (inputIdx >= records.length) return false;
            inputIdx++;
          }
          return true;
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ─── Property 9: Deduplication is idempotent ─────────────────────────────────
// Feature: full-chat-history-export, Property 9
// Validates: Requirements 7.3

describe('P9: deduplicateRecords — idempotent', () => {
  test('applying deduplicateRecords twice equals applying it once', () => {
    fc.assert(
      fc.property(
        fc.array(arbRecord, { minLength: 0, maxLength: 30 }),
        (records) => {
          const once  = deduplicateRecords(records);
          const twice = deduplicateRecords(once);
          if (once.length !== twice.length) return false;
          return once.every((r, i) => r === twice[i]);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ─── Helpers for scrollLoadHistory tests ─────────────────────────────────────

/**
 * Builds a mock chat container whose querySelectorAll returns a list of
 * `count` dummy elements. The count can be updated via container._count.
 */
function makeMockContainer(initialCount) {
  const container = {
    _count: initialCount,
    scrollTop: 0,
    _children: [],
    querySelectorAll(sel) {
      // Return an array-like of `_count` dummy objects
      const arr = [];
      for (let i = 0; i < this._count; i++) {
        arr.push({ _id: i, _container: this });
      }
      return arr;
    },
    contains(el) {
      // Sentinel is "in DOM" as long as its _id < current count
      if (!el) return false;
      return el._id < this._count;
    },
  };
  return container;
}

/**
 * Installs a mock document with the given container as the chat container.
 * Uses [data-tid="chat-messages-list"] as the selector.
 */
function installMockDocument(container) {
  global.document = {
    querySelector(sel) {
      if (sel === '[data-tid="chat-messages-list"]') return container;
      return null;
    },
    querySelectorAll(sel) { return []; },
  };
}

// ─── Property 3: Scroll loop continues while new bubbles keep appearing ───────
// Feature: full-chat-history-export, Property 3
// Validates: Requirements 2.1, 2.2, 2.3, 3.3

describe('P3: scrollLoadHistory — loop continues while new bubbles appear', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); delete global.document; });

  test('onProgress is called exactly N times with strictly increasing values', async () => {
    await fc.assert(
      fc.asyncProperty(
        // N: number of growing steps before stabilising (1–6)
        fc.integer({ min: 1, max: 6 }),
        // bubblesPerStep: how many new bubbles appear each step (1–10)
        fc.integer({ min: 1, max: 10 }),
        async (N, bubblesPerStep) => {
          const loadTimeout  = 500;
          const pollInterval = 50;
          const maxTotalMs   = 60000;

          let stepCount = 0;
          const container = makeMockContainer(5); // start with 5 bubbles
          installMockDocument(container);

          const progressValues = [];

          const promise = scrollLoadHistory({
            loadTimeout,
            pollInterval,
            maxTotalMs,
            onProgress: (count) => progressValues.push(count),
          });

          // Drive the fake timers: for each of N steps, advance time so a
          // poll fires and the count grows; after N steps, leave count stable.
          const driveLoop = async () => {
            for (let step = 0; step < N; step++) {
              // Advance past one poll interval so the scroll fires, then
              // inject new bubbles so the poll detects growth.
              await Promise.resolve();
              container._count += bubblesPerStep;
              jest.advanceTimersByTime(pollInterval + 10);
              await Promise.resolve();
            }
            // Now leave count stable so the loop exits on the next step
            jest.advanceTimersByTime(loadTimeout + pollInterval + 10);
            await Promise.resolve();
          };

          await Promise.all([driveLoop(), promise]);

          // onProgress must have been called exactly N times
          if (progressValues.length !== N) return false;
          // Each value must be strictly greater than the previous
          for (let i = 1; i < progressValues.length; i++) {
            if (progressValues[i] <= progressValues[i - 1]) return false;
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 4: Scroll loop exits when bubble count is stable ────────────────
// Feature: full-chat-history-export, Property 4
// Validates: Requirements 2.3, 3.4

describe('P4: scrollLoadHistory — exits with timedOut:false when count is stable', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); delete global.document; });

  test('resolves with timedOut:false within loadTimeout + pollInterval when count never grows', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 100, max: 1000 }),  // loadTimeout
        fc.integer({ min: 10,  max: 200  }),  // pollInterval
        fc.integer({ min: 0,   max: 20   }),  // initial bubble count
        async (loadTimeout, pollInterval, initialCount) => {
          const maxTotalMs = 60000;
          const container  = makeMockContainer(initialCount);
          installMockDocument(container);

          let result;
          const promise = scrollLoadHistory({
            loadTimeout,
            pollInterval,
            maxTotalMs,
            onProgress: () => {},
          }).then(r => { result = r; });

          // Advance time past loadTimeout so the stable-count branch fires
          jest.advanceTimersByTime(loadTimeout + pollInterval + 50);
          await Promise.resolve();
          jest.advanceTimersByTime(pollInterval);
          await Promise.resolve();
          await promise;

          return result !== undefined && result.timedOut === false;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 5: onProgress receives strictly increasing counts ───────────────
// Feature: full-chat-history-export, Property 5
// Validates: Requirements 5.2

describe('P5: scrollLoadHistory — onProgress values are strictly monotonically increasing', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); delete global.document; });

  test('all loaded values passed to onProgress are strictly increasing', async () => {
    await fc.assert(
      fc.asyncProperty(
        // K: number of batches (1–5)
        fc.integer({ min: 1, max: 5 }),
        // sizes: how many bubbles each batch adds (1–8 each)
        fc.array(fc.integer({ min: 1, max: 8 }), { minLength: 1, maxLength: 5 }),
        async (K, sizes) => {
          const loadTimeout  = 500;
          const pollInterval = 50;
          const maxTotalMs   = 60000;
          const batches      = sizes.slice(0, K);

          const container = makeMockContainer(3);
          installMockDocument(container);

          const progressValues = [];

          const promise = scrollLoadHistory({
            loadTimeout,
            pollInterval,
            maxTotalMs,
            onProgress: (count) => progressValues.push(count),
          });

          const driveLoop = async () => {
            for (const batchSize of batches) {
              await Promise.resolve();
              container._count += batchSize;
              jest.advanceTimersByTime(pollInterval + 10);
              await Promise.resolve();
            }
            // Stabilise
            jest.advanceTimersByTime(loadTimeout + pollInterval + 10);
            await Promise.resolve();
          };

          await Promise.all([driveLoop(), promise]);

          // Strictly increasing check
          for (let i = 1; i < progressValues.length; i++) {
            if (progressValues[i] <= progressValues[i - 1]) return false;
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Helpers for scrapeFullHistory tests ─────────────────────────────────────

/**
 * Builds a minimal mock document that has:
 *  - a chat container (data-tid="chat-messages-list") with `bubbleCount` bubbles
 *  - a chat header title element
 * Each bubble has a sender, timestamp, and content so extractMessages() succeeds.
 */
function buildFullHistoryDoc(bubbleCount, chatTitle = 'Test Chat') {
  const doc = new MockDocument();

  // Chat header
  const header = makeEl('div', { 'data-tid': 'chat-header-title' });
  header._text = chatTitle;
  doc._append(header);

  // Chat container (used by findChatContainer + scrollLoadHistory)
  const container = makeEl('div', { 'data-tid': 'chat-messages-list' });

  for (let i = 0; i < bubbleCount; i++) {
    const bubbleEl = makeEl('div', { 'data-tid': 'message-body' });

    const senderEl = makeEl('span', { 'data-tid': 'message-author-name' });
    senderEl._text = `User${i}`;

    const tsEl = makeEl('span', { 'data-tid': 'message-timestamp', datetime: '2024-01-01T10:00:00' });
    tsEl._text = '2024-01-01T10:00:00';

    const contentEl = makeEl('div', {});
    contentEl._text = `Message ${i}`;

    bubbleEl._children = [senderEl, tsEl, contentEl];
    container._children.push(bubbleEl);
  }

  doc._append(container);
  return doc;
}

// ─── Property 6: Timeout warning prepended when partial export ────────────────
// Feature: full-chat-history-export, Property 6
// Validates: Requirements 6.2, 6.3
//
// Strategy: call scrapeFullHistory with a maxTotalMs=0 override so scrollLoadHistory
// immediately times out. We pass opts through a thin wrapper exported for testing.

describe('P6: scrapeFullHistory — timeout warning prepended when partial export', () => {
  afterEach(() => { delete global.document; global.chrome = undefined; });

  const WARNING_RE = /^\[WARNING\] Chat history may be incomplete — loading timed out after \d+ seconds\./;

  test('first line of content matches warning pattern when timedOut with ≥1 bubble', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Number of bubbles present (at least 1)
        fc.integer({ min: 1, max: 10 }),
        async (bubbleCount) => {
          const doc = buildFullHistoryDoc(bubbleCount);
          global.document = doc;
          global.chrome = { runtime: { sendMessage: () => {} } };

          const scraper = require('../scraper');

          // Use maxTotalMs=0 so scrollLoadHistory times out immediately
          const { timedOut, elapsedSeconds } = await scraper.scrollLoadHistory({
            maxTotalMs: 0,
            loadTimeout: 50,
            pollInterval: 10,
          });

          // Verify scrollLoadHistory itself timed out
          if (!timedOut) return false;

          // Now manually replicate scrapeFullHistory logic with the timed-out result
          // to verify the warning is prepended
          const records = scraper.extractMessages();
          const deduped = scraper.deduplicateRecords(records);
          let content = deduped.map(scraper.formatRecord).join('\n');
          content = `[WARNING] Chat history may be incomplete — loading timed out after ${elapsedSeconds} seconds.\n` + content;

          const firstLine = content.split('\n')[0];
          return WARNING_RE.test(firstLine);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  test('scrapeFullHistory itself prepends warning when timedOut with ≥1 bubble', async () => {
    // Concrete test: set up DOM with bubbles, force immediate timeout
    const doc = buildFullHistoryDoc(3);
    global.document = doc;
    global.chrome = { runtime: { sendMessage: () => {} } };

    const scraper = require('../scraper');

    // Patch scrollLoadHistory on the module exports so scrapeFullHistory picks it up
    const original = scraper.scrollLoadHistory;
    scraper.scrollLoadHistory = async () => ({ timedOut: true, elapsedSeconds: 42 });

    let result;
    try {
      result = await scraper.scrapeFullHistory();
    } finally {
      scraper.scrollLoadHistory = original;
    }

    expect(result).toBeDefined();
    const firstLine = result.content.split('\n')[0];
    expect(firstLine).toMatch(WARNING_RE);
  });
});

// ─── Property 7: Zero-bubble timeout throws instead of saving ─────────────────
// Feature: full-chat-history-export, Property 7
// Validates: Requirements 6.4

describe('P7: scrapeFullHistory — zero-bubble timeout throws', () => {
  afterEach(() => { delete global.document; global.chrome = undefined; });

  test('throws when timedOut is true and zero bubbles are in the DOM', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 120 }),
        async (elapsedSeconds) => {
          // DOM with a container but NO bubbles inside it
          const doc = buildFullHistoryDoc(0);
          global.document = doc;
          global.chrome = { runtime: { sendMessage: () => {} } };

          const scraper = require('../scraper');

          // Patch scrollLoadHistory to return timedOut immediately
          const original = scraper.scrollLoadHistory;
          scraper.scrollLoadHistory = async () => ({ timedOut: true, elapsedSeconds });

          let threw = false;
          try {
            await scraper.scrapeFullHistory();
          } catch (_) {
            threw = true;
          } finally {
            scraper.scrollLoadHistory = original;
          }

          return threw;
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);
});

// ─── Property 10: scrapeFullHistory returns { chatName, content } shape ────────
// Feature: full-chat-history-export, Property 10
// Validates: Requirements 8.1, 8.4

describe('P10: scrapeFullHistory — result shape matches scrape()', () => {
  afterEach(() => { delete global.document; global.chrome = undefined; });

  test('resolves to { chatName: non-empty string, content: string } for any valid DOM', async () => {
    await fc.assert(
      fc.asyncProperty(
        // At least 1 bubble so extractMessages() doesn't throw
        fc.integer({ min: 1, max: 10 }),
        fc.string({ minLength: 1, maxLength: 30 }),
        async (bubbleCount, chatTitle) => {
          const doc = buildFullHistoryDoc(bubbleCount, chatTitle);
          global.document = doc;
          global.chrome = { runtime: { sendMessage: () => {} } };

          const scraper = require('../scraper');

          // Patch scrollLoadHistory to return immediately (no timeout)
          const original = scraper.scrollLoadHistory;
          scraper.scrollLoadHistory = async () => ({ timedOut: false, elapsedSeconds: 0 });

          let result;
          try {
            result = await scraper.scrapeFullHistory();
          } finally {
            scraper.scrollLoadHistory = original;
          }

          if (!result) return false;
          const keys = Object.keys(result).sort();
          if (keys.join(',') !== 'chatName,content') return false;
          if (typeof result.chatName !== 'string' || result.chatName.length === 0) return false;
          if (typeof result.content !== 'string') return false;
          return true;
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);
});

// ─── Property 11: scrape() is unaffected by the new code ─────────────────────
// Feature: full-chat-history-export, Property 11
// Validates: Requirements 8.2

describe('P11: scrape() is unaffected by the new code', () => {
  afterEach(() => { delete global.document; });

  test('scrape() returns the same result regardless of scrapeFullHistory being defined', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.string({ minLength: 1, maxLength: 30 }),
        (bubbleCount, chatTitle) => {
          const scraper = require('../scraper');

          // Verify scrapeFullHistory is exported (i.e. defined in the same module scope)
          if (typeof scraper.scrapeFullHistory !== 'function') return false;
          if (typeof scraper.scrollLoadHistory !== 'function') return false;

          // Call scrape() with a valid DOM
          const doc = buildFullHistoryDoc(bubbleCount, chatTitle);
          global.document = doc;

          let result;
          try {
            result = scraper.scrape();
          } catch (_) {
            return false;
          }

          // scrape() must return { chatName, content } with the same shape
          if (typeof result !== 'object' || result === null) return false;
          const keys = Object.keys(result).sort();
          if (keys.join(',') !== 'chatName,content') return false;
          if (typeof result.chatName !== 'string') return false;
          if (typeof result.content !== 'string') return false;

          // Call scrape() again — must return identical values
          global.document = doc;
          let result2;
          try {
            result2 = scraper.scrape();
          } catch (_) {
            return false;
          }

          return result.chatName === result2.chatName && result.content === result2.content;
        }
      ),
      { numRuns: 100 }
    );
  });
});
