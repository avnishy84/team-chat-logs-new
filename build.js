#!/usr/bin/env node
// build.js — packages the Chrome Extension into dist/teams-chat-archiver.zip

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DIST_DIR = path.join(__dirname, 'dist');
const ZIP_NAME = 'teams-chat-archiver.zip';
const ZIP_PATH = path.join(DIST_DIR, ZIP_NAME);

// Extension files to include in the build
const FILES = [
  'manifest.json',
  'background.js',
  'scraper.js',
  'popup.html',
  'popup.js',
];

const UNPACKED_DIR = path.join(DIST_DIR, 'unpacked');

// Ensure dist/ and dist/unpacked/ exist
if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR);
}
if (!fs.existsSync(UNPACKED_DIR)) {
  fs.mkdirSync(UNPACKED_DIR);
}

// Remove old zip if present
if (fs.existsSync(ZIP_PATH)) {
  fs.unlinkSync(ZIP_PATH);
}

// Copy extension files to dist/unpacked/
FILES.forEach(f => {
  fs.copyFileSync(path.join(__dirname, f), path.join(UNPACKED_DIR, f));
});
console.log('Unpacked extension ready: dist/unpacked/');

// Verify all files exist before zipping
const missing = FILES.filter(f => !fs.existsSync(path.join(__dirname, f)));
if (missing.length > 0) {
  console.error('Build failed — missing files:', missing.join(', '));
  process.exit(1);
}

// Zip using the platform-available tool
try {
  const fileList = FILES.join(' ');
  // PowerShell Compress-Archive (Windows) or zip (Unix)
  if (process.platform === 'win32') {
    const psFiles = FILES.map(f => `"${f}"`).join(',');
    execSync(
      `powershell -Command "Compress-Archive -Path ${psFiles} -DestinationPath '${ZIP_PATH}' -Force"`,
      { stdio: 'inherit' }
    );
  } else {
    execSync(`zip -j "${ZIP_PATH}" ${fileList}`, { stdio: 'inherit' });
  }
  console.log(`\nBuild complete: dist/${ZIP_NAME}`);
  console.log('Files included:', FILES.join(', '));
} catch (err) {
  console.error('Build failed:', err.message);
  process.exit(1);
}
