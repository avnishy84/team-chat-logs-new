// Feature: teams-chat-archiver — sanitizeFilename unit and property tests

const fc = require('fast-check');
const { sanitizeFilename } = require('../scraper');

// --- Unit Tests (Task 2.1) ---

describe('sanitizeFilename — unit tests', () => {
  const invalidChars = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

  test.each(invalidChars)(
    'replaces "%s" with underscore',
    (char) => {
      expect(sanitizeFilename(`before${char}after`)).toBe('before_after');
    }
  );

  test('replaces all invalid characters in a single string', () => {
    expect(sanitizeFilename('/\\:*?"<>|')).toBe('_________');
  });

  test('returns string unchanged when no invalid characters are present', () => {
    expect(sanitizeFilename('teams-chat')).toBe('teams-chat');
    expect(sanitizeFilename('My Chat 2024')).toBe('My Chat 2024');
    expect(sanitizeFilename('')).toBe('');
  });

  test('replaces multiple occurrences of the same invalid character', () => {
    expect(sanitizeFilename('a/b/c')).toBe('a_b_c');
    expect(sanitizeFilename('a:b:c')).toBe('a_b_c');
  });

  test('leaves valid filename characters untouched', () => {
    const valid = 'abcABC123 .-_()[]';
    expect(sanitizeFilename(valid)).toBe(valid);
  });
});

// --- Property-Based Test (Task 2.2) ---
// Feature: teams-chat-archiver, Property 1: Chat Name Sanitization
// Validates: Requirements 2.3

describe('sanitizeFilename — property tests', () => {
  const INVALID_CHARS = new Set(['/', '\\', ':', '*', '?', '"', '<', '>', '|']);

  test('P1: sanitized output never contains invalid filename characters', () => {
    fc.assert(
      fc.property(fc.string(), (name) => {
        const result = sanitizeFilename(name);

        // No invalid characters remain in the output
        for (const ch of result) {
          if (INVALID_CHARS.has(ch)) return false;
        }

        // Every invalid character in the input is replaced with '_' in the output
        let inputIdx = 0;
        let outputIdx = 0;
        while (inputIdx < name.length) {
          const inputChar = name[inputIdx];
          const outputChar = result[outputIdx];
          if (INVALID_CHARS.has(inputChar)) {
            if (outputChar !== '_') return false;
          } else {
            if (outputChar !== inputChar) return false;
          }
          inputIdx++;
          outputIdx++;
        }

        return true;
      }),
      { numRuns: 100 }
    );
  });
});
