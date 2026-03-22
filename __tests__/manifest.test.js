// Feature: teams-chat-archiver — manifest.json unit tests
// Validates: Requirements 1.1, 1.2, 1.3, 1.5

const path = require('path');
const manifest = require('../manifest.json');

describe('manifest.json — unit tests', () => {
  test('manifest_version is 3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  test('permissions contains "activeTab"', () => {
    expect(manifest.permissions).toContain('activeTab');
  });

  test('permissions contains "storage"', () => {
    expect(manifest.permissions).toContain('storage');
  });

  test('permissions contains "downloads"', () => {
    expect(manifest.permissions).toContain('downloads');
  });

  test('permissions contains "scripting"', () => {
    expect(manifest.permissions).toContain('scripting');
  });

  test('host_permissions contains "https://teams.microsoft.com/*"', () => {
    expect(manifest.host_permissions).toContain('https://teams.microsoft.com/*');
  });

  test('background.service_worker is "background.js"', () => {
    expect(manifest.background.service_worker).toBe('background.js');
  });

  test('action.default_popup is "popup.html"', () => {
    expect(manifest.action.default_popup).toBe('popup.html');
  });
});
