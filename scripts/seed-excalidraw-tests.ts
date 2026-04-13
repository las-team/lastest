/**
 * Seed script for Excalidraw visual regression tests
 *
 * Populates the excalidraw repository with 29 tests.
 * Generated from Zima production database dump (2026-03-30).
 *
 * Run: pnpm tsx scripts/seed-excalidraw-tests.ts
 */

import { db } from '../src/lib/db';
import { tests, testVersions, repositories, functionalAreas } from '../src/lib/db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';

const EXCALIDRAW_REPO_NAME = 'dexilion-team/excalidraw';

// Will be set dynamically
let REPO_ID: string;

// Functional area definitions (with hierarchy)
const FUNCTIONAL_AREA_DEFINITIONS: Array<{ name: string; description?: string; parent?: string }> = [
  { name: "Arrow Binding", description: "As a user, I want to connect arrows to shapes and add labels to arrows, so that I can create connected diagrams and flowcharts with annotations" },
  { name: "Arrows binding to bindables", description: "Arrows' ability to bind and follow bindable shapes.", parent: "Arrow Binding" },
  { name: "Binding focus point", description: "The modifiable focus point handling tests.", parent: "Arrow Binding" },
  { name: "Generic", description: "based on unit tests" },
];

// Test definitions with complete code
const TEST_DEFINITIONS: Array<{
  name: string;
  code: string;
  targetUrl: string;
  description?: string;
  functionalArea?: string;
  executionMode?: string;
  agentPrompt?: string;
  setupOverrides?: string;
  teardownOverrides?: string;
  viewportOverride?: string;
  diffOverrides?: string;
  playwrightOverrides?: string;
  stabilizationOverrides?: string;
}> = [
  {
    name: "Test 1: Move Element Basic",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Generic",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          // Parse role=button[name="Label"] format and use getByRole
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        // Use .first() to handle multiple matches (e.g., header + footer nav links)
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'click') await target.click();
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return;
      } catch { continue; }
    }
    // Coordinate fallback for clicks when all selectors fail
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  // Replay cursor path helper
  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[1248,477,0],[1042,440,39],[912,409,33],[831,386,33],[791,366,34],[781,350,33],[778,343,33],[777,337,34]]);
  await replayCursorPath(page, [[774,332,33],[763,324,33],[729,310,34],[680,293,33],[634,271,33],[599,242,34],[563,207,33],[535,176,34],[519,150,32],[511,129,34],[508,112,33],[507,97,42],[508,92,33],[509,89,33],[511,84,34],[512,78,33],[514,71,34],[516,64,33]]);
  await replayCursorPath(page, [[519,54,34],[521,46,33],[522,41,33],[522,39,33],[522,36,34],[523,36,99],[523,36,50],[522,36,109],[522,36,133],[522,36,83]]);
  await page.mouse.move(522, 36);
  await page.mouse.down();
  await page.mouse.move(522, 36);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"svg > g > rect"}], 'click', null, {"x":520,"y":38});
  await locateWithFallback(page, [{"type":"role-name","value":"role=radio[name=\\"Rectangle\\"]"},{"type":"name","value":"[name=\\"editor-current-shape\\"]"},{"type":"css-path","value":"div.Stack.Stack_horizontal > label.ToolIcon.Shape > input.ToolIcon_type_radio.ToolIcon_size_medium"}], 'click', null, {"x":514,"y":40});
  await replayCursorPath(page, [[522,36,475],[522,36,142],[522,36,91],[517,42,34]]);
  await replayCursorPath(page, [[507,53,33],[500,63,33],[492,77,34],[485,95,33],[479,115,34],[475,126,33],[474,134,33],[472,138,33],[471,140,34],[469,144,34],[465,152,41],[460,159,33],[458,163,34],[455,167,33],[455,167,133],[453,169,33],[440,174,34],[416,178,33],[393,181,34],[383,181,33],[383,181,66],[383,181,34],[383,181,41],[383,181,34],[383,181,42],[383,181,33],[383,181,41],[383,181,34],[383,180,33],[383,179,33],[383,179,33],[383,179,34],[383,179,42],[383,179,33],[383,179,33],[383,179,43]]);
  await page.mouse.move(383, 179);
  await page.mouse.down();
  await replayCursorPath(page, [[383,179,175],[383,179,107],[383,182,34],[388,190,33],[391,194,33],[391,194,42],[391,194,59],[391,195,41],[396,205,33],[403,216,34],[408,227,33],[414,236,34],[420,248,33],[430,264,33],[441,282,34],[452,296,33],[463,307,33],[473,316,34],[479,321,33],[487,325,33],[497,330,33],[504,332,33],[510,333,34],[516,334,33],[524,337,34],[533,340,33],[544,343,33],[551,346,34],[555,347,34],[562,350,32],[566,352,33],[568,352,35],[568,353,90],[571,354,34],[571,355,33],[571,355,37],[571,355,30],[573,357,33],[575,361,34],[576,362,33],[577,365,34],[577,366,33]]);
  await page.mouse.move(577, 366);
  await page.mouse.up();
  await replayCursorPath(page, [[577,365,2692],[577,365,49],[576,362,34],[572,356,33],[564,347,34],[558,339,33],[547,329,42],[537,319,32],[526,309,34],[517,301,34],[511,295,32],[506,290,34],[499,283,42],[489,273,34],[481,266,33],[477,262,32],[473,257,34],[472,257,59],[472,257,492],[472,257,166],[472,257,58],[472,258,34],[472,259,316],[472,260,34],[472,260,41],[472,261,34],[472,262,516],[472,263,108],[472,263,42]]);
  await page.mouse.move(472, 263);
  await page.mouse.down();
  await replayCursorPath(page, [[472,263,591],[472,264,33],[473,265,34],[474,267,34],[476,270,33],[480,273,33],[482,277,34],[488,283,32],[498,293,35],[513,305,32],[532,316,34],[550,326,33],[569,335,34],[585,342,33],[602,350,33],[622,358,34],[644,366,33],[669,375,33],[690,381,34],[704,386,33],[718,392,34],[735,399,32],[749,405,34],[754,408,33],[755,409,34],[760,413,33],[766,417,33],[774,424,33],[781,430,34],[785,432,33],[785,432,34],[785,433,32],[787,434,42],[788,435,42],[788,435,208]]);
  await page.mouse.move(788, 435);
  await page.mouse.up();
  await replayCursorPath(page, [[788,435,1092],[788,435,42],[788,435,41],[788,437,34],[787,440,34],[788,440,75],[791,441,33],[810,434,33],[890,440,33],[1022,451,34],[1222,466,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}`,
  },
  {
    name: "Test 1b: Move Element Advanced",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Generic",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          // Parse role=button[name="Label"] format and use getByRole
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        // Use .first() to handle multiple matches (e.g., header + footer nav links)
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'click') await target.click();
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return;
      } catch { continue; }
    }
    // Coordinate fallback for clicks when all selectors fail
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  // Replay cursor path helper
  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[1262,469,0],[1147,454,40],[1060,446,33],[978,441,32],[902,438,42],[850,439,26],[813,440,33]]);
  await replayCursorPath(page, [[787,438,35],[771,436,31],[765,435,34],[765,435,42],[765,435,57],[765,435,34],[764,435,42],[764,435,33],[765,435,33],[765,435,42],[765,435,42],[765,435,50],[765,435,33],[765,435,41],[765,435,76],[765,435,600]]);
  await page.mouse.move(765, 435);
  await page.mouse.down();
  await page.mouse.move(765, 435);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\\"Live collaboration...\\"]"},{"type":"css-path","value":"div.welcome-screen-center > div.welcome-screen-menu > button.welcome-screen-menu-item"}], 'click', null, {"x":640,"y":445});
  await replayCursorPath(page, [[765,435,2250],[765,435,41],[756,436,34],[753,437,32],[752,437,34],[752,437,42],[752,437,158],[752,437,201],[761,436,33],[797,434,33],[849,435,34]]);
  await page.keyboard.press('Escape');
  await replayCursorPath(page, [[877,435,34],[881,435,32],[882,435,300],[891,433,34],[910,424,33],[930,408,33],[941,396,34],[945,386,33],[947,383,33]]);
  await page.mouse.move(947, 383);
  await page.mouse.down();
  await page.mouse.move(947, 383);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"div.excalidraw-app > div.excalidraw.excalidraw-container > canvas.excalidraw__canvas.interactive"}], 'click', null, {"x":640,"y":360});
  await replayCursorPath(page, [[947,383,142],[947,384,117],[947,384,133],[947,384,42],[946,385,33],[945,385,75],[946,385,50],[946,385,49],[946,385,67],[947,386,418]]);
  await page.keyboard.press('2');
  await replayCursorPath(page, [[946,386,1916],[927,389,33],[905,392,33],[897,389,33],[887,379,34],[871,367,33],[851,359,33],[821,350,34],[787,341,33],[751,334,33],[717,331,34],[697,330,33],[689,329,34],[674,328,33],[653,324,33],[621,314,34],[579,299,33],[538,282,34],[509,268,33],[496,259,33],[494,259,42],[494,258,37],[494,258,113],[494,258,42],[493,258,65],[492,258,34],[491,257,34],[485,256,33],[480,254,33],[477,254,33],[468,252,34],[455,249,33],[448,247,33],[440,244,34],[438,243,41],[438,243,34],[438,243,50]]);
  await page.mouse.move(438, 242);
  await page.mouse.down();
  await replayCursorPath(page, [[438,243,75],[438,243,41],[441,251,34],[457,272,33],[489,301,42],[522,328,34],[569,361,41],[612,385,33],[648,406,34],[680,424,33],[709,439,33],[728,449,34],[751,463,33],[785,481,33],[820,496,34],[842,505,33],[845,507,41],[845,507,158],[845,507,100],[845,507,43]]);
  await page.mouse.move(845, 507);
  await page.mouse.up();
  await replayCursorPath(page, [[845,506,50],[845,506,166],[845,506,58],[845,506,2734],[936,485,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1265,333,2317],[1167,332,32],[1061,327,33],[945,323,33],[838,318,34],[753,310,33],[676,300,34],[633,295,33],[614,293,33],[605,294,34],[605,294,33],[605,294,34],[604,294,50],[601,296,33],[599,300,33],[596,307,34],[593,317,38],[594,332,28],[598,346,34],[601,353,33],[603,354,49],[603,355,51],[604,356,33],[604,359,33],[604,363,33],[606,364,59],[609,366,33],[614,368,33],[618,368,34],[619,368,33],[619,368,34],[621,368,33],[622,368,42],[622,368,33],[622,368,284]]);
  await page.mouse.move(622, 368);
  await page.mouse.down();
  await replayCursorPath(page, [[622,368,335],[623,369,889],[626,369,34],[628,370,33],[630,372,33],[631,372,34],[633,373,33],[635,373,41],[635,373,34],[636,374,42],[637,374,33],[637,374,50],[639,375,34],[645,379,33],[654,385,33],[662,390,33],[670,394,33],[682,404,34],[699,420,34],[712,432,41],[712,432,33],[713,432,34],[718,432,33],[725,432,34],[728,433,33],[735,434,33],[744,438,33],[764,448,33],[784,459,34],[798,469,33],[814,478,33],[827,484,34],[835,487,34],[839,489,33],[842,489,33],[848,492,33],[854,494,34],[865,498,33],[867,498,41],[867,498,217],[867,498,83],[868,498,33],[875,496,34],[880,494,33],[882,494,33],[883,494,34],[885,493,34],[887,493,41],[890,493,39]]);
  await page.mouse.move(890, 493);
  await page.mouse.up();
  await replayCursorPath(page, [[890,493,561],[890,494,601],[927,502,41],[1043,506,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1266,150,2125],[1195,159,32],[1168,165,34],[1163,168,33],[1152,176,38],[1135,187,28],[1111,200,34],[1076,217,33],[1026,230,34],[976,237,33],[938,240,34],[925,241,33],[925,241,183],[925,241,841],[925,241,2292],[959,240,34],[1123,226,33]]);
}`,
  },
  {
    name: "Test 2: Move Binding Arrow",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Generic",
    stabilizationOverrides: '{"reseedRandomOnInput":false}',
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target;
        if (action === 'click') await target.click();
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    if (action === 'fill' && coords) {
      console.log('Falling back to coordinate fill at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.press('Control+a');
      await page.keyboard.type(value || '');
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[427,479,0],[427,480,39],[427,480,42],[427,480,125],[426,482,109],[380,519,434],[380,515,41],[380,512,52],[381,458,47],[400,403,40],[484,194,46],[493,161,41],[498,115,35],[498,115,54],[497,114,34],[490,107,134],[498,67,48]]);
  await replayCursorPath(page, [[505,59,35],[511,51,33],[520,43,56],[523,41,39],[526,34,46]]);
  await page.mouse.move(526, 33);
  await page.mouse.down();
  await replayCursorPath(page, [[526,33,45],[526,33,47],[526,33,176]]);
  await page.mouse.move(526, 34);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(520, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(514, 40);
  await replayCursorPath(page, [[526,34,37]]);
  await replayCursorPath(page, [[525,35,37],[515,54,61],[510,62,40],[496,86,233],[458,134,49],[458,134,69],[434,166,76],[402,199,89],[402,200,134],[388,211,96],[362,233,43],[363,232,44],[362,232,47],[363,231,41],[363,231,50],[363,231,45],[363,232,46],[363,232,43],[363,232,144],[358,240,36],[357,241,63],[354,244,87]]);
  await page.mouse.move(354, 243);
  await page.mouse.down();
  await replayCursorPath(page, [[354,242,92],[354,243,48],[358,248,39],[371,277,51],[388,299,70],[449,365,39],[476,393,50],[480,395,50],[481,395,42],[484,396,51],[550,400,47],[567,400,47],[582,399,126],[585,399,51],[585,399,254],[585,399,89],[584,399,50],[584,400,85],[584,400,34],[584,400,74],[575,409,189],[573,410,85]]);
  await page.mouse.move(573, 410);
  await page.mouse.up();
  await replayCursorPath(page, [[573,409,50],[573,411,87],[576,414,39],[581,417,58],[642,440,45],[679,452,45],[717,461,48],[719,461,43],[719,461,53],[719,462,34],[720,463,34],[726,466,54],[730,468,61],[730,468,234],[730,468,267],[730,468,49]]);
  await page.keyboard.press('2');
  await replayCursorPath(page, [[730,468,233],[730,468,417],[730,460,33],[729,453,33],[728,445,43],[728,445,75]]);
  await page.mouse.move(728, 445);
  await page.mouse.down();
  await replayCursorPath(page, [[728,445,53],[728,447,38],[729,457,37],[732,464,37],[750,484,58],[760,491,25],[820,531,42],[852,547,36],[892,567,62],[936,593,37],[939,593,34],[939,593,51],[939,593,171],[939,593,50],[938,593,69],[939,593,39],[938,593,42],[938,593,36]]);
  await page.mouse.move(938, 593);
  await page.mouse.up();
  await replayCursorPath(page, [[938,593,216],[938,593,100],[938,593,67],[928,588,45],[873,572,35],[745,540,46],[674,519,35],[640,502,38],[603,478,44],[583,470,36],[562,464,38],[545,464,41],[530,465,40],[512,465,33],[495,466,35],[469,468,49],[446,468,33],[419,470,47],[388,474,37],[322,487,32],[303,493,35],[273,504,49],[266,508,50],[266,509,100],[266,508,68],[267,508,34],[267,508,33],[267,508,35],[267,507,94],[268,502,54],[269,496,34],[272,483,35],[274,474,49],[275,466,50],[276,462,50],[276,460,57],[275,457,42],[275,456,35],[275,456,47],[275,454,107],[275,442,53],[273,437,36],[273,436,72],[272,436,51],[272,436,155],[272,426,70],[272,425,142],[273,422,44],[279,413,39],[285,405,32],[287,403,42],[288,402,90],[288,403,251],[287,402,549],[287,399,35],[292,393,32],[303,384,46],[321,373,41],[335,365,48],[354,355,49],[367,350,35],[408,337,32],[447,326,53],[473,311,33],[494,293,47],[495,289,37],[495,290,41]]);
  await page.keyboard.press('5');
  await replayCursorPath(page, [[495,290,55],[495,290,49],[495,291,253],[495,291,52],[495,292,145],[500,302,152],[506,303,278],[554,302,88],[555,302,50],[555,302,202],[555,303,86],[556,306,45],[556,307,49],[556,307,92],[557,311,152],[557,315,65],[563,318,37],[563,318,81],[579,320,40],[581,320,54],[583,321,46],[583,321,146],[581,326,42],[578,329,237],[578,330,97],[574,329,38],[572,327,40],[572,326,50],[572,326,53]]);
  await page.mouse.move(572, 326);
  await page.mouse.down();
  await replayCursorPath(page, [[572,326,47],[572,326,61],[573,326,57],[577,325,49],[589,321,56],[604,317,33],[622,313,37],[636,313,44],[657,313,33],[693,319,52],[718,325,46],[765,337,48],[780,342,38],[796,351,50],[819,362,46],[832,372,42],[841,381,44],[842,385,32],[842,385,48],[839,399,52],[836,410,39],[835,412,62],[835,412,31],[836,413,60],[836,421,36],[836,425,32],[836,427,46],[835,429,53],[835,431,51],[834,434,57],[834,435,40],[834,435,29],[834,436,81],[833,436,39],[833,436,46],[833,439,38],[833,439,41],[833,439,287],[834,439,32],[834,439,50],[835,440,33],[835,440,40],[835,440,32],[836,442,62],[836,442,81],[836,443,353],[836,443,40],[836,444,35],[836,445,58],[836,445,33],[836,446,49],[836,446,83],[836,446,84],[836,447,42],[836,447,142],[836,446,384],[836,446,331],[836,446,42],[836,446,126],[836,446,81],[836,445,44],[836,445,40],[836,444,55],[836,442,88],[836,440,45],[836,438,48],[836,438,53],[836,438,38],[836,437,324]]);
  await page.mouse.move(836, 437);
  await page.mouse.up();
  await replayCursorPath(page, [[836,437,248],[836,437,69],[836,437,135],[836,437,100],[839,436,111],[881,427,61],[1019,417,88],[1044,409,84],[1064,400,90],[1065,398,65],[1065,398,317],[1064,398,123],[1056,393,47],[1055,393,163],[1055,393,368],[1044,386,78],[982,368,96],[860,347,84],[782,323,97],[688,303,92],[572,288,97],[443,272,140],[290,271,57],[281,273,107],[248,293,66],[228,319,122],[225,321,46],[225,320,32],[224,320,132],[224,320,86],[224,320,50],[224,320,48],[224,320,35],[224,320,101],[224,320,36],[224,320,46],[221,323,32],[217,325,67]]);
  await replayCursorPath(page, [[214,329,33],[214,329,57],[209,338,43],[202,350,35],[198,362,36]]);
  await replayCursorPath(page, [[196,369,53],[194,372,35],[194,373,61],[193,374,48],[193,374,92],[193,374,41],[192,375,108],[183,384,38]]);
  await replayCursorPath(page, [[182,385,60],[182,385,40],[181,387,75],[168,393,123],[162,396,39],[154,400,38],[147,403,48],[147,403,48],[146,403,126],[146,403,41],[146,404,33],[146,404,33],[145,404,34],[145,404,33],[145,404,219],[144,404,30],[141,405,34]]);
  await replayCursorPath(page, [[137,407,33],[133,407,33],[130,408,37],[127,408,48]]);
  await page.mouse.move(127, 408);
  await page.mouse.down();
  await replayCursorPath(page, [[127,408,199]]);
  await page.mouse.move(127, 408);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(124, 405);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(125, 407);
  await replayCursorPath(page, [[127,408,132],[127,407,186],[128,408,540],[129,408,43]]);
  await replayCursorPath(page, [[219,416,41],[291,422,36],[363,432,38],[414,437,33],[429,438,34],[429,438,35],[432,437,46],[440,438,35],[446,438,34],[450,438,33],[463,438,41],[478,438,38],[493,439,53],[503,441,33],[523,445,34],[548,450,33],[582,457,34],[606,463,36],[619,472,50],[619,478,50],[617,496,50],[615,513,33],[612,529,34],[601,579,47],[595,620,33],[586,650,33],[575,681,33],[563,703,34],[556,718,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[732,707,1567],[838,644,35],[901,586,34],[929,552,34],[939,537,32],[939,537,50],[939,537,51],[938,537,33],[937,537,34],[935,538,100],[883,549,64],[883,549,69],[883,549,128],[883,548,36]]);
  await page.mouse.move(883, 548);
  await page.mouse.down();
  await page.mouse.move(883, 548);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[883,548,300],[883,548,100],[884,548,98],[894,542,37],[904,537,56],[917,529,108],[927,521,77]]);
  await page.mouse.move(940, 511);
  await page.mouse.down();
  await replayCursorPath(page, [[940,511,178]]);
  await page.mouse.move(940, 511);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[940,511,277],[940,512,54],[940,512,34],[940,512,86],[940,512,165],[939,514,75],[928,522,89],[919,527,85],[919,527,167],[919,527,117],[919,527,93],[919,527,53],[919,527,37],[920,525,41],[920,523,42],[920,523,50],[920,523,150],[920,523,34],[922,523,39],[924,523,36],[926,523,33],[927,523,41],[930,524,32],[932,524,50],[932,524,150],[934,525,34],[935,525,32],[935,526,33]]);
  await page.mouse.move(936, 526);
  await page.mouse.down();
  await replayCursorPath(page, [[935,526,160],[935,526,76],[935,526,65],[936,526,51],[936,526,45],[936,525,37],[938,525,37],[942,524,33],[963,517,38],[993,513,34],[1017,510,44],[1035,507,50],[1047,506,43],[1054,506,38],[1068,504,40],[1078,504,34],[1090,505,47],[1096,505,42],[1098,505,36],[1108,506,46],[1115,506,57],[1123,506,41],[1146,509,53],[1157,510,49],[1162,510,57],[1164,510,40],[1164,510,45],[1164,511,64],[1165,511,42],[1165,510,226],[1170,486,32],[1170,449,48],[1167,425,34],[1158,380,42],[1154,358,60],[1153,337,36],[1153,316,37],[1152,294,34],[1152,264,43],[1151,244,53],[1148,230,34],[1145,208,35],[1142,194,46],[1141,183,36],[1137,162,44],[1137,159,36],[1136,152,40],[1135,151,49],[1135,151,76],[1135,151,36],[1135,153,43],[1134,154,38],[1130,160,72],[1122,172,36],[1119,179,37],[1114,190,41],[1108,205,45],[1108,206,98],[1106,211,39],[1105,211,106],[1105,211,62],[1101,216,57],[1099,220,35],[1099,220,54],[1099,220,84],[1099,220,201],[1099,220,131]]);
  await page.mouse.move(1099, 220);
  await page.mouse.up();
  await replayCursorPath(page, [[1099,220,145],[1095,236,39],[1088,248,38],[1017,336,46],[979,376,53],[822,562,36],[798,595,59],[775,641,36],[764,663,55],[744,701,41],[741,705,36]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[901,718,1743],[906,714,43],[905,709,33],[906,708,47],[906,708,179],[906,708,107],[906,708,99],[906,708,100],[906,708,33],[906,708,51],[906,709,65],[906,709,33],[906,709,35],[906,709,34],[905,710,49],[905,711,42],[905,712,41],[903,717,33],[876,719,1501],[875,717,33],[875,717,100],[875,717,32],[875,717,67],[875,717,51],[874,716,40],[874,715,43],[874,714,35],[873,714,32],[873,714,119],[873,713,48],[873,713,34],[873,712,32],[873,712,35],[872,711,49],[872,711,99],[872,711,101],[872,711,100],[872,711,49],[871,711,40],[871,710,60],[870,710,32],[870,710,34],[870,710,44],[870,709,41],[869,709,40],[869,709,60],[869,709,50],[869,709,33],[869,709,100],[869,709,106],[868,709,125],[868,709,102],[868,709,134],[868,709,216],[868,709,68],[868,710,32],[849,714,44],[827,714,40],[820,715,50],[820,717,43],[820,717,75],[819,715,31],[819,714,34],[819,714,32],[819,714,34],[819,714,34],[818,714,135],[818,714,682],[818,714,82],[818,714,84],[818,713,60],[818,712,40],[818,712,34],[818,711,35],[818,711,32],[818,711,49],[818,711,150],[818,711,117],[808,708,43],[803,707,52],[796,706,51],[787,704,55],[784,704,42],[777,705,41],[719,713,43],[641,711,39],[169,641,45]]);
  await replayCursorPath(page, [[85,411,1602],[287,417,41],[436,428,47],[638,455,123],[1152,558,76],[1114,697,64]]);
}
`,
  },
  {
    name: "Test 3: ALT+Drag Duplicate",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Generic",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          // Parse role=button[name="Label"] format and use getByRole
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        // Use .first() to handle multiple matches (e.g., header + footer nav links)
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'click') await target.click();
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return;
      } catch { continue; }
    }
    // Coordinate fallback for clicks when all selectors fail
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  // Replay cursor path helper
  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[1275,234,0],[1080,213,38],[953,199,34],[832,185,33],[767,178,33],[764,178,42],[764,178,41],[758,169,34],[735,149,42],[693,125,25],[648,99,33],[632,87,33],[629,84,34],[626,81,33],[626,81,33],[626,81,34],[626,81,41],[626,81,33],[626,81,43],[626,81,33],[626,82,33],[625,83,33],[626,104,34],[625,126,34],[619,149,33],[609,168,32],[587,190,34],[551,218,33],[510,238,33],[490,246,34],[489,246,34],[489,246,33]]);
  await page.mouse.move(489, 246);
  await page.mouse.down();
  await replayCursorPath(page, [[489,246,60],[489,246,89]]);
  await page.mouse.move(489, 246);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await page.keyboard.press('3');
  await replayCursorPath(page, [[489,246,334],[489,246,200],[487,249,42],[483,251,24],[476,259,34],[469,267,33],[465,270,34],[463,272,33],[462,273,33],[462,273,126],[462,273,41],[461,267,34],[457,258,33],[451,247,33],[443,235,41],[436,227,26]]);
  await page.mouse.move(435, 227);
  await page.mouse.down();
  await replayCursorPath(page, [[435,227,75],[435,237,33],[441,256,34],[463,289,33],[495,324,33],[528,350,33],[553,373,34],[565,384,33],[567,385,50],[567,385,176],[567,385,66],[568,385,33],[579,385,33],[602,383,34],[612,382,33],[612,382,109]]);
  await page.mouse.move(612, 382);
  await page.mouse.up();
  await replayCursorPath(page, [[612,382,50],[611,381,49],[607,381,34],[600,378,33],[591,372,34],[574,358,33],[557,345,33],[546,336,33],[543,333,34],[543,332,33],[543,332,158],[543,333,34],[543,333,33],[543,332,108]]);
  await page.keyboard.down('Alt');
  await page.mouse.move(543, 332);
  await page.mouse.down();
  await replayCursorPath(page, [[543,332,184],[545,333,33],[577,338,34],[634,340,33],[703,340,33],[757,339,33],[777,338,34],[777,338,58],[777,338,242]]);
  await page.mouse.move(777, 338);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await replayCursorPath(page, [[777,338,175],[777,338,117],[797,330,33],[883,321,33],[1087,307,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}`,
  },
  {
    name: "Test 4: Rotate Arrow Binding",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Generic",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          // Parse role=button[name="Label"] format and use getByRole
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        // Use .first() to handle multiple matches (e.g., header + footer nav links)
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'click') await target.click();
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return;
      } catch { continue; }
    }
    // Coordinate fallback for clicks when all selectors fail
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  // Replay cursor path helper
  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[1263,317,0],[1148,294,38],[1064,285,34],[1002,283,33],[954,281,33],[899,279,34],[828,276,33],[750,267,33],[698,252,34],[669,231,33],[662,213,33],[652,187,33],[636,158,35],[626,145,33],[625,145,33],[625,145,92],[625,145,42],[625,145,41],[625,145,108],[614,154,34],[598,165,33],[585,175,33],[572,188,34],[566,193,33],[566,193,59],[566,194,74],[562,201,33],[555,213,33],[542,231,35],[529,252,33],[518,274,33],[509,293,33],[504,307,33],[500,315,33]]);
  await page.mouse.move(500, 316);
  await page.mouse.down();
  await replayCursorPath(page, [[500,315,126]]);
  await page.mouse.move(500, 315);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"div.excalidraw-app > div.excalidraw.excalidraw-container > canvas.excalidraw__canvas.interactive"}], 'click', null, {"x":640,"y":360});
  await page.keyboard.press('2');
  await replayCursorPath(page, [[500,316,375],[490,318,33],[481,320,33],[471,321,34],[464,321,33],[464,321,51],[458,314,33],[451,302,33],[446,294,34],[441,282,33],[428,267,33],[418,258,41],[417,258,50],[417,258,33]]);
  await page.mouse.move(417, 258);
  await page.mouse.down();
  await replayCursorPath(page, [[417,258,109],[418,261,34],[428,282,34],[444,306,33],[464,330,33],[479,344,33],[485,348,34],[492,355,33],[502,362,34],[503,362,33],[505,362,33],[505,362,33]]);
  await page.mouse.move(505, 362);
  await page.mouse.up();
  await replayCursorPath(page, [[506,362,192],[532,360,33],[598,358,33],[706,351,34],[801,345,33],[825,344,34],[825,344,58],[824,344,34],[823,343,33],[819,339,41],[814,333,33],[810,327,34],[808,326,41]]);
  await page.mouse.move(808, 326);
  await page.mouse.down();
  await replayCursorPath(page, [[808,326,75]]);
  await page.mouse.move(808, 326);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"div.excalidraw-app > div.excalidraw.excalidraw-container > canvas.excalidraw__canvas.interactive"}], 'click', null, {"x":640,"y":360});
  await page.keyboard.press('2');
  await replayCursorPath(page, [[808,326,351],[808,326,41],[799,318,33],[779,303,34],[756,287,33],[748,282,42],[740,275,33],[734,272,34],[733,270,41],[733,269,85],[729,266,32],[728,265,34],[728,265,41],[728,265,32],[722,261,35],[707,253,38],[694,248,28],[694,248,33],[693,248,34],[694,248,33]]);
  await page.mouse.move(693, 249);
  await page.mouse.down();
  await replayCursorPath(page, [[694,250,33],[693,253,33],[692,259,34],[696,275,33],[712,304,33],[736,330,34],[757,347,33],[779,362,33],[789,369,34],[794,372,33],[794,372,42],[795,373,50],[800,378,33],[802,379,34],[802,379,42],[802,379,33],[802,379,58]]);
  await page.mouse.move(802, 379);
  await page.mouse.up();
  await replayCursorPath(page, [[802,379,64],[801,379,53],[796,375,33],[782,360,41],[766,347,34],[760,342,34],[759,341,66],[758,341,52],[758,341,33],[758,341,32],[758,341,141],[758,341,175],[743,328,34],[713,308,32],[677,285,34],[638,261,33],[608,242,34],[593,230,33],[591,228,42],[591,228,42],[590,227,33],[590,228,58],[590,228,33],[590,228,34],[590,228,34],[591,227,49],[590,228,33],[590,227,34],[590,228,41],[590,228,34]]);
  await page.keyboard.press('5');
  await replayCursorPath(page, [[590,228,33],[590,228,34],[590,228,33],[590,228,33],[589,229,33],[584,233,33],[579,236,34],[557,244,33],[528,254,34],[502,256,33],[462,250,33],[441,243,34],[437,242,42],[437,242,34],[437,242,32],[437,242,33],[437,242,34],[437,243,34],[441,252,32],[446,261,34],[448,264,33],[452,268,34],[455,270,33],[455,270,33],[455,270,33],[457,267,34],[457,263,34],[457,260,32],[455,257,35],[452,253,41],[452,253,52],[452,253,224],[452,253,40],[453,254,34],[454,254,59],[455,254,42],[455,255,40]]);
  await page.mouse.move(455, 255);
  await page.mouse.down();
  await replayCursorPath(page, [[455,254,184],[455,254,33],[459,245,33],[464,233,34],[467,225,33],[471,217,33],[476,209,33],[478,206,34],[482,201,33],[491,196,34],[509,191,32],[546,190,34],[590,191,34],[629,194,33],[657,197,33],[672,198,33],[674,198,34],[676,199,32],[678,199,34],[687,200,34],[691,200,33],[691,200,49],[692,200,100],[705,208,34],[716,216,34],[721,224,33],[723,226,50],[722,227,33],[719,235,33],[715,243,34],[707,252,33],[701,262,38],[699,268,29],[698,270,33],[696,278,34],[696,289,33],[698,294,33],[699,295,50],[701,298,33],[703,299,34],[704,300,33],[707,303,33],[711,306,34],[710,305,42],[710,305,50],[710,305,33],[711,305,42],[712,305,41],[712,305,34],[713,305,33],[712,305,92],[712,305,42],[712,305,41],[709,305,34],[706,306,41],[706,306,34],[706,306,41],[706,306,42],[704,306,33],[703,307,75],[701,307,33],[695,308,33],[692,308,34],[692,308,41],[692,308,51],[692,309,33],[692,308,91],[692,308,50]]);
  await page.mouse.move(692, 308);
  await page.mouse.up();
  await replayCursorPath(page, [[693,308,443],[729,316,41],[786,330,34],[814,341,33],[815,347,32],[811,361,34],[795,381,34],[771,396,33],[754,402,34],[745,404,33],[738,404,33],[738,405,58],[738,405,44],[738,405,81],[737,404,76],[737,404,33],[737,404,41],[733,403,33],[730,402,34],[728,402,34],[725,402,41],[723,402,33],[722,402,33],[721,403,34],[719,403,42],[718,403,84],[718,403,116],[715,404,33],[708,404,33],[701,405,34],[694,405,33],[688,405,33],[686,405,50],[686,405,118],[686,405,393],[687,404,40],[688,404,35],[689,402,30],[689,402,34],[689,402,42],[689,402,58],[689,402,51],[689,402,301],[689,402,248],[689,402,284],[689,402,74],[689,401,33],[689,401,100],[690,397,34],[696,388,33],[706,379,33],[711,375,34],[712,375,34],[713,375,101],[713,374,32]]);
  await page.mouse.move(713, 374);
  await page.mouse.down();
  await replayCursorPath(page, [[713,374,150]]);
  await page.mouse.move(713, 374);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"div.excalidraw-app > div.excalidraw.excalidraw-container > canvas.excalidraw__canvas.interactive"}], 'click', null, {"x":640,"y":360});
  await replayCursorPath(page, [[713,374,416],[713,374,143],[713,375,559],[712,375,41],[712,375,166],[712,375,1080],[714,370,20],[726,350,33],[740,328,33],[754,304,34],[762,290,33],[766,285,34],[767,282,33],[770,277,33],[774,270,34],[777,266,32],[779,262,34],[779,258,33],[777,251,34],[773,241,33],[767,232,33],[765,230,34],[764,230,41],[761,229,34],[759,229,33],[757,229,33],[753,228,33],[749,227,34],[748,226,34],[746,226,33],[746,226,151],[746,226,48],[746,226,202],[746,225,48],[746,225,42],[746,224,34],[746,224,226],[746,224,207],[746,225,92],[746,225,34],[747,226,32],[747,227,34],[748,228,38],[748,229,37],[748,229,50],[749,229,101],[749,229,51],[749,229,165]]);
  await page.mouse.move(749, 229);
  await page.mouse.down();
  await replayCursorPath(page, [[749,229,325],[749,229,50],[749,229,34],[749,229,40],[750,228,84],[752,228,33],[752,228,177],[753,229,40],[753,229,34],[755,229,32],[757,230,33],[758,231,33],[759,231,34],[760,232,33],[761,232,69],[765,234,32],[768,237,33],[769,237,34],[772,239,33],[775,242,32],[778,245,34],[780,246,34],[782,247,32],[785,250,34],[787,252,33],[789,254,33],[789,254,51],[790,255,34],[791,257,33],[794,260,33],[797,264,34],[799,267,33],[801,270,33],[803,274,33],[806,278,34],[808,281,33],[809,284,33],[809,285,34],[809,285,34],[811,289,32],[812,291,42],[813,295,33],[813,299,34],[814,303,32],[815,311,34],[816,316,42],[817,322,33],[817,326,34],[817,330,33],[817,331,41],[817,331,184],[817,331,41],[818,330,33],[818,327,34],[815,318,33],[810,309,34],[803,299,33],[795,289,34],[793,285,32],[791,284,34],[789,282,34],[787,279,33],[785,276,33],[784,275,159],[785,275,42],[785,276,49],[788,278,33],[791,279,33],[794,282,34],[795,283,34],[796,284,33],[797,286,33],[798,288,50],[798,288,50],[798,288,133],[798,288,50],[798,287,34],[797,286,33],[797,285,75],[796,285,33],[795,285,34],[793,284,33],[792,281,33],[791,280,34],[790,280,166],[793,282,40],[798,289,27],[802,297,33],[808,308,33],[816,323,34],[820,334,33],[822,341,34],[823,349,33],[823,368,41],[821,387,34],[817,406,33],[813,416,34],[812,422,34],[808,430,33],[804,438,33],[803,440,101],[803,440,208],[781,447,41],[744,452,33],[716,454,33],[708,454,34],[707,454,33],[707,454,34],[707,453,33],[701,447,33],[682,430,41],[663,413,34],[641,395,33],[622,381,33],[611,371,34],[606,365,33],[605,364,34],[605,364,33],[605,364,34],[606,364,33],[606,364,33],[606,364,100],[607,366,33],[620,377,34],[643,393,33],[671,406,34],[702,415,33],[740,422,33],[777,423,33],[808,420,42],[817,417,33],[824,412,34],[833,401,33],[844,386,33],[854,362,33],[856,343,34],[856,326,34],[855,311,32],[854,296,34],[852,287,33],[851,287,300],[851,287,51],[851,288,33],[851,293,33],[854,301,33],[854,305,34],[856,310,33],[857,314,33],[857,315,42],[858,318,33],[858,319,92],[858,319,266],[858,319,51]]);
  await page.mouse.move(858, 319);
  await page.mouse.up();
  await replayCursorPath(page, [[858,319,1534],[860,321,41],[872,322,33],[892,321,34],[915,321,33],[923,321,33],[924,324,34],[936,335,33],[974,350,33],[988,354,316],[988,350,33],[988,348,34],[986,345,33],[984,341,33],[983,338,34],[982,336,40],[978,334,26],[978,333,34],[976,330,33],[976,329,34],[973,327,34],[968,326,33],[964,326,33],[963,325,66],[959,325,34],[955,325,34],[950,325,32],[939,322,34],[932,321,33],[931,320,39],[931,320,28],[931,320,43],[931,319,32],[930,319,84],[930,319,76],[930,319,50],[930,319,115],[930,318,68],[929,315,32],[928,312,41],[928,312,51],[929,314,32],[934,317,35],[983,323,33],[1135,327,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1271,156,2051],[1048,209,33],[931,244,41],[924,253,33],[930,272,33],[944,286,33],[945,288,34],[945,288,33],[944,288,34],[927,290,33],[876,284,34],[831,266,32],[813,248,34],[805,237,33],[805,236,33],[805,236,34],[805,236,33],[805,235,34],[805,235,33],[805,235,44],[805,234,47],[805,231,34],[805,227,33],[805,226,42],[805,226,42],[804,225,33],[804,225,41],[804,224,109],[803,218,33],[802,215,33],[802,215,44],[802,215,50],[802,215,50],[802,215,82],[802,215,35],[801,215,49],[802,216,42],[809,218,32],[819,220,33],[831,224,34],[849,230,33],[859,236,33],[863,243,34],[860,249,33],[840,263,41],[813,271,34],[785,272,34],[765,269,33],[763,269,41]]);
  await page.mouse.move(763, 269);
  await page.mouse.down();
  await replayCursorPath(page, [[763,268,71]]);
  await page.mouse.move(763, 268);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"div.excalidraw-app > div.excalidraw.excalidraw-container > canvas.excalidraw__canvas.interactive"}], 'click', null, {"x":640,"y":360});
  await page.keyboard.press('r');
  await replayCursorPath(page, [[763,268,722],[763,265,34],[763,257,40],[762,255,92],[762,255,33],[762,256,33],[757,257,34],[755,257,41],[754,257,209],[753,254,33],[750,253,33],[750,253,42],[750,253,284],[754,255,33],[776,258,33],[827,266,34],[920,276,32],[998,286,34],[1011,290,42],[1010,290,49],[1008,289,33]]);
  await page.keyboard.press('Escape');
  await replayCursorPath(page, [[1006,290,34],[1002,290,33],[1001,290,43],[996,290,33],[985,291,33],[972,292,33],[949,294,34],[928,295,33],[916,296,33],[914,296,34],[914,296,32],[914,297,51],[914,297,58],[914,297,34],[914,297,33],[913,298,33],[911,302,34],[906,305,33],[901,306,33],[895,305,34],[877,301,32],[843,297,34],[816,291,33],[804,289,34],[802,288,34],[800,288,33]]);
  await page.mouse.move(800, 289);
  await page.mouse.down();
  await replayCursorPath(page, [[800,289,32],[800,290,51]]);
  await page.mouse.move(800, 289);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"div.excalidraw-app > div.excalidraw.excalidraw-container > canvas.excalidraw__canvas.interactive"}], 'click', null, {"x":640,"y":360});
  await replayCursorPath(page, [[801,289,150],[800,289,151],[800,289,41],[800,289,41],[800,289,42],[801,289,116],[810,286,33],[873,280,34],[1048,276,33]]);
}`,
  },
  {
    name: "Test 5: Undo Element Creation",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Generic",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          // Parse role=button[name="Label"] format and use getByRole
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        // Use .first() to handle multiple matches (e.g., header + footer nav links)
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'click') await target.click();
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return;
      } catch { continue; }
    }
    // Coordinate fallback for clicks when all selectors fail
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  // Replay cursor path helper
  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[1262,592,0],[1150,551,40],[1038,510,34],[947,475,33],[888,448,34],[873,441,32],[873,441,34],[873,441,33],[873,441,51],[873,441,33],[871,440,33],[858,427,33],[830,400,33],[797,365,34],[754,322,33],[711,293,33],[676,277,33],[647,263,35],[613,250,33],[573,241,34],[526,241,32],[451,259,34],[391,285,33],[363,299,33],[360,305,34],[357,310,33],[357,310,68],[357,310,82]]);
  await page.mouse.move(357, 310);
  await page.mouse.down();
  await page.mouse.move(357, 309);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"div.excalidraw-app > div.excalidraw.excalidraw-container > canvas.excalidraw__canvas.interactive"}], 'click', null, {"x":640,"y":360});
  await replayCursorPath(page, [[357,309,133],[357,309,708],[369,300,33],[466,274,34],[729,272,33],[1154,283,34]]);
  await replayCursorPath(page, [[1260,118,1318],[814,102,32],[559,96,33],[494,94,33],[494,94,34],[496,96,33],[499,98,33],[509,92,33],[524,72,34]]);
  await replayCursorPath(page, [[541,54,33],[560,39,34],[562,37,84],[560,38,32],[552,40,34]]);
  await replayCursorPath(page, [[542,42,33],[529,44,33],[522,44,33],[522,44,35],[522,44,33],[521,43,33]]);
  await page.mouse.move(520, 43);
  await page.mouse.down();
  await replayCursorPath(page, [[520,43,66],[520,43,75]]);
  await page.mouse.move(520, 43);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"svg > g > rect"}], 'click', null, {"x":520,"y":38});
  await locateWithFallback(page, [{"type":"role-name","value":"role=radio[name=\\"Rectangle\\"]"},{"type":"name","value":"[name=\\"editor-current-shape\\"]"},{"type":"css-path","value":"div.Stack.Stack_horizontal > label.ToolIcon.Shape > input.ToolIcon_type_radio.ToolIcon_size_medium"}], 'click', null, {"x":514,"y":40});
  await replayCursorPath(page, [[520,43,58]]);
  await replayCursorPath(page, [[519,47,34],[512,77,34],[503,145,34],[494,220,41],[494,230,33],[494,230,42],[494,229,99],[494,229,52]]);
  await page.mouse.move(494, 229);
  await page.mouse.down();
  await replayCursorPath(page, [[495,229,57],[516,254,33],[586,299,33],[688,347,34],[782,382,33],[844,406,41],[852,410,35],[852,410,107]]);
  await page.mouse.move(852, 409);
  await page.mouse.up();
  await replayCursorPath(page, [[852,409,67],[852,409,34],[852,409,41],[851,410,59],[851,410,33],[851,411,41],[860,416,34],[922,417,33],[1121,411,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1272,180,1942],[1192,213,40],[1148,233,25],[1115,244,34],[1084,249,33],[1058,252,34],[1024,254,32],[979,256,34],[948,258,33],[933,259,34],[912,265,33],[891,277,33],[883,285,34],[880,292,33],[882,301,34],[890,311,33],[894,314,42],[894,314,25],[894,314,33],[894,314,41],[894,314,34],[896,315,34]]);
  await page.mouse.move(896, 315);
  await page.mouse.down();
  await replayCursorPath(page, [[896,314,33],[895,314,33]]);
  await page.mouse.move(896, 314);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"div.excalidraw-app > div.excalidraw.excalidraw-container > canvas.excalidraw__canvas.interactive"}], 'click', null, {"x":640,"y":360});
  await replayCursorPath(page, [[895,315,66],[895,314,59],[895,314,50],[895,315,75],[895,315,452],[892,317,31],[876,327,35],[871,331,32],[869,332,33],[867,335,33],[865,337,33],[865,337,35],[865,337,40],[862,339,34],[859,340,34],[858,341,41],[857,341,33],[856,343,33],[856,343,201],[856,343,33],[856,342,42],[856,342,77],[856,342,32],[857,342,33]]);
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await replayCursorPath(page, [[857,342,4084],[906,340,40],[1126,339,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}`,
  },
  {
    name: "Test 6: Redo Element Creation",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Generic",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          // Parse role=button[name="Label"] format and use getByRole
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        // Use .first() to handle multiple matches (e.g., header + footer nav links)
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'click') await target.click();
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return;
      } catch { continue; }
    }
    // Coordinate fallback for clicks when all selectors fail
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  // Replay cursor path helper
  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[1223,289,0],[931,299,38],[781,319,34],[682,338,34],[651,349,33],[647,354,33],[646,355,33],[646,355,34],[646,355,33],[647,355,60],[648,346,32],[650,326,33],[648,321,33],[648,321,34],[632,319,34],[604,319,33],[578,322,33],[571,322,33]]);
  await page.mouse.move(571, 322);
  await page.mouse.down();
  await replayCursorPath(page, [[571,322,33]]);
  await page.mouse.move(571, 322);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"div.excalidraw-app > div.excalidraw.excalidraw-container > canvas.excalidraw__canvas.interactive"}], 'click', null, {"x":640,"y":360});
  await replayCursorPath(page, [[571,322,259],[571,322,99],[571,321,134],[571,317,42],[570,312,33],[576,313,567],[565,309,33],[560,307,33],[557,306,34],[548,304,33],[537,306,34],[524,307,33],[508,307,32],[499,306,34],[493,304,33],[489,302,34],[489,300,33],[489,300,33],[488,300,34],[488,300,41],[488,300,34],[487,300,49],[483,300,34],[476,299,34],[469,301,33],[451,306,33],[431,308,34],[425,303,33],[416,292,33],[403,282,34],[396,280,33],[396,280,75],[396,280,33],[396,279,34],[397,269,33],[401,245,34],[415,212,41],[434,185,36],[457,162,30],[474,144,34],[482,133,34],[486,127,33],[488,120,33],[489,112,34],[491,105,33],[492,97,33],[493,92,33],[493,83,34],[494,69,33],[495,68,59],[495,64,33]]);
  await replayCursorPath(page, [[497,53,33],[498,47,33],[501,37,33],[502,35,42],[503,34,33],[505,31,34],[505,30,42],[507,28,33],[509,27,33]]);
  await page.mouse.move(509, 27);
  await page.mouse.down();
  await page.mouse.move(509, 27);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"div.Stack.Stack_horizontal > label.ToolIcon.Shape > div.ToolIcon__icon"}], 'click', null, {"x":520,"y":38});
  await locateWithFallback(page, [{"type":"role-name","value":"role=radio[name=\\"Rectangle\\"]"},{"type":"name","value":"[name=\\"editor-current-shape\\"]"},{"type":"css-path","value":"div.Stack.Stack_horizontal > label.ToolIcon.Shape > input.ToolIcon_type_radio.ToolIcon_size_medium"}], 'click', null, {"x":514,"y":40});
  await replayCursorPath(page, [[509,27,459],[509,28,41],[508,31,33]]);
  await replayCursorPath(page, [[504,68,35],[492,164,41],[476,228,33],[466,262,33],[464,271,33],[464,271,34],[464,271,41],[464,271,34],[464,270,42],[464,271,33],[464,270,58]]);
  await page.mouse.move(464, 270);
  await page.mouse.down();
  await replayCursorPath(page, [[464,270,42],[464,270,34],[465,271,33],[499,303,33],[560,344,33],[626,382,38],[677,408,29],[694,416,33],[695,417,75],[695,417,100],[695,417,125],[695,420,33],[696,420,33],[696,420,34],[696,420,84],[696,420,116],[696,420,41],[696,420,226],[696,420,224],[696,420,242]]);
  await page.mouse.move(696, 420);
  await page.mouse.up();
  await replayCursorPath(page, [[696,420,62],[696,420,305],[696,420,42],[718,418,33],[938,435,42]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1257,135,2277],[1095,130,39],[1001,134,34],[934,139,33],[885,146,34],[853,158,32],[843,171,34],[840,185,34],[836,198,32],[831,219,34],[826,241,36],[819,256,31],[809,270,33],[801,282,33],[797,288,34],[794,291,33],[789,295,34],[784,300,32],[783,301,42],[783,300,33],[782,300,317],[782,300,83],[783,301,67],[783,301,84],[783,300,199],[783,300,1917],[783,298,34],[791,276,33],[818,172,34]]);
  await replayCursorPath(page, [[810,29,36]]);
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1266,547,4814],[1154,564,40],[1148,565,38],[1147,565,29],[1136,562,34],[1094,559,33],[966,554,42],[822,542,33],[699,528,34],[623,515,33],[608,510,33],[608,510,116],[607,511,51]]);
  await page.mouse.move(608, 511);
  await page.mouse.down();
  await replayCursorPath(page, [[607,511,3299],[607,511,84]]);
  await page.mouse.move(607, 511);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"div.excalidraw-app > div.excalidraw.excalidraw-container > canvas.excalidraw__canvas.interactive"}], 'click', null, {"x":640,"y":360});
  await replayCursorPath(page, [[607,511,41]]);
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('Z');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await replayCursorPath(page, [[608,511,1876],[629,505,33],[677,493,33],[892,440,33],[1273,403,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}`,
  },
  {
    name: "Test 7: Undo Multiple Operations",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Generic",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          // Parse role=button[name="Label"] format and use getByRole
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        // Use .first() to handle multiple matches (e.g., header + footer nav links)
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'click') await target.click();
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return;
      } catch { continue; }
    }
    // Coordinate fallback for clicks when all selectors fail
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  // Replay cursor path helper
  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[1270,378,0],[1160,394,39],[1088,410,34],[1022,422,33],[947,427,34],[878,430,32],[849,430,33],[836,425,34],[810,411,33]]);
  await replayCursorPath(page, [[767,381,34],[738,350,33],[726,322,34],[717,301,33],[714,291,34]]);
  await page.mouse.move(713, 291);
  await page.mouse.down();
  await replayCursorPath(page, [[713,291,107]]);
  await page.mouse.move(713, 291);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"div.excalidraw-app > div.excalidraw.excalidraw-container > canvas.excalidraw__canvas.interactive"}], 'click', null, {"x":640,"y":360});
  await replayCursorPath(page, [[713,291,50],[693,273,34],[639,230,33],[571,180,33],[516,139,34],[495,121,33],[495,120,42],[495,118,33],[498,114,34],[502,104,33],[507,97,33],[515,88,34],[522,77,33],[527,68,42],[527,65,33],[528,62,33]]);
  await replayCursorPath(page, [[528,57,33],[528,52,34],[526,44,34],[524,37,33]]);
  await page.mouse.move(524, 37);
  await page.mouse.down();
  await replayCursorPath(page, [[524,37,100]]);
  await page.mouse.move(524, 37);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"svg > g > rect"}], 'click', null, {"x":520,"y":38});
  await locateWithFallback(page, [{"type":"role-name","value":"role=radio[name=\\"Rectangle\\"]"},{"type":"name","value":"[name=\\"editor-current-shape\\"]"},{"type":"css-path","value":"div.Stack.Stack_horizontal > label.ToolIcon.Shape > input.ToolIcon_type_radio.ToolIcon_size_medium"}], 'click', null, {"x":514,"y":40});
  await replayCursorPath(page, [[524,37,83],[523,39,33]]);
  await replayCursorPath(page, [[513,51,33],[471,94,34],[424,157,33],[390,217,33],[378,246,34],[378,246,50],[379,246,42],[381,242,33],[395,228,43],[401,220,32],[400,220,41]]);
  await page.mouse.move(400, 220);
  await page.mouse.down();
  await replayCursorPath(page, [[400,220,103],[400,222,40],[420,253,33],[476,304,33],[537,348,33],[566,367,34],[567,368,49],[567,367,50]]);
  await page.mouse.move(567, 367);
  await page.mouse.up();
  await replayCursorPath(page, [[567,367,54],[567,367,122],[567,367,283],[567,367,50],[568,366,39],[571,355,28],[576,331,33],[572,289,33],[545,206,42],[518,147,33],[505,114,33],[503,100,34],[503,90,33],[503,88,34],[506,86,33],[509,83,33],[510,83,50],[517,77,33],[530,68,34],[533,66,41],[535,62,34]]);
  await replayCursorPath(page, [[540,51,33],[540,48,134],[540,48,58],[540,48,49],[540,48,34]]);
  await replayCursorPath(page, [[537,47,35],[521,39,31],[510,34,34],[509,33,34],[507,33,33],[506,33,50],[506,33,125],[507,33,100],[507,33,33],[508,33,33],[509,33,34],[509,33,75]]);
  await page.mouse.move(509, 33);
  await page.mouse.down();
  await replayCursorPath(page, [[509,33,58]]);
  await page.mouse.move(509, 33);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"div.Stack.Stack_horizontal > label.ToolIcon.Shape > div.ToolIcon__icon"}], 'click', null, {"x":520,"y":38});
  await locateWithFallback(page, [{"type":"role-name","value":"role=radio[name=\\"Rectangle\\"]"},{"type":"name","value":"[name=\\"editor-current-shape\\"]"},{"type":"css-path","value":"div.Stack.Stack_horizontal > label.ToolIcon.Shape > input.ToolIcon_type_radio.ToolIcon_size_medium"}], 'click', null, {"x":514,"y":40});
  await replayCursorPath(page, [[509,33,75],[509,34,50]]);
  await replayCursorPath(page, [[515,42,34],[557,90,32],[646,164,34],[751,233,33],[810,270,34],[817,273,33],[816,273,34],[810,270,41],[798,269,34],[784,268,33],[772,268,33],[759,267,34],[742,262,33],[726,256,33],[705,244,33],[688,234,34],[687,233,50],[687,231,33],[687,230,33]]);
  await page.mouse.move(687, 230);
  await page.mouse.down();
  await replayCursorPath(page, [[687,230,34],[691,238,33],[735,275,33],[793,317,34],[847,353,45],[860,361,30],[860,361,42],[860,361,33],[860,361,33],[860,361,33]]);
  await page.mouse.move(860, 361);
  await page.mouse.up();
  await replayCursorPath(page, [[860,361,34],[860,361,33],[860,361,33],[860,361,33],[870,366,35],[943,377,32],[1077,390,34],[1206,398,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1270,376,3427],[1186,379,40],[1158,380,33],[1151,379,33],[1151,379,34],[1151,378,33],[1151,378,33],[1151,378,117],[1151,378,183],[1151,378,1042],[1152,327,33],[1144,205,33],[1131,76,34]]);
  await replayCursorPath(page, [[1129,24,410],[1123,104,32],[1108,216,39],[1098,270,27],[1098,276,34]]);
  await page.mouse.move(1098, 276);
  await page.mouse.down();
  await replayCursorPath(page, [[1098,276,67],[1098,275,57],[1098,275,34]]);
  await page.mouse.move(1098, 275);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"div.excalidraw-app > div.excalidraw.excalidraw-container > canvas.excalidraw__canvas.interactive"}], 'click', null, {"x":640,"y":360});
  await replayCursorPath(page, [[1098,275,32],[1098,274,34],[1098,274,92],[1098,274,75],[1098,274,325],[1097,274,42]]);
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await replayCursorPath(page, [[1097,275,75],[1097,276,33],[1096,276,51],[1096,276,57]]);
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await replayCursorPath(page, [[1096,277,1801],[1092,282,33],[1092,284,83],[1092,284,33],[1092,283,58],[1092,283,34],[1113,275,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1249,265,1409],[992,286,34],[832,309,41],[819,312,50],[819,312,33]]);
  await page.mouse.move(820, 312);
  await page.mouse.down();
  await replayCursorPath(page, [[820,312,67],[820,312,49]]);
  await page.mouse.move(820, 312);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"div.excalidraw-app > div.excalidraw.excalidraw-container > canvas.excalidraw__canvas.interactive"}], 'click', null, {"x":640,"y":360});
  await replayCursorPath(page, [[820,312,59],[820,311,148]]);
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await replayCursorPath(page, [[820,311,1003],[826,309,24],[872,298,34],[1056,281,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}`,
  },
  {
    name: "Test 8: Undo/Redo Button State",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Generic",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          // Parse role=button[name="Label"] format and use getByRole
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        // Use .first() to handle multiple matches (e.g., header + footer nav links)
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'click') await target.click();
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return;
      } catch { continue; }
    }
    // Coordinate fallback for clicks when all selectors fail
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  // Replay cursor path helper
  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[1276,418,0],[1263,419,32],[1243,417,42],[1213,414,32],[1169,410,34],[1119,407,33],[1037,409,34],[950,411,33],[896,407,34],[848,403,33],[820,399,33],[800,396,33]]);
  await replayCursorPath(page, [[778,397,34],[745,395,33],[698,387,33],[628,375,34],[552,366,33],[477,357,34],[439,352,32],[434,351,42],[434,351,34],[434,351,41],[434,351,33],[425,346,33],[403,337,35],[378,324,32],[361,304,42],[356,295,25],[356,295,92],[356,295,51],[356,295,42],[356,296,43],[356,301,39],[359,309,34],[359,311,183],[361,323,33],[365,335,33],[368,341,33],[369,343,35],[370,347,41],[371,352,33],[372,364,33],[374,402,33],[373,447,34],[368,483,33],[363,508,34],[356,541,32],[346,567,35],[342,573,33],[341,576,33],[321,593,33],[287,611,34],[261,625,33],[243,638,33],[233,647,34],[224,657,33],[222,658,33],[222,658,33],[222,658,43],[223,658,33],[245,644,33],[366,587,33]]);
  await replayCursorPath(page, [[659,470,34],[1234,295,42]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1278,464,2143],[1037,484,31],[823,488,34],[623,503,33],[473,525,34],[383,541,33],[331,551,33],[292,560,33],[263,572,33],[254,581,34],[254,581,34],[256,582,33],[258,583,33],[258,583,41],[261,580,35],[263,577,33],[263,577,33]]);
  await page.mouse.move(263, 577);
  await page.mouse.down();
  await page.mouse.move(263, 577);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"div.excalidraw-app > div.excalidraw.excalidraw-container > canvas.excalidraw__canvas.interactive"}], 'click', null, {"x":640,"y":360});
  await replayCursorPath(page, [[263,577,158],[259,590,33],[253,604,34],[250,614,33],[246,631,33],[244,645,34],[243,652,33],[241,659,33],[239,666,34],[236,672,33],[234,678,33],[233,679,33],[232,680,33],[231,682,35]]);
  await replayCursorPath(page, [[229,684,32],[228,684,51],[228,684,99],[228,684,42],[228,679,34],[228,671,33],[228,671,150],[228,670,58]]);
  await replayCursorPath(page, [[228,666,33],[228,666,92],[228,666,217],[241,646,33],[297,571,34],[359,488,33],[418,418,33],[472,359,33],[503,324,34],[521,299,33],[526,285,34],[529,278,33],[531,272,33],[537,255,34],[537,237,33],[530,208,33],[515,172,33],[493,144,34],[476,125,34],[461,104,33],[449,89,33],[448,87,33],[448,87,41],[448,87,35],[448,87,91],[448,82,33],[447,75,33],[447,73,34],[448,68,33]]);
  await replayCursorPath(page, [[456,49,33],[456,48,51],[466,43,33],[478,42,33],[493,43,33],[501,43,34],[501,43,49]]);
  await replayCursorPath(page, [[505,43,34],[506,42,33],[509,42,34],[513,41,33],[515,40,50],[515,40,34]]);
  await page.mouse.move(515, 40);
  await page.mouse.down();
  await replayCursorPath(page, [[515,40,101]]);
  await page.mouse.move(515, 40);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"svg > g > rect"}], 'click', null, {"x":520,"y":38});
  await locateWithFallback(page, [{"type":"role-name","value":"role=radio[name=\\"Rectangle\\"]"},{"type":"name","value":"[name=\\"editor-current-shape\\"]"},{"type":"css-path","value":"div.Stack.Stack_horizontal > label.ToolIcon.Shape > input.ToolIcon_type_radio.ToolIcon_size_medium"}], 'click', null, {"x":514,"y":40});
  await replayCursorPath(page, [[515,40,50],[515,40,98]]);
  await replayCursorPath(page, [[514,41,84],[514,42,33],[511,46,33],[505,55,33],[491,74,34],[464,110,34],[432,153,32],[410,187,34],[404,200,34],[401,204,33],[396,214,42],[393,219,33],[392,219,42],[392,219,32],[392,219,110],[391,220,32],[387,227,40],[386,228,43],[386,228,34],[386,228,42],[385,222,33],[382,215,34],[381,215,33],[381,219,41],[381,220,119],[381,220,32],[381,220,94],[382,220,64],[382,220,42],[382,220,983]]);
  await page.mouse.move(382, 220);
  await page.mouse.down();
  await replayCursorPath(page, [[382,220,83],[382,221,76],[417,257,32],[498,306,42],[575,336,33],[649,358,33],[710,372,34],[728,376,34],[728,376,41],[727,376,42],[727,376,108],[726,378,41],[721,390,34],[715,401,33],[710,408,34],[707,410,33],[707,410,158],[707,411,34],[698,416,33],[690,419,33],[686,421,33],[686,421,42],[686,421,92],[686,420,35],[687,420,57]]);
  await page.mouse.move(687, 420);
  await page.mouse.up();
  await replayCursorPath(page, [[687,420,86],[686,420,414],[686,420,124],[687,420,34],[709,412,33],[788,403,34],[939,382,33],[1216,315,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1255,299,2760],[1022,366,32],[879,425,33],[813,462,41],[763,496,26],[714,529,33],[667,564,34],[621,593,33],[537,622,34],[337,653,41]]);
  await replayCursorPath(page, [[173,677,34],[81,694,32],[41,697,33],[41,697,51],[42,697,34],[48,694,32]]);
  await replayCursorPath(page, [[65,694,34],[80,694,33],[90,694,34],[99,694,33],[112,694,34],[125,693,33],[133,692,33]]);
  await replayCursorPath(page, [[142,692,33],[153,691,33],[159,692,34],[169,690,33],[170,689,267]]);
  await page.mouse.move(170, 689);
  await page.mouse.down();
  await replayCursorPath(page, [[170,689,258]]);
  await page.mouse.move(170, 689);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"button.ToolIcon_type_button.ToolIcon_size_medium > div.ToolIcon__icon > svg"}], 'click', null, {"x":176,"y":686});
  await replayCursorPath(page, [[170,689,325],[170,689,50],[169,689,34],[168,690,33]]);
  await replayCursorPath(page, [[175,687,34],[264,673,33],[619,632,41],[1089,579,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1213,434,1576],[995,473,33],[880,502,33],[837,515,34],[805,530,33],[746,550,33],[658,567,34],[552,585,33],[438,599,33],[331,602,34],[258,601,33],[223,604,33],[208,610,34],[204,616,33],[200,625,33],[200,638,34],[201,651,33],[204,664,33]]);
  await replayCursorPath(page, [[207,673,33],[209,681,34],[210,684,35],[210,685,32],[209,686,32]]);
  await page.mouse.move(209, 687);
  await page.mouse.down();
  await page.mouse.move(209, 687);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"div.ToolIcon__icon > svg > path"}], 'click', null, {"x":211,"y":685});
  await replayCursorPath(page, [[209,686,268],[209,686,317]]);
  await replayCursorPath(page, [[238,683,32],[381,667,34],[661,629,33],[1055,572,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}`,
  },
  {
    name: "Test 11: Context Menu Actions",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Generic",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords, options) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          // Parse role=button[name="Label"] format and use getByRole
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        // Use .first() to handle multiple matches (e.g., header + footer nav links)
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target; // Return locator for assertions
        if (action === 'click') await target.click(options || {});
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    // Coordinate fallback for clicks when all selectors fail
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y, options || {});
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  // Replay cursor path helper
  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[1267,253,0],[1147,302,40],[982,335,42],[824,338,34],[615,321,41],[527,308,33],[498,304,33],[498,304,33],[498,304,85],[499,304,51],[499,304,39],[500,304,34],[500,303,42]]);
  await page.mouse.move(500, 303);
  await page.mouse.down();
  await page.mouse.move(500, 303);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[500,303,700],[500,303,84],[500,305,33],[500,305,42],[500,305,50]]);
  await page.keyboard.press('2');
  await replayCursorPath(page, [[500,305,415],[500,305,118],[500,305,51],[500,305,100],[499,297,31],[498,294,34],[498,295,76]]);
  await page.mouse.move(498, 295);
  await page.mouse.down();
  await replayCursorPath(page, [[498,295,33],[498,295,33],[498,296,34],[511,326,33],[555,380,32],[602,425,34],[619,442,33],[620,442,68],[620,443,149],[625,446,33],[629,449,33],[639,454,33],[651,460,34],[655,461,59],[655,461,217],[655,461,58],[655,461,99]]);
  await page.mouse.move(655, 461);
  await page.mouse.up();
  await replayCursorPath(page, [[655,461,86],[658,451,32],[662,432,41],[661,425,33],[661,424,34],[660,423,33],[657,420,33],[653,416,33],[653,414,34],[653,414,383]]);
  await page.mouse.move(653, 414);
  await page.mouse.down({ button: 'right' });
  // Coordinate-only right-click (no selectors found)
  await page.mouse.click(640, 360, { button: 'right' });
  await page.mouse.move(653, 414);
  await page.mouse.up({ button: 'right' });
  await replayCursorPath(page, [[653,415,1111],[653,415,81],[653,415,125]]);
  await replayCursorPath(page, [[713,412,33],[876,416,34],[1157,438,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
`,
  },
  {
    name: "Test 12: Keyboard Shortcuts \u2014 Shape Tools",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Generic",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords, options) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          // Parse role=button[name="Label"] format and use getByRole
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        // Use .first() to handle multiple matches (e.g., header + footer nav links)
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target; // Return locator for assertions
        if (action === 'click') await target.click(options || {});
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    // Coordinate fallback for clicks when all selectors fail
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y, options || {});
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  // Replay cursor path helper
  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[150,541,0],[150,541,1347],[150,541,216],[201,507,34],[291,468,33],[345,431,43],[368,398,32],[384,379,34],[385,377,50],[412,373,33],[452,369,33]]);
  await replayCursorPath(page, [[514,362,33],[578,353,34],[596,348,58],[596,349,33],[596,349,34],[595,349,50],[595,349,33],[595,349,42],[591,347,33],[581,335,33],[571,317,34],[568,310,33],[568,310,41],[568,310,109],[567,310,34],[568,312,32],[568,313,34],[568,313,350],[569,313,42]]);
  await page.mouse.move(569, 313);
  await page.mouse.down();
  await page.mouse.move(569, 313);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[569,313,608]]);
  await page.keyboard.press('r');
  await replayCursorPath(page, [[569,313,683],[568,313,51],[548,312,32],[510,301,34],[475,285,33],[450,267,34],[439,259,33],[437,258,42],[437,259,33],[437,259,42],[437,258,34],[412,245,41],[384,230,34],[367,217,41],[358,208,33],[356,206,33],[356,206,42]]);
  await page.mouse.move(356, 206);
  await page.mouse.down();
  await replayCursorPath(page, [[356,206,42],[356,206,33],[357,206,42],[373,220,33],[411,248,34],[439,265,33],[449,272,33],[462,282,33],[469,290,42],[469,290,42],[469,290,34],[469,290,49],[469,290,84],[469,290,33]]);
  await page.mouse.move(469, 290);
  await page.mouse.up();
  await replayCursorPath(page, [[469,290,68],[469,290,41],[469,290,50],[468,290,42],[469,290,32],[469,290,34],[469,290,41],[469,290,33],[480,290,34],[521,296,42],[619,313,33],[791,330,33],[1064,337,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1241,163,2334],[972,171,33],[746,188,34],[610,202,33],[542,211,32],[518,215,34],[509,217,34],[489,222,33],[457,228,33],[422,235,34],[404,239,33],[402,240,43],[403,239,33],[405,238,41],[414,234,32],[429,228,34],[453,220,34],[471,214,33],[481,210,33],[488,207,34],[488,207,74],[488,207,84],[513,210,33],[527,212,34],[527,212,33],[527,212,41],[527,213,34],[527,212,241]]);
  await page.mouse.move(527, 212);
  await page.mouse.down();
  await page.mouse.move(527, 212);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[527,212,693],[527,212,74],[527,212,243]]);
  await page.keyboard.press('e');
  await replayCursorPath(page, [[527,212,1754],[527,207,39],[527,206,40],[527,206,34]]);
  await page.mouse.move(527, 205);
  await page.mouse.down();
  await replayCursorPath(page, [[527,206,248],[527,206,50],[527,207,33],[528,208,34],[533,213,33],[545,225,34],[563,239,33],[583,254,33],[602,271,33],[621,285,34],[640,297,33],[653,308,33],[655,309,43],[655,309,92],[656,309,82],[656,309,351],[656,309,42],[656,309,33],[657,305,33],[659,292,33],[661,275,33],[664,255,33],[664,237,34],[660,226,33],[649,218,34],[620,211,33],[568,206,33],[510,206,33],[480,208,34],[479,209,33],[479,209,34],[479,209,120],[479,209,54],[479,209,43],[479,210,34],[469,217,32],[454,229,33],[443,239,34],[437,247,33],[437,248,33],[436,249,34],[434,252,33],[434,255,33],[434,256,94],[430,263,31],[426,270,33],[420,284,34],[413,293,33],[408,301,34],[408,301,100],[408,301,66],[408,299,34],[414,283,33],[423,258,33],[449,208,34],[469,167,34],[471,161,32],[470,162,34],[470,162,35],[470,163,40],[470,163,75],[470,164,33],[470,170,33],[467,200,33],[463,224,34],[463,232,33],[463,231,160],[463,231,49],[463,231,33]]);
  await page.mouse.move(463, 231);
  await page.mouse.up();
  await replayCursorPath(page, [[463,231,34],[463,231,33],[463,230,468],[463,230,1],[463,230,0],[463,231,22],[463,232,39],[463,231,171],[463,231,825],[475,231,40],[497,231,34],[577,237,33],[707,242,33],[922,257,33],[1213,273,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1223,168,3292],[999,158,33],[804,183,33],[647,192,34],[569,194,33],[534,197,33],[520,200,34],[513,203,33],[503,209,33],[500,211,34],[500,211,66],[500,212,143],[500,212,125]]);
  await page.mouse.move(500, 212);
  await page.mouse.down();
  await replayCursorPath(page, [[500,212,82],[500,211,34],[500,211,33]]);
  await page.mouse.move(501, 211);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[501,211,384],[501,211,40],[501,210,43],[501,210,107],[501,211,34],[501,210,184],[501,210,91]]);
  await page.keyboard.press('d');
  await replayCursorPath(page, [[501,211,1192],[501,213,34],[501,214,108],[500,213,33],[500,213,34],[497,214,33],[487,218,41],[486,218,35],[486,218,49],[479,219,33],[465,218,34],[449,215,32],[432,210,34],[416,205,33],[404,200,33],[391,191,33],[382,184,34],[374,178,33],[370,175,35],[361,169,32],[350,163,34],[348,162,33]]);
  await page.mouse.move(348, 162);
  await page.mouse.down();
  await replayCursorPath(page, [[348,162,50],[350,166,34],[368,200,33],[431,270,41],[481,312,33],[507,334,34],[521,347,38],[523,348,33],[524,349,45],[524,349,161],[524,348,148]]);
  await page.mouse.move(524, 348);
  await page.mouse.up();
  await replayCursorPath(page, [[524,348,118],[524,348,91],[524,348,52],[523,348,24],[523,348,41],[522,347,42],[522,347,48],[524,349,35],[546,353,62],[618,361,7],[767,368,32],[1049,361,39]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1238,164,1918],[1082,163,32],[957,168,33],[852,175,34],[778,183,33],[731,189,33],[705,195,33],[691,200,34],[683,204,34],[674,209,33],[658,217,33],[642,223,34],[631,227,33],[623,229,33],[618,232,35],[618,232,32],[618,231,33],[618,231,84],[617,230,226],[617,230,50],[617,230,49],[617,230,35],[617,230,91]]);
  await page.mouse.move(617, 230);
  await page.mouse.down();
  await page.mouse.move(617, 230);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[617,230,1865]]);
  await page.keyboard.press('l');
  await replayCursorPath(page, [[617,230,943],[616,225,41],[615,221,33],[611,213,33],[605,204,34],[599,195,33],[587,186,35],[583,182,31],[574,178,34],[567,175,33],[564,173,34],[561,172,33],[557,172,34],[552,173,41]]);
  await page.mouse.move(549, 174);
  await page.mouse.down();
  await replayCursorPath(page, [[549,174,124],[549,174,34],[551,189,33],[586,237,33],[650,296,34],[708,347,33],[730,366,34],[731,367,33],[731,367,33],[731,367,109],[731,367,33],[731,367,33],[731,367,58],[731,366,43],[731,366,32],[731,366,35]]);
  await page.mouse.move(731, 366);
  await page.mouse.up();
  await replayCursorPath(page, [[731,366,41],[731,366,160],[731,366,166],[785,360,40],[993,355,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1256,172,1592],[1059,188,32],[886,206,34],[755,227,34],[673,253,33],[619,278,33],[564,310,33],[508,346,35],[453,383,40],[429,399,33],[428,400,35],[428,400,33],[430,399,33],[451,391,33],[478,382,34],[513,371,41],[544,362,33],[559,356,33],[569,352,34],[578,348,33],[578,348,34],[578,348,50],[578,348,33],[578,348,50],[578,348,33],[578,348,108],[578,348,77],[577,348,174]]);
  await page.mouse.move(577, 348);
  await page.mouse.down();
  await page.mouse.move(577, 348);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[577,348,442],[577,348,243],[579,356,31],[582,365,34],[582,365,208],[584,368,33],[584,368,143]]);
  await page.keyboard.press('a');
  await replayCursorPath(page, [[584,368,91],[584,369,166],[577,374,33],[561,384,34],[529,402,33],[478,425,33],[429,446,33],[403,458,34],[391,464,33],[389,466,34],[389,466,33],[388,468,93],[385,473,32],[381,479,34],[380,480,34]]);
  await page.mouse.move(380, 481);
  await page.mouse.down();
  await replayCursorPath(page, [[380,481,141],[382,479,32],[393,461,34],[407,438,33],[428,412,34],[446,391,33],[466,370,33],[481,355,35],[488,347,34],[490,346,33],[492,343,33],[496,337,33],[496,338,260],[501,342,33],[508,347,41],[510,349,33],[510,349,33],[510,349,78],[511,349,34]]);
  await page.mouse.move(511, 349);
  await page.mouse.up();
  await replayCursorPath(page, [[510,349,553],[510,349,47],[510,349,82],[510,349,165],[510,349,395],[510,349,63],[510,349,837],[525,363,37],[534,369,33],[542,373,34],[550,379,33],[555,384,32],[559,392,34],[561,397,33],[563,400,35],[563,400,41],[563,400,167],[563,400,50],[563,400,50],[563,400,41],[608,398,34],[902,394,42],[1247,387,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1262,379,1649],[1116,436,20],[1013,475,35],[942,493,32],[895,492,32],[851,483,34],[797,477,32],[779,476,32],[778,476,144],[763,477,0],[728,479,0],[667,482,1],[585,480,23],[529,479,31],[516,479,50],[517,479,83],[517,478,33],[519,470,34],[519,470,58],[524,464,33],[532,456,35],[533,455,65],[537,450,34],[537,450,76],[537,450,33]]);
  await page.mouse.move(537, 450);
  await page.mouse.down();
  await page.mouse.move(537, 450);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[537,450,176],[536,450,549],[536,450,108],[536,450,524],[536,450,268],[534,452,33],[533,452,100],[533,452,108]]);
  await page.keyboard.press('o');
  await replayCursorPath(page, [[533,452,717],[533,452,42],[533,451,107],[535,449,34],[539,437,43],[540,431,24],[539,429,33],[537,422,33],[535,406,33],[535,402,35],[534,402,66]]);
  await page.mouse.move(534, 402);
  await page.mouse.down();
  await replayCursorPath(page, [[534,403,59],[536,407,41],[573,449,33],[629,493,33],[672,523,33],[685,535,34],[686,536,35],[686,536,57],[689,541,32],[689,541,160],[689,541,67],[689,542,157],[689,542,42],[689,542,225],[689,542,125],[689,542,50],[688,545,33],[688,545,34],[688,546,41],[687,550,33],[685,552,34],[685,556,33],[685,557,234]]);
  await page.mouse.move(685, 557);
  await page.mouse.up();
  await replayCursorPath(page, [[685,557,41],[685,557,76],[685,557,250],[685,556,41],[687,555,33],[708,560,34],[771,564,33],[892,562,32],[1073,555,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
`,
  },
  {
    name: "Test 13: Tool Switching via Toolbar",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Generic",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target;
        if (action === 'click') await target.click();
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    if (action === 'fill' && coords) {
      console.log('Falling back to coordinate fill at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.press('Control+a');
      await page.keyboard.type(value || '');
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[532,640,0],[526,628,79],[513,579,24]]);
  await replayCursorPath(page, [[495,483,59],[468,392,31],[429,283,20],[419,251,39],[409,219,41],[408,213,67],[408,212,25],[408,212,51],[408,212,34],[408,212,56],[408,212,38],[408,212,32],[408,212,44],[408,212,40],[408,212,33],[408,212,34],[407,212,33],[401,208,35],[393,206,44],[383,203,147],[381,203,92],[380,203,370],[378,203,109],[362,199,86],[361,198,122],[436,121,7],[468,106,24],[478,101,133],[533,77,80],[545,69,34],[545,69,188],[534,65,82],[529,62,176]]);
  await replayCursorPath(page, [[525,59,108],[520,51,185],[521,49,397]]);
  await replayCursorPath(page, [[524,41,75],[525,36,84]]);
  await replayCursorPath(page, [[525,32,96]]);
  await page.mouse.move(526, 31);
  await page.mouse.down();
  await page.mouse.move(526, 31);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(520, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(514, 40);
  await replayCursorPath(page, [[526,31,39],[526,31,238],[526,31,33],[526,31,49],[526,32,34],[526,32,61],[527,33,237],[526,33,34],[526,34,56]]);
  await replayCursorPath(page, [[522,37,47],[497,53,88],[426,96,85],[374,125,90],[368,130,122],[368,131,190],[363,137,350],[359,142,75],[353,149,34],[352,152,33],[340,165,35],[332,172,39],[326,176,39],[327,175,34],[327,175,33],[326,171,39],[326,170,79]]);
  await page.mouse.move(326, 170);
  await page.mouse.down();
  await replayCursorPath(page, [[326,171,250],[333,178,36],[370,212,55],[391,227,36],[405,236,36],[412,241,34],[416,244,40],[420,247,30],[421,248,36],[425,252,47],[425,252,48],[426,252,53],[427,252,32],[426,252,52],[427,253,36],[432,263,51],[437,270,41],[439,274,39],[439,274,249]]);
  await page.mouse.move(439, 274);
  await page.mouse.up();
  await replayCursorPath(page, [[439,274,72],[439,274,178],[439,274,36],[438,271,54],[436,269,103],[435,260,129],[546,131,100],[556,120,62],[587,66,19],[584,61,87]]);
  await replayCursorPath(page, [[578,55,88],[572,46,76],[571,46,49],[570,45,163],[569,39,33],[569,39,100]]);
  await page.mouse.move(569, 39);
  await page.mouse.down();
  await page.mouse.move(569, 39);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(572, 46);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(554, 40);
  await replayCursorPath(page, [[569,39,1033],[569,39,1466]]);
  await replayCursorPath(page, [[567,44,34],[558,74,40],[544,120,31],[536,169,32],[534,193,40],[534,200,41],[534,200,49],[535,200,34],[537,199,32],[536,194,40],[534,188,34],[534,187,36],[526,184,37],[507,179,39],[485,174,32],[485,174,36],[485,174,98],[485,174,41]]);
  await page.mouse.move(485, 174);
  await page.mouse.down();
  await replayCursorPath(page, [[485,174,36],[487,175,35],[495,178,39],[500,181,39],[521,199,39],[545,217,38],[562,231,33],[569,239,34],[576,245,53],[584,254,31],[593,263,36],[602,273,33],[603,274,50],[603,274,33],[604,276,38],[604,279,38],[604,280,41],[604,281,41],[604,285,35],[605,288,41],[605,288,43],[605,288,51],[605,288,50],[605,288,184]]);
  await page.mouse.move(605, 288);
  await page.mouse.up();
  await replayCursorPath(page, [[605,287,91],[605,287,60],[605,287,34],[605,287,516],[605,287,461],[603,275,34],[602,274,59],[602,271,40],[601,269,195],[597,258,20],[596,252,71],[594,234,29],[590,211,66],[589,193,29],[588,181,38],[588,172,165],[586,138,138],[585,125,92],[586,117,102],[586,111,170],[586,99,63],[586,97,60],[586,90,75],[587,81,57],[587,79,49],[587,74,61],[587,71,504],[586,70,113],[586,60,76]]);
  await replayCursorPath(page, [[586,55,93],[586,51,99],[589,44,93]]);
  await replayCursorPath(page, [[594,40,104]]);
  await page.mouse.move(596, 36);
  await page.mouse.down();
  await page.mouse.move(596, 36);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(600, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(594, 40);
  await replayCursorPath(page, [[596,36,79],[598,36,162],[598,36,584],[599,36,282]]);
  await replayCursorPath(page, [[612,42,65],[653,61,45],[671,70,48],[709,88,37],[771,125,36],[800,152,48],[792,162,40],[775,161,38],[747,159,57],[736,161,56],[736,160,33],[736,160,51],[736,159,125],[736,159,74],[736,159,34],[736,158,41],[737,157,37],[737,156,37],[737,155,35],[737,151,39],[737,150,37],[737,148,40],[737,147,33],[737,147,50],[737,146,34],[737,145,43],[736,145,38],[736,145,50]]);
  await page.mouse.move(734, 146);
  await page.mouse.down();
  await replayCursorPath(page, [[732,149,46],[728,153,32],[720,160,41],[715,163,32],[715,163,83],[715,166,40],[718,174,44],[744,197,36],[782,228,24],[809,254,40],[832,278,29],[852,298,46],[857,301,36],[860,303,32],[862,303,39],[871,308,41],[882,311,36],[892,314,42],[902,316,35],[902,316,65],[902,316,33],[903,316,35],[903,316,81],[904,316,50],[903,316,49],[903,316,68]]);
  await page.mouse.move(903, 316);
  await page.mouse.up();
  await replayCursorPath(page, [[903,316,117],[903,316,52],[903,315,325],[903,315,36],[902,315,87],[902,315,168],[902,315,55],[895,314,40],[888,313,36],[888,313,67],[888,313,201],[888,313,201],[887,313,57],[887,313,48],[882,313,40],[880,313,55],[880,313,420],[864,319,28],[817,347,37],[756,393,35],[658,491,31],[593,581,33],[552,656,32],[540,696,32]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[541,719,3079],[483,621,47],[421,537,29],[405,509,37],[400,500,53],[396,486,29],[394,473,32],[389,451,36],[385,433,69],[375,402,44],[370,395,95],[370,395,451],[370,395,1085],[371,371,63],[399,262,19],[468,155,62],[532,68,40]]);
  await replayCursorPath(page, [[536,53,30],[537,48,42],[536,48,40],[537,48,38],[536,48,34],[534,47,55],[534,45,34],[534,44,40],[534,44,36],[534,44,30],[534,44,49],[534,43,35],[534,43,41],[537,41,33]]);
  await replayCursorPath(page, [[545,36,41],[558,30,40],[563,29,46],[568,28,41],[572,28,41],[577,29,53]]);
  await replayCursorPath(page, [[598,36,61],[619,42,32],[625,44,49],[627,44,50]]);
  await replayCursorPath(page, [[633,44,32],[634,44,41],[634,44,32],[634,44,102]]);
  await page.mouse.move(634, 44);
  await page.mouse.down();
  await page.mouse.move(634, 44);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[634,44,182],[634,44,136],[636,40,34]]);
  await replayCursorPath(page, [[638,38,47],[638,38,500]]);
  await page.mouse.move(638, 38);
  await page.mouse.down();
  await page.mouse.move(638, 38);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[638,38,252]]);
  await replayCursorPath(page, [[638,39,750],[637,39,48],[637,39,33],[637,39,50],[637,39,32],[636,40,94]]);
  await replayCursorPath(page, [[629,43,57],[628,43,51],[628,43,100],[628,43,99],[628,43,251],[628,43,1028]]);
  await replayCursorPath(page, [[614,47,32],[503,101,36],[424,167,42],[340,269,41],[327,320,38],[329,327,71],[329,327,30],[329,327,36],[335,333,45],[342,338,29],[346,340,36],[348,340,38],[353,339,34],[357,339,33],[361,339,39],[365,338,53],[376,335,21],[377,335,35]]);
  await page.mouse.move(377, 335);
  await page.mouse.down();
  await replayCursorPath(page, [[378,335,33],[378,336,40],[378,337,45],[376,362,43],[371,395,47],[368,432,36],[368,450,43],[368,455,33],[368,460,38],[369,468,40],[370,468,38],[370,468,45],[370,468,51],[370,468,68]]);
  await page.mouse.move(370, 468);
  await page.mouse.up();
  await replayCursorPath(page, [[370,468,142],[370,468,1059],[379,454,32],[388,442,77],[455,356,11],[523,266,28],[566,205,39],[587,178,39],[615,138,46],[631,116,32],[640,102,64],[649,86,32],[659,70,35]]);
  await replayCursorPath(page, [[668,55,32],[681,35,48],[685,30,55],[688,27,30],[687,27,48],[687,27,32],[687,28,45],[686,29,40],[686,29,35]]);
  await replayCursorPath(page, [[686,30,36],[684,33,33],[683,34,42]]);
  await page.mouse.move(682, 34);
  await page.mouse.down();
  await replayCursorPath(page, [[682,34,155],[683,34,78]]);
  await page.mouse.move(683, 34);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(680, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(674, 40);
  await replayCursorPath(page, [[683,34,422]]);
  await replayCursorPath(page, [[683,41,34],[680,51,37],[664,89,52],[627,161,35],[603,211,25],[585,248,43],[565,293,33],[553,321,33],[542,344,33],[535,357,34],[529,366,35],[526,370,36],[526,370,33],[524,367,38],[520,359,34],[515,348,35],[513,342,35],[510,335,32],[506,329,33],[505,328,44],[505,327,51]]);
  await page.mouse.move(504, 327);
  await page.mouse.down();
  await replayCursorPath(page, [[504,327,173],[501,337,41],[496,359,40],[491,401,42],[490,416,36],[488,427,34],[487,434,43],[488,439,36],[488,443,37],[488,445,33],[488,447,34],[489,451,35],[489,453,43],[489,456,36],[489,459,42],[489,459,78],[489,458,68]]);
  await page.mouse.move(489, 458);
  await page.mouse.up();
  await replayCursorPath(page, [[489,458,82],[489,458,36],[489,458,50],[491,457,32],[498,448,56],[510,440,25],[570,384,71],[654,269,33],[675,227,36],[686,192,37],[690,175,39],[695,140,46],[698,108,42],[698,83,46],[699,67,47]]);
  await replayCursorPath(page, [[702,50,33],[704,42,56],[706,37,42],[707,35,40],[707,34,33],[707,34,41],[711,34,39],[711,34,59]]);
  await replayCursorPath(page, [[714,36,40],[715,36,188]]);
  await page.mouse.move(715, 36);
  await page.mouse.down();
  await page.mouse.move(715, 36);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(720, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(714, 40);
  await replayCursorPath(page, [[715,36,749],[715,37,99]]);
  await replayCursorPath(page, [[711,45,38],[709,50,46],[701,76,27],[702,100,37],[704,112,85],[706,142,9],[708,159,35],[707,171,32],[706,177,35],[706,186,36],[703,197,38],[694,217,29],[688,234,43],[673,278,28],[665,312,36],[656,347,32],[647,374,33],[641,398,36],[637,412,33],[633,423,34],[632,429,32],[631,431,46],[624,440,30],[617,442,32],[611,442,34],[611,442,41],[611,442,31],[610,441,36],[610,436,33],[610,434,33],[610,434,82],[612,427,38],[615,414,30],[616,407,45],[615,389,27],[614,385,55],[612,379,57],[612,376,35],[612,372,34],[611,368,32],[611,362,45],[611,357,19],[610,356,51],[609,356,32],[609,355,34],[609,355,33],[609,355,33],[609,355,49]]);
  await page.mouse.move(609, 354);
  await page.mouse.down();
  await replayCursorPath(page, [[609,354,54],[609,354,47],[609,354,51],[615,352,59],[622,352,39],[633,352,32],[646,352,45],[665,356,35],[671,358,31],[672,359,40],[673,362,55],[676,370,15],[676,380,44],[670,396,34],[663,404,50],[641,419,34],[627,423,65],[587,435,35],[583,438,42],[583,439,59],[583,440,42],[587,470,54],[597,492,39],[608,508,39],[622,522,37],[641,531,33],[687,544,50],[703,550,36],[710,552,39],[710,553,36],[712,556,41],[714,575,48],[708,595,35],[693,611,37],[682,616,45],[667,622,35],[658,624,35],[652,626,50],[652,626,38],[652,626,83],[652,625,35],[652,625,36],[651,624,66]]);
  await page.mouse.move(651, 623);
  await page.mouse.up();
  await replayCursorPath(page, [[651,624,44],[651,625,56],[652,627,46],[653,631,32],[655,636,38],[656,639,37],[656,641,35],[659,647,44],[661,652,29],[661,654,35],[661,654,33],[661,654,83],[661,655,68],[661,655,83],[661,655,300],[661,655,60],[658,657,26],[652,659,33],[648,661,33],[647,662,39],[643,662,108],[643,662,33],[642,663,37],[635,666,30],[632,668,37],[623,674,31],[618,677,39],[617,681,33],[612,691,33],[606,699,33],[601,709,36]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[599,713,3216],[643,594,39],[708,422,29],[737,323,32],[757,244,34],[767,203,33],[770,188,59],[780,151,32],[783,142,37],[791,119,32],[797,105,33],[800,98,44],[809,68,29],[809,67,37],[809,67,138],[809,67,49],[809,68,34],[809,68,133],[809,67,37],[809,65,32],[807,61,33]]);
  await replayCursorPath(page, [[806,57,34],[803,53,35],[802,52,55],[797,49,31],[793,48,39],[787,44,37]]);
  await replayCursorPath(page, [[777,40,34],[767,38,33],[766,38,48],[765,38,36],[765,38,67],[765,38,184],[765,38,150],[765,38,267],[765,38,250],[765,38,266],[765,38,39]]);
  await page.mouse.move(765, 38);
  await page.mouse.down();
  await page.mouse.move(765, 38);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(760, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(754, 40);
  await replayCursorPath(page, [[765,38,166],[765,38,62],[765,38,1748],[765,38,83],[764,39,35]]);
  await replayCursorPath(page, [[762,43,37],[760,46,33],[760,47,46],[760,47,336],[760,46,49],[760,46,183],[760,46,115]]);
  await replayCursorPath(page, [[771,72,42],[794,134,36],[846,285,34],[891,401,67],[927,502,28],[929,506,40],[929,506,71],[903,489,50],[875,475,35],[860,466,31],[853,459,35]]);
  await page.mouse.move(851, 457);
  await page.mouse.down();
  await replayCursorPath(page, [[851,456,67],[851,456,48],[851,457,34],[851,457,33]]);
  await page.mouse.move(851, 457);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[851,457,167],[851,457,150],[851,457,134],[852,457,148]]);
  await replayCursorPath(page, [[863,456,94],[900,454,81],[923,454,67],[923,454,257],[920,460,42]]);
  // Skipped fill: no valid selector or coordinates found
  await replayCursorPath(page, [[917,465,35],[917,465,209],[916,466,237],[906,493,126],[898,523,207],[893,549,175],[890,570,75],[888,577,42],[886,589,40],[882,609,111],[875,661,58],[873,673,95],[871,689,91],[870,696,73],[866,710,94]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
`,
  },
  {
    name: "Test 13b: Text recording",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Generic",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords, options) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          // Parse role=button[name="Label"] format and use getByRole
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        // Use .first() to handle multiple matches (e.g., header + footer nav links)
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target; // Return locator for assertions
        if (action === 'click') await target.click(options || {});
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    // Coordinate fallback for clicks when all selectors fail
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y, options || {});
      return;
    }
    // Coordinate fallback for fill - click to focus then type
    if (action === 'fill' && coords) {
      console.log('Falling back to coordinate fill at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.selectAll();
      await page.keyboard.type(value || '');
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  // Replay cursor path helper
  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[1257,459,0],[1205,449,39],[1206,448,34],[1204,446,34],[1181,429,32],[1133,406,34],[1072,389,33],[975,368,34],[878,348,34],[790,331,33],[722,317,41],[692,309,33],[672,302,33],[654,296,35],[644,293,33],[644,293,50],[643,293,33],[638,295,33],[629,299,33],[624,300,34],[624,300,66],[618,298,33],[611,295,34],[611,294,42],[611,294,109]]);
  await page.mouse.move(611, 294);
  await page.mouse.down();
  await replayCursorPath(page, [[611,294,140]]);
  await page.mouse.move(611, 294);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[611,294,103],[611,294,64],[611,289,34],[614,263,33],[627,207,33],[643,143,33],[659,96,36],[665,80,32],[665,79,41],[665,78,33],[665,77,33],[665,77,34],[668,73,34]]);
  await replayCursorPath(page, [[679,59,34],[703,34,41],[714,24,32],[714,24,33],[714,24,33],[714,24,35],[714,24,34],[714,25,32],[714,25,37],[714,25,30],[714,26,34],[715,29,32]]);
  await replayCursorPath(page, [[716,33,34],[716,34,33]]);
  await page.mouse.move(716, 34);
  await page.mouse.down();
  await page.mouse.move(716, 34);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(720, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(714, 40);
  await replayCursorPath(page, [[716,34,192],[716,34,60],[726,30,32]]);
  await replayCursorPath(page, [[740,27,34],[744,26,33],[746,26,33],[747,26,34],[748,27,34],[749,27,34],[749,28,48]]);
  await page.mouse.move(749, 28);
  await page.mouse.down();
  await replayCursorPath(page, [[748,27,33],[748,27,50],[748,27,35]]);
  await page.mouse.move(749, 27);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(760, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(754, 40);
  await replayCursorPath(page, [[749,27,32],[749,27,50],[749,27,35],[749,27,41],[748,27,39],[749,27,35],[749,27,42],[749,27,67],[749,28,99],[749,28,134],[755,28,33],[757,28,33],[758,28,83]]);
  await replayCursorPath(page, [[758,30,35],[758,31,216],[758,31,42],[758,31,34],[759,32,40]]);
  await replayCursorPath(page, [[759,33,33],[762,37,33],[765,41,33],[766,44,34],[767,44,100],[767,44,142],[767,44,250],[766,44,50]]);
  await replayCursorPath(page, [[762,49,33],[753,57,33],[731,70,34],[682,105,42],[629,149,33],[559,203,33],[481,248,34],[414,264,33],[382,267,34],[353,276,41],[326,283,33],[298,291,34],[269,303,33],[241,315,41],[239,317,34],[239,317,33],[254,319,34],[325,312,33],[381,310,33],[391,312,33],[391,312,33],[391,313,34],[391,313,51],[391,312,33],[407,312,33],[444,311,35],[460,311,31],[460,310,36],[460,310,41]]);
  await page.mouse.move(460, 310);
  await page.mouse.down();
  await replayCursorPath(page, [[460,310,108]]);
  await page.mouse.move(460, 310);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[460,311,176],[459,311,40],[459,311,66],[459,312,42]]);
  await replayCursorPath(page, [[460,312,60],[460,312,206]]);
  await replayCursorPath(page, [[470,313,35],[491,312,33],[509,307,33],[518,305,33],[517,306,63],[517,306,37],[517,307,33],[516,308,42],[516,307,44]]);
  // Coordinate-only fill (no selectors found) - click to focus then type
  await page.mouse.click(464, 323);
  await page.keyboard.selectAll();
  await page.keyboard.type('1');
  // Coordinate-only fill (no selectors found) - click to focus then type
  await page.mouse.click(464, 323);
  await page.keyboard.selectAll();
  await page.keyboard.type('12');
  // Coordinate-only fill (no selectors found) - click to focus then type
  await page.mouse.click(471, 323);
  await page.keyboard.selectAll();
  await page.keyboard.type('123');
  // Coordinate-only fill (no selectors found) - click to focus then type
  await page.mouse.click(477, 323);
  await page.keyboard.selectAll();
  await page.keyboard.type('1231');
  // Coordinate-only fill (no selectors found) - click to focus then type
  await page.mouse.click(482, 323);
  await page.keyboard.selectAll();
  await page.keyboard.type('12312');
  // Coordinate-only fill (no selectors found) - click to focus then type
  await page.mouse.click(489, 323);
  await page.keyboard.selectAll();
  await page.keyboard.type('123123');
  // Coordinate-only fill (no selectors found) - click to focus then type
  await page.mouse.click(495, 323);
  await page.keyboard.selectAll();
  await page.keyboard.type('1231231');
  // Coordinate-only fill (no selectors found) - click to focus then type
  await page.mouse.click(499, 323);
  await page.keyboard.selectAll();
  await page.keyboard.type('12312313');
  // Coordinate-only fill (no selectors found) - click to focus then type
  await page.mouse.click(505, 323);
  await page.keyboard.selectAll();
  await page.keyboard.type('123123131');
  await replayCursorPath(page, [[517,308,1581]]);
  await replayCursorPath(page, [[544,321,33],[676,339,34],[926,362,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
`,
  },
  {
    name: "Test 14: Box Selection + Shift-Click",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Generic",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords, options) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          // Parse role=button[name="Label"] format and use getByRole
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        // Use .first() to handle multiple matches (e.g., header + footer nav links)
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target; // Return locator for assertions
        if (action === 'click') await target.click(options || {});
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    // Coordinate fallback for clicks when all selectors fail
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y, options || {});
      return;
    }
    // Coordinate fallback for fill - click to focus then type
    if (action === 'fill' && coords) {
      console.log('Falling back to coordinate fill at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.selectAll();
      await page.keyboard.type(value || '');
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  // Replay cursor path helper
  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[1156,664,0],[962,621,39],[826,554,42],[745,486,33],[667,407,34],[606,345,33],[563,296,33],[546,266,33],[537,234,33],[531,200,34],[525,167,34],[518,138,39],[514,122,27],[510,106,33],[504,89,33],[498,74,34],[496,67,32],[495,61,34]]);
  await replayCursorPath(page, [[496,55,33],[496,54,34],[496,54,35],[496,54,31],[497,54,42]]);
  await replayCursorPath(page, [[503,51,35],[506,50,40],[507,50,34],[507,49,33],[511,47,33],[511,47,59],[511,47,908],[511,51,33]]);
  await replayCursorPath(page, [[506,69,34],[490,122,33],[460,195,34],[440,240,33],[438,242,50],[438,242,517],[438,242,167],[438,243,100],[438,243,41],[438,243,134],[438,243,33],[438,243,33],[437,243,33],[436,243,33],[438,245,34],[437,245,41],[438,245,43],[438,245,42]]);
  await page.mouse.move(438, 245);
  await page.mouse.down();
  await replayCursorPath(page, [[438,245,41]]);
  await page.mouse.move(438, 245);
  await page.mouse.up();
  await replayCursorPath(page, [[438,245,134],[438,245,115]]);
  await page.keyboard.press('2');
  await replayCursorPath(page, [[438,245,1268],[437,241,33],[437,238,33],[436,236,41],[436,234,33],[434,231,34],[434,224,34],[434,221,33],[434,215,33],[434,207,33],[433,195,34],[433,188,100],[433,188,33]]);
  await page.mouse.move(433, 188);
  await page.mouse.down();
  await replayCursorPath(page, [[433,188,318],[434,189,42],[439,201,40],[444,210,33],[449,219,34],[454,228,33],[460,238,34],[466,246,33],[472,253,33],[482,264,33],[493,275,33],[505,286,34],[520,298,34],[534,310,32],[546,320,34],[557,328,33],[566,335,34],[570,337,33],[571,337,59],[571,337,33],[583,340,32],[603,344,34],[618,346,34],[619,346,75],[619,346,152],[633,346,39],[634,346,59],[634,347,126],[634,347,173],[634,347,192]]);
  await page.mouse.move(634, 347);
  await page.mouse.up();
  await replayCursorPath(page, [[633,347,47],[633,351,41],[633,350,38],[634,347,32],[635,344,34],[635,344,150],[648,339,33],[686,328,34],[727,312,33],[746,299,33],[750,294,33],[752,289,34],[754,279,35],[756,265,32],[760,249,33],[762,234,33],[765,222,34],[768,212,33],[770,207,42],[770,206,34]]);
  await page.keyboard.press('2');
  await replayCursorPath(page, [[770,206,166],[770,206,105],[769,206,70],[769,206,233],[759,201,34],[749,194,33],[747,192,33],[746,192,35],[746,192,60]]);
  await page.mouse.move(746, 192);
  await page.mouse.down();
  await replayCursorPath(page, [[746,192,180],[761,215,33],[792,250,33],[815,272,34],[829,285,33],[844,299,34],[861,314,33],[886,333,34],[908,349,33],[930,363,33],[946,371,33],[955,375,33],[965,380,34],[974,384,34],[975,385,41],[976,385,42],[975,385,66],[975,384,34],[975,384,300],[975,385,567]]);
  await page.mouse.move(975, 385);
  await page.mouse.up();
  await replayCursorPath(page, [[975,385,3158],[956,380,33],[927,372,33],[902,365,34],[885,360,32],[864,355,37],[813,346,39],[768,336,32],[740,331,34],[719,329,33],[711,328,34],[711,328,33],[711,328,93],[686,329,33],[657,328,33],[648,327,34],[647,327,33],[647,327,41],[647,327,67],[647,327,33],[647,327,33],[647,327,33],[638,323,35],[622,316,41],[619,314,33],[618,314,34],[618,314,141],[619,313,43],[620,313,33],[622,311,33],[624,309,32],[625,308,42],[625,308,35],[625,308,232],[628,305,50],[628,305,200]]);
  await page.keyboard.down('Shift');
  await page.mouse.move(628, 305);
  await page.mouse.down();
  await replayCursorPath(page, [[628,305,89]]);
  await page.mouse.move(628, 305);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await replayCursorPath(page, [[627,305,221],[627,305,458],[627,305,50]]);
  await page.mouse.move(627, 305);
  await page.mouse.down();
  await replayCursorPath(page, [[627,306,2340],[627,309,34],[626,316,32],[624,325,34],[623,333,33],[621,345,34],[620,354,33],[619,363,34],[618,375,41],[617,388,33],[615,405,34],[615,418,33],[615,429,34],[615,438,33],[614,446,33],[614,455,34],[614,463,33],[613,470,33],[613,474,34],[613,477,33],[613,482,33],[613,485,33],[613,489,34],[613,490,358],[612,498,33],[612,500,34],[612,501,66],[612,501,85]]);
  await page.mouse.move(612, 501);
  await page.mouse.up();
  await replayCursorPath(page, [[612,501,59],[612,500,33],[613,499,107],[616,497,33],[666,508,33],[839,515,34],[1168,515,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1176,560,2576],[1093,549,33],[1012,537,32],[950,523,34],[921,516,33],[913,513,34],[908,510,33],[903,506,33],[893,487,34],[878,448,33],[858,419,34],[844,400,33],[830,378,33],[816,357,34],[803,344,32],[800,342,40],[800,341,36],[797,337,34],[794,334,32],[795,334,143],[795,333,41],[810,326,33],[852,316,34],[884,311,33],[929,305,33],[990,297,41],[1018,293,34],[1036,289,33],[1049,285,33],[1049,284,69]]);
  await page.mouse.move(1049, 284);
  await page.mouse.down();
  await page.mouse.move(1049, 285);
  await page.mouse.up();
  await replayCursorPath(page, [[1048,285,156],[1048,285,59],[1048,285,59],[1048,285,41],[1049,285,45]]);
  await page.mouse.move(1049, 285);
  await page.mouse.down();
  await replayCursorPath(page, [[1049,285,347],[1045,292,33],[1015,316,33],[955,349,34],[875,399,33],[794,459,34],[732,515,32],[686,564,34],[644,607,33],[607,637,33],[572,657,34],[528,673,42],[489,678,33],[464,677,34],[450,673,33],[439,663,33],[427,648,34],[423,643,33],[422,643,33],[422,642,54],[415,636,30],[405,632,33],[393,628,33],[383,626,34],[382,626,33]]);
  await page.mouse.move(382, 626);
  await page.mouse.up();
  await replayCursorPath(page, [[382,626,800],[382,626,317],[388,619,33],[426,608,33],[521,588,34],[692,561,32],[985,530,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1179,485,2535],[1091,506,40],[1029,511,33],[1006,509,33],[1006,509,34],[1006,509,33],[1005,503,33],[1004,500,34],[998,487,33],[987,479,33],[983,477,35],[983,477,74],[983,477,150],[983,477,42],[982,477,35],[981,478,31],[977,479,41],[972,481,34],[965,483,42],[965,484,42],[965,483,59]]);
  await page.mouse.move(965, 483);
  await page.mouse.down();
  await page.mouse.move(965, 483);
  await page.mouse.up();
  await replayCursorPath(page, [[965,483,682],[965,483,377],[965,483,81],[965,483,169],[971,458,40],[992,425,33],[1009,396,33],[1021,370,33],[1029,348,34],[1032,336,33],[1031,331,33],[1030,315,34],[1029,300,35],[1028,297,31]]);
  await page.mouse.move(1029, 297);
  await page.mouse.down();
  await replayCursorPath(page, [[1029,298,34],[1028,297,34],[1026,301,33],[981,348,33],[903,442,33],[821,531,33],[755,573,34],[712,589,34],[685,598,33],[658,603,33],[638,603,33],[615,597,33],[582,586,34],[538,575,37],[491,562,30],[449,553,33],[420,550,33],[409,548,34],[401,548,33],[389,548,33],[375,548,33],[363,551,34],[349,561,33],[333,577,33],[323,589,34],[320,599,33],[319,610,34],[319,616,33],[320,618,36],[323,623,31],[325,625,33],[325,625,35],[326,625,49],[326,625,66]]);
  await page.mouse.move(326, 625);
  await page.mouse.up();
  await replayCursorPath(page, [[328,622,33],[351,606,33],[406,577,34],[470,547,34],[522,529,33],[548,516,33],[556,509,34],[561,503,32],[571,494,35],[590,479,32],[620,464,34],[647,454,33],[664,449,34],[675,446,41],[687,443,34],[696,442,32],[699,443,34],[708,445,34],[713,449,41],[715,451,33],[716,451,67],[723,453,36],[726,454,30],[727,454,43],[731,454,33],[732,454,93]]);
  await page.mouse.move(731, 454);
  await page.mouse.down();
  await replayCursorPath(page, [[731,454,249],[734,436,41],[737,398,33],[737,368,42],[737,345,41],[738,329,33],[736,317,34],[735,305,34],[734,289,33],[734,281,33],[733,273,33],[734,268,34],[734,258,33],[734,256,34],[734,253,33],[733,251,42],[733,251,49],[733,251,34],[734,251,33]]);
  await page.mouse.move(734, 251);
  await page.mouse.up();
  await replayCursorPath(page, [[734,248,33],[734,246,34],[734,246,34],[739,244,33],[780,245,32],[937,245,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
`,
  },
  {
    name: "Test 16: Flip Horizontal/Vertical",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Generic",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords, options) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          // Parse role=button[name="Label"] format and use getByRole
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        // Use .first() to handle multiple matches (e.g., header + footer nav links)
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target; // Return locator for assertions
        if (action === 'click') await target.click(options || {});
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    // Coordinate fallback for clicks when all selectors fail
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y, options || {});
      return;
    }
    // Coordinate fallback for fill - click to focus then type
    if (action === 'fill' && coords) {
      console.log('Falling back to coordinate fill at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.selectAll();
      await page.keyboard.type(value || '');
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  // Replay cursor path helper
  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[1269,414,0],[1115,380,39],[1001,362,34],[921,355,33],[843,357,33],[770,368,33],[708,375,34],[651,374,33],[615,370,33],[592,366,35],[563,361,32]]);
  await replayCursorPath(page, [[539,355,35],[517,347,41],[511,344,33],[507,343,33],[485,339,33],[418,327,33],[316,311,34],[248,301,33],[244,300,34],[245,300,33],[246,300,34],[259,297,33],[276,297,33],[286,298,33],[306,302,34],[333,308,33],[358,313,33],[395,318,33],[420,321,35],[423,321,50],[423,321,33]]);
  await page.mouse.move(423, 321);
  await page.mouse.down();
  await replayCursorPath(page, [[423,321,115]]);
  await page.mouse.move(423, 321);
  await page.mouse.up();
  await page.keyboard.press('2');
  await replayCursorPath(page, [[423,321,1068],[423,321,68],[424,319,33],[427,309,32],[430,300,34],[432,290,32],[435,274,34],[435,265,33],[435,260,34],[434,256,33],[433,247,33],[434,229,33],[437,221,34],[437,221,68],[443,215,32],[450,211,34],[450,210,46],[461,200,37],[464,196,34],[465,196,34],[466,190,41],[465,188,33],[465,181,33]]);
  await page.mouse.move(465, 177);
  await page.mouse.down();
  await replayCursorPath(page, [[465,177,100],[465,178,34],[472,191,33],[489,216,33],[512,246,34],[539,270,41],[542,272,34],[542,272,33],[542,272,34],[542,272,32],[542,272,51],[542,272,42],[542,272,32],[542,272,35]]);
  await page.mouse.move(542, 272);
  await page.mouse.up();
  await replayCursorPath(page, [[542,272,82],[542,272,60],[542,272,32],[542,272,35],[539,280,40],[529,299,33],[515,324,33],[502,343,34],[493,354,33],[486,360,33],[480,362,33],[478,362,35],[478,362,41],[478,362,33],[477,362,34],[477,361,41],[474,356,33],[470,349,34],[467,343,33],[464,338,42],[464,338,91]]);
  await page.keyboard.press('2');
  await replayCursorPath(page, [[465,338,276]]);
  await page.mouse.move(465, 338);
  await page.mouse.down();
  await replayCursorPath(page, [[465,338,383],[465,340,41],[483,367,34],[519,419,33],[556,463,42],[567,474,25],[567,474,33],[568,474,33],[568,475,35],[568,474,42],[568,475,32],[568,474,33],[568,474,33],[568,474,34],[568,474,33],[567,474,33],[566,474,34],[564,474,34],[561,473,32],[558,472,33],[558,472,50]]);
  await page.mouse.move(558, 472);
  await page.mouse.up();
  await replayCursorPath(page, [[558,472,297],[558,472,171],[558,474,33],[559,477,33],[565,483,33],[574,490,34],[580,494,33],[588,499,34],[605,505,41],[615,507,33],[628,509,33],[637,510,34],[637,510,58]]);
  await page.mouse.move(637, 510);
  await page.mouse.down();
  await replayCursorPath(page, [[637,510,100],[637,509,33],[625,493,33],[596,462,34],[566,431,34],[539,394,33],[516,354,33],[498,304,33],[482,269,34],[471,243,33],[461,224,33],[450,206,34],[441,191,33],[433,182,34],[429,174,33],[425,163,33],[421,158,34],[420,156,33],[420,155,33],[420,152,34],[420,151,142]]);
  await page.mouse.move(420, 151);
  await page.mouse.up();
  await replayCursorPath(page, [[420,151,133],[420,151,42],[419,152,33],[416,153,33],[408,160,33],[389,173,34],[361,189,33],[331,207,33],[305,223,33],[283,239,34],[268,253,33],[257,264,33],[248,279,33],[238,298,34],[232,313,34],[228,330,33],[223,348,34],[220,365,41],[219,368,34],[219,368,32],[218,368,34]]);
  await replayCursorPath(page, [[215,372,34],[205,378,41],[193,384,33],[178,389,33],[158,394,34],[141,397,33],[133,400,33]]);
  await replayCursorPath(page, [[129,402,35],[129,402,274]]);
  await replayCursorPath(page, [[120,409,33],[107,420,33],[98,426,33],[95,428,35],[95,428,32],[96,429,50],[96,429,34],[96,428,41],[95,428,34],[95,429,32],[96,430,103]]);
  await replayCursorPath(page, [[97,432,33],[98,434,33],[100,435,33],[106,441,40],[112,445,34],[114,446,60],[114,446,90],[114,445,117],[114,445,141],[115,446,109],[116,447,41],[117,447,35],[116,447,33],[117,448,33],[117,449,33]]);
  await replayCursorPath(page, [[117,450,108],[117,450,42],[117,450,74],[118,451,33],[118,453,34],[118,454,38],[118,454,31]]);
  await replayCursorPath(page, [[118,456,34],[118,458,42],[118,458,33]]);
  await replayCursorPath(page, [[118,459,143],[118,458,330],[118,458,41],[118,457,42],[119,456,49],[122,455,17],[122,455,75],[122,455,234],[124,458,33],[126,462,33],[127,463,59],[127,463,41],[127,463,67],[127,464,41],[128,464,34],[128,466,33]]);
  await replayCursorPath(page, [[128,467,42],[128,467,58],[130,468,33],[130,469,43],[130,469,58]]);
  await replayCursorPath(page, [[132,472,33],[133,473,50],[133,473,134],[133,473,58],[134,475,34],[137,481,40],[139,488,33]]);
  await replayCursorPath(page, [[141,494,34],[142,501,34],[142,511,32],[141,524,34],[137,533,33],[131,542,38]]);
  await replayCursorPath(page, [[127,548,30],[123,553,41],[122,553,58],[122,554,42],[118,561,33],[115,567,33],[111,573,34],[108,576,33]]);
  await replayCursorPath(page, [[106,578,33],[104,581,34],[100,584,33],[98,586,33],[96,589,35],[92,592,41]]);
  await replayCursorPath(page, [[88,595,33],[85,596,32],[84,597,34],[82,598,34],[81,598,34],[82,599,32],[81,598,33],[82,598,35],[84,598,41]]);
  await replayCursorPath(page, [[92,597,34],[103,597,33],[110,597,32],[117,598,34],[122,599,34],[124,600,33],[124,600,33]]);
  await replayCursorPath(page, [[125,600,35],[125,600,50],[125,600,1474],[125,600,67]]);
  await replayCursorPath(page, [[125,598,35],[124,589,31],[123,580,33],[122,573,33],[122,568,34],[123,562,34],[124,556,33],[124,551,33],[125,548,33]]);
  await replayCursorPath(page, [[126,544,33],[127,540,33],[127,538,35],[127,537,50],[127,534,40]]);
  await replayCursorPath(page, [[128,532,37],[128,532,39],[127,532,266],[127,532,41],[127,532,2093]]);
  await replayCursorPath(page, [[139,523,32],[170,507,34],[207,492,33],[245,473,34],[277,456,33],[304,443,34],[327,432,33],[350,421,33],[375,411,34],[402,401,33],[420,395,33],[431,391,33],[450,384,34],[475,374,34],[496,363,32],[516,352,34],[534,339,33],[544,331,33],[550,326,34],[554,324,34],[554,324,33],[553,324,42],[553,325,42],[553,327,41],[553,329,33],[552,330,33],[552,332,34],[551,334,34],[551,337,41],[551,339,34],[550,342,42],[550,344,32],[550,345,34],[550,346,32],[550,346,42],[550,346,92],[550,346,33],[550,346,34],[550,346,100],[550,345,84]]);
  await page.mouse.move(550, 345);
  await page.mouse.down({ button: 'right' });
  // Coordinate-only right-click (no selectors found)
  await page.mouse.click(550, 345, { button: 'right' });
  await page.mouse.move(550, 345);
  await page.mouse.up({ button: 'right' });
  await replayCursorPath(page, [[550,346,207],[550,346,434],[550,346,933],[550,354,33]]);
  await replayCursorPath(page, [[552,366,33],[555,380,34],[560,397,33],[563,406,33],[571,417,34],[586,434,33]]);
  await replayCursorPath(page, [[601,452,34],[618,470,33],[634,489,33],[645,504,34],[653,520,32],[656,529,34]]);
  await replayCursorPath(page, [[658,533,33],[658,533,35],[658,535,33],[659,537,32],[660,542,33],[661,547,34],[660,554,42],[660,561,34],[660,566,41]]);
  await replayCursorPath(page, [[660,569,33],[661,573,41],[662,576,34],[661,577,51],[661,577,142],[661,577,282],[662,577,42],[663,575,33],[664,573,33],[666,569,33],[667,569,35],[668,568,32]]);
  await replayCursorPath(page, [[672,564,33],[674,562,34],[678,558,33],[683,553,41]]);
  await page.mouse.move(683, 553);
  await page.mouse.down();
  await page.mouse.move(683, 553);
  await page.mouse.up();
  await replayCursorPath(page, [[683,553,549],[683,553,637],[682,553,34],[680,556,39],[679,557,36],[679,557,148],[680,557,209],[716,555,41],[861,567,33],[1116,575,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1268,315,2268],[1230,313,32],[1209,315,34],[1177,323,33],[1157,326,33],[1132,325,33],[1076,326,34],[973,330,33],[840,335,33],[699,342,34],[599,350,33],[536,357,34],[506,362,33],[493,367,33],[486,369,33],[486,369,36],[486,368,32],[486,368,34],[490,364,32],[496,358,33],[500,354,34],[503,352,35],[508,350,32],[508,349,209],[509,349,32],[511,347,33],[512,346,34],[516,344,33],[517,343,35]]);
  await page.mouse.move(517, 343);
  await page.mouse.down({ button: 'right' });
  // Coordinate-only right-click (no selectors found)
  await page.mouse.click(517, 343, { button: 'right' });
  await replayCursorPath(page, [[517,343,114]]);
  await page.mouse.move(517, 343);
  await page.mouse.up({ button: 'right' });
  await replayCursorPath(page, [[517,343,202],[517,343,225],[517,343,108],[517,345,33]]);
  await replayCursorPath(page, [[529,361,33],[555,386,33],[584,412,33],[622,444,34],[660,477,34],[681,496,32]]);
  await replayCursorPath(page, [[688,505,34],[692,511,33],[695,518,33],[696,523,34],[696,527,33],[695,533,33],[691,541,33]]);
  await replayCursorPath(page, [[689,550,34],[685,557,33],[680,565,34],[676,572,34],[675,574,32],[675,574,76],[675,574,125],[675,574,42]]);
  await page.mouse.move(675, 574);
  await page.mouse.down();
  await replayCursorPath(page, [[675,574,107]]);
  await page.mouse.move(675, 574);
  await page.mouse.up();
  await replayCursorPath(page, [[675,574,569],[679,569,39],[719,562,34],[846,559,33],[1098,565,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1265,405,3650],[1090,452,25],[915,490,33],[770,514,34],[680,522,33],[660,523,33],[660,523,34],[660,523,32],[660,522,35],[660,517,32],[658,512,33],[641,501,34],[597,493,33],[556,484,33],[553,481,34],[554,480,33],[557,470,34],[567,454,33],[575,441,33],[576,440,41],[575,441,1035],[575,441,2158],[575,442,35],[575,441,240],[575,441,34],[575,440,50],[576,440,491],[603,454,32],[711,468,34],[925,484,33],[1261,495,33]]);
}
`,
  },
  {
    name: "Test 17: Element Locking",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Generic",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords, options) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          // Parse role=button[name="Label"] format and use getByRole
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        // Use .first() to handle multiple matches (e.g., header + footer nav links)
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target; // Return locator for assertions
        if (action === 'click') await target.click(options || {});
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    // Coordinate fallback for clicks when all selectors fail
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y, options || {});
      return;
    }
    // Coordinate fallback for fill - click to focus then type
    if (action === 'fill' && coords) {
      console.log('Falling back to coordinate fill at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.selectAll();
      await page.keyboard.type(value || '');
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  // Replay cursor path helper
  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[1272,256,0],[1120,188,40],[1024,144,32],[960,112,34],[915,81,33],[876,54,37]]);
  await replayCursorPath(page, [[824,24,31],[781,7,33],[771,4,33],[771,4,41],[771,4,33],[765,12,34]]);
  await replayCursorPath(page, [[746,21,35],[718,32,32],[688,39,32],[655,42,34],[622,41,34],[602,39,41]]);
  await replayCursorPath(page, [[593,39,35],[586,39,40],[586,39,47],[586,39,113]]);
  await replayCursorPath(page, [[573,41,27],[563,43,33],[556,43,33],[553,43,32],[553,43,38],[553,42,46],[553,42,83]]);
  await page.mouse.move(553, 42);
  await page.mouse.down();
  await page.mouse.move(553, 42);
  await page.mouse.up();
  await replayCursorPath(page, [[553,42,546],[553,43,1]]);
  await replayCursorPath(page, [[554,74,0],[556,138,0],[558,180,0],[560,201,0],[559,219,0],[557,229,1],[557,230,0],[557,230,0],[557,230,4],[557,230,31],[556,232,32],[554,233,34],[551,235,33],[546,238,34],[542,242,41],[541,242,33],[542,242,34],[541,242,75],[541,243,116]]);
  await page.mouse.move(541, 243);
  await page.mouse.down();
  await replayCursorPath(page, [[541,243,84],[547,262,32],[564,318,34],[585,362,34],[596,379,33],[603,386,34],[613,398,41],[621,407,33],[625,410,34],[628,411,32],[632,412,34],[636,414,33],[639,416,34],[643,416,33],[650,417,33],[653,417,34],[655,418,33],[658,418,33],[662,418,34],[665,419,33],[666,419,34],[666,419,149]]);
  await page.mouse.move(666, 419);
  await page.mouse.up();
  await replayCursorPath(page, [[666,419,84],[666,419,51],[666,417,32],[666,413,34],[665,409,32],[665,399,34],[666,377,42],[665,365,33],[664,357,34],[664,353,32],[662,350,34],[661,348,34],[661,347,32],[661,347,60],[661,345,41],[661,341,32],[661,341,86]]);
  await page.mouse.move(661, 341);
  await page.mouse.down({ button: 'right' });
  // Coordinate-only right-click (no selectors found)
  await page.mouse.click(661, 341, { button: 'right' });
  await replayCursorPath(page, [[660,341,440]]);
  await page.mouse.move(660, 341);
  await page.mouse.up({ button: 'right' });
  await replayCursorPath(page, [[660,341,277],[660,341,74],[660,341,51],[660,341,33],[660,341,48],[660,345,17],[659,350,34],[660,359,33]]);
  await replayCursorPath(page, [[665,374,34],[676,399,32],[699,448,33],[724,511,34],[740,568,33],[746,605,34]]);
  await replayCursorPath(page, [[747,624,33],[747,626,42],[747,626,32],[747,626,51],[747,629,44],[747,630,39],[747,633,33]]);
  await replayCursorPath(page, [[748,637,34],[747,640,33],[747,640,51],[747,640,83]]);
  await page.mouse.move(747, 640);
  await page.mouse.down();
  await replayCursorPath(page, [[747,640,166]]);
  await page.mouse.move(747, 640);
  await page.mouse.up();
  await replayCursorPath(page, [[747,640,378],[747,635,31],[737,588,33],[722,513,33],[713,456,33],[710,399,34],[708,351,34],[706,336,33],[706,335,100],[704,337,32],[699,338,35],[693,338,32],[690,339,33],[690,339,220],[689,339,90],[682,340,33],[672,340,36],[663,340,39],[658,341,34],[652,342,32],[651,342,227],[652,342,73],[652,342,101],[652,342,34],[652,342,90],[685,354,33],[848,369,34],[1152,372,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1243,252,1627],[1099,248,32],[970,229,33],[879,213,34],[810,200,32],[767,195,33],[743,190,34],[715,186,33],[709,187,33],[706,194,35],[696,218,41],[686,239,33],[675,248,33],[649,251,34],[599,250,33],[544,245,35],[489,239,41],[474,239,40],[474,239,34],[474,239,92],[474,239,34],[474,239,33],[475,238,32],[477,233,34],[478,221,34],[478,214,32],[478,213,61]]);
  await page.mouse.move(478, 213);
  await page.mouse.down();
  await replayCursorPath(page, [[478,213,57],[479,214,68],[518,250,39],[609,324,35],[755,438,40],[844,509,33],[885,543,35],[890,548,33],[890,548,49],[892,550,34],[893,551,75]]);
  await page.mouse.move(893, 551);
  await page.mouse.up();
  await replayCursorPath(page, [[893,551,76],[886,540,33],[826,478,34],[735,410,41],[669,369,34],[623,341,32],[618,337,59],[618,337,91],[627,335,34],[635,335,33],[640,335,33],[643,334,34],[647,333,33],[649,332,33]]);
  await page.mouse.move(649, 332);
  await page.mouse.down();
  await replayCursorPath(page, [[650,332,92],[655,333,33],[658,333,33],[660,334,34],[661,334,35],[667,335,40],[676,335,33],[708,338,34],[763,345,33],[803,349,34],[808,351,40],[808,351,34]]);
  await page.mouse.move(808, 350);
  await page.mouse.up();
  await replayCursorPath(page, [[807,350,33],[807,351,42],[791,348,33],[731,339,34],[659,328,33],[604,322,34],[596,320,83]]);
  await page.mouse.move(596, 320);
  await page.mouse.down();
  await replayCursorPath(page, [[596,320,67],[597,320,41],[617,321,35],[679,332,32],[740,342,33],[774,349,33],[773,348,33],[773,348,33],[773,352,34]]);
  await page.mouse.move(773, 357);
  await page.mouse.up();
  await replayCursorPath(page, [[773,360,33],[772,363,34],[772,366,34],[763,370,33],[693,370,33],[580,358,34],[503,351,32],[485,350,34]]);
  await page.mouse.move(485, 350);
  await page.mouse.down();
  await replayCursorPath(page, [[485,350,35],[485,350,31],[487,351,34],[534,363,34],[659,397,41],[768,438,33],[828,466,33],[832,468,34]]);
  await page.mouse.move(832, 468);
  await page.mouse.up();
  await replayCursorPath(page, [[832,468,33],[832,468,34],[832,467,43],[831,467,31],[827,465,34],[825,461,33],[824,460,34],[824,459,33],[824,457,34],[830,459,33],[877,461,33],[1039,457,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
`,
  },
  {
    name: "Test 18: Multi-Point Line/Arrow",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Generic",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords, options) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          // Parse role=button[name="Label"] format and use getByRole
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        // Use .first() to handle multiple matches (e.g., header + footer nav links)
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target; // Return locator for assertions
        if (action === 'click') await target.click(options || {});
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    // Coordinate fallback for clicks when all selectors fail
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y, options || {});
      return;
    }
    // Coordinate fallback for fill - click to focus then type
    if (action === 'fill' && coords) {
      console.log('Falling back to coordinate fill at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.selectAll();
      await page.keyboard.type(value || '');
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  // Replay cursor path helper
  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[1176,218,0],[1115,200,32],[1042,184,33],[961,163,34],[897,148,33],[875,148,33],[864,146,34],[863,145,41],[840,143,34],[793,134,33],[747,119,33],[715,106,33],[697,94,34],[686,84,33],[678,76,33],[676,73,34],[672,65,33],[671,64,33],[670,63,42]]);
  await replayCursorPath(page, [[667,59,41],[664,55,34],[660,52,33],[659,51,34],[657,49,33],[655,47,41],[654,47,110],[654,46,183]]);
  await replayCursorPath(page, [[649,43,32],[649,42,36],[649,42,56]]);
  await page.mouse.move(649, 42);
  await page.mouse.down();
  await page.mouse.move(649, 42);
  await page.mouse.up();
  await replayCursorPath(page, [[649,42,344]]);
  await replayCursorPath(page, [[635,44,40],[591,52,33],[518,77,33],[451,103,34],[410,128,33],[379,154,33],[361,174,33],[353,184,34],[344,196,33],[328,216,33],[314,234,34],[308,242,33],[308,243,33],[306,246,34],[306,247,284]]);
  await page.mouse.move(306, 247);
  await page.mouse.down();
  await replayCursorPath(page, [[306,247,141]]);
  await page.mouse.move(306, 247);
  await page.mouse.up();
  await replayCursorPath(page, [[306,246,45],[306,246,41],[306,246,32],[304,245,32],[307,241,34],[310,234,33],[315,227,33],[318,222,33],[324,214,34],[329,210,33],[332,206,33],[338,201,34],[341,198,33],[347,194,34],[352,190,33],[352,190,33],[353,190,51],[358,186,41],[361,184,34],[366,181,33],[370,180,33],[373,178,33],[376,178,35],[376,178,316]]);
  await page.mouse.move(376, 178);
  await page.mouse.down();
  await page.mouse.move(376, 178);
  await page.mouse.up();
  await replayCursorPath(page, [[376,178,216],[377,183,33],[381,193,33],[386,208,34],[390,221,34],[393,229,33],[393,235,33],[394,241,33],[394,243,34],[395,245,33],[396,249,33],[396,252,34],[396,253,34],[396,254,41],[396,255,34],[396,257,34],[396,260,32],[396,263,33],[396,264,33],[396,265,33],[396,265,34],[397,268,33],[399,270,34],[400,272,33],[401,275,33]]);
  await page.mouse.move(402, 275);
  await page.mouse.down();
  await page.mouse.move(402, 275);
  await page.mouse.up();
  await replayCursorPath(page, [[402,275,335],[402,275,23],[402,273,33],[405,270,34],[412,263,34],[421,258,33],[428,252,33],[443,242,33],[455,234,34],[463,227,33],[468,223,34],[475,216,33],[482,210,33],[486,205,33],[487,204,34],[489,202,33],[490,201,34],[490,201,77],[493,197,39],[496,194,33],[497,194,34],[497,194,33],[497,194,34],[496,194,33]]);
  await page.mouse.move(497, 195);
  await page.mouse.down();
  await replayCursorPath(page, [[497,195,33],[496,194,33],[497,195,42]]);
  await page.mouse.move(497, 195);
  await page.mouse.up();
  await replayCursorPath(page, [[497,195,175],[500,201,34],[511,217,33],[522,233,33],[530,245,34],[535,254,33],[537,259,33],[539,263,34],[541,270,41],[542,273,33],[543,277,34],[544,280,33],[544,283,34],[545,286,33],[545,287,41]]);
  await page.mouse.move(545, 287);
  await page.mouse.down();
  await replayCursorPath(page, [[545,287,252]]);
  await page.mouse.move(545, 287);
  await page.mouse.up();
  await replayCursorPath(page, [[547,284,32],[551,277,33],[561,266,34],[576,251,32],[588,239,35],[598,229,32],[609,218,33],[621,207,34],[631,199,34],[642,192,41],[645,191,42],[646,190,33],[651,187,34],[652,187,41],[651,187,160]]);
  await page.mouse.move(651, 187);
  await page.mouse.down();
  await replayCursorPath(page, [[651,187,308]]);
  await page.mouse.move(651, 187);
  await page.mouse.up();
  await page.mouse.move(651, 187);
  await page.mouse.down();
  await page.mouse.move(651, 187);
  await page.mouse.up();
  await replayCursorPath(page, [[651,188,1617],[651,188,42],[651,188,99]]);
  await page.mouse.move(651, 188);
  await page.mouse.down();
  await page.mouse.move(651, 188);
  await page.mouse.up();
  await replayCursorPath(page, [[651,188,1824],[652,188,41],[696,199,34],[862,225,33],[1123,248,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1169,40,1959],[983,49,40],[874,66,34],[801,79,33],[760,78,33],[733,75,34],[694,71,33],[662,66,33],[656,64,34],[655,64,41],[657,64,35],[657,63,32]]);
  await replayCursorPath(page, [[658,59,34],[658,57,33],[659,54,33],[662,48,40],[666,42,27],[670,37,33],[672,36,33],[672,35,85],[672,35,40]]);
  await page.mouse.move(672, 35);
  await page.mouse.down();
  await replayCursorPath(page, [[673,35,50],[672,35,52]]);
  await page.mouse.move(672, 35);
  await page.mouse.up();
  await replayCursorPath(page, [[672,35,74],[672,35,91],[672,35,42],[672,35,33]]);
  await replayCursorPath(page, [[671,41,34],[657,85,32],[618,165,34],[568,250,33],[540,302,34],[533,321,33],[531,336,33],[528,357,33],[524,377,33],[520,388,34],[517,399,34],[513,409,33],[510,413,40],[505,423,35],[498,429,33],[494,437,34],[486,447,33],[479,460,33],[478,461,93]]);
  await page.mouse.move(478, 461);
  await page.mouse.down();
  await replayCursorPath(page, [[478,461,125],[478,461,58]]);
  await page.mouse.move(478, 461);
  await page.mouse.up();
  await replayCursorPath(page, [[479,461,40],[481,455,34],[488,441,34],[494,425,33],[500,410,34],[506,398,33],[510,392,33],[514,386,33],[520,380,34],[528,373,33],[537,367,41],[544,362,34],[553,357,34],[554,357,32],[554,357,71]]);
  await page.mouse.move(554, 357);
  await page.mouse.down();
  await replayCursorPath(page, [[554,357,49]]);
  await page.mouse.move(554, 357);
  await page.mouse.up();
  await replayCursorPath(page, [[554,357,181],[554,364,33],[559,380,34],[573,405,41],[585,423,33],[593,437,34],[596,447,33],[599,458,33],[600,467,34],[601,472,33],[600,479,33],[601,488,34],[601,490,33]]);
  await page.mouse.move(601, 490);
  await page.mouse.down();
  await replayCursorPath(page, [[601,490,150],[601,490,76]]);
  await page.mouse.move(601, 490);
  await page.mouse.up();
  await replayCursorPath(page, [[603,490,32],[606,483,36],[616,470,35],[629,456,49],[643,442,45],[655,424,138],[662,413,0],[665,407,7],[667,404,3],[667,402,31],[669,397,13],[672,391,18],[675,386,26],[675,384,38],[680,376,31],[682,373,36],[683,373,32],[683,373,92]]);
  await page.mouse.move(683, 372);
  await page.mouse.down();
  await replayCursorPath(page, [[683,373,347],[683,373,14],[683,373,0]]);
  await page.mouse.move(683, 373);
  await page.mouse.up();
  await replayCursorPath(page, [[683,373,1],[683,377,0],[687,390,0],[690,408,0],[694,424,0],[697,439,17],[699,452,33],[700,461,34],[702,476,44],[705,490,38],[707,496,34],[708,497,34],[709,497,33]]);
  await page.mouse.move(709, 497);
  await page.mouse.down();
  await replayCursorPath(page, [[709,496,108],[709,496,103]]);
  await page.mouse.move(709, 496);
  await page.mouse.up();
  await replayCursorPath(page, [[709,492,38],[714,483,34],[727,467,33],[752,441,42],[771,419,33],[788,399,34],[805,379,33],[812,371,33],[812,371,33],[812,371,43],[812,371,82]]);
  await page.mouse.move(812, 371);
  await page.mouse.down();
  await page.mouse.move(812, 371);
  await page.mouse.up();
  await page.mouse.move(812, 371);
  await page.mouse.down();
  await page.mouse.move(812, 371);
  await page.mouse.up();
  await replayCursorPath(page, [[813,370,1544],[892,377,40],[1077,395,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
`,
  },
  {
    name: "Test 19: Canvas Scroll + Zoom",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Generic",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords, options) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          // Parse role=button[name="Label"] format and use getByRole
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        // Use .first() to handle multiple matches (e.g., header + footer nav links)
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target; // Return locator for assertions
        if (action === 'click') await target.click(options || {});
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    // Coordinate fallback for clicks when all selectors fail
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y, options || {});
      return;
    }
    // Coordinate fallback for fill - click to focus then type
    if (action === 'fill' && coords) {
      console.log('Falling back to coordinate fill at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.selectAll();
      await page.keyboard.type(value || '');
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  // Replay cursor path helper
  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[1272,463,0],[1107,442,39],[989,430,34],[882,417,33],[782,405,34],[730,397,33],[716,394,32],[696,394,34]]);
  await replayCursorPath(page, [[674,411,34],[674,414,416]]);
  await replayCursorPath(page, [[669,381,33],[663,365,34],[649,348,34],[631,329,33],[617,316,33],[606,301,33],[589,279,33],[572,255,36],[556,236,31],[540,204,34],[526,174,33],[519,154,34],[518,149,33],[518,142,33],[519,136,34],[519,135,41],[519,136,100],[519,136,34],[515,166,33],[501,223,33],[482,247,34],[466,254,33],[451,259,33],[438,261,34],[436,261,33]]);
  await page.mouse.move(436, 261);
  await page.mouse.down();
  await replayCursorPath(page, [[436,261,66],[436,261,35],[436,261,42]]);
  await page.mouse.move(436, 261);
  await page.mouse.up();
  await replayCursorPath(page, [[436,261,48],[436,261,34],[436,261,34],[436,261,34],[436,261,41],[436,261,37],[436,261,37],[436,261,35],[436,261,33],[436,261,33]]);
  await page.keyboard.press('2');
  await replayCursorPath(page, [[436,261,425],[436,261,50],[432,257,34],[429,254,32],[426,250,33],[424,246,33],[423,242,33],[417,230,34],[413,221,34],[411,217,33],[411,217,34],[411,217,91],[411,217,142]]);
  await page.mouse.move(411, 217);
  await page.mouse.down();
  await replayCursorPath(page, [[411,217,100],[412,217,41],[413,235,34],[419,249,33],[426,258,33],[435,268,33],[447,278,34],[459,288,35],[469,297,32],[475,302,33],[476,304,33],[477,303,142]]);
  await page.mouse.move(477, 303);
  await page.mouse.up();
  await replayCursorPath(page, [[477,303,58],[477,303,42],[477,302,34],[481,301,32],[504,304,34],[565,311,42],[622,319,33],[649,323,33],[653,324,33],[653,324,44],[655,324,48],[655,324,150],[655,324,117]]);
  await page.keyboard.press('2');
  await replayCursorPath(page, [[655,324,43],[654,324,32],[654,324,76],[654,324,32],[653,324,34],[652,325,75],[651,325,34],[648,325,40],[637,324,34],[624,322,33],[604,322,33],[577,320,34],[570,318,32],[565,317,34],[557,317,34],[555,316,33],[555,316,34],[555,316,33],[555,315,33]]);
  await page.mouse.move(554, 314);
  await page.mouse.down();
  await replayCursorPath(page, [[554,315,92],[557,320,33],[596,361,33],[646,393,34],[682,412,33],[686,415,42],[686,415,92],[686,415,41]]);
  await page.mouse.move(686, 415);
  await page.mouse.up();
  await replayCursorPath(page, [[686,414,33],[683,411,34],[665,388,32],[631,355,34],[593,327,33],[558,302,34],[527,285,33],[500,274,33],[482,267,34],[462,263,33],[442,262,34]]);
  await page.keyboard.press('2');
  await replayCursorPath(page, [[438,263,142],[438,262,84],[439,262,50],[439,262,75],[438,260,41],[438,260,58],[437,260,34],[435,256,32],[434,256,58],[435,256,34],[434,256,134],[434,256,33]]);
  await page.mouse.move(434, 256);
  await page.mouse.down();
  await replayCursorPath(page, [[434,256,92],[434,256,41],[436,259,34],[441,266,32],[445,270,34],[446,271,34],[446,271,133],[449,273,33],[451,274,34],[454,277,33],[457,278,33],[457,279,58],[458,278,248]]);
  await page.mouse.move(458, 278);
  await page.mouse.up();
  await replayCursorPath(page, [[458,279,1228],[509,297,32],[674,329,34],[965,362,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1260,192,1718],[1029,161,41],[900,127,33],[767,98,33],[632,94,42],[568,102,33],[540,115,33],[516,127,34],[493,141,33],[473,162,33],[453,180,33],[440,189,35],[432,195,33],[425,202,36],[419,213,30],[420,241,34],[427,263,32],[429,265,34],[432,268,34],[432,268,41],[432,268,58],[432,268,101],[432,268,116],[432,268,227],[433,273,32],[433,282,33],[435,295,41],[437,307,34],[438,310,159],[438,310,134],[438,311,2158],[446,319,40],[455,326,34],[466,331,33],[473,334,34],[475,335,33],[475,335,52],[476,335,82],[476,335,58],[527,348,33],[646,369,33],[842,393,34],[1137,414,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1232,400,1851],[980,396,33],[766,398,41],[651,399,33],[597,406,33],[590,407,33],[590,407,118],[590,407,41],[590,406,292],[590,406,33],[590,407,41],[590,406,768],[583,407,33],[572,404,32],[556,397,34],[537,389,34],[514,379,33],[491,367,43],[474,357,41],[464,351,33],[458,347,35],[452,344,32],[444,339,32],[430,330,34],[420,322,33],[414,317,34],[410,314,32],[409,314,34],[409,314,34],[409,313,167],[409,314,115],[409,314,176],[409,314,1326],[411,318,32],[413,323,33],[418,329,34],[421,332,33],[422,332,625],[422,332,117],[425,332,34],[425,332,474],[434,328,34],[461,321,33],[491,314,34],[518,309,33],[545,304,33],[570,300,33],[590,297,33],[602,294,34],[625,292,33],[652,289,33],[657,289,76],[657,289,33],[656,290,34],[639,293,33],[602,295,32],[549,295,36],[506,297,31],[497,298,34],[498,298,33],[498,298,33],[498,298,35]]);
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await replayCursorPath(page, [[1160,413,3057],[1162,412,34],[1254,393,41]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
`,
  },
  {
    name: "Test 20: Fit to Content",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Generic",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords, options) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          // Parse role=button[name="Label"] format and use getByRole
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        // Use .first() to handle multiple matches (e.g., header + footer nav links)
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target; // Return locator for assertions
        if (action === 'click') await target.click(options || {});
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    // Coordinate fallback for clicks when all selectors fail
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y, options || {});
      return;
    }
    // Coordinate fallback for fill - click to focus then type
    if (action === 'fill' && coords) {
      console.log('Falling back to coordinate fill at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.selectAll();
      await page.keyboard.type(value || '');
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  // Replay cursor path helper
  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[1236,538,0],[988,505,39],[908,483,34],[879,470,34],[876,468,74],[875,469,32],[873,470,35],[868,469,33],[860,461,33],[833,434,33],[790,385,34]]);
  await replayCursorPath(page, [[754,323,33],[713,230,33],[683,175,34],[673,162,33],[673,163,50],[673,163,34],[671,164,32],[652,177,34],[611,199,33],[561,215,34],[516,226,33],[481,236,33],[475,237,84],[470,241,33],[448,251,33],[433,257,33],[431,257,34]]);
  await page.mouse.move(431, 257);
  await page.mouse.down();
  await replayCursorPath(page, [[431,257,50],[431,257,41]]);
  await page.mouse.move(431, 257);
  await page.mouse.up();
  await replayCursorPath(page, [[432,257,51],[432,257,59],[432,257,132],[437,254,34],[464,255,33],[485,260,34],[486,260,65],[487,260,77],[487,260,99],[494,257,41],[504,252,34],[511,248,34]]);
  await page.keyboard.press('3');
  await replayCursorPath(page, [[513,247,216],[526,238,33],[544,226,34],[560,213,32],[560,212,60]]);
  await page.mouse.move(560, 212);
  await page.mouse.down();
  await replayCursorPath(page, [[560,212,35],[560,212,39],[562,218,33],[592,256,34],[640,314,33],[690,372,34],[718,403,33],[725,413,33],[726,415,52],[726,415,148]]);
  await page.mouse.move(726, 415);
  await page.mouse.up();
  await replayCursorPath(page, [[726,415,34],[726,416,42],[728,442,41],[732,466,33],[742,495,34],[745,506,32],[745,506,35],[745,506,33],[745,506,33],[745,507,43],[745,506,32],[744,506,33],[744,506,41],[745,507,35],[745,507,41],[744,506,33],[744,506,33]]);
  await page.mouse.wheel(0, 360);
  await replayCursorPath(page, [[745,507,34],[745,506,33],[745,507,34],[745,507,33],[744,506,33],[745,507,125],[746,507,309],[784,528,32],[980,543,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1268,438,1843],[1197,438,32],[1095,427,34],[995,405,33],[934,386,34],[927,383,41]]);
  await page.mouse.move(927, 383);
  await page.mouse.down();
  await replayCursorPath(page, [[927,383,34],[926,382,33]]);
  await page.mouse.move(926, 382);
  await page.mouse.up();
  await replayCursorPath(page, [[925,382,33],[925,381,34],[925,381,167],[926,382,58],[926,382,41],[927,383,33],[927,383,134],[925,384,33],[925,384,41]]);
  await page.keyboard.down('Shift');
  await page.keyboard.press('1');
  await page.keyboard.up('Shift');
  await replayCursorPath(page, [[925,384,884],[945,383,41],[1173,365,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
`,
  },
  {
    name: "Test 21: Color/Style Changes",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Generic",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords, options) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          // Parse role=button[name="Label"] format and use getByRole
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        // Use .first() to handle multiple matches (e.g., header + footer nav links)
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target; // Return locator for assertions
        if (action === 'click') await target.click(options || {});
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    // Coordinate fallback for clicks when all selectors fail
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y, options || {});
      return;
    }
    // Coordinate fallback for fill - click to focus then type
    if (action === 'fill' && coords) {
      console.log('Falling back to coordinate fill at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.selectAll();
      await page.keyboard.type(value || '');
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  // Replay cursor path helper
  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[1272,472,0],[1136,422,40],[1001,377,34],[878,331,33],[815,307,46],[794,297,20],[783,288,34],[776,280,34],[765,267,33],[740,247,33],[699,220,33],[656,196,34],[633,181,33],[627,176,41],[623,170,35],[612,155,33],[595,130,41],[582,112,33],[575,102,33],[563,89,34],[554,80,34],[553,80,66],[553,80,50],[553,80,92],[553,80,33],[552,82,34],[551,85,32],[549,91,34],[538,115,33],[524,146,34],[508,174,33],[493,201,34],[477,222,33],[467,233,33],[459,245,34],[453,254,33],[452,257,41],[452,257,33]]);
  await page.mouse.move(453, 257);
  await page.mouse.down();
  await replayCursorPath(page, [[453,257,35],[452,256,65]]);
  await page.mouse.move(452, 256);
  await page.mouse.up();
  await replayCursorPath(page, [[452,256,34],[452,256,42],[452,255,49],[452,255,57],[452,255,18],[452,255,41],[452,255,43],[452,255,50]]);
  await page.keyboard.press('2');
  await replayCursorPath(page, [[452,255,250],[453,255,67],[464,251,33],[476,243,34],[481,238,33],[482,236,83]]);
  await page.mouse.move(482, 236);
  await page.mouse.down();
  await replayCursorPath(page, [[482,236,125],[483,237,33],[495,254,34],[513,276,33],[559,325,33],[637,386,34],[699,423,33],[726,442,33],[740,455,34],[743,460,33],[746,463,33],[747,464,75],[747,464,42],[747,464,233],[747,464,50],[747,464,83],[747,463,201]]);
  await page.mouse.move(747, 463);
  await page.mouse.up();
  await replayCursorPath(page, [[747,463,467],[747,463,892],[747,463,267],[740,465,32],[737,466,38],[737,466,179],[737,466,533],[720,469,33],[680,465,34],[616,449,33],[546,422,34],[463,384,33],[384,330,32],[312,264,44],[265,213,23],[221,154,34]]);
  await replayCursorPath(page, [[177,116,33],[144,96,34],[143,96,33],[143,96,41],[142,96,34],[142,98,35]]);
  await replayCursorPath(page, [[130,107,32],[118,114,32],[101,121,35],[81,125,32],[74,126,34],[74,126,33],[74,126,33],[74,126,33],[74,126,34],[74,126,42],[74,126,33],[74,126,41],[74,126,34],[74,126,42],[74,126,33],[74,126,34],[74,126,33],[74,126,33],[74,126,34],[74,126,41]]);
  await page.mouse.move(74, 126);
  await page.mouse.down();
  await replayCursorPath(page, [[74,126,283]]);
  await page.mouse.move(74, 126);
  await page.mouse.up();
  await replayCursorPath(page, [[74,126,926],[74,126,183]]);
  await replayCursorPath(page, [[71,137,34],[67,151,32],[66,159,34],[64,164,33],[63,170,33],[63,175,33],[62,179,33],[62,180,102],[63,181,34],[64,183,32],[66,183,33],[69,184,33],[72,186,34],[74,187,34],[76,188,34]]);
  await replayCursorPath(page, [[79,189,31],[80,189,34],[80,189,151],[82,190,40],[82,190,34]]);
  await page.mouse.move(82, 190);
  await page.mouse.down();
  await page.mouse.move(82, 190);
  await page.mouse.up();
  await replayCursorPath(page, [[82,191,1084],[82,191,208],[82,191,143],[82,194,40],[82,195,134],[82,197,33],[82,200,33]]);
  await replayCursorPath(page, [[82,203,34],[83,208,33],[83,213,33],[83,218,33],[82,223,34],[82,227,33],[82,228,33],[82,230,34],[82,236,33]]);
  await replayCursorPath(page, [[81,241,34],[82,242,50],[82,243,41],[82,246,34],[82,248,33],[82,248,33],[82,248,75]]);
  await replayCursorPath(page, [[82,249,99]]);
  await page.mouse.move(83, 250);
  await page.mouse.down();
  await page.mouse.move(83, 250);
  await page.mouse.up();
  await replayCursorPath(page, [[83,250,318]]);
  await replayCursorPath(page, [[83,251,609],[83,255,41],[84,258,45],[84,259,21],[86,261,33],[87,265,34],[89,268,33],[90,270,33]]);
  await replayCursorPath(page, [[94,275,34],[97,280,33],[100,284,34],[102,288,33],[104,291,33],[104,291,75],[107,296,34],[109,301,32],[110,302,34],[110,303,41]]);
  await replayCursorPath(page, [[112,311,34],[115,315,34],[115,316,33],[115,316,33],[117,318,34],[118,320,33],[118,321,50],[119,322,33]]);
  await page.mouse.move(119, 322);
  await page.mouse.down();
  await page.mouse.move(119, 322);
  await page.mouse.up();
  await replayCursorPath(page, [[119,322,425],[119,322,1010]]);
  await replayCursorPath(page, [[120,330,32],[122,340,33],[124,348,34],[125,352,33],[125,354,33],[125,356,34],[125,358,33],[125,359,33]]);
  await replayCursorPath(page, [[125,361,33],[125,362,75],[125,362,77],[124,362,65],[124,367,33],[125,369,33],[124,371,35],[124,373,33],[124,373,401]]);
  await replayCursorPath(page, [[120,381,34],[114,389,39],[111,397,34],[108,404,33],[107,411,34],[107,415,33]]);
  await replayCursorPath(page, [[108,419,34],[110,425,33],[111,430,33],[112,432,32],[113,435,34],[115,442,33],[117,449,34]]);
  await replayCursorPath(page, [[119,457,33],[120,464,34],[121,468,33],[121,469,50],[121,469,43]]);
  await page.mouse.move(121, 469);
  await page.mouse.down();
  await replayCursorPath(page, [[121,469,32],[121,469,41]]);
  await page.mouse.move(121, 469);
  await page.mouse.up();
  await replayCursorPath(page, [[121,469,84],[121,469,84],[121,469,150],[121,469,32],[120,470,36]]);
  await replayCursorPath(page, [[120,472,42],[119,474,31],[119,476,34],[118,479,33],[119,481,33],[122,486,34],[144,493,33]]);
  await replayCursorPath(page, [[230,504,33],[381,521,34],[623,542,41],[858,563,33],[1125,588,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
`,
  },
  {
    name: "Test 22: View Mode Toggle - fixdrag",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Generic",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords, options) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          // Parse role=button[name="Label"] format and use getByRole
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        // Use .first() to handle multiple matches (e.g., header + footer nav links)
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target; // Return locator for assertions
        if (action === 'click') await target.click(options || {});
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    // Coordinate fallback for clicks when all selectors fail
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y, options || {});
      return;
    }
    // Coordinate fallback for fill - click to focus then type
    if (action === 'fill' && coords) {
      console.log('Falling back to coordinate fill at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.selectAll();
      await page.keyboard.type(value || '');
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  // Replay cursor path helper
  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[1014,554,0],[832,518,37]]);
  await replayCursorPath(page, [[747,497,33],[697,484,33],[648,475,33],[593,463,34],[549,452,33],[533,445,34],[533,445,41],[533,445,51]]);
  await replayCursorPath(page, [[545,406,33],[560,318,33],[559,285,33],[558,285,34],[558,286,35],[558,286,32],[546,294,33],[492,321,33],[458,332,34],[445,336,33],[421,344,33],[407,348,41],[407,348,34]]);
  await page.mouse.move(407, 348);
  await page.mouse.down();
  await replayCursorPath(page, [[407,348,33]]);
  await page.mouse.move(407, 348);
  await page.mouse.up();
  await replayCursorPath(page, [[407,348,118]]);
  await page.keyboard.press('3');
  await replayCursorPath(page, [[407,347,550],[406,343,40],[405,333,34],[405,324,33],[401,310,34],[394,301,33],[378,294,34],[345,286,32],[316,281,34],[302,278,33],[302,278,34],[302,277,41]]);
  await page.mouse.move(302, 277);
  await page.mouse.down();
  await replayCursorPath(page, [[302,277,150],[310,298,33],[352,344,33],[400,386,34],[481,457,34],[533,493,32],[536,495,42],[536,495,35],[536,495,33],[536,495,50],[536,495,200]]);
  await page.mouse.move(536, 495);
  await page.mouse.up();
  await replayCursorPath(page, [[536,495,225],[536,495,84],[536,495,250],[536,495,50],[536,495,41],[537,494,33],[537,493,41],[537,493,50],[537,493,68],[537,493,66],[537,493,33],[537,493,51],[537,494,183],[624,523,41],[969,533,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1157,300,1776],[993,315,33],[847,310,33],[722,304,34],[617,312,33],[540,326,33],[494,336,34],[455,351,33],[441,359,33],[439,362,33],[440,361,34],[461,347,33],[518,327,34],[600,313,32],[644,311,39],[645,311,45],[645,311,34]]);
  await page.mouse.move(645, 311);
  await page.mouse.down({ button: 'right' });
  // Coordinate-only right-click (no selectors found)
  await page.mouse.click(645, 311, { button: 'right' });
  await page.mouse.move(645, 311);
  await page.mouse.up({ button: 'right' });
  await replayCursorPath(page, [[645,311,308],[645,311,82]]);
  await replayCursorPath(page, [[644,311,52],[643,315,41],[639,327,33],[648,359,42],[681,394,33],[722,419,33]]);
  await replayCursorPath(page, [[746,435,34],[760,454,33],[775,481,33],[783,501,33],[783,516,33],[780,529,36],[779,539,31]]);
  await replayCursorPath(page, [[774,554,35],[768,568,41],[764,572,40],[763,573,35],[763,573,125],[763,573,250],[763,573,126]]);
  await page.mouse.move(763, 573);
  await page.mouse.down();
  await page.mouse.move(763, 573);
  await page.mouse.up();
  await replayCursorPath(page, [[763,573,241],[763,572,642],[764,572,43],[764,572,30],[783,572,34],[838,574,34],[953,577,33],[1152,575,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1150,367,2968],[931,392,32],[807,400,33],[774,402,34],[774,403,50],[760,414,33],[750,424,34],[750,425,41],[750,425,34],[750,424,99],[756,417,34],[766,406,33],[774,399,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
`,
  },
  {
    name: "Test 23: Search Elements -fix chromium?",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Generic",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords, options) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          // Parse role=button[name="Label"] format and use getByRole
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        // Use .first() to handle multiple matches (e.g., header + footer nav links)
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target; // Return locator for assertions
        if (action === 'click') await target.click(options || {});
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    // Coordinate fallback for clicks when all selectors fail
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y, options || {});
      return;
    }
    // Coordinate fallback for fill - click to focus then type
    if (action === 'fill' && coords) {
      console.log('Falling back to coordinate fill at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.selectAll();
      await page.keyboard.type(value || '');
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  // Replay cursor path helper
  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[1092,454,0],[831,358,37],[774,316,34],[771,304,34],[771,294,33],[770,286,33],[767,277,33],[755,267,34],[728,258,34],[682,254,40],[640,253,34],[600,256,33],[559,266,34],[504,282,33],[459,301,33],[442,310,34],[442,311,33],[442,310,33],[442,310,34],[442,310,38],[442,311,29],[435,317,33],[421,324,34],[409,329,32],[407,330,33],[407,330,34],[407,330,41],[407,330,50],[407,330,42],[407,330,160],[407,330,57],[407,330,67],[407,330,33],[407,330,400],[407,330,43]]);
  await page.mouse.move(407, 330);
  await page.mouse.down();
  await replayCursorPath(page, [[407,330,608]]);
  await page.mouse.move(407, 330);
  await page.mouse.up();
  await page.keyboard.press('8');
  await replayCursorPath(page, [[407,330,2033],[407,330,241],[407,330,47],[409,325,28],[410,323,33],[412,319,34],[416,312,33],[417,310,33],[417,309,34],[417,309,50],[418,310,41]]);
  await page.mouse.move(418, 310);
  await page.mouse.down();
  await replayCursorPath(page, [[418,310,69],[418,310,41],[418,310,33]]);
  await page.mouse.move(417, 310);
  await page.mouse.up();
  await replayCursorPath(page, [[417,310,32],[416,309,226],[416,309,934]]);
  await page.keyboard.type('this');
  await replayCursorPath(page, [[417,309,3466],[417,309,59]]);
  await replayCursorPath(page, [[421,310,32],[423,310,34],[423,310,270],[422,310,404],[422,310,117],[422,310,59],[422,311,34],[422,312,100],[422,312,131],[422,314,34],[422,315,50],[422,315,35],[422,316,42],[422,316,107],[419,319,33]]);
  await replayCursorPath(page, [[410,325,33],[384,331,34],[323,330,40],[268,322,34],[253,319,33],[252,318,44],[247,318,32],[247,317,33],[247,316,34],[235,305,38],[220,296,28]]);
  await replayCursorPath(page, [[212,292,34],[211,290,50],[204,285,33],[196,282,33],[187,280,33],[182,278,35],[180,276,32]]);
  await replayCursorPath(page, [[173,272,34],[171,271,101],[171,271,132]]);
  await page.mouse.move(171, 271);
  await page.mouse.down();
  await page.mouse.move(171, 271);
  await page.mouse.up();
  await replayCursorPath(page, [[171,271,1443],[171,271,40]]);
  await replayCursorPath(page, [[181,276,34],[207,284,33],[281,294,33],[434,302,43],[566,310,32],[639,317,33],[654,318,35],[653,318,48],[653,319,51],[653,319,42],[660,321,32],[677,325,34],[709,334,33],[744,345,34],[767,351,32],[778,352,34],[787,352,44],[800,350,40],[819,348,33],[837,346,33],[871,348,33],[905,351,33],[916,350,34],[922,347,33],[929,346,33],[929,346,144],[929,346,166],[928,346,99],[920,349,34],[882,354,33],[843,354,33],[810,350,42],[783,343,33],[773,339,33]]);
  await page.mouse.move(773, 339);
  await page.mouse.down();
  await page.mouse.move(773, 339);
  await page.mouse.up();
  await replayCursorPath(page, [[773,339,177],[773,339,124],[773,339,92]]);
  await page.keyboard.press('8');
  await replayCursorPath(page, [[773,340,124],[773,339,85],[768,332,32],[761,326,33],[756,324,35],[747,320,34],[733,314,32],[716,310,33],[702,309,33],[698,309,33],[697,309,35],[697,309,33]]);
  await page.mouse.move(697, 309);
  await page.mouse.down();
  await replayCursorPath(page, [[697,309,58],[697,308,33]]);
  await page.mouse.move(697, 308);
  await page.mouse.up();
  await replayCursorPath(page, [[698,308,126]]);
  await replayCursorPath(page, [[698,309,45],[705,318,37],[727,328,34],[762,335,41],[777,337,33],[777,337,150],[776,337,84],[776,337,50]]);
  await page.keyboard.type('that');
  await replayCursorPath(page, [[776,337,2775]]);
  await page.keyboard.down('Control');
  await page.keyboard.press('f');
  await page.keyboard.up('Control');
  await replayCursorPath(page, [[776,337,2666]]);
  await replayCursorPath(page, [[795,327,34],[842,306,32],[867,293,34],[871,290,35],[871,290,32],[871,289,60],[868,286,40],[863,278,32],[853,266,34],[835,253,34],[821,244,33],[815,240,33]]);
  await page.keyboard.down('Control');
  await page.mouse.move(814, 240);
  await page.mouse.down();
  await replayCursorPath(page, [[814,240,42]]);
  await page.mouse.move(814, 240);
  await page.mouse.up();
  await page.keyboard.up('Control');
  await replayCursorPath(page, [[815,240,1100],[837,223,33],[890,190,34],[963,151,42],[1032,109,24]]);
  await replayCursorPath(page, [[1117,20,743],[1117,20,40],[1116,21,34],[1102,31,33],[1058,54,34],[991,78,32],[925,106,34],[859,139,33],[803,164,34],[766,178,33],[746,184,33],[740,186,35],[739,185,32],[730,186,33],[707,191,33],[687,197,34],[677,202,34],[668,210,32],[659,219,34],[653,226,34],[653,230,33],[652,233,33],[652,235,34],[653,237,33],[654,239,33],[654,239,102],[655,239,149],[655,239,66],[655,239,34],[655,239,33],[658,239,33],[664,240,33],[667,241,33],[676,244,34],[680,245,33],[680,245,43],[682,248,35],[682,248,57],[683,247,32],[683,247,44],[683,246,139]]);
  await page.keyboard.down('Control');
  await page.mouse.move(683, 246);
  await page.mouse.down();
  await page.mouse.move(683, 246);
  await page.mouse.up();
  await page.keyboard.up('Control');
  await replayCursorPath(page, [[683,246,150],[683,247,651]]);
  await page.keyboard.down('Control');
  await page.keyboard.press('f');
  await page.keyboard.up('Control');
  // Coordinate-only fill (no selectors found) - click to focus then type
  await page.mouse.click(1148, 100);
  await page.keyboard.selectAll();
  await page.keyboard.type('that');
  await replayCursorPath(page, [[682,246,6766],[654,226,33],[647,219,192],[647,219,242],[648,219,42],[656,218,34],[671,216,39],[677,216,34],[685,218,33],[698,225,34],[727,231,33],[788,236,33],[891,235,34]]);
  await replayCursorPath(page, [[1051,230,33]]);
  await replayCursorPath(page, [[1172,220,534],[1077,247,33],[1024,283,33],[1009,302,33],[986,331,33],[956,368,34],[934,392,33],[923,406,34],[917,413,33],[914,415,36],[914,415,81],[913,413,33],[903,409,41],[902,409,35],[902,409,76],[902,409,49],[902,409,60],[902,409,57],[902,409,183],[895,411,32],[890,412,33],[882,414,35],[880,414,33],[880,414,324],[880,414,51],[880,413,34],[913,402,32]]);
  await replayCursorPath(page, [[1033,381,33]]);
  await replayCursorPath(page, [[1185,182,1177],[1156,203,32],[1112,223,33],[1078,232,33],[1072,233,33],[1072,233,59],[1072,233,34],[1072,232,34],[1071,228,33]]);
  await replayCursorPath(page, [[1070,227,34],[1070,226,33],[1070,226,32],[1070,226,51]]);
  await page.mouse.move(1070, 226);
  await page.mouse.down();
  await replayCursorPath(page, [[1069,226,49],[1069,226,34]]);
  await page.mouse.move(1069, 226);
  await page.mouse.up();
  await replayCursorPath(page, [[1069,226,74],[1069,226,42],[1070,226,42],[1070,226,33],[1070,226,609],[1070,226,59],[1116,223,31]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
`,
  },
  {
    name: "Test 24: Lasso",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Generic",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords, options) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          // Parse role=button[name="Label"] format and use getByRole
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        // Use .first() to handle multiple matches (e.g., header + footer nav links)
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target; // Return locator for assertions
        if (action === 'click') await target.click(options || {});
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    // Coordinate fallback for clicks when all selectors fail
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y, options || {});
      return;
    }
    // Coordinate fallback for fill - click to focus then type
    if (action === 'fill' && coords) {
      console.log('Falling back to coordinate fill at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.selectAll();
      await page.keyboard.type(value || '');
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  // Replay cursor path helper
  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[1274,332,0],[1165,298,39],[1086,269,34],[1007,245,33],[919,227,33],[804,217,33],[696,213,34],[635,209,34],[593,205,41],[576,195,33],[563,177,33],[547,151,34],[542,142,33],[542,142,66],[542,141,77],[542,141,123],[542,137,34],[541,130,33],[539,124,34],[537,115,34],[537,115,99],[537,115,33],[537,116,35],[533,139,41],[529,174,32],[526,198,34],[515,227,33],[499,247,33],[477,259,34],[432,267,34],[394,271,33],[390,271,41],[390,271,67],[390,271,110],[391,271,31],[391,271,34],[393,269,33],[404,267,34],[405,267,225],[405,267,134],[405,267,182],[404,267,301]]);
  await page.mouse.move(404, 267);
  await page.mouse.down();
  await page.mouse.move(404, 267);
  await page.mouse.up();
  await page.keyboard.press('2');
  await replayCursorPath(page, [[405,267,1166],[407,262,34],[416,240,42],[417,238,49],[416,238,34]]);
  await page.mouse.move(416, 238);
  await page.mouse.down();
  await replayCursorPath(page, [[416,238,183],[416,239,33],[417,243,33],[422,254,48],[430,273,27],[445,302,33],[462,328,34],[472,341,33],[475,345,33],[483,349,34],[487,350,33],[487,350,50],[493,355,33],[496,358,34],[496,358,142],[496,359,41]]);
  await page.mouse.move(496, 359);
  await page.mouse.up();
  await replayCursorPath(page, [[496,358,268],[496,357,32],[496,354,34],[498,350,33],[519,339,33],[565,325,42],[595,318,33],[604,316,50],[616,311,34],[631,307,33],[632,307,43],[641,303,31],[655,298,34],[660,297,41],[660,297,36],[661,296,175],[668,290,40],[671,288,33],[676,285,34],[683,281,33],[683,281,83],[684,281,52],[688,278,32],[688,278,76],[689,277,66],[689,277,66]]);
  await page.keyboard.press('4');
  await replayCursorPath(page, [[689,274,33],[690,272,33],[694,268,34],[699,262,33],[706,254,34],[716,248,33],[718,245,33],[718,245,42],[718,245,42],[718,245,33],[718,245,67]]);
  await page.mouse.move(718, 245);
  await page.mouse.down();
  await replayCursorPath(page, [[718,245,49],[718,245,93],[729,271,41],[758,314,33],[780,339,33],[795,356,34],[808,366,33],[809,368,34],[809,368,33],[810,368,50],[810,368,34],[811,369,51],[812,369,68],[812,369,247],[812,369,50]]);
  await page.mouse.move(812, 369);
  await page.mouse.up();
  await replayCursorPath(page, [[812,369,192],[812,369,92],[804,365,33],[791,359,33],[770,349,33],[734,328,33],[710,312,34],[699,303,33],[696,300,33],[694,299,34],[687,296,34],[666,282,41],[650,271,34],[640,263,34],[639,263,40],[639,263,118],[639,263,407],[632,258,33],[630,256,34],[629,256,52],[629,256,166],[629,256,57],[629,256,49],[629,256,35],[627,251,32],[625,245,34],[624,243,33]]);
  await page.keyboard.press('6');
  await replayCursorPath(page, [[624,242,33],[624,242,52],[620,235,32],[615,227,33],[613,223,34]]);
  await page.mouse.move(613, 223);
  await page.mouse.down();
  await replayCursorPath(page, [[613,223,189],[612,224,36],[612,225,33],[609,238,33],[605,265,33],[600,291,33],[599,315,34],[599,330,33],[600,334,33],[600,337,35],[603,349,32],[605,362,34],[606,372,33],[606,376,33],[606,376,68],[606,377,33],[606,377,33],[606,377,102],[605,377,65],[605,377,34],[605,377,266]]);
  await page.mouse.move(605, 377);
  await page.mouse.up();
  await replayCursorPath(page, [[605,377,84],[605,376,883],[575,355,33],[478,304,33],[366,259,33],[315,236,33],[315,235,33],[316,230,34],[319,218,33],[321,211,33],[327,204,34],[337,194,41],[340,193,34],[340,193,59],[340,193,34],[340,193,41],[340,193,34],[340,193,48],[340,192,60],[340,193,33],[340,193,34],[340,193,32],[340,193,67],[340,192,41],[339,192,35],[339,192,41],[339,192,34],[339,192,66]]);
  await page.keyboard.down('Alt');
  await page.mouse.move(339, 192);
  await page.mouse.down();
  await replayCursorPath(page, [[339,192,999],[339,193,42],[338,193,33],[337,200,33],[334,216,33],[331,237,34],[330,251,34],[329,259,33],[330,269,33],[331,277,33],[331,282,33],[332,283,34],[331,288,34],[333,296,33],[333,306,33],[333,314,40],[333,324,36],[333,334,24],[333,340,33],[334,346,34],[334,354,33],[336,361,42],[338,370,33],[346,389,34],[359,409,33],[366,417,33],[374,424,33],[383,431,33],[392,436,34],[410,440,42],[418,441,33],[426,441,33],[436,439,34],[446,436,33],[456,433,34],[468,429,41],[477,425,33],[487,418,34],[498,412,33],[506,407,33],[511,403,33],[516,397,34],[521,386,34],[525,371,33],[528,361,33],[530,352,33],[532,346,34],[534,339,33],[540,326,41],[544,310,34],[549,293,33],[552,282,33],[554,270,34],[556,257,34],[560,243,33],[561,239,33],[562,236,34],[564,231,41],[567,224,33],[568,219,34],[570,216,33],[575,210,33],[583,201,34],[587,198,33],[589,195,33],[594,191,33],[595,190,42],[598,188,34],[604,185,33],[614,184,33],[625,184,33],[629,185,34],[629,186,42],[638,192,33],[647,200,34],[654,208,33],[659,217,33],[663,226,34],[666,231,33],[668,234,33],[669,240,34],[671,247,33],[671,257,32],[671,271,35],[669,281,33],[667,290,32],[666,299,35],[662,311,40],[663,328,38],[666,344,30],[667,352,32],[668,358,34],[671,370,42],[675,380,34],[677,384,33],[679,389,33],[687,399,33],[694,405,34],[699,408,33],[711,415,42],[720,420,33],[722,421,33],[727,421,34],[738,422,33],[760,424,33],[786,424,34],[806,422,33],[813,418,33],[823,411,34],[830,403,32],[838,390,34],[846,377,34],[849,365,33],[856,352,34],[863,334,32],[867,315,34],[867,297,33],[867,287,34],[866,277,33],[862,264,33],[853,246,34],[846,228,33],[842,207,33],[838,199,33],[836,196,34],[835,194,33],[832,188,34],[827,182,33],[820,173,34],[813,168,33],[808,164,33],[798,157,33],[782,148,34],[763,138,33],[731,127,33],[699,118,33],[685,115,34],[668,111,33],[632,109,34],[599,107,33],[572,108,33],[548,109,33],[534,113,34],[514,119,34],[485,130,32],[466,135,34],[459,138,33],[457,138,34],[450,142,36],[438,148,30]]);
  await page.mouse.move(437, 148);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await replayCursorPath(page, [[437,148,517],[437,148,534],[436,150,32],[435,151,43],[435,151,183],[435,151,34],[436,151,91],[444,160,33],[483,176,42],[531,189,33],[599,205,34],[722,233,33],[839,261,32],[917,281,34],[938,287,42],[937,287,33],[938,287,34],[937,287,33],[937,288,33],[937,290,35],[936,290,32],[936,290,36],[936,290,73],[936,290,33],[936,290,125],[936,291,58],[935,291,34],[935,292,208],[934,294,33],[934,294,358],[934,294,1100],[933,294,802],[916,297,31],[869,297,34],[819,295,33],[797,295,35],[797,295,43],[797,295,39],[797,295,92]]);
  await page.mouse.move(797, 295);
  await page.mouse.down();
  await replayCursorPath(page, [[797,295,575],[797,297,34],[797,304,32],[796,317,42],[796,336,33],[796,361,41],[795,377,34],[794,391,33],[793,407,33],[792,425,34],[791,448,33],[792,462,34],[791,463,41],[793,485,34],[794,504,33],[794,510,33],[794,510,34],[794,510,33],[795,513,33],[795,515,33],[795,515,34],[795,515,51],[795,515,33],[795,515,49],[795,515,35],[795,515,33],[795,515,33],[795,515,33],[795,515,33],[795,515,42]]);
  await page.mouse.move(795, 515);
  await page.mouse.up();
  await replayCursorPath(page, [[795,515,375],[795,515,101],[795,515,83],[802,513,33],[856,518,32],[1015,507,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
`,
  },
  {
    name: "Test 25: Laser",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Generic",
    playwrightOverrides: '{"cursorPlaybackSpeed":1,"screenshotDelay":0}',
    stabilizationOverrides: '{"freezeAnimations":true}',
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  async function locateWithFallback(page, selectors, action, value, coords, options) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target;
        if (action === 'click') await target.click(options || {});
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    if (action === 'click' && coords) {
      await page.mouse.click(coords.x, coords.y, options || {});
      return;
    }
    if (action === 'fill' && coords) {
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.selectAll();
      await page.keyboard.type(value || '');
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  async function replayCursorPathFast(page, moves) {
    for (const [x, y] of moves) {
      await page.mouse.move(x, y);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [
    [1174,485,0],[1110,463,32],[1045,435,33],[965,392,32],
    [874,347,34],[793,311,33],[737,287,33],[716,275,34],
    [708,267,33],[705,264,33],[699,262,34],[694,262,33],
    [686,263,34],[676,263,33],[676,263,34]
  ]);
  await page.mouse.move(676, 263);
  await page.mouse.down();
  await replayCursorPath(page, [[676,263,74]]);
  await page.mouse.move(676, 263);
  await page.mouse.up();
  await replayCursorPath(page, [
    [676,263,159],[676,263,33],[657,268,34],[619,273,33],
    [587,274,33],[567,277,34],[557,279,33]
  ]);
  await page.keyboard.press('2');
  await replayCursorPath(page, [
    [555,279,42],[555,279,33],[555,279,92],[541,279,33],
    [528,278,33],[520,276,33],[518,275,44],[518,275,32],
    [518,275,41],[517,271,33],[513,264,34],[511,260,33],
    [505,253,34],[503,251,33]
  ]);
  await page.mouse.move(503, 251);
  await page.mouse.down();
  await replayCursorPathFast(page, [
    [503,251],[503,252],[512,260],[534,295],
    [592,367],[644,413],[678,441],[716,463],
    [750,475],[757,477],[761,479],[762,478]
  ]);
  await page.mouse.move(762, 478);
  await page.mouse.up();
  await replayCursorPath(page, [
    [762,478,51],[762,478,84],[766,477,32],[786,473,33],
    [809,467,33],[815,464,109],[815,464,42],[814,465,132],
    [813,466,34],[813,468,33],[813,468,74],[814,470,33],
    [814,471,34],[814,473,33],[815,474,43],[815,478,32],
    [815,480,33],[815,481,35],[814,481,75]
  ]);
  await page.mouse.move(814, 481);
  await page.mouse.down();
  await replayCursorPath(page, [[814,481,112]]);
  await page.mouse.move(814, 481);
  await page.mouse.up();
  await replayCursorPath(page, [
    [814,481,379],[813,482,34],[800,484,32],[785,487,34],
    [781,487,84],[775,487,33],[774,487,191],[765,489,33],
    [758,490,43],[753,491,32],[753,491,58],[753,490,34]
  ]);
  await page.keyboard.press('k');
  await replayCursorPath(page, [
    [753,490,43],[755,486,33],[758,480,33],[759,476,34],
    [759,476,67],[758,474,85],[751,468,36],[740,458,30],
    [737,455,75],[737,455,118],[740,458,40],[741,459,34],
    [743,459,33],[743,459,216]
  ]);

  // === STROKE 1: draw down-left, screenshot MID-STROKE ===
  await page.mouse.move(743, 459);
  await page.mouse.down();
  await replayCursorPathFast(page, [
    [743,459],[742,459],[735,455],[731,452],
    [717,442],[701,432],[688,424],[672,412],
    [650,397],[631,385],[620,377],[605,365],
    [588,353],[569,336],[555,323],[550,318],
    [547,314],[542,306]
  ]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPathFast(page, [[540,301],[540,300],[540,299]]);
  await page.mouse.move(540, 297);
  await page.mouse.up();

  await replayCursorPath(page, [
    [540,297,42],[540,297,100],[540,298,33],[540,298,51],
    [540,299,34],[540,298,250],[540,299,175],[527,293,33],
    [526,293,59],[523,291,507],[497,275,33],[492,271,84],
    [492,271,50],[492,271,400],[492,272,42],[492,273,33],
    [493,281,33],[493,297,32],[493,305,34],[493,305,43],
    [493,304,34],[493,305,82],[493,305,34],[495,309,33],
    [507,317,40],[508,317,143],[507,317,68],[507,317,92],
    [509,302,34],[512,279,34],[513,262,33],[512,258,35],
    [511,259,50]
  ]);

  // === STROKE 2: draw up-right, screenshot MID-STROKE ===
  await page.mouse.move(511, 259);
  await page.mouse.down();
  await replayCursorPathFast(page, [
    [511,259],[526,274],[552,300],[573,319],
    [587,331],[605,349],[630,371],[643,383],
    [654,393],[668,406]
  ]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPathFast(page, [
    [677,415],[693,428],[708,439],[711,440],
    [714,442],[720,445],[721,446]
  ]);
  await page.mouse.move(721, 446);
  await page.mouse.up();
  await page.keyboard.up('Control');
  await page.keyboard.up('Shift');
  await replayCursorPath(page, [[721,446,34],[721,446,67],[720,445,42]]);
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('d');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await replayCursorPath(page, [
    [720,445,192],[720,445,107],[720,445,158],
    [720,445,235],[720,445,124]
  ]);
}
`,
  },
  {
    name: "New simple arrow binds and tracks",
    targetUrl: "https://excalidraw.com",
    functionalArea: "Arrows binding to bindables",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target;
        if (action === 'click') await target.click();
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    if (action === 'fill' && coords) {
      console.log('Falling back to coordinate fill at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.press('Control+a');
      await page.keyboard.type(value || '');
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[550,461,0],[546,396,29],[580,251,38],[587,215,56],[595,117,34],[596,96,37],[595,88,83],[582,83,34],[557,69,46],[542,60,34]]);
  await replayCursorPath(page, [[538,55,37],[533,51,51],[533,50,131]]);
  await replayCursorPath(page, [[528,48,38]]);
  await page.mouse.move(517, 42);
  await page.mouse.down();
  await page.mouse.move(517, 42);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(520, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(514, 40);
  await replayCursorPath(page, [[520,47,439],[523,78,69],[483,218,40],[451,384,45],[449,472,39],[443,520,33],[439,530,85],[423,513,47],[407,423,42],[371,332,41],[336,270,33],[327,248,33],[310,223,33],[300,207,34],[298,204,35],[296,202,48],[296,201,52],[301,198,31],[308,190,61],[311,188,32],[314,185,36],[318,183,40]]);
  await page.mouse.move(318, 183);
  await page.mouse.down();
  await replayCursorPath(page, [[319,183,115],[327,188,40],[339,195,35],[365,220,34],[389,256,49],[398,276,35],[405,286,40],[414,297,42],[422,301,43],[427,305,36],[434,310,42],[444,314,43],[447,316,45],[451,318,39],[453,319,59],[458,321,35],[466,325,31],[483,334,49],[486,336,38],[489,337,134]]);
  await page.mouse.move(488, 337);
  await page.mouse.up();
  await replayCursorPath(page, [[492,280,63],[512,215,73],[528,111,40],[533,74,33]]);
  await replayCursorPath(page, [[536,51,39],[540,30,41],[542,22,42],[542,21,34],[542,21,34],[555,22,36]]);
  await replayCursorPath(page, [[582,24,35],[594,24,38],[602,25,46],[619,30,39],[623,32,39],[624,32,131],[628,34,33]]);
  await replayCursorPath(page, [[638,37,47],[640,37,45]]);
  await page.mouse.move(640, 37);
  await page.mouse.down();
  await page.mouse.move(640, 37);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[639,37,119],[638,39,45]]);
  await replayCursorPath(page, [[541,215,35],[443,361,43],[402,452,38],[379,503,61],[362,537,35],[353,553,33],[350,555,33],[350,555,68],[345,535,43],[357,501,37],[361,493,47]]);
  await page.mouse.move(364, 487);
  await page.mouse.down();
  await replayCursorPath(page, [[365,484,40],[369,479,43],[369,478,74],[371,469,32],[379,440,40],[387,407,53],[391,389,57],[391,384,36],[391,379,57],[391,379,92],[391,378,49],[395,369,44],[398,359,41],[400,354,48],[400,353,33],[400,353,42],[400,351,41],[401,346,46],[402,345,238]]);
  await page.mouse.move(402, 345);
  await page.mouse.up();
  await replayCursorPath(page, [[402,345,353],[400,346,99],[399,346,32],[397,345,34],[386,337,34],[378,334,32],[374,331,37],[365,325,32],[361,324,57],[360,324,207],[360,325,35],[360,326,33],[361,326,100],[361,328,62],[361,334,32],[361,335,39],[360,340,33],[359,344,38],[358,347,126],[357,346,34],[357,346,33],[357,341,56],[359,335,47],[358,335,34]]);
  await page.mouse.move(358, 335);
  await page.mouse.down();
  await replayCursorPath(page, [[358,335,232],[357,335,40],[351,333,44],[342,332,33],[335,330,42],[331,329,50],[327,329,37],[326,329,86],[325,329,36],[325,329,66],[324,329,49]]);
  await page.mouse.move(324, 329);
  await page.mouse.up();
  await replayCursorPath(page, [[324,329,301],[396,323,42],[503,299,39],[535,281,33],[554,265,36],[595,226,33],[617,202,35],[623,191,39],[623,176,40],[620,152,35],[615,106,32],[607,74,46]]);
  await replayCursorPath(page, [[594,53,35],[590,39,35],[589,32,52],[585,28,37],[575,23,41],[572,23,61],[563,22,61],[563,23,49],[562,24,34]]);
  await page.mouse.move(562, 24);
  await page.mouse.down();
  await page.mouse.move(562, 24);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(560, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(554, 40);
  await replayCursorPath(page, [[562,25,190]]);
  await replayCursorPath(page, [[560,45,55],[553,77,42],[538,148,48],[522,204,44],[520,209,38],[519,209,99],[516,197,43],[519,188,40],[521,183,35]]);
  await page.mouse.move(521, 183);
  await page.mouse.down();
  await replayCursorPath(page, [[521,183,72],[529,187,54],[546,198,37],[599,260,46],[608,269,39],[628,286,33],[638,296,34],[648,305,36],[656,309,40],[657,310,45],[659,312,41],[667,315,50],[671,318,48],[676,320,56],[685,323,42],[695,331,54],[707,343,58],[716,351,39],[720,354,43],[719,354,111]]);
  await page.mouse.move(719, 354);
  await page.mouse.up();
  await replayCursorPath(page, [[717,352,39],[696,284,62],[672,111,45],[667,98,36],[656,80,40],[645,67,41],[644,66,43],[637,62,32]]);
  await replayCursorPath(page, [[627,53,37],[627,49,47]]);
  await page.mouse.move(627, 47);
  await page.mouse.down();
  await page.mouse.move(627, 47);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[627,47,282],[627,48,34]]);
  await replayCursorPath(page, [[620,78,51],[600,185,61],[578,303,31],[554,368,33],[540,399,39],[495,495,49],[488,512,36],[486,522,33],[484,537,41],[483,540,43],[485,540,33],[485,539,50],[491,524,33],[505,492,34],[510,484,50],[512,481,44],[516,477,33]]);
  await page.mouse.move(517, 474);
  await page.mouse.down();
  await replayCursorPath(page, [[520,471,38],[522,468,42],[525,460,33],[532,434,53],[549,394,43],[556,377,39],[558,371,52],[558,368,39],[559,366,38],[560,364,40],[567,354,50],[571,345,35],[572,342,38],[572,341,70],[572,341,46],[572,341,136],[573,341,86],[578,339,32],[581,336,50],[584,332,37],[586,329,60]]);
  await page.mouse.move(586, 329);
  await page.mouse.up();
  await replayCursorPath(page, [[586,328,399],[590,319,35],[595,305,43],[595,304,46],[602,284,42],[605,276,39],[606,275,47],[606,275,84],[603,274,50],[599,273,35],[591,272,40],[573,276,42],[557,280,35],[551,282,44],[549,284,38],[549,285,41],[546,290,47],[546,293,145]]);
  await page.mouse.move(546, 293);
  await page.mouse.down();
  await replayCursorPath(page, [[546,294,606],[543,294,47],[541,294,33],[533,291,39],[531,290,38],[529,290,32],[529,289,120],[528,289,34]]);
  await page.mouse.move(527, 289);
  await page.mouse.up();
  await replayCursorPath(page, [[528,289,406],[591,241,67],[670,150,41],[675,141,36],[681,130,41],[682,124,53],[681,116,38],[678,108,40],[678,97,35],[671,78,39]]);
  await replayCursorPath(page, [[667,51,35],[667,32,50],[667,28,33],[666,27,33],[658,22,47]]);
  await replayCursorPath(page, [[656,22,38],[655,22,31],[650,23,39],[633,29,46],[624,33,39],[614,38,35]]);
  await replayCursorPath(page, [[609,39,35],[606,39,44],[600,40,39],[597,40,34],[592,39,39]]);
  await page.mouse.move(592, 39);
  await page.mouse.down();
  await replayCursorPath(page, [[593,39,347]]);
  await page.mouse.move(593, 39);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(600, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(594, 40);
  await replayCursorPath(page, [[602,44,40],[662,98,57],[765,179,40],[799,201,38],[806,205,144],[805,204,50]]);
  await page.mouse.move(805, 204);
  await page.mouse.down();
  await replayCursorPath(page, [[805,205,236],[829,238,42],[846,256,39],[869,279,54],[887,298,31],[901,312,40],[912,320,38],[919,323,47],[930,332,51],[933,333,50],[938,337,58],[944,339,44],[946,340,54],[946,340,68]]);
  await page.mouse.move(946, 340);
  await page.mouse.up();
  await replayCursorPath(page, [[944,338,103],[881,263,43],[812,172,34],[755,107,49]]);
  await replayCursorPath(page, [[696,57,48],[677,45,38],[668,40,51],[656,34,32],[652,33,35]]);
  await page.mouse.move(652, 33);
  await page.mouse.down();
  await page.mouse.move(652, 33);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[653,33,284]]);
  await replayCursorPath(page, [[676,83,33],[707,175,38],[731,279,33],[739,384,33],[740,442,41],[740,461,39],[739,470,50],[738,474,49]]);
  await page.mouse.move(739, 474);
  await page.mouse.down();
  await replayCursorPath(page, [[740,474,83],[749,457,47],[775,412,36],[791,382,38],[797,370,44],[797,369,52],[808,354,150],[810,351,83],[811,350,49],[814,347,42],[816,344,36],[816,343,33],[817,343,192],[817,334,42],[817,324,36],[816,320,103],[815,320,47]]);
  await page.mouse.move(815, 320);
  await page.mouse.up();
  await replayCursorPath(page, [[814,319,521],[812,316,38],[811,313,61],[806,303,49],[803,289,54],[802,283,34],[803,283,283],[805,283,34],[807,282,47],[809,282,49],[810,282,35]]);
  await page.mouse.move(810, 282);
  await page.mouse.down();
  await replayCursorPath(page, [[809,282,299],[809,282,37],[807,283,35],[806,283,35],[803,283,43],[799,283,49],[794,283,40],[790,283,38],[778,283,48],[771,283,53],[763,282,48],[753,278,50],[751,277,57],[750,276,50],[747,274,44],[746,274,157]]);
  await page.mouse.move(746, 274);
  await page.mouse.up();
  await replayCursorPath(page, [[746,274,251],[759,224,31],[764,205,34],[768,144,34],[766,122,34],[759,90,49],[765,77,32],[785,69,33],[799,66,34],[809,63,42]]);
  await replayCursorPath(page, [[825,59,42],[853,46,31],[869,36,35],[879,32,43],[887,29,43],[896,27,149]]);
  await page.mouse.move(896, 27);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(893, 38);
  await replayCursorPath(page, [[896,27,100]]);
  await replayCursorPath(page, [[896,30,37],[896,32,62],[896,32,50],[896,32,233],[896,36,33],[893,45,33]]);
  await replayCursorPath(page, [[889,56,36],[881,78,44],[875,91,54],[870,97,32],[868,103,35],[863,108,49]]);
  await replayCursorPath(page, [[861,110,49],[860,111,51],[859,111,35],[859,111,53],[858,111,30],[858,111,83]]);
  await replayCursorPath(page, [[856,108,36],[851,98,47],[850,97,38]]);
  await page.mouse.move(848, 96);
  await page.mouse.down();
  await page.mouse.move(848, 96);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(819, 94);
  await replayCursorPath(page, [[849,98,271],[869,141,35],[896,185,34],[924,225,39],[942,256,51],[953,277,41],[955,279,101],[962,262,53],[967,248,36],[972,237,35],[978,230,33],[989,216,32],[995,206,62],[992,193,40],[990,187,50]]);
  await page.mouse.move(990, 186);
  await page.mouse.down();
  await replayCursorPath(page, [[990,186,285],[991,188,38],[993,193,42],[998,207,37],[1008,224,40],[1020,240,61],[1030,249,36],[1037,255,63],[1057,271,54],[1080,286,52],[1096,308,60],[1107,323,56],[1112,335,48],[1125,350,53],[1131,356,51],[1141,363,46],[1146,364,54]]);
  await page.mouse.move(1146, 364);
  await page.mouse.up();
  await replayCursorPath(page, [[1145,364,273],[1136,359,42],[1039,282,33],[1008,262,42],[975,241,34],[898,171,48],[859,127,48],[842,107,36],[794,61,42]]);
  await replayCursorPath(page, [[767,39,36],[754,33,60],[716,24,40],[712,24,56]]);
  await replayCursorPath(page, [[701,27,46],[690,31,36],[684,32,54],[659,32,42],[653,32,42],[650,33,56]]);
  await replayCursorPath(page, [[642,33,58]]);
  await page.mouse.move(642, 33);
  await page.mouse.down();
  await page.mouse.move(642, 33);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[642,36,244],[708,162,48],[796,278,34],[837,335,38],[915,424,40],[958,476,57],[976,507,46],[979,518,34],[982,527,41],[982,525,198],[982,522,41]]);
  await page.mouse.move(982, 522);
  await page.mouse.down();
  await replayCursorPath(page, [[983,518,36],[985,510,38],[994,494,36],[998,486,41],[1009,465,49],[1014,453,33],[1018,442,41],[1024,427,34],[1027,417,38],[1033,407,35],[1034,404,37],[1034,401,34],[1035,396,55],[1036,388,37],[1036,385,40],[1036,384,145],[1036,383,33],[1036,379,35],[1036,377,213],[1035,376,41]]);
  await page.mouse.move(1035, 376);
  await page.mouse.up();
  await replayCursorPath(page, [[1035,376,379],[1027,364,45],[1001,332,31],[997,324,45],[982,312,45],[978,307,181],[979,307,51],[980,307,34],[982,307,34],[985,307,33],[985,307,183],[986,307,85],[986,307,131],[987,307,117],[988,307,33],[990,307,34],[991,307,51]]);
  await page.mouse.move(991, 307);
  await page.mouse.down();
  await replayCursorPath(page, [[991,307,499],[988,307,35],[985,308,36],[983,308,39],[979,308,46],[976,308,43],[973,308,151],[973,308,39],[969,308,66],[962,308,45],[957,308,37],[955,308,37],[948,308,51],[946,308,57],[945,308,33],[944,308,34]]);
  await page.mouse.move(944, 308);
  await page.mouse.up();
  await replayCursorPath(page, [[943,320,217],[939,337,49],[921,443,35],[913,508,41],[906,614,41],[892,707,41]]);
}
`,
  },
  {
    name: "Old arrows can bind to bindables and track",
    targetUrl: "https://excalidraw-lastest.vercel.app",
    functionalArea: "Arrows binding to bindables",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target;
        if (action === 'click') await target.click();
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    if (action === 'fill' && coords) {
      console.log('Falling back to coordinate fill at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.press('Control+a');
      await page.keyboard.type(value || '');
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[673,131,0],[673,130,39],[645,102,40],[642,93,51],[639,90,80],[635,73,37]]);
  await replayCursorPath(page, [[630,58,37],[618,47,39],[594,46,58],[544,51,39],[528,51,38],[526,51,37]]);
  await page.mouse.move(526, 51);
  await page.mouse.down();
  await page.mouse.move(526, 51);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(520, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(514, 40);
  await replayCursorPath(page, [[526,53,301]]);
  await replayCursorPath(page, [[517,141,44],[481,270,37],[450,344,35],[435,374,33],[435,375,34],[401,349,46],[382,285,37],[390,233,33],[396,217,34],[401,199,51],[401,197,148],[400,168,46],[401,166,37],[400,166,101],[400,166,34],[399,164,34]]);
  await page.mouse.move(398, 163);
  await page.mouse.down();
  await replayCursorPath(page, [[399,163,131],[427,194,59],[441,227,53],[452,239,58],[463,244,32],[472,251,35],[484,258,43],[489,260,40],[492,263,47],[497,266,34],[500,266,34],[509,271,46],[511,272,34],[513,274,36],[517,276,83],[518,276,39],[519,277,44]]);
  await page.mouse.move(519, 277);
  await page.mouse.up();
  await replayCursorPath(page, [[519,275,164],[524,187,58],[544,107,42],[550,97,39],[569,69,56]]);
  await replayCursorPath(page, [[592,50,59],[612,37,50],[618,36,33],[622,37,51],[627,39,48]]);
  await replayCursorPath(page, [[635,44,52],[643,49,66],[646,49,32],[647,49,37]]);
  await page.mouse.move(647, 49);
  await page.mouse.down();
  await page.mouse.move(647, 49);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[647,49,147],[640,55,33]]);
  await replayCursorPath(page, [[610,93,51],[584,143,34],[552,218,31],[525,285,34],[489,367,35],[465,423,32],[437,470,34],[429,481,32],[423,489,51],[421,490,34],[421,490,101],[421,489,51]]);
  await page.mouse.move(421, 489);
  await page.mouse.down();
  await replayCursorPath(page, [[421,488,50],[423,476,34],[428,444,36],[432,427,35],[437,415,45],[440,390,48],[442,379,55],[447,364,49],[447,349,39],[447,346,39],[446,343,61],[446,342,45],[446,342,78],[446,341,44],[447,340,73],[447,339,268]]);
  await page.mouse.move(447, 339);
  await page.mouse.up();
  await replayCursorPath(page, [[447,339,281],[448,383,33],[450,401,33],[456,448,45],[463,464,41],[474,494,31],[476,501,34],[477,505,35],[480,506,68],[480,511,47],[486,526,35],[495,550,33],[502,562,50],[505,573,33],[507,584,51],[507,590,33],[507,589,81],[507,578,35],[508,528,32],[511,521,33],[511,518,36],[511,517,32],[507,497,32],[505,466,43],[498,457,36],[481,431,44],[478,399,44],[478,394,38],[472,383,36],[472,380,43],[472,380,50],[472,379,35],[455,359,48],[453,355,51],[452,355,34],[451,355,33],[451,353,111],[450,342,43],[451,339,46],[451,339,233],[450,338,34]]);
  await page.mouse.move(450, 338);
  await page.mouse.down();
  await replayCursorPath(page, [[450,338,133],[450,336,34],[451,328,45],[451,318,57],[451,315,52],[449,307,42],[450,301,48],[449,294,68],[449,293,53],[449,293,37],[448,292,64],[445,282,33],[445,281,49]]);
  await page.mouse.move(445, 281);
  await page.mouse.up();
  await replayCursorPath(page, [[445,281,491],[449,280,61],[459,281,71],[477,282,43],[479,283,33],[480,283,120],[480,283,84],[482,272,45],[482,269,37],[482,269,301],[483,273,33],[483,276,43],[483,276,38]]);
  await page.mouse.move(483, 276);
  await page.mouse.down();
  await replayCursorPath(page, [[483,276,268],[480,276,37],[469,272,49],[462,269,34],[460,269,62],[454,267,45],[450,265,58],[448,264,46],[446,264,52],[444,264,65],[431,267,52],[410,270,39],[404,271,37],[399,273,56],[393,274,43],[387,275,57],[380,277,56],[375,279,212],[372,279,41]]);
  await page.mouse.move(368, 279);
  await page.mouse.up();
  await replayCursorPath(page, [[368,280,210],[370,283,40],[397,336,34],[419,371,36],[472,442,39],[517,490,33],[543,525,50],[560,544,75],[568,552,35],[583,574,42],[602,606,47],[616,650,52],[625,678,52],[629,700,45]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[633,717,1769],[649,605,50],[647,442,56],[635,375,43],[627,306,34],[626,241,50],[622,206,50],[619,198,32],[619,184,52],[622,169,36],[623,165,32],[624,154,32],[624,140,33],[622,111,44],[615,79,55],[614,74,35],[606,70,44],[597,66,40],[587,62,32]]);
  await replayCursorPath(page, [[574,56,40],[568,51,61],[566,49,44],[563,39,55]]);
  await page.mouse.move(563, 39);
  await page.mouse.down();
  await page.mouse.move(563, 39);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(560, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(554, 40);
  await replayCursorPath(page, [[563,40,350]]);
  await replayCursorPath(page, [[563,50,42],[560,62,32],[557,66,58],[555,68,35],[548,74,33],[529,95,34],[496,148,48],[483,165,51],[477,169,33],[471,171,33],[467,173,34],[466,173,162],[481,177,35],[493,180,36],[497,180,33],[511,180,34],[518,180,50],[525,181,34],[538,186,52],[544,188,48],[546,189,32],[547,187,66],[549,184,33],[552,181,35],[552,180,34],[555,179,49],[559,180,50],[560,181,41],[565,182,42],[567,183,34],[572,183,32],[573,182,36],[590,178,32],[593,176,49],[593,176,50]]);
  await page.mouse.move(593, 176);
  await page.mouse.down();
  await replayCursorPath(page, [[593,177,152],[604,197,47],[612,207,33],[627,219,45],[634,225,50],[641,231,33],[649,238,51],[652,240,50],[662,250,48],[666,256,55],[670,261,44],[679,269,50],[687,278,53],[693,287,47],[694,287,44],[697,289,44],[700,291,56],[703,295,48],[705,296,33],[706,296,68],[706,296,37]]);
  await page.mouse.move(706, 296);
  await page.mouse.up();
  await replayCursorPath(page, [[706,296,145],[690,260,55],[665,96,37],[665,81,42],[664,78,34],[662,65,32]]);
  await replayCursorPath(page, [[662,58,50],[662,57,67],[661,56,50],[659,55,37],[657,52,46]]);
  await replayCursorPath(page, [[654,50,32],[653,49,54]]);
  await page.mouse.move(645, 42);
  await page.mouse.down();
  await replayCursorPath(page, [[644,42,68]]);
  await page.mouse.move(644, 42);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[644,42,129]]);
  await replayCursorPath(page, [[644,98,48],[640,194,37],[617,310,61],[602,378,32],[600,392,40],[595,412,48],[589,437,33],[584,453,33],[580,467,34],[579,471,44],[579,477,51]]);
  await page.mouse.move(579, 478);
  await page.mouse.down();
  await replayCursorPath(page, [[580,475,156],[592,422,43],[596,403,50],[597,387,39],[600,376,46],[603,369,54],[605,354,47],[606,352,40],[606,350,37],[606,349,128],[609,345,38],[610,338,43]]);
  await page.mouse.move(610, 338);
  await page.mouse.up();
  await replayCursorPath(page, [[610,339,370],[610,340,34]]);
  await page.mouse.move(610, 340);
  await page.mouse.down();
  await replayCursorPath(page, [[610,339,480],[611,337,37],[615,321,49],[618,308,40],[619,307,42],[620,305,33],[620,301,133],[620,299,134],[620,298,36],[621,298,31],[621,298,66],[621,297,118],[624,294,32],[625,293,35],[626,293,38],[626,292,44]]);
  await page.mouse.move(626, 292);
  await page.mouse.up();
  await replayCursorPath(page, [[626,291,401],[626,291,45],[626,291,39],[624,289,32],[624,288,35],[616,275,43],[610,254,39],[610,245,49],[611,245,153],[611,245,35],[611,245,247],[609,253,34]]);
  await page.mouse.move(609, 253);
  await page.mouse.down();
  await page.mouse.move(609, 253);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[609,253,398],[610,253,85],[610,253,49],[610,252,266],[611,251,53],[611,250,115]]);
  await page.mouse.move(611, 250);
  await page.mouse.down();
  await replayCursorPath(page, [[610,250,197],[603,248,35],[588,247,40],[582,246,36],[568,245,60],[561,244,36],[556,243,38],[543,241,54],[534,241,61],[529,241,57],[524,242,45],[520,242,69],[517,242,63],[508,242,39],[506,242,35],[506,242,67],[504,242,33],[492,241,49],[489,240,44]]);
  await page.mouse.move(489, 240);
  await page.mouse.up();
  await replayCursorPath(page, [[490,240,220],[501,279,53],[542,428,35],[574,529,50],[622,645,51],[644,705,49],[648,719,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[626,700,933],[638,621,34],[650,520,33],[662,428,35],[677,280,35],[693,184,47],[698,129,35],[703,99,32]]);
  await replayCursorPath(page, [[705,57,45],[703,51,37],[701,50,33],[696,46,34],[691,44,32],[686,42,41],[684,42,44],[679,43,43],[672,44,40]]);
  await replayCursorPath(page, [[659,43,42],[646,42,41],[639,38,52],[628,34,39]]);
  await replayCursorPath(page, [[620,31,47],[616,29,37],[613,28,61],[598,22,65],[595,22,34],[592,22,32],[591,22,241],[590,22,43]]);
  await replayCursorPath(page, [[580,27,47],[577,30,48],[578,32,45],[589,36,49],[592,39,55]]);
  await page.mouse.move(594, 39);
  await page.mouse.down();
  await page.mouse.move(594, 39);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(600, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(594, 40);
  await replayCursorPath(page, [[595,41,301]]);
  await replayCursorPath(page, [[599,65,37],[620,129,33],[655,190,33],[680,205,33],[691,210,34],[699,211,85],[695,189,50],[694,161,33],[694,155,34],[695,155,49],[710,163,50],[728,172,33],[734,176,33],[739,178,43],[745,180,40],[747,181,32],[747,181,119],[749,181,43]]);
  await page.mouse.move(749, 181);
  await page.mouse.down();
  await replayCursorPath(page, [[752,180,35],[761,186,43],[771,200,34],[784,224,34],[795,243,42],[799,251,34],[803,255,51],[806,259,35],[808,261,48],[811,263,59],[817,264,59],[818,264,48],[820,264,36],[825,266,41],[825,266,57],[825,267,36],[827,267,65]]);
  await page.mouse.move(827, 267);
  await page.mouse.up();
  await replayCursorPath(page, [[827,267,98],[791,223,51],[730,109,36],[720,89,32],[715,87,33],[701,79,50],[697,77,42],[686,72,42],[678,69,34]]);
  await replayCursorPath(page, [[650,54,62],[637,37,36]]);
  await page.mouse.move(635, 36);
  await page.mouse.down();
  await replayCursorPath(page, [[636,36,128]]);
  await page.mouse.move(636, 36);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[636,36,105]]);
  await replayCursorPath(page, [[636,61,36],[632,252,45],[638,323,33],[659,415,37],[669,455,33],[674,471,34],[680,481,49],[682,487,33],[683,494,33],[686,495,33],[688,495,33],[692,495,33]]);
  await page.mouse.move(692, 494);
  await page.mouse.down();
  await replayCursorPath(page, [[696,487,41],[707,442,55],[723,407,50],[737,371,47],[739,364,36],[742,352,51],[750,337,54],[751,329,42]]);
  await page.mouse.move(751, 328);
  await page.mouse.up();
  await replayCursorPath(page, [[752,329,156],[752,330,54],[752,331,67],[752,330,701]]);
  await page.mouse.move(752, 330);
  await page.mouse.down();
  await replayCursorPath(page, [[752,330,131],[752,328,38],[753,323,45],[753,319,35],[753,309,40],[754,303,57],[752,293,44],[750,286,49],[750,282,55],[750,278,53],[750,276,50],[750,276,34],[752,266,54],[753,263,97],[753,263,184]]);
  await page.mouse.move(753, 263);
  await page.mouse.up();
  await replayCursorPath(page, [[754,263,216],[754,262,84],[754,261,33],[760,254,32],[763,252,41],[765,248,93],[767,245,45],[768,243,39],[768,241,50],[761,235,50],[758,231,36],[758,229,99],[758,228,36],[760,228,78],[767,233,34],[777,243,33],[784,252,34],[795,276,50],[797,280,34],[796,281,166],[795,281,35],[794,279,129],[794,279,63],[793,272,46],[793,268,41],[793,266,34],[794,264,68]]);
  await page.mouse.move(794, 264);
  await page.mouse.down();
  await replayCursorPath(page, [[794,264,215],[793,264,52],[778,267,44],[770,267,37],[733,268,43],[714,268,50],[704,269,49],[694,269,59],[693,269,33]]);
  await page.mouse.move(693, 269);
  await page.mouse.up();
  await replayCursorPath(page, [[694,269,432],[698,407,47],[684,530,39],[684,617,34],[690,679,32],[692,717,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[625,716,1601],[638,557,49],[654,435,46],[668,376,36],[689,315,35],[711,246,33],[739,197,34],[773,165,32],[794,129,33],[807,105,35],[820,77,32],[823,67,34],[828,62,32]]);
  await replayCursorPath(page, [[831,57,33],[833,56,35],[836,56,50],[849,54,33],[870,45,48],[871,45,42]]);
  await replayCursorPath(page, [[882,40,43],[883,39,49],[884,38,33]]);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(893, 38);
  await replayCursorPath(page, [[884,38,250],[884,39,103],[883,50,48]]);
  await replayCursorPath(page, [[881,69,51],[877,88,37],[877,97,35],[874,101,45],[873,106,67],[873,106,99],[873,107,63]]);
  await replayCursorPath(page, [[868,111,46],[866,112,40],[866,112,84],[866,112,84],[865,112,68]]);
  await replayCursorPath(page, [[864,107,34],[864,102,34],[863,101,59],[860,99,138]]);
  await page.mouse.move(860, 99);
  await page.mouse.down();
  await replayCursorPath(page, [[860,98,67]]);
  await page.mouse.move(860, 98);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(819, 94);
  await replayCursorPath(page, [[860,99,167],[862,108,33],[862,127,35],[869,174,47],[874,192,46],[874,194,38],[872,193,100],[869,188,35],[868,186,48],[870,184,36],[873,183,31],[876,181,33],[888,177,46],[900,176,39],[920,175,49],[938,175,49],[947,175,51],[950,176,41],[952,177,55],[958,179,37],[960,180,119]]);
  await page.mouse.move(960, 180);
  await page.mouse.down();
  await replayCursorPath(page, [[961,181,51],[984,234,68],[1007,274,47],[1024,296,50],[1029,305,32],[1031,308,44],[1036,311,52],[1040,318,43],[1067,350,54],[1076,358,47],[1081,360,66],[1085,362,43],[1091,364,49],[1093,364,34]]);
  await page.mouse.move(1094, 364);
  await page.mouse.up();
  await replayCursorPath(page, [[1094,364,134],[1094,364,35],[935,191,44],[903,153,36],[868,131,36],[830,110,35],[799,87,40],[792,85,42],[784,83,34],[769,77,32],[752,71,35]]);
  await replayCursorPath(page, [[691,53,47],[675,49,33],[672,48,43],[664,47,42],[659,47,45],[658,47,72]]);
  await replayCursorPath(page, [[656,46,64],[655,46,69]]);
  await page.mouse.move(655, 46);
  await page.mouse.down();
  await replayCursorPath(page, [[654,46,99]]);
  await page.mouse.move(652, 46);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[650,46,64],[648,48,102],[658,84,33],[680,161,33],[693,257,33],[717,324,45],[744,402,60],[766,454,43],[776,472,36],[796,498,48],[802,503,37],[805,509,51],[806,510,48]]);
  await page.mouse.move(806, 510);
  await page.mouse.down();
  await replayCursorPath(page, [[807,510,35],[808,503,35],[833,440,60],[852,400,34],[857,392,35],[858,391,36]]);
  await page.mouse.move(859, 390);
  await page.mouse.up();
  await page.mouse.move(859, 390);
  await page.mouse.down();
  await replayCursorPath(page, [[860,390,745],[861,390,36],[864,390,51],[881,382,54],[896,364,38],[906,354,36],[918,340,76],[931,326,51],[944,319,45],[952,313,44],[953,312,40],[955,312,51],[956,312,48]]);
  await page.mouse.move(956, 312);
  await page.mouse.up();
  await replayCursorPath(page, [[957,313,569],[959,319,38],[960,323,54],[963,328,58],[964,328,32],[964,328,51],[967,334,52],[968,349,48],[968,353,52],[967,354,33],[966,354,82],[966,355,33],[967,355,33]]);
  await page.mouse.move(967, 355);
  await page.mouse.down();
  await replayCursorPath(page, [[967,355,267],[966,355,37],[965,355,62],[960,353,45],[958,353,37],[956,352,34],[956,351,33],[954,350,34],[952,349,36]]);
  await page.mouse.move(951, 349);
  await page.mouse.up();
  await replayCursorPath(page, [[952,349,231],[955,349,51],[955,349,33],[956,349,117]]);
  await page.mouse.move(956, 349);
  await page.mouse.down();
  await page.mouse.move(956, 349);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[956,349,300],[957,349,216],[958,349,166],[958,349,35],[960,348,53],[967,351,46],[966,351,51],[963,350,33],[962,350,33]]);
  await page.mouse.move(962, 350);
  await page.mouse.down();
  await replayCursorPath(page, [[961,350,33],[960,349,39],[948,345,42],[933,338,34],[914,328,51],[893,317,42],[879,310,65],[868,308,32],[864,306,34],[858,304,58],[854,303,45],[853,303,45],[847,303,40],[838,303,46],[837,303,42],[836,303,68],[832,304,65],[829,305,55],[827,305,45],[823,307,41],[820,308,34],[816,310,144],[809,312,40]]);
  await page.mouse.move(809, 313);
  await page.mouse.up();
  await replayCursorPath(page, [[808,313,59],[794,354,55],[756,501,39],[735,591,40],[708,689,32]]);
}
`,
  },
  {
    name: "New elbow arrow binds and tracks bindables",
    targetUrl: "https://excalidraw-lastest.vercel.app",
    functionalArea: "Arrows binding to bindables",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target;
        if (action === 'click') await target.click();
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    if (action === 'fill' && coords) {
      console.log('Falling back to coordinate fill at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.press('Control+a');
      await page.keyboard.type(value || '');
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[469,597,0],[472,600,50],[474,565,33]]);
  await replayCursorPath(page, [[550,314,58],[623,149,42],[629,133,33],[632,119,134],[629,115,116],[622,108,68]]);
  await replayCursorPath(page, [[545,41,65],[542,39,33],[535,36,39],[533,36,91],[533,36,37],[531,36,35],[528,36,153]]);
  await replayCursorPath(page, [[525,36,106]]);
  await page.mouse.move(525, 36);
  await page.mouse.down();
  await page.mouse.move(525, 36);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(520, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(514, 40);
  await replayCursorPath(page, [[516,40,556]]);
  await replayCursorPath(page, [[449,74,33],[381,112,145],[311,158,289],[300,165,105],[266,176,60],[262,176,44],[261,176,40],[258,176,51],[257,176,54],[256,176,50],[253,175,144]]);
  await page.mouse.move(253, 175);
  await page.mouse.down();
  await replayCursorPath(page, [[253,175,125],[257,177,43],[269,194,313],[328,268,38],[336,275,75],[339,278,50],[341,279,55],[342,280,51],[342,280,34],[343,281,229],[343,281,89],[347,284,74],[356,290,66],[358,291,47],[358,291,50],[359,292,97],[360,293,36],[382,301,60],[389,304,58],[398,307,40],[402,309,36],[402,310,51]]);
  await page.mouse.move(402, 310);
  await page.mouse.up();
  await replayCursorPath(page, [[402,309,413],[442,86,37],[452,70,34],[456,66,73],[457,65,129]]);
  await replayCursorPath(page, [[474,58,52],[525,50,32],[547,50,55],[554,50,59],[556,50,34]]);
  await page.mouse.move(556, 49);
  await page.mouse.down();
  await page.mouse.move(556, 49);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(560, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(554, 40);
  await replayCursorPath(page, [[555,51,680]]);
  await replayCursorPath(page, [[545,64,37],[501,136,49],[481,189,32],[472,225,33],[469,244,33],[468,251,34],[468,248,202],[467,235,32],[461,209,37],[457,192,31],[451,179,50],[450,176,35],[450,175,63]]);
  await page.mouse.move(450, 175);
  await page.mouse.down();
  await replayCursorPath(page, [[450,175,369],[455,186,38],[466,210,48],[491,257,49],[510,295,39],[521,314,52],[527,322,56],[528,323,39],[530,324,43],[531,325,34],[532,325,35],[533,325,43],[533,326,40],[534,326,33],[534,326,33],[535,326,49],[536,326,33],[536,326,53],[538,326,42],[542,324,43],[544,322,48],[548,320,48],[551,318,50],[555,317,50],[556,316,34],[561,314,49],[563,313,50],[564,312,62],[569,311,41],[574,310,49],[579,309,44],[582,309,107],[588,308,48],[590,306,34],[593,303,200],[599,296,201]]);
  await page.mouse.move(599, 296);
  await page.mouse.up();
  await page.keyboard.press('4');
  await replayCursorPath(page, [[599,295,1784],[607,286,34],[619,270,33],[632,251,31],[646,224,50],[657,201,34],[664,186,52],[665,184,265],[666,179,65],[666,173,68]]);
  await page.mouse.move(666, 173);
  await page.mouse.down();
  await replayCursorPath(page, [[666,173,439],[668,180,52],[680,197,57],[691,210,49],[696,217,46],[702,222,41],[712,232,67],[719,238,36],[719,239,38],[720,241,41],[721,242,117],[725,247,37],[727,249,33],[731,252,66],[737,258,74],[740,261,36],[741,263,35],[743,265,37],[745,268,55],[746,269,59],[748,271,37],[753,276,61],[756,278,41],[757,279,224],[761,281,41],[769,289,199],[769,294,38],[769,303,58],[769,306,50],[769,308,52],[769,309,53],[769,309,45],[769,310,50],[770,310,47],[772,311,58],[772,312,61],[773,312,34],[774,312,51],[775,313,33],[776,314,48],[776,315,40],[776,315,33]]);
  await page.mouse.move(776, 315);
  await page.mouse.up();
  await replayCursorPath(page, [[809,179,826],[833,116,171],[844,104,33],[861,88,33],[871,77,51],[872,75,85],[873,69,33],[875,62,49]]);
  await replayCursorPath(page, [[877,57,32],[879,54,52],[880,52,49],[882,50,38],[884,46,51]]);
  await replayCursorPath(page, [[885,45,80],[886,45,46],[886,45,34],[887,44,32],[887,44,51],[888,43,33],[888,43,83]]);
  await page.mouse.move(888, 43);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(890, 41);
  await replayCursorPath(page, [[888,44,986],[883,50,49],[877,57,36],[866,71,48],[860,78,56]]);
  await replayCursorPath(page, [[852,87,41],[850,91,49],[849,91,37],[849,91,34],[847,91,48],[847,91,33],[847,91,68]]);
  await page.mouse.move(847, 91);
  await page.mouse.down();
  await page.mouse.move(847, 91);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(819, 94);
  await replayCursorPath(page, [[847,93,1129],[847,107,46],[849,130,57],[850,144,55],[850,154,46],[850,155,52],[851,155,31],[852,156,71],[862,165,48],[869,172,48],[870,173,49]]);
  await page.mouse.move(870, 173);
  await page.mouse.down();
  await replayCursorPath(page, [[870,173,385],[875,178,45],[884,188,33],[902,206,38],[912,218,33],[923,230,34],[935,247,41],[943,259,51],[947,266,51],[953,274,174],[956,280,35],[957,284,56],[957,284,44],[957,285,97],[957,285,201],[957,286,40],[958,290,37],[960,294,35],[961,295,36],[963,300,44],[964,303,57],[965,305,35],[969,308,48],[970,308,35],[973,311,48],[974,312,36],[976,314,70]]);
  await page.mouse.move(976, 314);
  await page.mouse.up();
  await replayCursorPath(page, [[976,314,613],[964,307,56],[797,158,43]]);
  await replayCursorPath(page, [[661,31,58],[647,19,359]]);
  await replayCursorPath(page, [[647,29,48],[647,35,59],[647,36,52],[646,36,72]]);
  await page.mouse.move(646, 36);
  await page.mouse.down();
  await page.mouse.move(646, 36);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[645,36,835]]);
  await replayCursorPath(page, [[610,38,41],[475,51,34],[345,86,65],[301,105,41],[290,111,45],[286,117,192],[260,149,52]]);
  await replayCursorPath(page, [[172,269,43],[151,301,37],[140,324,34],[137,335,35],[136,341,64]]);
  await replayCursorPath(page, [[133,355,46],[130,373,188]]);
  await replayCursorPath(page, [[129,405,40],[128,409,269]]);
  await page.mouse.move(128, 409);
  await page.mouse.down();
  await page.mouse.move(128, 409);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(124, 405);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(125, 407);
  await replayCursorPath(page, [[129,409,775]]);
  await replayCursorPath(page, [[150,411,59],[178,417,49],[226,433,46],[264,453,47],[282,463,48],[286,466,34],[287,467,33],[288,468,34],[291,470,33],[305,476,48],[314,479,34],[326,482,33],[327,482,33],[328,482,33]]);
  await page.mouse.move(328, 482);
  await page.mouse.down();
  await replayCursorPath(page, [[328,482,302],[328,479,40],[321,464,44],[314,449,48],[308,433,36],[306,424,40],[305,409,98],[306,400,42],[306,396,41],[306,394,229],[309,385,131],[321,358,103],[326,349,52],[327,347,35],[328,346,42],[328,344,50],[329,341,44],[329,339,59],[329,337,45],[329,336,69],[329,333,64],[329,331,53],[329,330,36],[330,327,41],[330,327,39],[330,327,77],[330,324,53],[330,323,57],[330,322,36],[329,321,40],[329,320,47],[329,320,56],[329,319,35],[328,319,33],[328,319,35],[328,318,40],[327,318,42],[326,318,36],[326,317,41],[325,317,49],[325,317,57],[325,317,35],[324,317,72],[324,317,278]]);
  await page.mouse.move(324, 317);
  await page.mouse.up();
  await replayCursorPath(page, [[326,317,610],[369,317,97],[384,317,180],[378,306,86],[375,304,150],[373,304,293],[373,305,34],[373,305,50],[373,306,34],[373,306,49],[373,307,51],[372,307,40]]);
  await page.mouse.move(372, 307);
  await page.mouse.down();
  await replayCursorPath(page, [[372,307,58],[372,307,235],[370,307,69],[364,307,59],[358,307,43],[356,307,40],[355,307,54],[354,307,51],[353,307,35],[352,307,54],[352,307,125],[351,307,40],[350,308,78],[350,308,39],[349,308,113],[348,308,53],[348,308,93],[347,308,37]]);
  await page.mouse.move(347, 308);
  await page.mouse.up();
  await replayCursorPath(page, [[351,308,444],[385,311,61],[421,313,45],[448,309,48],[463,295,39],[489,242,62],[522,170,50],[522,171,153],[527,172,51],[560,138,64],[585,106,33],[593,97,35],[600,89,32],[612,72,69],[618,62,48]]);
  await replayCursorPath(page, [[626,52,66],[628,50,300],[631,45,35]]);
  await page.mouse.move(640, 32);
  await page.mouse.down();
  await page.mouse.move(640, 32);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[639,34,154],[623,74,39],[583,204,63],[563,296,68],[558,356,53],[558,378,42],[555,398,109],[548,409,53],[541,418,45],[530,434,84],[527,441,81],[525,446,44],[525,448,47],[521,459,66],[518,470,49],[518,473,38]]);
  await page.mouse.move(518, 474);
  await page.mouse.down();
  await replayCursorPath(page, [[518,474,1227],[518,473,151],[515,463,35],[508,451,67],[505,446,43],[499,433,51],[495,423,48],[492,414,59],[490,409,34],[488,401,47],[487,395,48],[485,387,61],[484,380,43],[483,372,48],[483,368,37],[483,350,93],[483,346,40],[483,329,34],[484,319,46],[484,316,34],[484,307,47],[485,304,36],[485,302,51],[485,301,58],[486,300,40],[488,297,154],[495,291,40],[497,288,75],[497,288,35],[497,287,134],[497,287,39],[497,287,360],[497,286,421],[497,286,35],[497,284,366],[496,276,41],[496,276,70],[496,275,54],[496,275,33],[496,275,46],[496,274,168]]);
  await page.mouse.move(495, 274);
  await page.mouse.up();
  await replayCursorPath(page, [[497,274,851],[505,276,58],[528,285,38],[536,287,199],[540,286,38],[541,285,45],[541,285,35],[542,285,36],[542,285,114]]);
  await page.mouse.move(542, 285);
  await page.mouse.down();
  await replayCursorPath(page, [[542,285,815],[542,285,41],[543,285,105],[546,286,38],[546,286,138],[548,287,37],[549,288,54],[550,289,72],[550,289,57],[551,290,42],[551,290,50],[551,291,47],[551,291,45],[552,291,42],[552,292,55],[552,292,48],[553,293,43],[553,293,155],[554,294,33]]);
  await page.mouse.move(554, 294);
  await page.mouse.up();
  await replayCursorPath(page, [[555,294,400],[581,268,54],[612,229,47],[673,147,66],[679,136,33],[672,111,323]]);
  await replayCursorPath(page, [[656,57,43],[655,57,36],[655,57,47],[651,55,80],[645,47,57]]);
  await replayCursorPath(page, [[644,43,44]]);
  await page.mouse.move(644, 43);
  await page.mouse.down();
  await page.mouse.move(644, 43);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[644,44,369]]);
  await replayCursorPath(page, [[645,48,116],[661,154,35],[662,174,73],[674,298,68],[676,320,40],[676,323,238],[694,406,47],[727,522,42],[732,536,41],[735,543,51],[735,544,108],[735,548,53],[735,550,39],[735,551,32],[735,552,42],[735,552,41]]);
  await page.mouse.move(735, 552);
  await page.mouse.down();
  await replayCursorPath(page, [[735,551,316],[734,550,39],[730,533,34],[724,515,60],[718,502,52],[715,492,66],[712,484,35],[711,460,40],[717,445,42],[720,437,32],[729,419,135],[733,409,43],[734,402,261],[730,395,39],[723,381,39],[721,378,34],[717,367,152],[715,360,39],[715,352,58],[715,351,67],[714,349,62],[714,348,35],[713,347,91],[713,344,40],[712,342,46],[712,342,42],[712,341,52],[711,340,46],[711,339,40],[711,339,46],[711,338,39],[711,337,50],[710,335,43],[710,335,44],[710,334,54],[710,333,49],[710,333,91],[709,332,52],[709,331,62],[709,331,40],[709,331,43],[709,331,34],[709,330,34],[709,330,48],[709,329,100],[709,329,43],[709,328,57],[709,327,40],[709,327,179],[708,325,39],[708,324,75],[708,324,34],[708,324,46],[708,323,39],[708,322,44],[708,321,38],[708,320,33],[708,319,50],[707,319,36],[707,319,281],[707,318,40]]);
  await page.mouse.move(707, 318);
  await page.mouse.up();
  await replayCursorPath(page, [[711,318,470],[734,320,90],[737,319,110],[737,318,59],[738,312,113],[739,309,36],[740,309,45],[740,308,135],[745,308,56],[748,308,83]]);
  await page.mouse.move(749, 308);
  await page.mouse.down();
  await replayCursorPath(page, [[749,308,449],[748,308,61],[745,308,37],[744,308,49],[744,308,33],[743,308,37],[742,308,47],[742,308,199],[740,308,88],[740,308,223],[734,308,49],[733,308,54],[733,308,43],[733,308,194],[733,308,52],[739,309,55],[742,309,37],[743,310,54]]);
  await page.mouse.move(743, 310);
  await page.mouse.up();
  await replayCursorPath(page, [[743,306,654],[744,242,49],[752,199,33],[759,170,33],[762,162,34],[765,177,133],[767,184,48],[764,171,34],[720,99,70],[681,60,48]]);
  await replayCursorPath(page, [[677,57,180],[657,54,55],[646,44,37],[641,39,62],[640,39,49]]);
  await page.mouse.move(640, 39);
  await page.mouse.down();
  await page.mouse.move(640, 39);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[641,39,284]]);
  await replayCursorPath(page, [[647,39,33],[665,45,34],[736,83,47],[815,141,55],[930,270,41],[971,338,43],[975,353,304],[970,386,42],[959,440,51],[956,454,33],[955,457,50],[954,458,32],[954,460,189],[953,464,45],[953,469,35],[953,476,49],[951,482,48],[949,486,35],[949,487,35]]);
  await page.mouse.move(949, 487);
  await page.mouse.down();
  await replayCursorPath(page, [[949,487,182],[945,466,78],[942,454,35],[938,442,31],[933,428,49],[931,418,45],[930,414,46],[930,412,49],[929,409,44],[929,409,38],[929,408,252],[927,406,42],[919,393,39],[915,385,35],[912,381,49],[911,380,39],[911,378,41],[911,377,45],[911,376,48],[910,373,50],[909,369,46],[908,368,35],[907,366,40],[906,365,54],[906,364,36],[906,363,43],[905,360,190],[900,343,39],[897,335,46],[896,331,59],[895,328,47],[895,327,42],[895,326,34],[895,325,35],[895,324,65],[895,323,47],[895,321,320],[895,317,277],[895,314,334]]);
  await page.mouse.move(895, 314);
  await page.mouse.up();
  await replayCursorPath(page, [[895,313,1004],[888,303,33],[884,298,34],[882,296,49],[879,295,71],[878,294,81],[878,294,34],[877,293,33],[877,293,34],[877,293,34],[875,292,49],[875,291,34],[874,291,33],[874,291,50],[873,291,34],[873,290,82],[873,290,33],[872,290,72],[872,290,45],[871,289,50],[871,289,34],[871,289,50],[870,288,33],[870,288,66]]);
  await page.mouse.move(870, 288);
  await page.mouse.down();
  await replayCursorPath(page, [[870,288,437],[867,288,38],[863,288,41],[861,288,51],[860,288,79],[860,288,39],[859,288,48],[859,288,51],[859,288,32],[858,288,58],[858,288,55],[857,288,70],[857,288,40],[857,288,45],[856,289,33],[856,289,48],[855,289,53],[855,289,65],[854,289,51],[854,290,67]]);
  await page.mouse.move(854, 290);
  await page.mouse.up();
  await replayCursorPath(page, [[854,290,414],[847,349,50],[832,436,33],[820,521,34],[812,625,41],[812,640,43],[812,643,34],[812,648,200],[818,675,34]]);
}
`,
  },
  {
    name: "Multipoint simple arrows bind and track",
    targetUrl: "https://excalidraw-lastest.vercel.app",
    functionalArea: "Arrows binding to bindables",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target;
        if (action === 'click') await target.click();
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    if (action === 'fill' && coords) {
      console.log('Falling back to coordinate fill at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.press('Control+a');
      await page.keyboard.type(value || '');
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[539,233,0],[514,206,42],[510,195,35],[506,177,32],[508,163,33],[516,153,34],[539,127,34],[549,115,33],[558,103,36],[562,98,34],[562,90,36],[552,83,39],[547,79,39],[536,67,45],[534,60,39]]);
  await replayCursorPath(page, [[533,53,31],[531,48,41],[527,43,52],[525,41,48]]);
  await page.mouse.move(521, 38);
  await page.mouse.down();
  await replayCursorPath(page, [[520,38,76]]);
  await page.mouse.move(520, 38);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(520, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(514, 40);
  await replayCursorPath(page, [[519,40,110]]);
  await replayCursorPath(page, [[521,50,36],[520,67,47],[486,117,41],[439,168,51],[416,181,33],[405,185,32],[386,185,49],[380,181,50],[371,176,34],[366,174,33],[364,172,34],[362,171,33],[363,170,58]]);
  await page.mouse.move(363, 170);
  await page.mouse.down();
  await replayCursorPath(page, [[365,171,44],[395,184,52],[405,190,29],[421,198,34],[429,205,40],[436,208,44],[441,211,61],[451,217,38],[453,218,34],[457,222,42],[460,226,41],[464,231,37],[465,232,34],[466,235,32],[467,242,42],[468,254,41],[468,260,40],[468,263,37],[468,265,38],[469,266,47],[469,268,46],[470,273,54]]);
  await page.mouse.move(471, 274);
  await page.mouse.up();
  await replayCursorPath(page, [[472,274,184],[546,214,56],[572,150,46],[573,139,35],[571,130,33],[573,103,49],[577,90,50],[585,82,35],[605,68,50]]);
  await replayCursorPath(page, [[614,59,51],[625,43,50],[629,41,34],[637,36,66],[639,36,65]]);
  await page.mouse.move(639, 36);
  await page.mouse.down();
  await page.mouse.move(639, 36);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[639,36,151]]);
  await replayCursorPath(page, [[617,75,30],[551,159,37],[479,246,46],[424,324,36],[393,369,33],[333,448,60],[316,476,35],[312,485,33],[311,492,38],[311,492,68],[374,457,72],[383,448,35],[389,444,50],[398,436,37],[401,435,37]]);
  await page.mouse.move(401, 435);
  await page.mouse.down();
  await replayCursorPath(page, [[402,435,78]]);
  await page.mouse.move(402, 435);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[419,427,43],[461,403,44],[495,387,45],[551,368,45],[557,366,38],[563,362,47],[568,358,38],[568,354,45],[567,353,34],[563,349,36],[558,346,37],[550,333,41],[548,326,40],[548,325,55]]);
  await page.mouse.move(548, 325);
  await page.mouse.down();
  await page.mouse.move(548, 325);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[548,325,183],[547,324,55],[543,322,45],[540,318,37],[533,303,48],[526,289,39],[519,275,34],[511,268,47],[508,265,40],[500,261,39],[499,260,34],[493,256,43],[490,254,41],[486,251,44],[481,249,45],[480,248,143],[480,247,66]]);
  await page.mouse.move(480, 247);
  await page.mouse.down();
  await page.mouse.move(480, 247);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[480,247,590],[482,249,40],[487,257,38],[497,282,35],[500,288,33],[501,289,35],[501,292,149],[500,292,49],[500,292,183],[497,286,42],[495,281,40],[493,273,36],[490,255,48],[490,254,34],[489,249,47],[489,247,53],[488,246,51],[483,244,38],[481,243,78]]);
  await page.mouse.move(481, 243);
  await page.mouse.down();
  await replayCursorPath(page, [[482,243,451],[483,244,52],[484,245,33],[486,245,49],[487,245,63],[487,245,104]]);
  await page.mouse.move(487, 245);
  await page.mouse.up();
  await replayCursorPath(page, [[487,245,515],[484,247,34],[481,249,64],[472,254,65],[462,258,50],[457,263,32],[455,266,36],[454,266,151],[451,268,35],[448,268,33],[443,271,33],[421,280,49],[400,281,41],[382,281,34],[379,280,227],[379,279,48],[379,279,66],[379,278,184],[379,276,35]]);
  await page.mouse.move(382, 270);
  await page.mouse.down();
  await replayCursorPath(page, [[381,269,390],[380,269,43],[365,269,54],[362,269,48],[361,269,46],[360,269,251]]);
  await page.mouse.move(360, 269);
  await page.mouse.up();
  await replayCursorPath(page, [[361,269,215],[380,282,54],[461,361,43],[486,386,43],[584,490,43],[626,537,34],[725,661,44],[737,684,42]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[600,707,1381],[616,553,33],[633,469,36],[649,368,31],[651,288,44],[645,228,40],[638,177,33],[612,105,51],[605,92,34],[594,77,49],[585,66,41],[584,64,48],[582,62,43],[581,62,35],[579,60,83]]);
  await replayCursorPath(page, [[578,59,38],[573,57,37],[572,55,41],[571,55,44],[570,54,56],[570,53,50],[568,50,45],[567,46,34]]);
  await replayCursorPath(page, [[567,43,38]]);
  await page.mouse.move(567, 43);
  await page.mouse.down();
  await page.mouse.move(567, 43);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(560, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(554, 40);
  await replayCursorPath(page, [[568,43,235],[582,52,47],[591,63,36],[609,94,48],[613,108,36],[616,116,48],[619,125,46],[621,132,38],[622,138,33],[624,142,33],[624,147,34],[624,160,49],[624,162,50]]);
  await page.mouse.move(624, 162);
  await page.mouse.down();
  await replayCursorPath(page, [[624,163,204],[624,169,37],[638,201,33],[646,213,38],[650,218,40],[669,236,47],[670,237,33],[674,240,52],[675,242,41],[677,244,59],[678,247,49],[686,258,42],[694,268,34],[700,274,60],[705,279,320],[706,281,31],[713,288,41],[716,291,32],[723,294,42],[729,298,35],[730,298,32],[733,299,47]]);
  await page.mouse.move(734, 300);
  await page.mouse.up();
  await replayCursorPath(page, [[732,300,256],[705,257,62],[676,132,34],[673,78,40],[674,61,35]]);
  await replayCursorPath(page, [[669,47,46],[640,2,59],[632,2,185],[634,11,42]]);
  await replayCursorPath(page, [[644,30,36],[646,31,44],[650,38,45]]);
  await page.mouse.move(650, 38);
  await page.mouse.down();
  await page.mouse.move(650, 38);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[649,38,160]]);
  await replayCursorPath(page, [[644,44,56],[635,120,31],[598,249,36],[570,351,33],[565,400,33],[564,435,40],[566,449,35],[570,473,41],[574,486,34],[577,489,52]]);
  await page.mouse.move(577, 489);
  await page.mouse.down();
  await replayCursorPath(page, [[578,489,151]]);
  await page.mouse.move(578, 489);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[578,489,49],[651,450,31],[696,403,52],[723,381,31],[742,373,35],[749,367,53],[750,364,48]]);
  await page.mouse.move(750, 364);
  await page.mouse.down();
  await page.mouse.move(750, 364);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[750,364,275],[783,303,61],[816,229,52],[817,226,45],[811,219,39],[805,217,46],[793,216,46],[786,219,46],[769,234,39],[759,242,37],[753,247,33],[750,251,38],[749,252,62],[749,252,101],[746,252,47],[744,252,55],[739,252,84],[738,252,94],[737,252,42],[727,252,43],[724,252,47],[722,252,70],[720,252,51],[718,252,51]]);
  await page.mouse.move(717, 252);
  await page.mouse.down();
  await page.mouse.move(717, 252);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[725,273,709],[769,359,38],[908,620,51],[919,639,32],[918,639,99],[908,628,33],[808,479,33],[740,354,35],[726,327,34],[714,308,49],[708,295,35],[696,271,33],[693,267,80],[697,260,53],[703,257,33],[710,255,33],[713,255,36],[714,255,98],[715,255,52]]);
  await page.mouse.move(715, 255);
  await page.mouse.down();
  await replayCursorPath(page, [[716,255,162],[718,255,40],[727,263,57],[730,265,41],[729,265,315],[728,265,65],[728,265,81],[727,264,36],[726,264,49],[726,264,121],[725,264,99]]);
  await page.mouse.move(725, 264);
  await page.mouse.up();
  await replayCursorPath(page, [[725,264,263],[725,264,50],[723,265,33],[709,270,33],[703,271,50],[701,271,35],[700,272,269],[699,272,50],[698,272,68],[696,242,47],[694,216,39],[689,201,62],[690,199,35],[693,197,49],[694,197,38],[694,197,58],[697,196,46]]);
  await page.mouse.move(698, 196);
  await page.mouse.down();
  await replayCursorPath(page, [[699,196,71]]);
  await page.mouse.move(699, 196);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[699,196,118],[701,195,48]]);
  await page.mouse.move(701, 195);
  await page.mouse.down();
  await replayCursorPath(page, [[700,195,351],[694,194,49],[687,194,52],[685,194,38],[682,194,37],[678,193,39],[674,192,45],[669,192,33],[662,192,48],[660,192,143],[660,192,35],[658,192,43],[654,192,36],[653,191,50],[651,191,51],[651,191,50],[650,191,51],[646,191,39]]);
  await page.mouse.move(646, 191);
  await page.mouse.up();
  await replayCursorPath(page, [[646,191,243],[656,191,52],[670,191,32],[680,187,40],[688,144,44]]);
  await replayCursorPath(page, [[683,52,50],[682,50,47],[628,155,35],[608,279,41],[630,564,38],[641,607,34],[659,661,51],[658,669,54],[650,676,51],[639,693,37],[631,709,44]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[611,696,1134],[623,574,33],[638,469,34],[658,382,51],[676,284,47],[677,260,36],[677,249,32],[666,219,34],[654,187,33],[637,155,34],[633,150,35],[617,128,48],[606,112,34],[597,90,48],[596,88,34],[595,79,36],[595,76,31],[597,72,49],[597,70,49],[598,62,49],[599,61,36],[599,60,51]]);
  await replayCursorPath(page, [[599,57,34],[599,55,34]]);
  await page.mouse.move(599, 54);
  await page.mouse.down();
  await page.mouse.move(599, 54);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(600, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(594, 40);
  await replayCursorPath(page, [[600,54,415]]);
  await replayCursorPath(page, [[623,62,34],[675,87,47],[682,91,34],[693,97,50],[702,106,33],[713,115,52],[737,129,44],[760,138,54],[797,152,40],[798,153,44],[802,156,36],[809,160,231],[806,160,34],[805,160,33],[805,160,65],[812,165,35],[821,169,32],[828,174,33],[863,180,35],[886,184,48],[888,183,53],[888,183,84],[888,182,48],[887,182,33],[886,182,33],[886,181,34],[886,181,49],[886,181,34]]);
  await page.mouse.move(886, 181);
  await page.mouse.down();
  await replayCursorPath(page, [[886,181,101],[893,186,58],[907,199,41],[927,225,37],[945,247,38],[951,258,37],[953,262,38],[956,264,50],[956,266,84],[960,269,50],[961,269,241]]);
  await page.mouse.move(961, 269);
  await page.mouse.up();
  await replayCursorPath(page, [[960,269,41],[895,251,60],[708,102,37],[688,65,39]]);
  await replayCursorPath(page, [[661,33,36],[651,24,38],[641,19,62],[641,19,81]]);
  await replayCursorPath(page, [[642,22,35],[646,42,69],[648,47,45]]);
  await page.mouse.move(648, 47);
  await page.mouse.down();
  await page.mouse.move(648, 47);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[659,73,246],[688,132,38],[748,213,49],[782,264,33],[823,324,51],[839,356,35],[849,376,33],[858,395,47],[865,398,44],[865,399,40],[864,400,73],[847,411,67],[841,418,35],[831,432,42],[828,441,33],[823,448,35],[821,449,50],[800,460,45],[795,464,47],[786,471,39]]);
  await page.mouse.move(786, 471);
  await page.mouse.down();
  await replayCursorPath(page, [[787,471,152]]);
  await page.mouse.move(787, 471);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[790,472,62],[838,433,49],[850,416,32],[876,395,70],[895,383,36],[900,379,38],[909,374,40],[925,373,37],[929,373,45],[930,373,75],[936,372,32],[946,370,34]]);
  await page.mouse.move(946, 370);
  await page.mouse.down();
  await replayCursorPath(page, [[946,370,98]]);
  await page.mouse.move(946, 370);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[946,367,83],[964,317,56],[963,293,35],[962,289,38],[961,283,35],[952,273,46],[948,271,44],[944,268,39],[943,267,42],[942,267,34],[941,266,48],[940,266,86]]);
  await page.mouse.move(940, 266);
  await page.mouse.down();
  await page.mouse.move(940, 266);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[940,266,566],[941,322,37],[966,368,67],[972,382,63],[972,383,65],[972,382,34],[964,345,32],[963,342,52],[958,331,48],[949,313,35],[945,305,50],[940,301,33],[934,287,36],[933,272,47],[933,270,34],[932,269,35],[932,268,81],[933,269,66],[935,269,85],[938,271,47],[939,271,152],[939,271,33],[939,271,46]]);
  await page.mouse.move(939, 271);
  await page.mouse.down();
  await replayCursorPath(page, [[941,274,64],[949,283,39],[958,306,34],[974,341,39],[984,361,32],[986,363,47],[985,363,198],[983,361,50],[974,355,51],[972,352,33],[954,302,48],[952,294,37],[951,291,34],[945,285,38],[944,284,42],[941,283,69],[938,280,37],[937,280,44],[937,279,51],[936,279,65],[936,278,51],[936,278,50],[936,277,36]]);
  await page.mouse.move(936, 277);
  await page.mouse.up();
  await replayCursorPath(page, [[933,276,376],[903,265,38],[895,264,40],[891,260,30],[886,257,31],[880,254,35],[878,253,41],[877,250,119],[882,242,38],[883,238,35],[882,236,117],[883,236,84],[890,238,31],[895,242,35],[897,242,33]]);
  await page.mouse.move(897, 242);
  await page.mouse.down();
  await replayCursorPath(page, [[896,241,338]]);
  await page.mouse.move(896, 241);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[894,240,178],[893,240,84],[893,240,65],[893,240,51],[892,240,34],[891,240,250],[891,240,48]]);
  await page.mouse.move(890, 240);
  await page.mouse.down();
  await page.mouse.move(890, 240);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[891,240,585],[892,240,83],[893,240,119]]);
  await page.mouse.move(893, 240);
  await page.mouse.down();
  await replayCursorPath(page, [[894,240,33],[893,240,81],[890,240,39],[881,240,73],[872,240,43],[864,240,42],[860,240,35],[851,240,33],[848,241,33],[843,240,35],[836,240,38],[834,240,31],[831,240,41],[829,240,47],[814,238,54],[805,237,34],[799,237,40],[795,237,81],[794,237,53],[782,236,48]]);
  await page.mouse.move(782, 236);
  await page.mouse.up();
  await replayCursorPath(page, [[784,235,176],[787,222,39],[785,190,36],[771,94,45],[773,68,38]]);
  await replayCursorPath(page, [[776,14,50],[780,4,36],[800,3,63],[849,15,34]]);
  await replayCursorPath(page, [[879,24,33],[886,26,35],[890,27,32]]);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(893, 38);
  await replayCursorPath(page, [[891,30,268],[896,34,68],[896,36,242]]);
  await replayCursorPath(page, [[917,80,39],[922,111,42],[905,138,40],[897,146,34],[868,157,50],[862,156,32],[853,153,36]]);
  await replayCursorPath(page, [[837,141,46],[829,122,34],[829,118,43],[830,115,41],[830,111,47]]);
  await replayCursorPath(page, [[832,105,39],[832,104,47],[830,103,41]]);
  await page.mouse.move(830, 103);
  await page.mouse.down();
  await page.mouse.move(830, 103);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(814, 94);
  await replayCursorPath(page, [[835,103,259],[871,100,46],[920,107,38],[950,113,33],[964,118,34],[983,127,37],[1031,148,46],[1038,152,35],[1040,152,83],[1040,154,166],[1035,163,33],[1028,166,50],[1017,167,33],[1016,170,54],[1018,174,30],[1072,188,33],[1139,214,51],[1148,204,226],[1161,185,41],[1161,179,35],[1159,177,31],[1159,175,34]]);
  await page.mouse.move(1159, 175);
  await page.mouse.down();
  await replayCursorPath(page, [[1159,176,132],[1161,182,42],[1175,224,32],[1189,246,39],[1198,257,55],[1203,261,32],[1213,271,49],[1216,279,37],[1221,290,31],[1225,300,40],[1227,307,42],[1233,314,34],[1271,358,45],[1277,367,38],[1278,367,35],[1277,367,48],[1276,366,53],[1274,366,39]]);
  await page.mouse.move(1274, 366);
  await page.mouse.up();
  await replayCursorPath(page, [[1253,354,35],[1247,348,44],[1230,335,48],[1225,329,33],[1222,327,35],[1196,310,32],[1184,304,34],[1178,303,33],[1146,293,51],[1073,263,38],[995,194,35],[929,112,40]]);
  await replayCursorPath(page, [[899,55,36],[895,50,32],[883,46,33],[852,36,34],[836,33,50],[834,32,41]]);
  await replayCursorPath(page, [[813,29,57],[812,29,52],[810,29,34],[805,29,32]]);
  await replayCursorPath(page, [[789,32,52],[780,33,32],[773,34,33],[766,33,54],[753,32,45],[744,31,34]]);
  await replayCursorPath(page, [[722,29,32],[716,28,33],[711,27,33],[697,26,34],[692,26,34],[684,26,36],[678,26,114]]);
  await replayCursorPath(page, [[655,32,37],[643,35,48],[635,38,43]]);
  await page.mouse.move(635, 38);
  await page.mouse.down();
  await page.mouse.move(635, 38);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[635,39,277],[756,143,34],[856,273,40],[955,372,38],[993,403,34],[1043,445,53],[1056,470,47],[1057,478,49],[1051,483,33],[1040,488,39],[1029,492,30],[1015,498,50],[1011,500,33],[1010,502,32],[1008,504,33]]);
  await page.mouse.move(1008, 506);
  await page.mouse.down();
  await replayCursorPath(page, [[1008,507,98],[1010,507,46]]);
  await page.mouse.move(1010, 507);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[1011,507,34],[1109,465,34],[1142,452,62],[1150,449,42],[1152,448,42],[1153,448,59],[1156,447,36],[1158,446,149]]);
  await page.mouse.move(1158, 446);
  await page.mouse.down();
  await page.mouse.move(1158, 446);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[1158,446,99],[1157,446,39],[1169,395,35],[1169,393,75],[1169,384,33],[1170,375,46],[1168,366,34],[1166,362,42],[1166,362,181],[1167,362,33],[1171,363,42],[1172,365,491],[1173,370,37]]);
  await page.mouse.move(1174, 372);
  await page.mouse.down();
  await page.mouse.move(1174, 372);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[1175,372,648],[1176,373,37],[1176,373,444],[1175,373,34]]);
  await page.mouse.move(1174, 373);
  await page.mouse.down();
  await replayCursorPath(page, [[1174,372,66],[1173,372,57],[1172,373,54],[1190,404,56],[1199,416,40],[1199,417,277],[1197,414,34],[1192,397,64],[1187,386,46],[1182,376,49],[1180,373,39],[1178,371,42],[1176,369,53],[1176,368,71]]);
  await page.mouse.move(1176, 368);
  await page.mouse.up();
  await replayCursorPath(page, [[1175,368,229],[1175,368,90],[1175,367,66],[1167,345,42],[1159,326,48],[1154,311,60],[1156,302,50],[1157,300,34],[1158,299,50]]);
  await page.mouse.move(1158, 298);
  await page.mouse.down();
  await replayCursorPath(page, [[1157,298,350],[1149,295,39],[1133,293,64],[1130,293,44],[1124,293,38],[1118,292,45],[1114,293,58],[1112,293,33],[1108,293,42],[1090,294,59],[1066,292,54],[1054,290,46],[1044,289,59],[1037,288,55],[1031,285,41],[1011,277,54],[996,271,49],[987,266,323]]);
  await page.mouse.move(987, 266);
  await page.mouse.up();
  await replayCursorPath(page, [[987,266,30],[988,266,32],[994,268,50],[991,303,52],[950,421,38],[924,474,33],[884,584,66],[868,696,45],[865,719,34]]);
}
`,
  },
  {
    name: "<<Setup>>",
    targetUrl: "https://excalidraw-lastest.vercel.app",
    functionalArea: "Arrows binding to bindables",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target;
        if (action === 'click') await target.click();
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    if (action === 'fill' && coords) {
      console.log('Falling back to coordinate fill at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.press('Control+a');
      await page.keyboard.type(value || '');
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
      if (delay > 0) await page.waitForTimeout(delay);
    }
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await replayCursorPath(page, [[461,638,0]]);
  await replayCursorPath(page, [[518,522,38],[562,489,39],[521,367,54],[330,193,36],[301,166,40],[277,101,47],[288,39,31],[393,8,136]]);
  await replayCursorPath(page, [[494,43,53],[526,39,57],[552,33,53],[554,36,116]]);
  await replayCursorPath(page, [[551,36,36],[538,39,31],[532,40,40],[528,41,61]]);
  await page.mouse.move(528, 41);
  await page.mouse.down();
  await replayCursorPath(page, [[527,41,204]]);
  await page.mouse.move(527, 41);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(520, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(514, 40);
  await replayCursorPath(page, [[527,42,61],[527,43,39],[411,125,42],[354,154,38],[325,172,34],[290,192,31],[269,201,33],[264,204,34],[262,205,35],[264,205,48],[301,185,36],[309,177,48],[309,176,34],[308,174,50],[305,173,32],[301,171,36],[297,169,48],[297,152,33],[297,146,33],[298,144,35]]);
  await page.mouse.move(298, 143);
  await page.mouse.down();
  await replayCursorPath(page, [[299,143,132],[305,149,39],[359,215,67],[374,228,37],[383,234,40],[399,246,37],[410,254,58],[415,261,38],[419,266,51],[424,272,55],[443,299,37],[452,309,40]]);
  await page.mouse.move(453, 309);
  await page.mouse.up();
  await replayCursorPath(page, [[453,308,300],[473,267,54],[536,126,44],[552,98,37],[563,78,50],[563,76,33],[567,72,35],[568,67,33],[569,65,33],[569,62,33]]);
  await replayCursorPath(page, [[567,43,49],[566,37,59]]);
  await page.mouse.move(564, 35);
  await page.mouse.down();
  await page.mouse.move(564, 35);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(560, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(554, 40);
  await replayCursorPath(page, [[564,36,333]]);
  await replayCursorPath(page, [[532,98,63],[501,180,43],[492,208,43],[489,214,44],[484,210,44],[484,209,39],[485,204,49],[487,202,51],[490,198,33],[493,197,33],[515,179,43],[518,169,41],[521,163,34],[522,160,48],[522,160,100],[534,153,45],[539,148,56],[540,147,49]]);
  await page.mouse.move(540, 147);
  await page.mouse.down();
  await replayCursorPath(page, [[542,147,38],[544,147,33],[550,154,39],[559,162,31],[572,176,33],[581,186,48],[600,201,42],[614,210,39],[632,232,42],[645,248,35],[660,268,37],[668,279,40],[673,289,33],[679,297,51],[681,297,58],[683,298,48],[691,305,49],[692,306,54],[693,306,255],[693,306,31],[694,307,99],[694,307,81]]);
  await page.mouse.move(694, 307);
  await page.mouse.up();
  await replayCursorPath(page, [[695,291,37],[695,182,60],[680,111,39],[668,84,31],[659,68,35]]);
  await replayCursorPath(page, [[650,52,44],[646,51,38],[630,49,46],[622,45,35],[620,44,42],[620,44,63],[619,44,34],[618,44,61]]);
  await replayCursorPath(page, [[615,42,40],[607,42,48],[603,41,47],[602,41,35]]);
  await page.mouse.move(602, 39);
  await page.mouse.down();
  await page.mouse.move(602, 39);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(600, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(594, 40);
  await replayCursorPath(page, [[602,39,149]]);
  await replayCursorPath(page, [[642,67,60],[732,126,41],[784,149,33],[810,156,34],[818,157,51],[823,157,32],[822,156,66],[819,155,66],[818,155,33],[815,153,35],[811,151,60],[809,151,57],[807,150,33],[805,150,49],[802,150,51],[791,153,58],[785,156,42],[782,158,32]]);
  await page.mouse.move(782, 158);
  await page.mouse.down();
  await replayCursorPath(page, [[786,161,91],[801,169,60],[814,177,32],[836,195,51],[860,221,39],[884,246,52],[888,251,61],[901,267,39],[907,273,50],[910,276,57],[919,290,47],[921,299,49],[925,314,50],[929,320,47],[930,325,57],[931,330,42],[932,330,44],[932,329,231],[932,329,51],[932,326,33],[932,321,33],[932,315,34],[931,312,71]]);
  await page.mouse.move(931, 312);
  await page.mouse.up();
  await replayCursorPath(page, [[927,305,264],[923,299,106],[818,66,45]]);
  await replayCursorPath(page, [[797,56,47],[789,54,36],[778,54,46],[776,57,39],[770,62,64],[771,61,183],[772,61,48],[775,60,33]]);
  await replayCursorPath(page, [[781,57,82],[795,49,42],[802,46,64],[813,46,43]]);
  await replayCursorPath(page, [[817,46,36],[835,42,35],[842,42,52],[854,42,64],[856,43,150]]);
  await replayCursorPath(page, [[864,46,33],[866,46,34],[870,46,37],[888,46,33],[891,45,48]]);
  await replayCursorPath(page, [[891,46,35],[892,46,64]]);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(893, 38);
  await replayCursorPath(page, [[890,46,139],[890,46,77],[889,47,35],[889,50,45]]);
  await replayCursorPath(page, [[903,76,54],[910,83,53],[912,85,31],[917,90,33],[918,92,33],[919,99,51]]);
  await replayCursorPath(page, [[908,110,44],[885,116,37],[869,117,34],[862,117,34],[853,117,33],[848,117,40],[847,117,40],[842,114,45],[837,111,35]]);
  await replayCursorPath(page, [[829,103,42],[823,98,56],[820,96,65],[819,95,45],[818,94,80]]);
  await page.mouse.move(818, 94);
  await page.mouse.down();
  await replayCursorPath(page, [[818,94,152]]);
  await page.mouse.move(818, 94);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(790, 94);
  await replayCursorPath(page, [[819,95,54],[827,99,69],[930,147,42],[1010,183,54],[1022,188,33],[1030,188,32],[1032,189,33],[1034,185,48],[1027,172,36],[1012,162,47],[1007,160,36],[998,158,166],[998,158,35]]);
  await page.mouse.move(999, 158);
  await page.mouse.down();
  await replayCursorPath(page, [[1000,158,34],[1001,159,54],[1008,165,26],[1015,169,32],[1019,175,34],[1040,194,46],[1045,201,38],[1063,224,44],[1077,245,59],[1088,263,40],[1091,266,56],[1102,273,44],[1105,277,50],[1112,285,50],[1119,293,50],[1132,299,52],[1135,299,55],[1135,300,85],[1136,300,39],[1137,300,42],[1137,301,34],[1138,302,34]]);
  await page.mouse.move(1138, 302);
  await page.mouse.up();
  await replayCursorPath(page, [[1137,302,283],[1137,302,35],[1136,302,65],[1131,304,36],[1103,312,48],[1091,312,34],[1053,309,57],[1031,307,35],[1018,307,49],[983,307,42],[974,307,33],[941,303,34],[927,313,49],[905,387,50],[905,467,34],[911,529,33],[909,634,34],[902,706,32]]);
}
`,
  },
];

async function seed() {
  console.log('🌱 Seeding Excalidraw tests...');

  // Find or create the repository
  const [repo] = await db.select().from(repositories).where(eq(repositories.fullName, EXCALIDRAW_REPO_NAME));
  if (!repo) {
    console.error(`Repository ${EXCALIDRAW_REPO_NAME} not found. Please create it first.`);
    process.exit(1);
  }
  REPO_ID = repo.id;
  console.log(`Found repository: ${repo.fullName} (${repo.id})`);

  // Delete existing tests and functional areas for this repo
  await db.delete(tests).where(eq(tests.repositoryId, REPO_ID));
  await db.delete(functionalAreas).where(eq(functionalAreas.repositoryId, REPO_ID));
  console.log('Cleared existing data');

  // Create functional areas
  const faMap = new Map<string, string>();
  for (const faDef of FUNCTIONAL_AREA_DEFINITIONS) {
    const id = uuid();
    const parentId = faDef.parent ? faMap.get(faDef.parent) ?? null : null;
    await db.insert(functionalAreas).values({
      id,
      repositoryId: REPO_ID,
      name: faDef.name,
      description: faDef.description ?? null,
      parentId,
    });
    faMap.set(faDef.name, id);
    console.log(`  Created FA: ${faDef.name}`);
  }

  // Create tests
  const now = new Date();
  for (const testDef of TEST_DEFINITIONS) {
    const testId = uuid();
    const faId = testDef.functionalArea ? faMap.get(testDef.functionalArea) ?? null : null;
    await db.insert(tests).values({
      id: testId,
      repositoryId: REPO_ID,
      functionalAreaId: faId,
      name: testDef.name,
      code: testDef.code,
      targetUrl: testDef.targetUrl,
      description: testDef.description ?? null,
      executionMode: testDef.executionMode ?? 'procedural',
      agentPrompt: testDef.agentPrompt ?? null,
      setupOverrides: testDef.setupOverrides ?? null,
      teardownOverrides: testDef.teardownOverrides ?? null,
      viewportOverride: testDef.viewportOverride ?? null,
      diffOverrides: testDef.diffOverrides ?? null,
      playwrightOverrides: testDef.playwrightOverrides ?? null,
      stabilizationOverrides: testDef.stabilizationOverrides ?? null,
      createdAt: now,
      updatedAt: now,
    });

    // Create initial test version
    await db.insert(testVersions).values({
      id: uuid(),
      testId,
      version: 1,
      code: testDef.code,
      name: testDef.name,
      targetUrl: testDef.targetUrl,
      changeReason: 'manual_edit',
      createdAt: now,
    });

    console.log(`  Created test: ${testDef.name}`);
  }

  console.log(`\n✅ Seeded ${TEST_DEFINITIONS.length} tests and ${FUNCTIONAL_AREA_DEFINITIONS.length} functional areas`);
}

seed().catch(console.error).finally(() => process.exit(0));
