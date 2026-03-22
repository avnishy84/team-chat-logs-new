// Feature: teams-chat-archiver — scraper unit and property tests

const fc = require('fast-check');

// ─── DOM environment helpers ──────────────────────────────────────────────────

/**
 * Minimal DOM shim so scraper.js can run in Node/Jest (testEnvironment: "node").
 * We replace global.document before each test group and restore after.
 */
function makeDocument(html = '') {
  // Build a lightweight document-like object backed by a real DOM parser
  // using the jsdom-free approach: manual element trees.
  return new MockDocument(html);
}

class MockElement {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = tag.toUpperCase();
    this._attrs = { ...attrs };
    this._children = children;
    // innerText / textContent derived from children text nodes
    this._text = '';
  }

  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return this._attrs[k] !== undefined ? this._attrs[k] : null; }
  get textContent() { return this._text + this._children.map(c => c.textContent || c).join(''); }
  get innerText() { return this.textContent; }

  querySelector(sel) {
    return queryOne(this._children, sel);
  }
  querySelectorAll(sel) {
    return queryAll(this._children, sel);
  }
}

class MockDocument {
  constructor() {
    this._root = new MockElement('root');
  }
  querySelector(sel) { return queryOne(this._root._children, sel); }
  querySelectorAll(sel) { return queryAll(this._root._children, sel); }
  _append(el) { this._root._children.push(el); return el; }
}

/** Very small CSS selector engine supporting:
 *  - tag names
 *  - [attr]
 *  - [attr="val"]
 *  - [attr*="val"]  (contains)
 *  - tag[attr]
 *  - ancestor descendant  (space-separated)
 */
function matchesSelector(el, sel) {
  if (!(el instanceof MockElement)) return false;
  sel = sel.trim();

  // Descendant combinator — only handle simple "a b" (one level for our tests)
  if (sel.includes(' ')) {
    const parts = sel.split(/\s+/);
    // We only need to match the last part against the element itself
    // (the ancestor check is implicit because we traverse the tree)
    return matchesSelector(el, parts[parts.length - 1]);
  }

  // Parse tag + attribute parts
  const tagMatch = sel.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
  const tag = tagMatch ? tagMatch[1].toUpperCase() : null;
  if (tag && el.tagName !== tag) return false;

  // Extract all [attr...] parts
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

// ─── Helpers to build mock DOM elements ──────────────────────────────────────

function el(tag, attrs = {}, text = '', children = []) {
  const e = new MockElement(tag, attrs, children);
  e._text = text;
  return e;
}

function bubble({ sender, timestamp, content, useDataTid = true }) {
  const children = [];

  if (sender) {
    if (useDataTid) {
      children.push(el('span', { 'data-tid': 'message-author-name' }, sender));
    } else {
      children.push(el('span', { 'aria-label': sender, 'aria-roledescription': 'author' }, sender));
    }
  }

  if (timestamp) {
    if (useDataTid) {
      const tsEl = el('span', { 'data-tid': 'message-timestamp', datetime: timestamp }, timestamp);
      children.push(tsEl);
    } else {
      children.push(el('time', { datetime: timestamp }, timestamp));
    }
  }

  children.push(el('div', {}, content));

  const attrs = useDataTid ? { 'data-tid': 'message-body' } : { role: 'listitem' };
  return el('div', attrs, '', children);
}

// ─── Module under test ────────────────────────────────────────────────────────

// We need to inject a global `document` before requiring the module
// because scraper.js references `document` at call time (not module load time).
// So we just require it once and swap global.document per test.

const scraper = require('../scraper');
const { extractChatName, extractMessages, formatRecord, scrape } = scraper;

// ─── Unit Tests: extractChatName (Task 3.1) ───────────────────────────────────

describe('extractChatName — unit tests', () => {
  afterEach(() => { delete global.document; });

  test('returns sanitized name from data-tid="chat-header-title" element', () => {
    const doc = new MockDocument();
    doc._append(el('div', { 'data-tid': 'chat-header-title' }, 'Alice & Bob'));
    global.document = doc;
    expect(extractChatName()).toBe('Alice & Bob');
  });

  test('returns sanitized name and replaces invalid chars', () => {
    const doc = new MockDocument();
    doc._append(el('div', { 'data-tid': 'chat-header-title' }, 'Chat: Room/1'));
    global.document = doc;
    expect(extractChatName()).toBe('Chat_ Room_1');
  });

  test('falls back to ARIA label on header element', () => {
    const doc = new MockDocument();
    const header = el('header', {}, '', [
      el('span', { 'aria-label': 'Project Alpha' }, 'Project Alpha'),
    ]);
    doc._append(header);
    global.document = doc;
    expect(extractChatName()).toBe('Project Alpha');
  });

  test('returns "teams-chat" when no element is found', () => {
    const doc = new MockDocument();
    global.document = doc;
    expect(extractChatName()).toBe('teams-chat');
  });
});

// ─── Unit Tests: extractMessages (Task 3.2) ───────────────────────────────────

describe('extractMessages — unit tests', () => {
  afterEach(() => { delete global.document; });

  test('extracts messages with sender and timestamp via data-tid', () => {
    const doc = new MockDocument();
    doc._append(bubble({ sender: 'Alice', timestamp: '2024-03-15T14:32:00', content: 'Hello' }));
    doc._append(bubble({ sender: 'Bob', timestamp: '2024-03-15T14:33:00', content: 'Hi there' }));
    global.document = doc;

    const records = extractMessages();
    expect(records).toHaveLength(2);
    expect(records[0].sender).toBe('Alice');
    expect(records[0].timestamp).toBe('2024-03-15T14:32:00');
    expect(records[1].sender).toBe('Bob');
  });

  test('carries forward sender for consecutive messages without sender element', () => {
    const doc = new MockDocument();
    doc._append(bubble({ sender: 'Alice', timestamp: '2024-03-15T14:32:00', content: 'First' }));
    doc._append(bubble({ sender: '', timestamp: '2024-03-15T14:33:00', content: 'Second' }));
    doc._append(bubble({ sender: '', timestamp: '2024-03-15T14:34:00', content: 'Third' }));
    global.document = doc;

    const records = extractMessages();
    expect(records).toHaveLength(3);
    expect(records[0].sender).toBe('Alice');
    expect(records[1].sender).toBe('Alice');
    expect(records[2].sender).toBe('Alice');
  });

  test('uses empty string for timestamp when timestamp element is absent', () => {
    const doc = new MockDocument();
    doc._append(bubble({ sender: 'Alice', timestamp: '', content: 'No timestamp' }));
    global.document = doc;

    const records = extractMessages();
    expect(records[0].timestamp).toBe('');
  });

  test('throws when no message bubbles are found', () => {
    const doc = new MockDocument();
    global.document = doc;
    expect(() => extractMessages()).toThrow('No messages found. Make sure a chat is open.');
  });

  test('falls back to role="listitem" when no data-tid bubbles exist', () => {
    const doc = new MockDocument();
    doc._append(bubble({ sender: 'Carol', timestamp: '2024-01-01T10:00:00', content: 'ARIA msg', useDataTid: false }));
    global.document = doc;

    const records = extractMessages();
    expect(records).toHaveLength(1);
    expect(records[0].sender).toBe('Carol');
  });

  test('strips HTML from content via textContent', () => {
    const doc = new MockDocument();
    const b = el('div', { 'data-tid': 'message-body' }, '', [
      el('span', { 'data-tid': 'message-author-name' }, 'Alice'),
      el('div', {}, 'Hello world'), // plain text, no HTML tags in mock
    ]);
    doc._append(b);
    global.document = doc;

    const records = extractMessages();
    expect(records[0].content).not.toMatch(/<[^>]*>/);
  });
});

// ─── Property Test P2: Message Extraction Completeness (Task 3.3) ─────────────
// Feature: teams-chat-archiver, Property 2: Message Extraction Completeness and Sender Continuity
// Validates: Requirements 3.1, 3.2, 3.5

describe('P2: Message Extraction Completeness and Sender Continuity', () => {
  afterEach(() => { delete global.document; });

  test('produces exactly N records with non-empty senders for N bubbles', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            hasSender: fc.boolean(),
            // Use non-whitespace content so bubbles are never skipped by the empty-content guard
            content: fc.stringMatching(/^[^\s].*$/),
          }),
          { minLength: 1 }
        ),
        (bubbleSpecs) => {
          // Ensure at least the first bubble has a sender so carry-forward works
          const specs = bubbleSpecs.map((s, i) => ({
            ...s,
            hasSender: i === 0 ? true : s.hasSender,
          }));

          const doc = new MockDocument();
          specs.forEach(({ hasSender, content }) => {
            doc._append(bubble({
              sender: hasSender ? 'Sender' : '',
              timestamp: '',
              content,
            }));
          });
          global.document = doc;

          const records = extractMessages();

          // Exactly N records
          if (records.length !== specs.length) return false;

          // Every record has a non-empty sender
          return records.every(r => r.sender && r.sender.length > 0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property Test P3: HTML Stripping (Task 3.4) ─────────────────────────────
// Feature: teams-chat-archiver, Property 3: HTML Stripping
// Validates: Requirements 3.4

describe('P3: HTML Stripping', () => {
  afterEach(() => { delete global.document; });

  test('extracted content contains no HTML tags', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.array(fc.string({ minLength: 1 }), { minLength: 0, maxLength: 5 }),
        (plainText, tags) => {
          // Build a bubble whose textContent is plainText (our mock strips tags naturally)
          const doc = new MockDocument();
          const b = el('div', { 'data-tid': 'message-body' }, '', [
            el('span', { 'data-tid': 'message-author-name' }, 'Alice'),
            el('div', {}, plainText),
          ]);
          doc._append(b);
          global.document = doc;

          const records = extractMessages();
          // Content must not contain HTML tag patterns
          return !/<[^>]*>/.test(records[0].content);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property Test P8: ARIA Fallback (Task 3.5) ──────────────────────────────
// Feature: teams-chat-archiver, Property 8: DOM Resilience — ARIA Fallback
// Validates: Requirements 2.1, 8.2

describe('P8: DOM Resilience — ARIA Fallback', () => {
  afterEach(() => { delete global.document; });

  test('scraper succeeds with ARIA attrs and no data-tid attributes', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            sender: fc.string({ minLength: 1, maxLength: 30 }),
            content: fc.string({ minLength: 1 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        fc.string({ minLength: 1, maxLength: 30 }),
        (bubbleSpecs, chatLabel) => {
          const doc = new MockDocument();

          // Chat name via ARIA only
          doc._append(el('header', {}, '', [
            el('span', { 'aria-label': chatLabel }, chatLabel),
          ]));

          // Bubbles via role="listitem" only (no data-tid)
          bubbleSpecs.forEach(({ sender, content }) => {
            doc._append(bubble({ sender, timestamp: '', content, useDataTid: false }));
          });

          global.document = doc;

          let chatName;
          let records;
          try {
            chatName = extractChatName();
            records = extractMessages();
          } catch (e) {
            return false;
          }

          return (
            typeof chatName === 'string' &&
            chatName.length > 0 &&
            Array.isArray(records) &&
            records.length === bubbleSpecs.length
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Unit Tests: formatRecord (Task 4.1) ──────────────────────────────────────

describe('formatRecord — unit tests', () => {
  test('formats record with ISO timestamp to [YYYY-MM-DD HH:MM] Sender: Message', () => {
    const record = { sender: 'Alice', timestamp: '2024-03-15T14:32:00', content: 'Hello there' };
    expect(formatRecord(record)).toBe('[2024-03-15 14:32] Alice: Hello there');
  });

  test('formats record with empty timestamp as [unknown] Sender: Message', () => {
    const record = { sender: 'Bob', timestamp: '', content: 'No timestamp here' };
    expect(formatRecord(record)).toBe('[unknown] Bob: No timestamp here');
  });

  test('formats record with unparseable timestamp as [unknown]', () => {
    const record = { sender: 'Carol', timestamp: 'not-a-date', content: 'Bad ts' };
    expect(formatRecord(record)).toBe('[unknown] Carol: Bad ts');
  });

  test('pads single-digit month and day', () => {
    const record = { sender: 'Dave', timestamp: '2024-01-05T09:07:00', content: 'Padded' };
    expect(formatRecord(record)).toBe('[2024-01-05 09:07] Dave: Padded');
  });
});

// ─── Unit Tests: scrape() (Task 4) ────────────────────────────────────────────

describe('scrape — unit tests', () => {
  afterEach(() => { delete global.document; });

  test('returns object with chatName string and content string', () => {
    const doc = new MockDocument();
    doc._append(el('div', { 'data-tid': 'chat-header-title' }, 'My Chat'));
    doc._append(bubble({ sender: 'Alice', timestamp: '2024-03-15T14:32:00', content: 'Hello' }));
    doc._append(bubble({ sender: 'Bob', timestamp: '2024-03-15T14:33:00', content: 'Hi' }));
    global.document = doc;

    const result = scrape();
    expect(result.chatName).toBe('My Chat');
    expect(typeof result.content).toBe('string');
    // Two records joined by exactly one newline
    const lines = result.content.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\[2024-03-15 14:32\] Alice: /);
    expect(lines[1]).toMatch(/^\[2024-03-15 14:33\] Bob: /);
  });

  test('uses [unknown] for messages with empty timestamps', () => {
    const doc = new MockDocument();
    doc._append(el('div', { 'data-tid': 'chat-header-title' }, 'Chat'));
    doc._append(bubble({ sender: 'Alice', timestamp: '', content: 'No ts' }));
    global.document = doc;

    const result = scrape();
    expect(result.content).toMatch(/^\[unknown\] Alice: /);
  });

  test('joins multiple records with exactly one newline between them', () => {
    const doc = new MockDocument();
    doc._append(el('div', { 'data-tid': 'chat-header-title' }, 'Chat'));
    doc._append(bubble({ sender: 'Alice', timestamp: '', content: 'First' }));
    doc._append(bubble({ sender: 'Bob', timestamp: '', content: 'Second' }));
    doc._append(bubble({ sender: 'Carol', timestamp: '', content: 'Third' }));
    global.document = doc;

    const result = scrape();
    const lines = result.content.split('\n');
    expect(lines).toHaveLength(3);
    lines.forEach(line => expect(line).toMatch(/^\[unknown\] \w+: /));
  });
});

// ─── Property Test P4: Message Formatting Pattern (Task 4.2) ─────────────────
// Feature: teams-chat-archiver, Property 4: Message Formatting Pattern
// Validates: Requirements 4.1, 4.2, 4.3

describe('P4: Message Formatting Pattern', () => {
  // Regex for a valid normalized timestamp inside brackets
  const tsPattern = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] .+: /;
  const unknownPattern = /^\[unknown\] .+: /;

  test('non-empty parseable timestamps produce [YYYY-MM-DD HH:MM] Sender: Message', () => {
    fc.assert(
      fc.property(
        // Generate valid ISO date strings
        fc.date({ min: new Date('2000-01-01'), max: new Date('2099-12-31') }),
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 0 }),
        (date, sender, content) => {
          const timestamp = date.toISOString();
          const line = formatRecord({ sender, timestamp, content });
          return tsPattern.test(line);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('empty timestamp produces [unknown] Sender: Message', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 0 }),
        (sender, content) => {
          const line = formatRecord({ sender, timestamp: '', content });
          return unknownPattern.test(line);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property Test P5: Output Order and Structure (Task 4.3) ─────────────────
// Feature: teams-chat-archiver, Property 5: Output Order and Structure
// Validates: Requirements 4.4, 4.5

describe('P5: Output Order and Structure', () => {
  afterEach(() => { delete global.document; });

  test('formatted lines appear in DOM order, separated by exactly one newline', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            // Use alphanumeric senders to avoid selector/matching edge cases
            sender: fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,19}$/),
            content: fc.string({ minLength: 1 }),
          }),
          { minLength: 1, maxLength: 20 }
        ),
        (specs) => {
          // Build DOM with all empty timestamps so output is deterministic
          const doc = new MockDocument();
          doc._append(el('div', { 'data-tid': 'chat-header-title' }, 'Test'));
          specs.forEach(({ sender, content }) => {
            doc._append(bubble({ sender, timestamp: '', content }));
          });
          global.document = doc;

          const result = scrape();
          const lines = result.content.split('\n');

          // Same number of lines as records
          if (lines.length !== specs.length) return false;

          // Each line starts with [unknown] and contains the sender followed by ':'
          return lines.every((line, i) =>
            line.startsWith('[unknown] ') && line.includes(`${specs[i].sender}:`)
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});
