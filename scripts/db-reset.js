#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'lastest2.db');
const DB_WAL_PATH = DB_PATH + '-wal';
const DB_SHM_PATH = DB_PATH + '-shm';
const SCREENSHOTS_DIR = path.join(process.cwd(), 'public', 'screenshots');
const BASELINES_DIR = path.join(process.cwd(), 'public', 'baselines');

function removeIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { recursive: true });
    console.log(`Removed: ${filePath}`);
  }
}

console.log('Resetting database to empty state...\n');

// Remove database files
removeIfExists(DB_PATH);
removeIfExists(DB_WAL_PATH);
removeIfExists(DB_SHM_PATH);

// Clear screenshots and baselines
removeIfExists(SCREENSHOTS_DIR);
removeIfExists(BASELINES_DIR);

// Recreate empty directories
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
fs.mkdirSync(BASELINES_DIR, { recursive: true });
console.log(`Created: ${SCREENSHOTS_DIR}`);
console.log(`Created: ${BASELINES_DIR}`);

console.log('\nDatabase files removed. Running db:push to recreate schema...\n');

const { execSync } = require('child_process');
try {
  execSync('pnpm db:push', { stdio: 'inherit' });
  console.log('\nDatabase reset complete.');
} catch (error) {
  console.error('Failed to push schema:', error.message);
  process.exit(1);
}
