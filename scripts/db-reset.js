#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

const SCREENSHOTS_DIR = path.join(process.cwd(), 'public', 'screenshots');
const BASELINES_DIR = path.join(process.cwd(), 'public', 'baselines');

function removeIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { recursive: true });
    console.log(`Removed: ${filePath}`);
  }
}

console.log('Resetting database to empty state...\n');

// Clear screenshots and baselines
removeIfExists(SCREENSHOTS_DIR);
removeIfExists(BASELINES_DIR);

// Recreate empty directories
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
fs.mkdirSync(BASELINES_DIR, { recursive: true });
console.log(`Created: ${SCREENSHOTS_DIR}`);
console.log(`Created: ${BASELINES_DIR}`);

console.log('\nDropping all tables and recreating schema...\n');

const { execSync } = require('child_process');
try {
  // Drop all tables by pushing empty schema then full schema
  // drizzle-kit push --force will handle the schema sync
  execSync('pnpm db:push', { stdio: 'inherit' });
  console.log('\nDatabase reset complete.');
} catch (error) {
  console.error('Failed to push schema:', error.message);
  process.exit(1);
}
