/**
 * Seed script for Excalidraw visual regression tests
 *
 * Creates:
 * - 1 Functional Area: "Excalidraw"
 * - 8 Visual Tests
 * - 3 Test Suites: Move Tests, Rotate Tests, History Tests
 *
 * Run: npx tsx scripts/seed-excalidraw-tests.ts
 */

import { db } from '../src/lib/db';
import {
  functionalAreas,
  tests,
  testVersions,
  suites,
  suiteTests,
} from '../src/lib/db/schema';
import { v4 as uuid } from 'uuid';

const EXCALIDRAW_URL = 'https://excalidraw.com/';

// Test code definitions
const TEST_CODES = {
  moveElementBasic: `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  await page.goto('${EXCALIDRAW_URL}');
  await page.waitForSelector('[data-testid="canvas"]');

  stepLogger.log('Initial canvas');
  await page.screenshot({ path: screenshotPath.replace('.png', '-01-initial.png') });

  // Select rectangle tool and draw
  await page.click('[data-testid="toolbar-rectangle"]');
  await page.mouse.move(200, 200);
  await page.mouse.down();
  await page.mouse.move(350, 350);
  await page.mouse.up();

  stepLogger.log('Rectangle created');
  await page.screenshot({ path: screenshotPath.replace('.png', '-02-created.png') });

  // Select and move
  await page.click('[data-testid="toolbar-selection"]');
  await page.mouse.click(275, 275);
  await page.mouse.move(275, 275);
  await page.mouse.down();
  await page.mouse.move(475, 275);
  await page.mouse.up();

  stepLogger.log('Rectangle moved');
  await page.screenshot({ path: screenshotPath.replace('.png', '-03-moved.png') });
}`,

  moveBindingArrow: `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  await page.goto('${EXCALIDRAW_URL}');
  await page.waitForSelector('[data-testid="canvas"]');

  // Create first rectangle
  await page.click('[data-testid="toolbar-rectangle"]');
  await page.mouse.move(100, 200);
  await page.mouse.down();
  await page.mouse.move(200, 300);
  await page.mouse.up();

  // Create second rectangle
  await page.mouse.move(400, 200);
  await page.mouse.down();
  await page.mouse.move(500, 300);
  await page.mouse.up();

  // Draw arrow connecting them
  await page.click('[data-testid="toolbar-arrow"]');
  await page.mouse.move(200, 250);
  await page.mouse.down();
  await page.mouse.move(400, 250);
  await page.mouse.up();

  stepLogger.log('Two rectangles with arrow');
  await page.screenshot({ path: screenshotPath.replace('.png', '-01-baseline.png') });

  // Move first rectangle
  await page.click('[data-testid="toolbar-selection"]');
  await page.mouse.click(150, 250);
  await page.mouse.move(150, 250);
  await page.mouse.down();
  await page.mouse.move(150, 400);
  await page.mouse.up();

  stepLogger.log('Arrow updated after move');
  await page.screenshot({ path: screenshotPath.replace('.png', '-02-moved.png') });
}`,

  altDragDuplicate: `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  await page.goto('${EXCALIDRAW_URL}');
  await page.waitForSelector('[data-testid="canvas"]');

  // Create rectangle
  await page.click('[data-testid="toolbar-rectangle"]');
  await page.mouse.move(200, 200);
  await page.mouse.down();
  await page.mouse.move(350, 350);
  await page.mouse.up();

  stepLogger.log('Original rectangle');
  await page.screenshot({ path: screenshotPath.replace('.png', '-01-original.png') });

  // ALT+drag to duplicate
  await page.click('[data-testid="toolbar-selection"]');
  await page.mouse.click(275, 275);
  await page.keyboard.down('Alt');
  await page.mouse.move(275, 275);
  await page.mouse.down();
  await page.mouse.move(475, 275);
  await page.mouse.up();
  await page.keyboard.up('Alt');

  stepLogger.log('Original + duplicate');
  await page.screenshot({ path: screenshotPath.replace('.png', '-02-duplicated.png') });
}`,

  rotateArrowBinding: `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  await page.goto('${EXCALIDRAW_URL}');
  await page.waitForSelector('[data-testid="canvas"]');

  // Create rectangle
  await page.click('[data-testid="toolbar-rectangle"]');
  await page.mouse.move(300, 200);
  await page.mouse.down();
  await page.mouse.move(450, 350);
  await page.mouse.up();

  // Draw arrow to rectangle
  await page.click('[data-testid="toolbar-arrow"]');
  await page.mouse.move(100, 275);
  await page.mouse.down();
  await page.mouse.move(300, 275);
  await page.mouse.up();

  stepLogger.log('Rectangle with bound arrow');
  await page.screenshot({ path: screenshotPath.replace('.png', '-01-baseline.png') });

  // Select rectangle and rotate
  await page.click('[data-testid="toolbar-selection"]');
  await page.mouse.click(375, 275);
  // Use rotation handle (top-center + offset)
  await page.mouse.move(375, 150);
  await page.mouse.down();
  await page.mouse.move(475, 200);
  await page.mouse.up();

  stepLogger.log('Arrow updated after rotation');
  await page.screenshot({ path: screenshotPath.replace('.png', '-02-rotated.png') });
}`,

  undoElementCreation: `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  await page.goto('${EXCALIDRAW_URL}');
  await page.waitForSelector('[data-testid="canvas"]');

  stepLogger.log('Empty canvas');
  await page.screenshot({ path: screenshotPath.replace('.png', '-01-empty.png') });

  // Create rectangle
  await page.click('[data-testid="toolbar-rectangle"]');
  await page.mouse.move(200, 200);
  await page.mouse.down();
  await page.mouse.move(350, 350);
  await page.mouse.up();

  stepLogger.log('Rectangle created');
  await page.screenshot({ path: screenshotPath.replace('.png', '-02-created.png') });

  // Undo
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);

  stepLogger.log('After undo (should be empty)');
  await page.screenshot({ path: screenshotPath.replace('.png', '-03-undone.png') });
}`,

  redoElementCreation: `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  await page.goto('${EXCALIDRAW_URL}');
  await page.waitForSelector('[data-testid="canvas"]');

  // Create and undo
  await page.click('[data-testid="toolbar-rectangle"]');
  await page.mouse.move(200, 200);
  await page.mouse.down();
  await page.mouse.move(350, 350);
  await page.mouse.up();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);

  stepLogger.log('After undo');
  await page.screenshot({ path: screenshotPath.replace('.png', '-01-undone.png') });

  // Redo
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(200);

  stepLogger.log('After redo (rectangle restored)');
  await page.screenshot({ path: screenshotPath.replace('.png', '-02-redone.png') });
}`,

  undoMultipleOperations: `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  await page.goto('${EXCALIDRAW_URL}');
  await page.waitForSelector('[data-testid="canvas"]');

  stepLogger.log('Empty canvas');
  await page.screenshot({ path: screenshotPath.replace('.png', '-01-empty.png') });

  // Create rectangle
  await page.click('[data-testid="toolbar-rectangle"]');
  await page.mouse.move(200, 200);
  await page.mouse.down();
  await page.mouse.move(350, 350);
  await page.mouse.up();

  stepLogger.log('Rectangle created');
  await page.screenshot({ path: screenshotPath.replace('.png', '-02-created.png') });

  // Move rectangle
  await page.click('[data-testid="toolbar-selection"]');
  await page.mouse.click(275, 275);
  await page.mouse.move(275, 275);
  await page.mouse.down();
  await page.mouse.move(475, 275);
  await page.mouse.up();

  stepLogger.log('Rectangle moved');
  await page.screenshot({ path: screenshotPath.replace('.png', '-03-moved.png') });

  // Undo move
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);

  stepLogger.log('Undo move (back to original position)');
  await page.screenshot({ path: screenshotPath.replace('.png', '-04-undo-move.png') });

  // Undo create
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);

  stepLogger.log('Undo create (empty canvas)');
  await page.screenshot({ path: screenshotPath.replace('.png', '-05-undo-create.png') });
}`,

  undoRedoButtonState: `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  await page.goto('${EXCALIDRAW_URL}');
  await page.waitForSelector('[data-testid="canvas"]');

  stepLogger.log('Initial - undo should be disabled');
  await page.screenshot({ path: screenshotPath.replace('.png', '-01-initial.png') });

  // Create element
  await page.click('[data-testid="toolbar-rectangle"]');
  await page.mouse.move(200, 200);
  await page.mouse.down();
  await page.mouse.move(350, 350);
  await page.mouse.up();

  stepLogger.log('After create - undo enabled');
  await page.screenshot({ path: screenshotPath.replace('.png', '-02-undo-enabled.png') });

  // Undo
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);

  stepLogger.log('After undo - redo enabled');
  await page.screenshot({ path: screenshotPath.replace('.png', '-03-redo-enabled.png') });
}`,
};

// Test definitions
const TEST_DEFINITIONS = [
  {
    name: 'Move Element Basic',
    code: TEST_CODES.moveElementBasic,
    targetUrl: EXCALIDRAW_URL,
    suite: 'Move Tests',
  },
  {
    name: 'Move Binding Arrow',
    code: TEST_CODES.moveBindingArrow,
    targetUrl: EXCALIDRAW_URL,
    suite: 'Move Tests',
  },
  {
    name: 'ALT+Drag Duplicate',
    code: TEST_CODES.altDragDuplicate,
    targetUrl: EXCALIDRAW_URL,
    suite: 'Move Tests',
  },
  {
    name: 'Rotate Arrow Binding',
    code: TEST_CODES.rotateArrowBinding,
    targetUrl: EXCALIDRAW_URL,
    suite: 'Rotate Tests',
  },
  {
    name: 'Undo Element Creation',
    code: TEST_CODES.undoElementCreation,
    targetUrl: EXCALIDRAW_URL,
    suite: 'History Tests',
  },
  {
    name: 'Redo Element Creation',
    code: TEST_CODES.redoElementCreation,
    targetUrl: EXCALIDRAW_URL,
    suite: 'History Tests',
  },
  {
    name: 'Undo Multiple Operations',
    code: TEST_CODES.undoMultipleOperations,
    targetUrl: EXCALIDRAW_URL,
    suite: 'History Tests',
  },
  {
    name: 'Undo/Redo Button State',
    code: TEST_CODES.undoRedoButtonState,
    targetUrl: EXCALIDRAW_URL,
    suite: 'History Tests',
  },
];

// Suite definitions
const SUITE_DEFINITIONS = [
  { name: 'Move Tests', description: 'Element positioning and movement tests' },
  { name: 'Rotate Tests', description: 'Element rotation and binding tests' },
  { name: 'History Tests', description: 'Undo/redo flow tests' },
];

async function seed() {
  console.log('Seeding Excalidraw tests...\n');

  const now = new Date();

  // 1. Create Functional Area
  const areaId = uuid();
  await db.insert(functionalAreas).values({
    id: areaId,
    repositoryId: null,
    name: 'Excalidraw',
    description: 'Visual regression tests for Excalidraw drawing operations',
    orderIndex: 0,
  });
  console.log(`✓ Created functional area: Excalidraw (${areaId})`);

  // 2. Create Tests
  const testIdMap = new Map<string, string>();
  for (const def of TEST_DEFINITIONS) {
    const testId = uuid();
    testIdMap.set(def.name, testId);

    await db.insert(tests).values({
      id: testId,
      repositoryId: null,
      functionalAreaId: areaId,
      name: def.name,
      code: def.code,
      targetUrl: def.targetUrl,
      createdAt: now,
      updatedAt: now,
    });

    // Create initial version
    await db.insert(testVersions).values({
      id: uuid(),
      testId,
      version: 1,
      code: def.code,
      name: def.name,
      targetUrl: def.targetUrl,
      changeReason: 'initial',
      createdAt: now,
    });

    console.log(`✓ Created test: ${def.name}`);
  }

  // 3. Create Suites
  const suiteIdMap = new Map<string, string>();
  for (const def of SUITE_DEFINITIONS) {
    const suiteId = uuid();
    suiteIdMap.set(def.name, suiteId);

    await db.insert(suites).values({
      id: suiteId,
      repositoryId: null,
      functionalAreaId: areaId,
      name: def.name,
      description: def.description,
      orderIndex: 0,
      createdAt: now,
      updatedAt: now,
    });

    console.log(`✓ Created suite: ${def.name}`);
  }

  // 4. Add tests to suites
  for (const def of TEST_DEFINITIONS) {
    const testId = testIdMap.get(def.name)!;
    const suiteId = suiteIdMap.get(def.suite)!;

    // Get current order index for this suite
    const existingTests = await db
      .select()
      .from(suiteTests)
      .where((row: { suiteId: string }) => row.suiteId === suiteId)
      .all();

    const orderIndex = existingTests.length;

    await db.insert(suiteTests).values({
      id: uuid(),
      suiteId,
      testId,
      orderIndex,
      createdAt: now,
    });
  }
  console.log(`✓ Added tests to suites`);

  console.log('\n✓ Seed complete!');
  console.log(`  - 1 Functional Area`);
  console.log(`  - ${TEST_DEFINITIONS.length} Tests`);
  console.log(`  - ${SUITE_DEFINITIONS.length} Suites`);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
