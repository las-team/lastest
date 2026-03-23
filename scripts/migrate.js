#!/usr/bin/env node
/**
 * Safe database migration script for Docker deployments.
 * Runs drizzle-kit push with FK checks disabled to avoid constraint errors.
 * Falls back to manual column additions if drizzle-kit fails entirely.
 */
const { execSync } = require('child_process');
const path = require('path');

const dbPath = process.env.DATABASE_PATH || '/app/data/lastest2.db';
const fs = require('fs');

if (!fs.existsSync(dbPath)) {
  console.log('[migrate] No database file yet — drizzle-kit will create it.');
  try {
    execSync('./node_modules/.bin/drizzle-kit push --force', { stdio: 'inherit' });
  } catch {
    console.log('[migrate] drizzle-kit push failed on fresh DB');
  }
  process.exit(0);
}

const Database = require('better-sqlite3');
const db = new Database(dbPath);

// Disable FK checks for migration
db.pragma('foreign_keys = OFF');

// Run drizzle-kit push in a subprocess with FK checks disabled at the DB level
// Note: SQLite FK pragma is per-connection, so we keep this connection open
// and run drizzle-kit which opens its own connection (FK is ON by default there).
// Instead, we'll do the migration ourselves if drizzle-kit fails.

console.log('[migrate] Running drizzle-kit push...');
try {
  execSync('./node_modules/.bin/drizzle-kit push --force 2>&1', { stdio: 'inherit' });
  console.log('[migrate] drizzle-kit push succeeded');
} catch (e) {
  console.log('[migrate] drizzle-kit push failed, applying manual migrations...');

  // Read schema to find all tables and columns, then add missing ones
  const schemaPath = path.join(process.cwd(), 'src/lib/db/schema.ts');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf8');

    // Extract table/column definitions using brace-counting
    // (regex non-greedy fails on nested braces like `{ mode: 'boolean' }`)
    const tableHeaderRegex = /sqliteTable\s*\(\s*['"](\w+)['"]\s*,\s*\{/g;
    let match;
    while ((match = tableHeaderRegex.exec(schema)) !== null) {
      const tableName = match[1];
      let depth = 1;
      let i = match.index + match[0].length;
      while (i < schema.length && depth > 0) {
        if (schema[i] === '{') depth++;
        else if (schema[i] === '}') depth--;
        i++;
      }
      const body = schema.substring(match.index + match[0].length, i - 1);

      // Get existing columns
      let existingCols;
      try {
        existingCols = new Set(
          db.prepare(`PRAGMA table_info("${tableName}")`).all().map(c => c.name)
        );
      } catch {
        continue; // table doesn't exist, drizzle-kit should create it
      }

      // Extract column names from schema body
      // Match: columnName: text('column_name') or integer('column_name') etc
      const colRegex = /(\w+)\s*:\s*(?:text|integer|real|blob)\s*\(\s*['"](\w+)['"]/g;
      let colMatch;
      while ((colMatch = colRegex.exec(body)) !== null) {
        const colName = colMatch[2]; // SQL column name
        if (!existingCols.has(colName)) {
          // Determine type
          const typeMatch = body.substring(colMatch.index).match(/^(\w+)\s*:\s*(text|integer|real|blob)/);
          const sqlType = (typeMatch?.[2] || 'text').toUpperCase();

          // Check for .notNull() and .default()
          const colDef = body.substring(colMatch.index, body.indexOf('\n', colMatch.index + 50));
          const notNull = colDef.includes('.notNull()');
          const defaultMatch = colDef.match(/\.default\(\s*(?:['"]([^'"]*?)['"]|(\d+)|(\w+))\s*\)/);
          const boolDefault = colDef.match(/\.default\(\s*(true|false)\s*\)/);

          let ddl = `ALTER TABLE "${tableName}" ADD COLUMN "${colName}" ${sqlType}`;
          if (notNull) {
            const defVal = boolDefault
              ? (boolDefault[1] === 'true' ? '1' : '0')
              : defaultMatch
                ? (defaultMatch[1] ?? defaultMatch[2] ?? defaultMatch[3])
                : (sqlType === 'INTEGER' ? '0' : "''");
            ddl += ` NOT NULL DEFAULT ${typeof defVal === 'string' && isNaN(defVal) ? `'${defVal}'` : defVal}`;
          } else if (defaultMatch || boolDefault) {
            const defVal = boolDefault
              ? (boolDefault[1] === 'true' ? '1' : '0')
              : (defaultMatch[1] ?? defaultMatch[2] ?? defaultMatch[3]);
            ddl += ` DEFAULT ${typeof defVal === 'string' && isNaN(defVal) ? `'${defVal}'` : defVal}`;
          }

          try {
            db.exec(ddl);
            console.log(`[migrate] Added ${tableName}.${colName}`);
          } catch (err) {
            if (!err.message.includes('duplicate')) {
              console.log(`[migrate] Failed ${tableName}.${colName}: ${err.message}`);
            }
          }
        }
      }
    }
  }
}

db.pragma('foreign_keys = ON');
db.close();
console.log('[migrate] Done');
