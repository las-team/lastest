/* eslint-disable @typescript-eslint/no-require-imports */
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const db = new Database("./lastest2.db");

const repoId = "c8fc9e1c-413d-4013-9920-cdbab5fe7f0c";

// Check diff sensitivity settings
const diffSettings = db.prepare("SELECT * FROM diff_sensitivity_settings WHERE repository_id = ?").get(repoId);
console.log("=== DIFF SENSITIVITY SETTINGS ===");
if (diffSettings) {
  Object.keys(diffSettings).forEach(k => {
    if (diffSettings[k] !== null) console.log("  " + k + ":", diffSettings[k]);
  });
} else {
  console.log("  No settings found (using defaults)");
}

// Check the 2 test results that exist
const testRunId = "6ec1d130-b036-466a-bda3-4ef9fa927d6d";
const results = db.prepare("SELECT * FROM test_results WHERE test_run_id = ?").all(testRunId);
console.log("\n=== TEST RESULTS ===");
results.forEach(r => {
  const test = db.prepare("SELECT name FROM tests WHERE id = ?").get(r.test_id);
  console.log("Test:", test ? test.name : r.test_id);
  console.log("  Status:", r.status, "| Duration:", r.duration_ms, "ms");

  // Check screenshot dimensions
  if (r.screenshots) {
    try {
      const screenshots = JSON.parse(r.screenshots);
      screenshots.forEach(s => {
        const fullPath = path.join("public", s.path);
        if (fs.existsSync(fullPath)) {
          const stats = fs.statSync(fullPath);
          console.log("  Screenshot:", s.path, "| Size:", Math.round(stats.size / 1024), "KB");
        } else {
          console.log("  Screenshot:", s.path, "(NOT FOUND)");
        }
      });
    } catch(_e) {}
  }
  if (r.screenshot_path) {
    const fullPath = path.join("public", r.screenshot_path);
    if (fs.existsSync(fullPath)) {
      const stats = fs.statSync(fullPath);
      console.log("  Screenshot:", r.screenshot_path, "| Size:", Math.round(stats.size / 1024), "KB");
    }
  }
});

// Check visual diffs for these test results
console.log("\n=== VISUAL DIFFS FOR THIS BUILD ===");
const diffs = db.prepare("SELECT * FROM visual_diffs WHERE build_id = 'd15f22b9-4a4b-4cfa-9f3d-a6dab81598ec'").all();
console.log("Count:", diffs.length);
diffs.forEach(d => {
  console.log("  Diff:", d.id.substring(0, 8), "| Classification:", d.classification, "| Status:", d.status);
  console.log("  Pixel diff:", d.pixel_difference, "| Pct:", d.percentage_difference);
  if (d.current_image_path) {
    const fullPath = path.join("public", d.current_image_path);
    if (fs.existsSync(fullPath)) {
      const stats = fs.statSync(fullPath);
      console.log("  Current image size:", Math.round(stats.size / 1024), "KB");
    }
  }
  if (d.baseline_image_path) {
    const fullPath = path.join("public", d.baseline_image_path);
    if (fs.existsSync(fullPath)) {
      const stats = fs.statSync(fullPath);
      console.log("  Baseline image size:", Math.round(stats.size / 1024), "KB");
    }
  }
});

// Check what tests were supposed to run (the 3 active ones)
console.log("\n=== TESTS IN REPO ===");
const tests = db.prepare("SELECT id, name, target_url FROM tests WHERE repository_id = ?").all(repoId);
console.log("Total tests:", tests.length);
const activeTests = ["book-a-meeting", "contact", "blog"];
activeTests.forEach(name => {
  const t = tests.find(t => t.name.toLowerCase().includes(name));
  if (t) console.log("  ", t.name, "| URL:", t.target_url);
});

// Check baselines for these tests
console.log("\n=== BASELINES CHECK ===");
const baselineCount = db.prepare("SELECT COUNT(*) as count FROM baselines WHERE repository_id = ?").get(repoId);
console.log("Total baselines for repo:", baselineCount ? baselineCount.count : 0);

db.close();
