/**
 * Script to generate PNG test fixtures
 * Run with: ts-node src/lib/__tests__/generate-fixtures.ts
 */
import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';

const fixturesDir = path.join(__dirname, 'fixtures');

// Ensure directory exists
if (!fs.existsSync(fixturesDir)) {
  fs.mkdirSync(fixturesDir, { recursive: true });
}

function createBaseline() {
  const png = new PNG({ width: 800, height: 600 });

  // Fill with white background
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (png.width * y + x) << 2;
      png.data[idx] = 255;     // R
      png.data[idx + 1] = 255; // G
      png.data[idx + 2] = 255; // B
      png.data[idx + 3] = 255; // A
    }
  }

  // Draw black rectangle (200x150) at (300, 225)
  for (let y = 225; y < 375; y++) {
    for (let x = 300; x < 500; x++) {
      const idx = (png.width * y + x) << 2;
      png.data[idx] = 0;       // R
      png.data[idx + 1] = 0;   // G
      png.data[idx + 2] = 0;   // B
      png.data[idx + 3] = 255; // A
    }
  }

  const buffer = PNG.sync.write(png);
  fs.writeFileSync(path.join(fixturesDir, 'baseline.png'), buffer);
  console.log('✓ Created baseline.png');
}

function createIdentical() {
  const baseline = fs.readFileSync(path.join(fixturesDir, 'baseline.png'));
  fs.writeFileSync(path.join(fixturesDir, 'identical.png'), baseline);
  console.log('✓ Created identical.png');
}

function createShifted() {
  const png = new PNG({ width: 800, height: 600 });

  // Fill with white background
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (png.width * y + x) << 2;
      png.data[idx] = 255;
      png.data[idx + 1] = 255;
      png.data[idx + 2] = 255;
      png.data[idx + 3] = 255;
    }
  }

  // Draw black rectangle shifted down 50px (200x150) at (300, 275)
  for (let y = 275; y < 425; y++) {
    for (let x = 300; x < 500; x++) {
      const idx = (png.width * y + x) << 2;
      png.data[idx] = 0;
      png.data[idx + 1] = 0;
      png.data[idx + 2] = 0;
      png.data[idx + 3] = 255;
    }
  }

  const buffer = PNG.sync.write(png);
  fs.writeFileSync(path.join(fixturesDir, 'shifted.png'), buffer);
  console.log('✓ Created shifted.png');
}

function createColorChanged() {
  const png = new PNG({ width: 800, height: 600 });

  // Fill with white background
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (png.width * y + x) << 2;
      png.data[idx] = 255;
      png.data[idx + 1] = 255;
      png.data[idx + 2] = 255;
      png.data[idx + 3] = 255;
    }
  }

  // Draw red rectangle (200x150) at (300, 225)
  for (let y = 225; y < 375; y++) {
    for (let x = 300; x < 500; x++) {
      const idx = (png.width * y + x) << 2;
      png.data[idx] = 255;     // R
      png.data[idx + 1] = 0;   // G
      png.data[idx + 2] = 0;   // B
      png.data[idx + 3] = 255; // A
    }
  }

  const buffer = PNG.sync.write(png);
  fs.writeFileSync(path.join(fixturesDir, 'color-changed.png'), buffer);
  console.log('✓ Created color-changed.png');
}

function createSizeChanged() {
  const png = new PNG({ width: 1024, height: 768 });

  // Fill with white background
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (png.width * y + x) << 2;
      png.data[idx] = 255;
      png.data[idx + 1] = 255;
      png.data[idx + 2] = 255;
      png.data[idx + 3] = 255;
    }
  }

  // Draw black rectangle (200x150) at (400, 300)
  for (let y = 300; y < 450; y++) {
    for (let x = 400; x < 600; x++) {
      const idx = (png.width * y + x) << 2;
      png.data[idx] = 0;
      png.data[idx + 1] = 0;
      png.data[idx + 2] = 0;
      png.data[idx + 3] = 255;
    }
  }

  const buffer = PNG.sync.write(png);
  fs.writeFileSync(path.join(fixturesDir, 'size-changed.png'), buffer);
  console.log('✓ Created size-changed.png');
}

// Generate all fixtures
createBaseline();
createIdentical();
createShifted();
createColorChanged();
createSizeChanged();

console.log('\n✅ All fixtures created successfully!');
