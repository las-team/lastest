/**
 * Seed script for Excalidraw visual regression tests
 *
 * Populates the lastest2 repository with 28 Excalidraw tests.
 * Generated from production database dump (2026-03-08).
 *
 * Run: pnpm db:seed
 */

import { db } from '../src/lib/db';
import { tests, testVersions, repositories, functionalAreas } from '../src/lib/db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';

const EXCALIDRAW_REPO_NAME = 'dexilion-team/excalidraw';

// Will be set dynamically
let REPO_ID: string;

// Functional area definitions
const FUNCTIONAL_AREA_DEFINITIONS = [
  { name: "Arrows binding to bindables" },
];

// Test definitions with complete code
const TEST_DEFINITIONS: Array<{ name: string; code: string; targetUrl: string; functionalArea?: string }> = [
  {
    name: "Multipoint simple arrows bind and track",
    targetUrl: "https://excalidraw-lastest.vercel.app", functionalArea: "Arrows binding to bindables",
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
  await replayCursorPath(page, [[485,683,0],[478,644,36],[471,573,57],[472,509,40],[473,504,67],[474,503,33]]);
  await replayCursorPath(page, [[498,457,71],[554,364,39],[582,332,39],[580,333,351],[552,348,33]]);
  await replayCursorPath(page, [[524,357,103],[511,359,47],[503,362,2672]]);
  await replayCursorPath(page, [[357,438,32],[356,439,47],[355,441,39],[352,450,43],[350,454,33],[348,456,34],[346,458,44],[346,458,56],[346,458,217],[346,458,67]]);
  await page.mouse.move(346, 458);
  await page.mouse.down();
  await replayCursorPath(page, [[346,458,83],[346,457,217],[350,454,39],[363,444,45],[376,434,51],[383,428,101],[393,421,39],[397,417,57],[400,413,44],[405,406,44],[408,400,45],[410,397,46],[412,392,44],[416,386,66],[419,382,51],[430,370,31],[438,360,62],[453,342,39],[457,337,229],[463,328,37],[468,319,179],[468,319,37],[470,317,121],[474,309,48],[474,308,43],[475,308,34]]);
  await page.mouse.move(475, 308);
  await page.mouse.up();
  await replayCursorPath(page, [[475,307,318],[476,290,70],[479,277,139],[479,276,489],[479,276,368],[479,266,50],[484,223,49],[499,160,32],[504,136,34],[506,128,33],[507,116,242],[515,89,44],[523,64,33]]);
  await replayCursorPath(page, [[526,53,43],[527,51,46],[527,48,47],[527,45,65],[527,42,66]]);
  await page.mouse.move(527, 42);
  await page.mouse.down();
  await replayCursorPath(page, [[527,42,33]]);
  await page.mouse.move(527, 42);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(520, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(514, 40);
  await replayCursorPath(page, [[526,44,289]]);
  await replayCursorPath(page, [[515,61,59],[484,123,35],[462,171,34],[439,230,49],[430,251,34],[424,261,94],[423,264,206],[409,291,32],[387,338,35],[359,398,51],[337,458,31],[334,467,44],[334,467,40],[334,467,32],[334,467,83],[334,469,33],[333,470,38]]);
  await page.mouse.move(333, 470);
  await page.mouse.down();
  await replayCursorPath(page, [[333,470,148],[335,448,44],[350,404,49],[373,341,46],[398,277,43],[406,259,50]]);
  await page.mouse.move(406, 259);
  await page.mouse.up();
  await replayCursorPath(page, [[406,261,1310],[408,295,64],[413,397,39],[410,414,92],[413,408,162],[447,354,215],[599,88,136],[593,78,50],[580,61,72]]);
  await replayCursorPath(page, [[561,40,43],[559,37,52],[558,35,55]]);
  await page.mouse.move(558, 35);
  await page.mouse.down();
  await page.mouse.move(558, 35);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(560, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(554, 40);
  await replayCursorPath(page, [[558,35,255],[560,35,60]]);
  await replayCursorPath(page, [[561,50,45],[561,66,33],[548,171,33],[541,216,33],[519,331,123],[508,357,579],[502,372,35],[463,472,47],[454,491,58],[447,509,43],[447,509,66],[458,501,60],[463,494,41],[470,486,35],[484,466,59],[489,460,40],[493,456,38],[498,453,42],[503,450,56],[508,447,39],[509,446,41],[511,445,135]]);
  await page.mouse.move(511, 445);
  await page.mouse.down();
  await replayCursorPath(page, [[511,444,98],[516,422,34],[529,385,50],[557,313,48],[561,302,33],[562,300,37],[562,298,194],[566,290,39],[572,276,50],[587,247,94],[587,247,49],[587,247,54],[588,247,40],[588,246,44],[588,246,49]]);
  await page.mouse.move(588, 246);
  await page.mouse.up();
  await page.keyboard.press('4');
  await replayCursorPath(page, [[588,254,1829],[604,311,139],[663,427,94],[664,433,60],[665,443,45],[666,451,42],[666,454,37],[666,455,56],[666,455,166],[669,450,33]]);
  await page.mouse.move(669, 450);
  await page.mouse.down();
  await replayCursorPath(page, [[669,450,334],[669,448,32],[670,445,35],[673,427,51],[677,405,47],[684,356,85],[688,335,38],[689,330,28],[690,326,34],[696,309,62],[700,298,38],[703,286,53],[704,281,44],[704,280,52],[705,279,51],[705,274,57],[705,274,208],[705,273,158],[708,272,37],[718,269,51],[724,267,54],[727,267,34],[736,264,50],[739,262,54],[741,261,62],[744,261,50],[744,261,60],[746,261,42],[747,261,99],[749,261,33],[750,261,84],[752,261,50],[754,262,40],[754,262,110]]);
  await page.mouse.move(754, 262);
  await page.mouse.up();
  await replayCursorPath(page, [[754,261,1910],[777,216,41],[821,133,33],[840,102,33]]);
  await replayCursorPath(page, [[882,38,33],[895,25,109],[895,26,307]]);
  await replayCursorPath(page, [[895,33,33],[895,35,33]]);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(893, 34);
  await replayCursorPath(page, [[895,36,1284]]);
  await replayCursorPath(page, [[895,41,34],[895,46,33],[893,65,40],[887,90,45],[881,100,55],[875,104,81],[872,104,45]]);
  await replayCursorPath(page, [[869,98,184],[868,97,170]]);
  await page.mouse.move(868, 97);
  await page.mouse.down();
  await page.mouse.move(868, 97);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(819, 94);
  await replayCursorPath(page, [[868,98,758],[869,105,71],[874,144,43],[879,198,57],[879,226,75],[880,253,43],[881,261,34]]);
  await page.mouse.move(881, 262);
  await page.mouse.down();
  await replayCursorPath(page, [[881,262,600],[890,287,42],[931,402,39],[941,413,79],[955,421,45],[966,425,47],[977,430,45],[986,434,51],[990,436,51]]);
  await page.mouse.move(991, 437);
  await page.mouse.up();
  await replayCursorPath(page, [[991,437,1148],[978,424,53],[856,343,50],[797,329,32],[748,327,58],[747,326,260],[688,269,33],[595,177,33],[552,89,74],[552,73,208],[557,70,52]]);
  await replayCursorPath(page, [[595,59,49],[610,58,60],[620,55,41],[624,50,33],[625,47,34],[627,40,65],[631,36,46]]);
  await replayCursorPath(page, [[634,35,36]]);
  await page.mouse.move(634, 35);
  await page.mouse.down();
  await page.mouse.move(634, 35);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[633,35,1068]]);
  await replayCursorPath(page, [[630,38,37],[560,105,35],[430,254,45],[389,312,36],[324,413,33],[310,435,37],[309,444,277],[309,467,40],[314,511,44],[317,530,33],[317,544,69],[316,548,46],[311,551,51],[300,557,46],[294,561,37],[291,565,34],[289,568,52],[289,569,32],[288,571,41],[286,573,42],[285,577,33],[283,581,33],[283,584,34],[282,587,60]]);
  await page.mouse.move(282, 587);
  await page.mouse.down();
  await page.mouse.move(282, 587);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[286,587,425],[298,587,42],[327,589,56],[336,591,38],[345,592,55],[348,592,79],[353,592,41],[357,589,52],[363,584,44],[365,583,40],[367,581,34],[368,581,38]]);
  await page.mouse.move(368, 581);
  await page.mouse.down();
  await page.mouse.move(368, 581);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[368,580,712],[368,576,33],[368,566,63],[368,552,37],[368,548,38],[369,543,136],[370,535,380],[372,505,34],[372,504,47],[372,502,67],[372,497,50],[372,495,56],[372,493,35],[372,491,59],[372,487,41],[372,484,46],[372,481,115],[372,479,38],[372,476,63],[372,476,863],[372,476,67]]);
  await page.mouse.move(372, 476);
  await page.mouse.down();
  await page.mouse.move(372, 476);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[375,469,1120],[380,457,36],[385,432,64],[388,423,56],[390,419,38],[392,416,36],[394,413,300],[400,407,61],[402,403,39],[404,401,34],[407,396,65],[408,394,34],[409,394,49]]);
  await page.mouse.move(409, 393);
  await page.mouse.down();
  await replayCursorPath(page, [[409,393,732],[408,393,50],[408,393,50],[407,393,36],[406,393,41],[404,393,59],[404,393,48],[403,393,56],[402,393,64],[401,393,52],[401,393,48],[400,393,41],[399,393,56],[399,393,49],[399,393,34],[398,393,38],[398,394,69],[397,394,44],[397,394,41],[396,394,52],[395,394,45],[386,396,52],[383,397,43],[381,397,65],[379,397,40],[377,397,57],[372,398,63],[368,398,41],[365,398,50],[364,398,66],[363,398,52],[361,397,34],[360,396,42],[358,396,39],[356,396,41],[345,401,59],[343,403,55],[342,403,45],[342,403,93],[341,403,47],[341,403,44]]);
  await page.mouse.move(341, 403);
  await page.mouse.up();
  await replayCursorPath(page, [[341,408,733],[340,437,46],[339,479,39],[339,502,35],[345,555,65],[346,556,49],[346,556,217],[346,556,33],[346,555,168],[350,553,32],[376,532,34],[413,507,34],[443,484,33],[465,468,53],[479,458,51],[480,458,46],[480,457,92],[486,454,41],[500,446,34],[522,427,35],[554,387,33],[594,317,34],[612,272,248],[616,198,35],[619,144,60],[624,108,35],[626,101,33],[630,96,34],[635,88,33],[637,84,35],[642,71,51],[644,64,32]]);
  await replayCursorPath(page, [[644,50,45],[644,42,55],[644,40,60]]);
  await page.mouse.move(644, 40);
  await page.mouse.down();
  await page.mouse.move(644, 40);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[644,40,231],[643,42,42],[643,43,43]]);
  await replayCursorPath(page, [[643,46,41],[634,71,50],[621,107,33],[603,157,34],[589,201,34],[557,345,46],[551,415,62],[547,456,41],[546,469,284],[543,545,91],[539,577,34],[531,579,81],[513,587,44],[502,592,33],[493,596,34],[487,597,33],[483,596,50],[481,595,39],[481,595,65]]);
  await page.mouse.move(481, 595);
  await page.mouse.down();
  await page.mouse.move(481, 595);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[495,591,256],[525,578,57],[535,571,32],[544,566,40],[550,563,217],[563,553,39],[568,551,43],[569,551,45],[570,550,41],[570,549,57],[570,549,46],[571,548,37],[572,548,39],[573,546,49],[574,545,35],[574,544,40],[575,544,95]]);
  await page.mouse.move(575, 544);
  await page.mouse.down();
  await page.mouse.move(575, 544);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[575,542,242],[575,537,40],[574,507,61],[570,471,51],[567,464,52],[567,464,41],[564,461,46],[563,461,46],[563,461,48],[563,461,33],[563,460,33],[562,460,56],[562,459,56],[561,458,60],[560,456,48],[560,456,69],[560,455,37],[560,454,53],[559,454,39],[559,454,34],[559,454,41],[558,453,42],[558,452,35],[558,451,57],[558,451,33],[557,450,41],[557,450,44],[557,449,36],[556,449,39],[556,448,49],[556,448,34],[556,448,682],[555,447,41]]);
  await page.mouse.move(555, 447);
  await page.mouse.down();
  await page.mouse.move(555, 447);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[555,446,566],[558,442,42],[562,437,41],[567,430,47],[569,426,63],[570,423,337],[570,414,33],[571,404,35],[571,392,60],[571,389,50],[571,389,33],[572,389,104],[572,388,66],[572,388,65]]);
  await page.mouse.move(572, 388);
  await page.mouse.down();
  await replayCursorPath(page, [[571,388,342],[570,388,103],[566,388,44],[565,388,60],[564,388,35],[564,388,58],[563,388,143],[563,388,32],[563,388,232],[562,388,42],[561,388,52],[561,388,51],[560,388,54],[560,388,41],[559,389,38],[559,389,44],[558,389,63],[558,389,40],[557,389,60],[555,389,39],[553,390,118],[551,391,38],[550,391,42],[549,391,42],[548,391,52],[547,392,92],[545,392,87],[545,392,73],[545,392,126],[544,392,33],[543,393,65],[540,393,59],[540,394,50],[539,394,44],[538,394,108],[533,395,55]]);
  await page.mouse.move(533, 395);
  await page.mouse.up();
  await replayCursorPath(page, [[534,394,389],[588,307,135],[654,201,206],[647,143,62],[641,97,34],[640,90,71],[640,83,39],[639,79,52],[639,72,39],[640,62,49]]);
  await replayCursorPath(page, [[640,48,43],[640,47,32],[640,44,59]]);
  await page.mouse.move(640, 44);
  await page.mouse.down();
  await page.mouse.move(640, 44);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[641,56,646],[679,448,32],[703,536,64],[703,539,340],[696,543,113],[682,562,38],[681,568,33],[681,570,110]]);
  await page.mouse.move(681, 570);
  await page.mouse.down();
  await page.mouse.move(681, 570);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[682,568,170],[691,556,40],[701,537,45],[706,526,50],[711,516,67],[713,512,37],[731,497,73],[746,491,48],[751,489,39],[755,488,36],[759,487,39],[761,487,64],[765,487,41]]);
  await page.mouse.move(767, 487);
  await page.mouse.down();
  await page.mouse.move(767, 487);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[766,485,490],[763,481,37],[761,478,37],[756,472,40],[752,468,36],[750,467,34],[745,461,56],[743,460,35],[740,458,37],[738,456,50],[735,454,51],[734,453,36],[733,452,36],[732,451,87],[731,450,45],[730,450,58],[730,450,94],[729,450,46],[728,450,52],[728,450,50],[727,450,61],[727,450,332],[724,449,41],[723,449,49]]);
  await page.mouse.move(723, 449);
  await page.mouse.down();
  await page.mouse.move(723, 449);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[724,449,1403],[733,453,50],[745,458,65],[760,460,58],[763,453,40],[766,439,149],[766,433,52],[764,429,105],[750,407,51],[744,397,45],[743,395,35],[743,393,32],[743,393,50],[743,393,83],[745,393,123],[750,395,44],[750,395,66],[750,395,51]]);
  await page.mouse.move(750, 395);
  await page.mouse.down();
  await replayCursorPath(page, [[750,395,343],[742,396,39],[733,397,34],[730,398,44],[724,398,41],[723,398,54],[721,398,88],[720,398,40],[720,398,76],[719,398,42],[718,398,46],[717,398,69],[716,398,42],[714,398,49],[713,398,92],[707,399,51],[706,399,38],[705,399,44]]);
  await page.mouse.move(705, 399);
  await page.mouse.up();
  await replayCursorPath(page, [[706,399,510],[774,384,53],[795,360,61],[806,303,147],[824,201,112],[826,204,49],[820,180,130],[744,69,36],[728,62,65],[706,60,37]]);
  await replayCursorPath(page, [[690,58,87],[662,52,40],[659,51,39],[654,49,116]]);
  await replayCursorPath(page, [[652,48,43]]);
  await page.mouse.move(649, 47);
  await page.mouse.down();
  await page.mouse.move(649, 47);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(652, 46);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[653,47,94],[660,50,36],[679,57,64]]);
  await replayCursorPath(page, [[735,86,46],[802,147,154],[936,489,59],[941,510,56],[943,522,32],[943,523,217],[942,531,34],[929,553,71],[910,568,50],[903,572,118]]);
  await page.mouse.move(893, 576);
  await page.mouse.down();
  await replayCursorPath(page, [[893,576,111]]);
  await page.mouse.move(893, 576);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[964,523,386],[967,519,65],[975,505,42],[976,504,42],[976,503,53],[976,503,61]]);
  await page.mouse.move(976, 503);
  await page.mouse.down();
  await page.mouse.move(976, 503);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[975,498,710],[970,488,66],[962,478,56],[955,473,63],[952,471,81],[948,469,44],[945,467,46],[944,467,40],[943,466,44],[942,465,71],[940,463,37],[939,461,41],[937,458,50],[937,457,50],[936,453,429],[932,446,113],[926,439,44],[924,438,42],[924,438,141],[923,438,49],[923,438,551],[923,438,48]]);
  await page.mouse.move(923, 438);
  await page.mouse.down();
  await page.mouse.move(923, 438);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[923,449,1235],[911,528,383],[911,517,40],[908,486,81],[908,449,39],[910,428,40],[910,418,33],[910,411,34],[910,409,50],[910,409,150],[910,409,42],[907,413,41],[906,417,52],[904,424,38],[903,425,42],[903,425,100],[903,427,317],[902,477,107],[911,558,48],[912,561,63],[912,559,185],[912,544,52],[912,533,46],[912,530,90],[913,524,43],[913,524,84]]);
  await page.mouse.move(913, 524);
  await page.mouse.down();
  await replayCursorPath(page, [[913,523,334],[913,516,63],[914,502,51],[920,484,44],[926,469,60],[927,466,48],[928,464,34],[929,462,64],[929,461,51],[931,458,234],[936,451,32],[936,451,57],[936,450,49],[938,446,42],[938,446,68],[938,444,41],[939,443,43],[940,441,50],[940,440,469],[940,440,48],[940,440,38]]);
  await page.mouse.move(940, 440);
  await page.mouse.up();
  await replayCursorPath(page, [[940,440,746],[936,441,35],[909,444,93],[880,443,57],[878,441,48],[877,433,74],[877,427,42],[877,425,34],[879,421,50],[880,419,31],[881,418,70],[881,418,60],[881,417,56],[882,417,50]]);
  await page.mouse.move(882, 417);
  await page.mouse.down();
  await replayCursorPath(page, [[881,417,409],[879,417,40],[874,417,59],[872,418,41],[868,418,52],[866,418,48],[865,418,41],[864,419,42],[863,419,33],[861,419,54],[860,419,52],[859,419,46],[858,419,53],[858,420,46],[857,420,136],[856,420,41],[855,420,38],[855,420,50],[854,421,40],[853,421,36],[852,421,44],[851,421,48],[851,421,36],[850,422,63],[850,422,44],[849,422,57]]);
  await page.mouse.move(849, 422);
  await page.mouse.up();
  await replayCursorPath(page, [[849,422,735],[841,521,49],[839,655,50]]);
}
`,
  },
  {
    name: "New elbow arrow binds and tracks bindables",
    targetUrl: "https://excalidraw-lastest.vercel.app", functionalArea: "Arrows binding to bindables",
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
    name: "New simple arrow binds and tracks",
    targetUrl: "https://excalidraw.com", functionalArea: "Arrows binding to bindables",
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
  await replayCursorPath(page, [[543,434,0],[524,428,41],[443,390,38],[427,382,70],[420,365,33],[420,360,67],[420,355,186],[445,196,38],[483,106,45]]);
  await replayCursorPath(page, [[507,53,58]]);
  await replayCursorPath(page, [[514,42,229],[524,33,65],[526,33,31]]);
  await page.mouse.move(527, 33);
  await page.mouse.down();
  await page.mouse.move(527, 33);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(520, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(514, 40);
  await replayCursorPath(page, [[526,33,516]]);
  await replayCursorPath(page, [[511,43,34],[456,80,50],[434,97,39],[378,147,63],[368,158,124],[363,160,40],[354,165,34],[347,168,34],[337,174,145],[323,188,63]]);
  await page.mouse.move(323, 188);
  await page.mouse.down();
  await replayCursorPath(page, [[325,188,540],[333,191,39],[374,222,50],[406,250,48],[431,272,62],[438,278,51],[446,284,53],[450,287,41],[456,290,48],[462,294,37],[465,296,72],[467,298,41]]);
  await page.mouse.move(468, 298);
  await page.mouse.up();
  await replayCursorPath(page, [[468,297,1585],[473,257,35],[491,199,57],[530,124,34],[551,95,32],[559,87,54],[602,62,101]]);
  await replayCursorPath(page, [[625,55,43],[632,55,50],[642,58,63],[643,57,40]]);
  await replayCursorPath(page, [[645,46,59],[648,39,64]]);
  await page.mouse.move(648, 38);
  await page.mouse.down();
  await page.mouse.move(648, 38);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[647,39,326],[641,44,72],[633,49,61],[615,61,35],[585,82,38],[480,142,61],[428,181,36],[395,223,52],[367,263,45],[359,276,32],[331,322,66],[326,328,68],[325,338,274],[322,378,42],[322,381,41],[323,381,97],[328,383,58],[331,385,55],[341,393,50],[343,395,52],[345,397,48],[345,397,116],[345,399,85],[345,401,31],[345,402,43],[345,403,53],[345,405,38],[345,407,47],[345,408,53],[345,408,44]]);
  await page.mouse.move(345, 408);
  await page.mouse.down();
  await replayCursorPath(page, [[345,408,373],[345,408,42],[345,400,56],[348,392,36],[351,381,46],[357,363,38],[360,358,88],[369,338,40],[376,324,42],[378,320,58],[379,319,52],[380,318,62],[380,317,46],[381,317,741],[382,314,38],[383,312,231],[384,311,40],[384,310,245],[384,309,76],[385,307,41],[386,307,132],[386,307,49],[386,307,113],[386,306,44]]);
  await page.mouse.move(386, 306);
  await page.mouse.up();
  await replayCursorPath(page, [[386,306,680],[415,318,147],[515,369,35],[558,389,68],[567,391,262],[568,371,56],[554,325,35],[530,298,63],[518,288,49],[516,285,33],[516,283,37],[518,269,45],[521,261,33],[522,257,34],[522,257,34],[522,254,67],[527,242,34],[563,192,32],[579,172,61],[600,149,120],[600,149,100],[590,121,52],[579,95,34],[573,84,32],[560,80,56],[525,100,44],[486,130,33],[451,167,51],[436,195,42],[436,204,60],[437,221,49],[442,225,44],[448,228,39],[453,230,34],[456,231,32],[458,232,34],[461,234,33],[462,234,49],[463,234,34],[464,234,49],[466,234,35],[467,235,67]]);
  await page.mouse.move(468, 235);
  await page.mouse.down();
  await replayCursorPath(page, [[467,235,400],[466,235,33],[465,235,35],[464,235,47],[462,235,57],[460,235,36],[458,235,40],[457,235,50],[455,235,35],[454,235,45],[454,235,53],[453,235,118],[452,235,40],[452,235,42],[451,235,100],[451,235,131],[451,235,70],[450,235,34],[450,235,39],[447,235,66],[444,236,43],[444,236,34],[442,236,51],[442,236,67],[442,236,116]]);
  await page.mouse.move(442, 236);
  await page.mouse.up();
  await replayCursorPath(page, [[444,234,117],[461,216,51],[537,105,49]]);
  await replayCursorPath(page, [[576,17,92],[580,6,42],[580,5,64],[580,6,117],[575,12,34]]);
  await replayCursorPath(page, [[566,23,48],[560,30,86],[559,31,35]]);
  await page.mouse.move(559, 32);
  await page.mouse.down();
  await page.mouse.move(559, 32);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(560, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(554, 40);
  await replayCursorPath(page, [[562,35,760]]);
  await replayCursorPath(page, [[569,62,34],[572,98,37],[574,134,35],[570,164,33],[563,182,66],[559,190,34],[555,195,47],[551,196,35],[543,195,50],[537,193,34],[535,192,33],[534,192,127]]);
  await page.mouse.move(534, 192);
  await page.mouse.down();
  await replayCursorPath(page, [[534,193,587],[542,210,44],[559,240,48],[570,256,45],[581,267,35],[593,277,38],[598,282,43],[602,285,41],[604,287,39],[605,288,36],[607,290,45],[608,292,50],[609,294,54],[610,296,70],[610,298,58],[611,298,73],[611,298,734],[612,298,45],[613,298,141],[613,298,248],[614,298,69],[621,300,57],[623,301,41],[626,303,67],[627,303,44],[628,303,118]]);
  await page.mouse.move(628, 304);
  await page.mouse.up();
  await replayCursorPath(page, [[628,296,381],[626,271,59],[617,170,198],[624,106,104],[642,73,158]]);
  await replayCursorPath(page, [[644,50,41],[644,45,79],[644,42,50],[644,42,67],[644,42,32]]);
  await page.mouse.move(644, 42);
  await page.mouse.down();
  await page.mouse.move(644, 42);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[644,42,700],[643,43,33]]);
  await replayCursorPath(page, [[642,47,35],[635,67,50],[627,88,74],[602,152,41],[576,199,37],[555,238,50],[546,257,33],[540,274,43],[534,297,33],[532,306,42],[529,327,39],[526,344,33],[522,365,41],[520,372,51],[520,373,34],[520,374,49],[520,374,35]]);
  await page.mouse.move(520, 374);
  await page.mouse.down();
  await replayCursorPath(page, [[520,373,392],[520,371,40],[524,357,36],[528,343,97],[535,325,41],[538,319,35],[540,312,41],[542,309,38],[542,308,43],[545,302,37],[545,300,55],[546,297,36],[547,295,56],[547,295,34],[548,294,44],[548,293,40],[548,292,46],[550,290,36],[550,290,35],[551,288,135],[552,287,36],[552,287,84],[552,286,44],[553,285,53],[554,285,33],[555,284,40],[555,284,40],[555,284,54],[556,283,700],[560,282,39],[561,282,714]]);
  await page.mouse.move(561, 282);
  await page.mouse.up();
  await replayCursorPath(page, [[563,282,264],[573,284,36],[601,294,46],[616,303,87],[616,301,61],[614,296,36],[612,292,41],[610,285,51],[609,281,75],[609,280,47],[609,279,270],[609,279,48],[609,278,59],[608,276,62],[607,273,94],[607,273,54]]);
  await page.mouse.move(607, 273);
  await page.mouse.down();
  await replayCursorPath(page, [[607,273,246],[605,273,44],[600,273,38],[597,273,34],[593,273,34],[590,273,36],[586,274,46],[584,274,50],[582,274,33],[580,274,50],[578,274,46]]);
  await page.mouse.move(578, 273);
  await page.mouse.up();
  await replayCursorPath(page, [[578,273,795],[581,273,42],[584,273,45],[592,270,41],[601,263,32],[607,257,37],[641,206,56],[649,189,42],[650,183,248],[661,156,35],[666,138,35],[676,100,32],[677,89,33],[677,85,32],[674,81,35],[670,76,33],[667,73,33],[653,64,33]]);
  await replayCursorPath(page, [[638,58,37],[621,51,34],[609,47,37],[594,42,59],[588,39,49],[586,37,37],[585,36,46],[584,36,101],[585,36,133],[589,36,61],[590,37,54],[590,37,35]]);
  await page.mouse.move(590, 37);
  await page.mouse.down();
  await page.mouse.move(590, 37);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(600, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(594, 40);
  await replayCursorPath(page, [[591,38,277]]);
  await replayCursorPath(page, [[595,41,40],[602,49,33],[610,61,35],[616,73,44],[637,118,54],[642,141,41],[645,156,42],[646,169,33],[649,182,34],[652,194,34],[655,204,50],[655,206,51],[653,206,298],[652,205,33],[651,204,33],[651,201,35],[651,199,34],[651,198,39],[651,198,79]]);
  await page.mouse.move(651, 198);
  await page.mouse.down();
  await replayCursorPath(page, [[651,198,199],[653,207,39],[656,212,41],[668,234,53],[683,257,50],[696,272,47],[703,280,43],[706,282,57],[707,283,52],[707,283,40],[707,283,797],[712,285,41],[731,299,50],[741,303,42],[744,304,47],[746,304,40],[748,305,43],[750,305,62],[752,306,42],[753,306,42],[754,306,42],[754,306,59],[755,306,72],[755,306,97]]);
  await page.mouse.move(755, 306);
  await page.mouse.up();
  await replayCursorPath(page, [[747,286,390],[690,172,53],[658,95,42],[657,87,123],[655,70,228]]);
  await replayCursorPath(page, [[644,37,123]]);
  await page.mouse.move(643, 37);
  await page.mouse.down();
  await page.mouse.move(643, 37);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(643, 37);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[643,37,524]]);
  await replayCursorPath(page, [[643,43,33],[643,47,49],[641,73,34],[635,102,33],[625,141,34],[603,245,33],[589,311,36],[580,371,69],[580,376,47],[580,380,284],[581,403,49],[584,418,42],[584,419,137],[590,419,91],[597,416,39],[604,414,71]]);
  await page.mouse.move(604, 414);
  await page.mouse.down();
  await replayCursorPath(page, [[605,414,120],[605,413,38],[605,412,130],[610,400,40],[621,375,51],[639,351,55],[641,349,34],[645,343,51],[646,341,34],[651,334,46],[652,333,40],[653,330,298],[659,320,46],[660,319,46],[661,318,48],[661,317,109],[661,317,40],[662,316,77],[663,315,38],[663,315,73],[665,314,43],[668,311,174],[673,307,32],[673,306,131],[675,303,41],[675,302,38],[676,302,43],[676,301,88],[676,301,39],[676,300,59]]);
  await page.mouse.move(676, 300);
  await page.mouse.up();
  await replayCursorPath(page, [[682,292,1113],[695,269,156],[728,195,38],[733,172,245],[733,162,50],[733,155,36],[731,144,47],[731,141,33],[728,133,44],[727,130,40],[724,126,45],[721,123,61],[719,120,32],[720,118,155],[728,110,56],[742,97,34],[769,77,50],[780,71,37],[784,68,297]]);
  await replayCursorPath(page, [[793,59,49],[796,57,32],[801,53,35],[803,52,63],[803,48,61]]);
  await replayCursorPath(page, [[803,45,42],[803,44,33],[803,44,33],[803,43,118]]);
  await page.mouse.move(802, 43);
  await page.mouse.down();
  await page.mouse.move(802, 43);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(800, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(794, 40);
  await replayCursorPath(page, [[802,44,2250]]);
  await replayCursorPath(page, [[801,53,41],[788,110,40],[778,175,51],[773,207,35],[772,271,506],[774,268,114],[779,264,46],[779,264,33],[779,263,1001],[779,262,66],[782,255,33],[803,220,45],[825,180,55],[831,170,39],[839,152,36],[841,147,42],[845,138,32],[856,121,39],[864,111,46],[871,103,33],[873,101,33],[873,97,205],[875,90,45],[877,83,33],[880,74,51],[881,71,33],[883,67,33],[884,63,78]]);
  await replayCursorPath(page, [[885,57,36],[886,54,65],[888,49,38],[888,47,33]]);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(893, 38);
  await replayCursorPath(page, [[888,47,1283],[888,47,49],[888,48,51],[888,48,34],[887,49,32],[885,53,33],[883,55,33]]);
  await replayCursorPath(page, [[875,64,44],[871,68,39],[869,69,33],[864,71,53],[859,73,48],[856,74,83],[844,77,34]]);
  await replayCursorPath(page, [[834,82,33],[832,83,60],[824,87,42],[821,90,33],[819,92,50],[818,93,34]]);
  await page.mouse.move(818, 93);
  await page.mouse.down();
  await page.mouse.move(818, 93);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(790, 94);
  await replayCursorPath(page, [[818,93,1624],[833,132,36],[837,154,63],[839,176,60],[839,179,33],[839,184,33],[839,186,94]]);
  await page.mouse.move(840, 189);
  await page.mouse.down();
  await replayCursorPath(page, [[840,189,42],[840,189,80],[842,190,41],[850,197,42],[864,210,50],[868,215,33],[882,230,46],[897,244,62],[914,260,58],[918,264,37],[926,273,64],[927,274,387],[936,286,40],[941,292,161],[977,338,44],[997,358,45],[999,360,41],[1000,360,64]]);
  await page.mouse.move(1000, 360);
  await page.mouse.up();
  await replayCursorPath(page, [[998,360,513],[989,356,39],[963,342,34],[944,328,34],[871,269,32],[814,197,35],[779,129,48],[771,107,34],[768,98,34],[767,97,275],[750,68,41]]);
  await replayCursorPath(page, [[740,52,33],[734,44,38],[724,37,66],[712,35,46]]);
  await replayCursorPath(page, [[698,34,51],[689,34,48],[676,32,33],[669,30,39],[662,28,51],[654,27,43],[653,27,35],[651,27,33],[650,27,51],[649,28,47]]);
  await replayCursorPath(page, [[646,31,53],[644,32,32]]);
  await page.mouse.move(644, 33);
  await page.mouse.down();
  await page.mouse.move(644, 33);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[644,33,517],[646,35,73]]);
  await replayCursorPath(page, [[659,65,45],[665,94,33],[673,155,49],[686,222,64],[692,231,40],[692,231,178],[692,231,57],[713,325,61],[730,407,39],[739,453,94],[752,530,200],[752,537,35],[752,583,50],[752,586,33],[752,588,32],[753,588,67],[754,585,48],[756,582,35]]);
  await page.mouse.move(757, 580);
  await page.mouse.down();
  await replayCursorPath(page, [[757,580,79],[758,576,43],[761,569,37],[766,559,34],[777,536,40],[788,518,38],[803,495,38],[823,465,40],[853,425,50],[863,411,38],[868,405,42],[869,404,290],[869,402,211],[870,391,33],[870,390,53],[870,389,70],[870,388,85],[870,386,346],[870,386,63],[870,377,53],[870,375,50],[870,374,435],[870,373,54],[870,372,33],[870,370,54],[870,368,67],[870,368,55],[870,367,47],[870,367,56],[870,366,38]]);
  await page.mouse.move(870, 366);
  await page.mouse.up();
  await replayCursorPath(page, [[872,366,849],[894,362,45],[900,362,43],[905,362,82],[906,362,43],[906,362,268],[906,362,49],[906,361,51],[906,361,65],[906,361,35],[906,361,49],[906,360,48]]);
  await page.mouse.move(906, 360);
  await page.mouse.down();
  await replayCursorPath(page, [[906,360,335],[905,360,39],[902,360,62],[899,360,51],[897,360,41],[896,360,56],[896,360,40],[895,360,57],[895,360,53],[894,360,33],[893,360,39],[892,360,62],[892,360,49],[892,360,68],[891,360,174],[888,360,34],[887,360,61],[885,360,185],[880,360,179],[881,360,72]]);
  await page.mouse.move(881, 360);
  await page.mouse.up();
  await replayCursorPath(page, [[881,361,212],[883,381,35],[876,482,43],[864,551,39],[856,582,54],[810,691,55],[802,704,40],[799,710,35],[798,711,43],[798,714,222]]);
}
`,
  },
  {
    name: "Old arrows can bind to bindables and track",
    targetUrl: "https://excalidraw-lastest.vercel.app", functionalArea: "Arrows binding to bindables",
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
  await replayCursorPath(page, [[561,489,0],[1002,187,54],[1036,172,660],[1028,176,34],[981,194,49],[922,211,93],[893,215,60],[889,215,366],[749,243,49],[675,260,101],[658,263,2180],[666,263,169],[677,299,49],[677,308,38],[677,313,57],[677,313,38],[677,312,65],[677,298,65],[677,291,52],[679,287,33],[681,284,34],[687,286,59],[690,295,41],[690,304,48],[689,311,46],[682,317,40],[680,317,60],[680,317,90],[681,316,34],[681,316,57],[681,314,40],[679,302,35],[668,263,67],[656,225,33],[647,188,34],[643,163,32],[642,145,34],[642,134,33],[642,129,233],[635,111,34],[601,62,59]]);
  await replayCursorPath(page, [[587,46,43],[584,44,71],[575,40,38],[575,40,55]]);
  await replayCursorPath(page, [[571,40,416],[526,38,28],[526,37,39],[526,37,35],[525,37,50],[525,37,32],[524,37,34],[523,37,33],[523,37,35]]);
  await page.mouse.move(523, 37);
  await page.mouse.down();
  await page.mouse.move(523, 37);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(520, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(514, 40);
  await replayCursorPath(page, [[523,38,534]]);
  await replayCursorPath(page, [[522,51,33],[506,106,52],[482,171,33],[468,195,48],[445,206,34],[388,221,49],[356,228,54],[332,230,62],[327,228,280],[277,197,35],[249,164,67],[246,158,69],[246,159,166],[246,159,33],[247,161,34],[247,163,33],[248,164,35],[248,165,32]]);
  await page.mouse.move(248, 165);
  await page.mouse.down();
  await replayCursorPath(page, [[248,165,57],[248,165,112],[257,172,42],[278,188,43],[317,218,41],[354,245,50],[370,258,36],[386,270,46],[400,281,52],[411,292,54],[421,302,43],[424,307,38],[425,309,51],[426,309,52],[426,309,47],[426,309,36]]);
  await page.mouse.move(426, 309);
  await page.mouse.up();
  await replayCursorPath(page, [[426,308,803],[454,265,53],[504,173,51],[513,147,44],[517,125,42],[522,106,40],[524,101,34],[531,88,47],[532,86,186],[538,78,33]]);
  await replayCursorPath(page, [[554,58,59],[562,47,39],[563,46,42],[563,46,39],[563,43,106]]);
  await replayCursorPath(page, [[563,41,64]]);
  await page.mouse.move(563, 41);
  await page.mouse.down();
  await page.mouse.move(563, 41);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(560, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(554, 40);
  await replayCursorPath(page, [[563,42,333]]);
  await replayCursorPath(page, [[563,71,51],[562,100,283],[524,188,34],[519,178,50],[519,177,35],[519,177,32],[519,176,34],[519,175,65],[518,175,49],[518,175,36],[514,175,49],[514,175,32]]);
  await page.mouse.move(514, 175);
  await page.mouse.down();
  await replayCursorPath(page, [[514,175,37],[514,175,213],[523,185,38],[537,205,47],[558,239,65],[578,273,52],[580,278,34],[583,285,40],[583,285,190],[585,287,59],[586,290,84],[587,290,57],[587,290,34],[587,290,43],[588,291,56],[590,293,44],[592,295,51],[598,301,52],[602,304,50],[603,305,62],[603,305,49],[603,305,60],[604,305,36],[608,305,34],[613,307,70],[615,309,42],[625,314,61],[635,318,42],[641,321,35],[643,321,63],[646,323,83]]);
  await page.mouse.move(646, 323);
  await page.mouse.up();
  await replayCursorPath(page, [[646,321,481],[644,306,36],[639,271,34],[634,224,32],[629,157,33],[626,140,33],[625,131,34],[620,115,86],[610,95,50],[607,87,45],[604,75,37],[602,66,34]]);
  await replayCursorPath(page, [[601,56,49],[601,53,35],[601,49,33],[601,47,44],[601,45,38],[601,43,34],[601,41,72]]);
  await page.mouse.move(601, 41);
  await page.mouse.down();
  await page.mouse.move(601, 41);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(600, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(594, 40);
  await replayCursorPath(page, [[603,41,378]]);
  await replayCursorPath(page, [[628,68,65],[675,144,35],[724,246,54],[724,242,229],[723,225,34],[719,185,49],[719,172,34],[719,170,32],[719,169,44],[720,165,40],[721,164,35],[722,162,33],[723,162,49],[723,162,50],[723,161,33],[724,161,67]]);
  await page.mouse.move(724, 161);
  await page.mouse.down();
  await replayCursorPath(page, [[724,161,135],[730,168,44],[746,194,36],[758,215,41],[769,234,49],[774,241,63],[782,250,51],[786,254,52],[796,264,79],[804,269,27],[808,273,41],[811,275,37],[814,278,60],[818,284,51],[821,290,116],[824,295,36],[837,308,63],[848,318,160],[864,326,42],[871,329,38],[873,330,40],[877,333,39],[879,335,48],[879,336,34],[881,337,44],[884,347,49],[885,352,52],[885,354,55],[886,356,52]]);
  await page.mouse.move(886, 356);
  await page.mouse.up();
  await replayCursorPath(page, [[885,353,636],[883,349,32],[852,266,49],[831,189,34],[822,136,31],[819,109,34],[817,95,36],[816,92,198],[818,84,34]]);
  await replayCursorPath(page, [[829,57,41],[841,44,100],[841,44,43]]);
  await replayCursorPath(page, [[849,42,67],[861,41,49],[864,41,42],[865,41,41],[866,41,54],[874,40,44]]);
  await replayCursorPath(page, [[877,41,38],[881,43,52],[882,43,94],[885,43,45]]);
  await replayCursorPath(page, [[890,43,73],[891,43,83]]);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(890, 41);
  await replayCursorPath(page, [[891,43,978]]);
  await replayCursorPath(page, [[890,45,33],[877,57,70],[859,81,36],[850,90,47],[843,99,37]]);
  await replayCursorPath(page, [[838,104,36],[826,121,31],[823,127,170]]);
  await replayCursorPath(page, [[808,165,43],[805,178,33],[805,178,34]]);
  await replayCursorPath(page, [[805,170,160],[808,127,43],[808,127,48],[808,126,35],[807,122,59],[807,120,39],[806,120,69],[806,119,215]]);
  await replayCursorPath(page, [[806,116,35],[806,109,57],[806,107,41],[806,107,34],[806,106,33],[806,105,51],[806,105,32],[806,104,50]]);
  await replayCursorPath(page, [[805,102,114],[805,102,53],[805,102,67],[805,101,50],[805,101,67]]);
  await page.mouse.move(805, 101);
  await page.mouse.down();
  await page.mouse.move(805, 101);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(790, 94);
  await replayCursorPath(page, [[838,109,571],[876,131,45],[909,157,34],[928,177,33],[936,186,35],[939,188,349],[948,188,41],[949,189,43],[950,188,76],[950,183,32],[950,176,32],[951,173,42],[952,171,31],[954,168,34],[955,166,50],[956,165,51],[961,161,86],[962,158,67],[963,157,31]]);
  await page.mouse.move(963, 157);
  await page.mouse.down();
  await replayCursorPath(page, [[963,157,72],[963,157,95],[969,160,48],[984,175,35],[995,188,48],[1003,199,33],[1012,209,34],[1021,219,33],[1031,231,42],[1050,253,107],[1077,280,39],[1087,291,61],[1091,297,41],[1091,298,229],[1096,306,45],[1106,326,99],[1112,340,39],[1113,345,47],[1113,346,370],[1114,350,49],[1115,352,34],[1118,361,49],[1119,362,66]]);
  await page.mouse.move(1119, 362);
  await page.mouse.up();
  await replayCursorPath(page, [[1118,362,902],[1112,359,39],[1102,350,44],[1095,341,33],[1093,338,34],[1090,326,38],[1090,324,44],[1090,322,49],[1089,322,33],[1089,322,48],[1087,319,36],[1070,301,32],[1008,244,34],[881,154,52],[848,134,33],[835,124,34],[833,124,232],[801,104,35]]);
  await replayCursorPath(page, [[702,57,44],[649,43,45],[630,42,44],[629,42,49],[628,43,32],[628,43,35],[629,43,67],[629,43,32],[629,43,101]]);
  await page.mouse.move(629, 43);
  await page.mouse.down();
  await page.mouse.move(629, 43);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[620,56,504],[516,171,62],[401,315,35],[389,334,36],[367,376,45],[359,389,41],[351,399,44],[334,414,49],[318,428,34],[309,437,34],[307,440,33],[306,443,301],[302,453,33],[295,472,33],[292,491,37],[292,500,47],[292,515,62],[291,521,37],[290,523,34],[289,528,33],[288,536,50],[288,538,33],[288,539,32]]);
  await page.mouse.move(288, 539);
  await page.mouse.down();
  await replayCursorPath(page, [[288,539,167],[288,529,38],[288,512,45],[288,494,73],[290,466,60],[295,437,68],[305,405,31],[309,395,34],[311,391,43],[318,380,57],[330,366,48],[333,361,203]]);
  await page.mouse.move(333, 361);
  await page.mouse.up();
  await replayCursorPath(page, [[333,362,904],[346,372,56],[366,375,45],[403,370,46],[513,294,56],[569,243,32],[615,195,50],[617,196,292],[580,267,36],[530,401,55],[516,475,33],[515,487,45],[515,486,135],[529,453,50],[581,280,37],[680,7,46],[665,0,349]]);
  await replayCursorPath(page, [[655,17,45],[651,23,34],[649,26,50],[649,27,49],[643,39,51]]);
  await replayCursorPath(page, [[641,42,41],[641,43,99]]);
  await page.mouse.move(641, 43);
  await page.mouse.down();
  await page.mouse.move(641, 43);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[641,45,365]]);
  await replayCursorPath(page, [[608,116,48],[562,227,56],[517,412,44],[516,437,33],[516,450,51],[515,458,36],[515,464,32],[515,489,33],[515,512,34],[515,530,34],[515,540,32],[515,542,35],[515,543,31],[516,545,51],[518,555,50],[524,567,78],[527,569,39],[528,569,33],[528,569,33],[529,569,46]]);
  await page.mouse.move(529, 569);
  await page.mouse.down();
  await replayCursorPath(page, [[529,569,105],[529,567,32],[529,557,37],[532,525,46],[536,498,38],[544,463,30],[550,446,33],[552,438,49],[554,432,35],[560,411,38],[563,397,42],[564,389,34],[565,381,36],[566,374,40],[566,372,42],[566,371,68],[566,368,43],[567,367,41],[567,367,39],[567,366,93],[567,366,83],[567,366,50],[567,366,32],[567,366,41],[568,365,56],[568,364,42],[568,363,41],[568,362,88]]);
  await page.mouse.move(568, 362);
  await page.mouse.up();
  await replayCursorPath(page, [[569,361,533],[579,349,37],[602,317,34],[612,304,33],[628,280,35],[648,225,48],[659,158,52],[660,121,69],[656,100,77],[654,93,49],[653,93,90],[653,93,35],[651,86,40],[649,78,33],[648,70,33],[646,65,33],[645,60,35]]);
  await replayCursorPath(page, [[643,54,49],[643,53,34],[643,52,186],[640,47,40]]);
  await page.mouse.move(640, 46);
  await page.mouse.down();
  await page.mouse.move(640, 46);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[640,47,357]]);
  await replayCursorPath(page, [[646,74,51],[654,110,80],[684,268,37],[696,361,50],[707,409,164],[763,502,53],[765,506,59],[772,524,41],[772,530,32],[772,537,36],[772,544,53],[772,547,46],[772,565,79],[772,568,53],[772,571,57]]);
  await page.mouse.move(772, 571);
  await page.mouse.down();
  await replayCursorPath(page, [[772,571,143],[772,568,36],[772,563,47],[772,556,36],[773,538,47],[776,514,49],[779,497,51],[781,480,430],[781,391,47],[780,380,191],[780,380,49],[780,382,36],[781,385,89]]);
  await page.mouse.move(782, 387);
  await page.mouse.up();
  await replayCursorPath(page, [[782,386,959],[778,367,38],[773,348,32],[727,221,64],[697,151,48],[688,132,51],[684,125,36],[683,120,31],[680,113,123],[675,94,263],[667,79,37],[659,64,92],[657,61,35],[657,61,50],[656,61,33]]);
  await replayCursorPath(page, [[655,59,38],[648,49,67],[644,40,44],[643,40,35]]);
  await page.mouse.move(643, 40);
  await page.mouse.down();
  await page.mouse.move(643, 40);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(643, 39);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[656,54,345],[706,135,38],[742,235,51],[770,304,38],[835,431,45],[871,487,66],[875,488,232],[897,504,33],[956,552,50],[975,567,33],[981,572,33],[982,572,34],[983,572,33],[984,572,34],[986,572,34],[988,572,74],[992,573,42],[993,574,34],[996,578,34],[997,579,34]]);
  await page.mouse.move(997, 579);
  await page.mouse.down();
  await replayCursorPath(page, [[997,579,133],[997,577,127],[997,535,33],[997,528,39],[998,514,89],[999,495,52],[1001,477,41],[1001,471,36],[1001,467,34],[1001,466,352],[1002,463,54],[1003,462,91],[1008,452,37],[1011,446,46],[1011,443,50],[1011,442,34],[1012,442,76],[1012,441,57],[1012,441,33],[1012,440,34],[1013,440,34],[1013,439,45],[1013,438,60],[1013,438,302],[1017,422,56],[1019,415,72],[1020,408,40],[1021,405,126],[1025,397,49],[1026,396,75],[1027,394,70],[1027,393,45],[1027,392,144],[1027,392,533],[1027,392,50]]);
  await page.mouse.move(1027, 392);
  await page.mouse.up();
  await replayCursorPath(page, [[1027,392,1318],[897,387,32],[793,385,37],[547,386,34],[416,397,44],[390,398,35],[387,397,234],[372,390,33],[336,380,51],[326,380,50],[325,380,36],[325,381,63],[325,381,51]]);
  await page.mouse.move(325, 381);
  await page.mouse.down();
  await page.mouse.move(325, 381);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[325,380,1171],[329,371,45],[331,366,36],[332,364,67],[333,364,48],[333,363,49],[333,363,48],[333,363,50],[333,362,33]]);
  await page.mouse.move(333, 362);
  await page.mouse.down();
  await replayCursorPath(page, [[333,361,355],[333,360,38],[331,351,47],[330,347,30],[329,340,78],[328,337,41],[328,335,63],[327,333,38],[326,331,57],[325,330,36],[324,329,125],[324,328,42],[322,323,35],[321,322,52],[321,321,34],[321,320,36],[320,319,43],[320,319,70],[320,319,41],[320,319,36],[320,318,38],[320,318,35],[319,318,47],[319,317,58],[319,317,43],[318,317,37],[318,317,122],[318,317,57],[318,317,267]]);
  await page.mouse.move(318, 317);
  await page.mouse.up();
  await replayCursorPath(page, [[318,317,83],[323,316,305],[331,314,47],[344,312,50],[354,311,51],[363,311,49],[370,311,72],[374,312,51],[374,311,210],[374,311,33],[375,310,49],[375,310,50],[375,310,52]]);
  await page.mouse.move(375, 310);
  await page.mouse.down();
  await replayCursorPath(page, [[375,310,361],[377,310,42],[380,310,62],[382,309,50],[383,309,39],[384,309,63],[385,309,47],[385,309,40],[386,309,45],[386,309,62],[387,309,35],[388,309,51],[388,309,35],[389,309,49],[389,309,69],[390,309,64],[390,309,50],[390,309,68],[391,309,117]]);
  await page.mouse.move(391, 309);
  await page.mouse.up();
  await replayCursorPath(page, [[394,309,366],[408,312,34],[432,320,32],[464,336,33],[494,358,35],[513,376,107],[534,398,43],[535,399,35],[535,400,32],[539,402,33],[542,404,34],[548,406,49],[551,408,50],[552,408,35],[552,408,181],[554,409,50],[556,410,34],[558,411,51],[560,412,50],[560,412,33]]);
  await page.mouse.move(560, 412);
  await page.mouse.down();
  await page.mouse.move(560, 412);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[561,407,602],[563,400,47],[565,392,65],[565,390,33],[566,388,33],[567,383,51],[567,381,126],[569,377,44],[570,374,33],[571,368,106],[571,365,126]]);
  await page.mouse.move(571, 365);
  await page.mouse.down();
  await replayCursorPath(page, [[571,364,319],[570,362,36],[566,354,47],[565,349,53],[563,342,32],[563,336,56],[562,333,41],[562,330,40],[562,328,33],[562,327,39],[562,326,44],[562,325,146],[562,325,47],[562,325,85],[562,322,33],[562,321,34],[562,320,50],[562,317,46],[563,316,53],[563,315,66],[563,315,68],[563,315,204],[564,314,44],[565,312,40],[565,311,54],[565,311,64]]);
  await page.mouse.move(565, 310);
  await page.mouse.up();
  await replayCursorPath(page, [[567,310,430],[587,304,38],[596,302,43],[599,301,65],[603,300,35],[604,300,35],[604,300,34],[605,300,65],[606,299,35]]);
  await page.mouse.move(606, 299);
  await page.mouse.down();
  await replayCursorPath(page, [[606,299,756],[618,303,34],[618,304,55],[619,304,52],[620,304,64],[620,304,50],[621,304,32],[621,305,36],[622,305,38],[622,305,44],[623,305,39],[624,306,95],[627,307,40],[628,307,51],[630,307,77],[631,308,64]]);
  await page.mouse.move(631, 308);
  await page.mouse.up();
  await replayCursorPath(page, [[634,308,518],[638,308,34],[653,315,34],[675,327,33],[704,349,33],[724,370,55],[753,416,46],[757,424,34],[758,424,49],[761,425,50],[766,427,52],[771,428,47],[773,428,35],[775,428,83],[778,427,47],[780,427,46],[783,427,38],[783,427,35]]);
  await page.mouse.move(784, 427);
  await page.mouse.down();
  await page.mouse.move(784, 427);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[784,425,469],[781,412,47],[781,399,49],[781,395,35],[781,395,32],[781,393,43],[781,392,39],[781,392,69],[781,392,369],[781,391,64],[782,390,36]]);
  await page.mouse.move(782, 390);
  await page.mouse.down();
  await replayCursorPath(page, [[782,390,264],[782,386,49],[782,383,36],[782,382,49],[782,379,43],[782,376,41],[782,374,44],[782,373,45],[782,371,58],[782,371,34],[782,370,91],[782,369,39],[782,368,37],[782,367,36],[782,366,54],[782,366,47],[783,366,46],[783,365,45],[783,364,38],[783,363,50],[784,362,110],[785,360,39],[785,359,84],[785,359,42],[785,359,189],[786,358,44],[786,358,178]]);
  await page.mouse.move(786, 358);
  await page.mouse.up();
  await replayCursorPath(page, [[786,357,418],[781,351,58],[769,338,50],[768,337,190],[761,332,32],[759,332,37],[757,332,45],[755,332,33],[754,332,50],[753,333,53],[752,333,50]]);
  await page.mouse.move(752, 333);
  await page.mouse.down();
  await replayCursorPath(page, [[752,333,370],[754,333,39],[758,335,39],[760,335,33],[766,339,54],[768,340,39],[771,342,62],[773,342,60],[773,342,37],[773,343,65],[774,343,68],[775,344,55],[776,344,62],[777,344,103],[777,344,43],[778,344,129],[779,344,39],[780,345,40],[780,345,297],[780,345,33],[785,349,59],[786,350,39],[787,350,33],[788,351,36],[788,352,64]]);
  await page.mouse.move(788, 352);
  await page.mouse.up();
  await replayCursorPath(page, [[789,352,468],[804,352,34],[842,353,33],[917,380,88],[958,409,182],[1009,442,30],[1016,446,42],[1032,452,58],[1031,452,148],[1029,452,33],[1025,452,34],[1021,449,74],[1020,449,59]]);
  await page.mouse.move(1020, 449);
  await page.mouse.down();
  await page.mouse.move(1020, 449);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  await replayCursorPath(page, [[1020,448,669],[1020,445,33],[1021,421,38],[1022,416,46],[1023,406,64],[1023,404,59],[1025,401,79],[1025,401,46],[1026,400,49],[1026,400,79],[1026,398,263],[1026,398,32],[1026,397,44]]);
  await page.mouse.move(1026, 397);
  await page.mouse.down();
  await replayCursorPath(page, [[1026,397,66],[1026,397,201],[1026,396,40],[1025,392,49],[1023,387,48],[1022,385,79],[1021,384,40],[1020,382,64],[1020,382,347],[1019,379,33],[1019,378,46],[1018,378,69],[1018,377,34],[1017,377,45],[1017,377,39],[1015,376,43],[1013,374,53],[1012,373,48],[1012,373,81],[1011,372,76]]);
  await page.mouse.move(1011, 372);
  await page.mouse.up();
  await replayCursorPath(page, [[1009,365,637],[1003,354,246],[979,320,51],[975,320,42],[969,320,41],[966,319,90],[966,319,60],[966,319,116],[965,318,34],[965,318,67],[965,318,34]]);
  await page.mouse.move(965, 318);
  await page.mouse.down();
  await replayCursorPath(page, [[966,318,384],[967,318,40],[968,318,36],[970,319,47],[973,320,45],[975,321,67],[978,321,62],[979,322,49],[981,322,106],[985,323,51],[985,323,60],[986,323,41],[989,325,68],[990,325,70],[990,325,40],[992,326,40],[994,327,45],[998,328,32],[999,329,63],[1005,332,42],[1006,332,57],[1008,334,41],[1009,334,35],[1010,335,79],[1010,335,157]]);
  await page.mouse.move(1010, 335);
  await page.mouse.up();
  await replayCursorPath(page, [[1008,336,907],[997,346,39],[975,371,45],[949,409,50],[930,451,34],[902,548,37],[874,675,48],[866,716,197],[862,712,34],[862,704,35],[859,708,32]]);
}
`,
  },
  {
    name: "Test 11: Context Menu Actions",
    targetUrl: "https://excalidraw.com",
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
  await replayCursorPath(page, [[1276,420,0],[1263,413,42],[1251,401,32],[1227,383,40],[1209,369,35],[1168,354,32],[1094,345,33],[988,341,34],[870,335,34],[774,325,33],[702,310,33],[642,291,33],[595,273,33],[570,261,34],[564,255,33],[563,254,35],[563,254,33],[563,254,234],[558,248,32],[552,239,33],[539,220,33],[534,210,33],[533,208,35],[533,208,50],[532,207,174],[525,193,34],[520,171,33],[518,147,33],[517,131,33],[517,124,33],[518,116,34],[518,109,33],[520,94,34],[520,84,33],[520,77,33],[519,67,33],[519,62,34]]);
  await replayCursorPath(page, [[519,57,34],[519,49,33],[519,48,33],[520,42,35],[520,33,32],[520,32,53]]);
  await page.mouse.move(520, 32);
  await page.mouse.down();
  await page.mouse.move(520, 32);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(520, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(514, 40);
  await replayCursorPath(page, [[520,33,524],[520,34,40],[518,52,35],[508,108,39],[497,144,34],[489,161,33],[489,161,51],[488,161,51],[488,161,44],[481,159,29],[452,157,34],[429,155,33],[422,155,33],[420,156,42]]);
  await page.mouse.move(420, 156);
  await page.mouse.down();
  await replayCursorPath(page, [[420,155,66],[420,156,43],[423,161,32],[434,181,34],[450,205,33],[467,226,33],[480,242,33],[492,260,34],[497,268,34],[500,271,33],[503,275,33],[505,277,50],[505,277,34],[507,276,32],[513,275,34],[523,272,33],[530,270,43],[534,269,33],[541,268,33],[546,267,33],[546,267,51]]);
  await page.mouse.move(546, 267);
  await page.mouse.up();
  await replayCursorPath(page, [[546,267,549],[546,267,1685],[546,266,33],[546,239,40],[547,218,33],[551,201,34],[554,186,33],[557,174,33],[559,164,34],[561,154,33],[563,143,38],[563,137,29],[563,136,34],[563,135,141],[561,124,33],[559,105,34],[555,83,33],[554,75,41],[554,74,42],[554,72,33]]);
  await replayCursorPath(page, [[557,58,34],[559,51,37],[563,43,29],[564,39,33]]);
  await page.mouse.move(564, 39);
  await page.mouse.down();
  await page.mouse.move(564, 39);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(560, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(554, 40);
  await replayCursorPath(page, [[564,39,467],[564,40,276],[564,40,41],[564,40,35]]);
  await replayCursorPath(page, [[566,50,32],[577,76,33],[590,108,34],[601,135,33],[605,156,33],[610,175,33],[611,179,209],[611,179,51],[611,178,34],[612,175,31],[613,174,76],[615,172,33],[615,171,34],[616,170,35],[618,168,31],[619,165,33],[620,166,75]]);
  await page.mouse.move(620, 166);
  await page.mouse.down();
  await replayCursorPath(page, [[620,166,135],[621,168,33],[630,178,40],[637,188,33],[649,202,38],[663,216,30],[673,226,32],[685,237,34],[696,246,33],[701,251,33],[709,260,34],[716,265,33],[716,266,34],[716,266,33],[724,269,33],[737,275,33],[743,276,34],[756,279,34],[760,280,175],[760,280,184],[760,280,175]]);
  await page.mouse.move(760, 280);
  await page.mouse.up();
  await replayCursorPath(page, [[758,277,35],[757,277,31],[756,279,33],[756,287,33],[768,302,34],[895,332,32],[1182,374,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1259,102,2726],[1193,110,33],[1165,123,32],[1138,136,34],[1119,141,33],[1093,142,35],[1042,140,32],[955,134,33],[852,123,34],[767,111,33],[707,101,34],[678,95,41],[679,95,33],[677,93,35],[671,84,40],[662,76,34],[643,64,33]]);
  await replayCursorPath(page, [[622,56,36],[599,52,30],[579,48,34],[578,47,50],[578,47,83],[578,47,67],[578,47,34],[578,47,133]]);
  await replayCursorPath(page, [[569,43,33],[568,42,33],[569,42,101],[569,42,41],[569,41,34]]);
  await replayCursorPath(page, [[575,36,33],[580,34,32],[582,33,34],[582,33,117],[585,34,33],[590,34,33]]);
  await replayCursorPath(page, [[595,33,38],[596,33,88]]);
  await page.mouse.move(596, 33);
  await page.mouse.down();
  await page.mouse.move(596, 33);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(600, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(594, 40);
  await replayCursorPath(page, [[596,33,250],[596,34,126],[596,34,73],[602,38,34]]);
  await replayCursorPath(page, [[650,65,33],[721,97,42],[769,116,33],[803,126,34],[835,133,33],[857,135,41],[872,132,35],[874,131,32],[874,131,43],[874,132,42],[874,132,32],[874,133,33],[873,134,34],[874,135,33],[873,136,34],[870,139,35]]);
  await page.mouse.move(866, 141);
  await page.mouse.down();
  await replayCursorPath(page, [[866,142,145],[866,143,36],[867,147,33],[871,160,34],[882,184,33],[896,207,33],[907,223,34],[916,234,33],[926,246,33],[937,256,34],[945,262,33],[953,266,33],[959,268,34],[960,268,52],[967,265,31],[983,260,33],[986,260,34],[986,260,61],[993,259,39],[994,259,91],[994,260,76],[994,260,100]]);
  await page.mouse.move(994, 260);
  await page.mouse.up();
  await replayCursorPath(page, [[994,260,74],[995,259,100],[1011,259,34],[1095,261,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1269,193,2475],[1170,201,32],[1104,211,33],[1043,214,34],[1017,206,33],[1003,193,41],[959,178,34],[899,160,33],[825,135,34],[748,114,33],[703,106,33],[688,103,33],[675,100,34],[673,99,43],[670,96,41],[659,86,32],[646,74,34],[639,65,34]]);
  await replayCursorPath(page, [[634,59,33],[630,51,33],[626,45,33],[626,42,36],[626,42,48],[629,38,33]]);
  await replayCursorPath(page, [[633,32,34],[635,30,39],[638,29,27],[640,28,33],[640,28,34],[640,28,92]]);
  await page.mouse.move(640, 28);
  await page.mouse.down();
  await page.mouse.move(640, 28);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(634, 40);
  await replayCursorPath(page, [[640,28,432],[640,28,59],[640,29,33]]);
  await replayCursorPath(page, [[639,39,33],[632,70,34],[611,131,34],[575,208,41],[543,267,34],[505,325,32],[459,381,34],[412,432,34],[372,469,33],[347,487,33],[345,489,58],[345,488,34],[346,486,35],[354,479,32],[375,465,41],[392,454,33],[407,445,34],[423,435,33],[432,427,33],[438,422,33],[439,420,36],[440,419,32],[440,417,34],[440,416,32],[440,414,33],[440,412,35],[440,412,33],[440,409,32],[440,408,34],[440,408,75]]);
  await page.mouse.move(440, 408);
  await page.mouse.down();
  await replayCursorPath(page, [[440,408,41],[440,408,35],[440,407,34],[441,407,39],[459,404,34],[498,399,33],[538,394,33],[572,391,34],[597,388,33],[616,386,34],[620,385,43]]);
  await page.mouse.move(620, 385);
  await page.mouse.up();
  await replayCursorPath(page, [[620,385,291],[620,386,58],[620,386,58],[620,386,92],[620,387,49],[620,387,93],[641,391,41],[737,403,33],[944,418,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1277,330,2309],[1198,333,33],[1124,339,33],[1059,346,34],[1009,352,33],[965,354,33],[925,354,33],[877,351,33],[823,345,34],[783,337,34],[750,325,33],[729,304,33],[718,282,37],[706,240,40],[699,208,33],[694,175,32],[684,134,42],[680,119,33],[678,114,33],[677,108,33],[676,97,33],[676,92,36],[676,91,41],[678,84,32],[679,78,34],[680,71,33],[680,65,33],[680,63,34]]);
  await replayCursorPath(page, [[679,58,34],[678,52,32],[678,47,33],[678,45,33],[677,42,35],[677,42,33],[677,42,50]]);
  await page.mouse.move(677, 42);
  await page.mouse.down();
  await page.mouse.move(677, 42);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(680, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(674, 40);
  await replayCursorPath(page, [[677,42,299],[677,42,117],[677,42,292]]);
  await replayCursorPath(page, [[677,49,34],[681,83,38],[691,140,28],[714,210,34],[742,282,40],[752,310,35],[753,316,33],[753,316,174],[753,320,34],[752,328,33],[748,336,33],[745,342,33],[744,345,34]]);
  await page.mouse.move(744, 345);
  await page.mouse.down();
  await replayCursorPath(page, [[744,345,150],[750,359,33],[763,385,34],[777,412,33],[794,437,33],[801,446,42],[803,448,33],[804,448,33],[804,449,34],[804,449,33],[804,449,41],[804,449,43],[804,449,41],[805,449,33],[805,449,42],[804,448,34],[804,448,41]]);
  await page.mouse.move(804, 448);
  await page.mouse.up();
  await replayCursorPath(page, [[804,448,34],[804,448,50],[804,448,33],[804,448,51],[805,448,149],[806,448,34],[842,449,33],[942,453,33],[1098,463,42],[1269,474,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1274,166,2634],[1226,160,33],[1159,152,33],[1078,145,34],[993,137,33],[914,128,33],[852,116,33],[807,105,34],[792,99,33],[790,98,33],[772,88,33],[745,77,34],[737,74,41],[727,71,33],[708,64,34],[705,62,68],[705,62,33],[705,61,42]]);
  await replayCursorPath(page, [[705,57,32],[707,51,33],[708,46,34],[708,45,34],[708,44,32],[712,41,42],[713,39,35],[713,39,66]]);
  await page.mouse.move(713, 39);
  await page.mouse.down();
  await page.mouse.move(713, 39);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(720, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(714, 40);
  await replayCursorPath(page, [[713,39,424],[713,40,75],[712,44,34]]);
  await replayCursorPath(page, [[710,67,32],[719,110,34],[744,167,33],[780,230,34],[816,290,33],[840,326,33],[851,342,34],[857,350,33],[858,351,34],[870,353,33],[895,355,34],[907,355,40],[933,355,34],[956,353,34],[968,351,33],[969,351,33],[969,351,77],[969,351,73],[969,351,42],[969,351,42],[969,350,67],[971,349,33],[973,348,33],[977,345,33],[988,341,33],[991,340,33],[996,338,34],[1002,336,34],[1005,335,33],[1009,332,33],[1009,331,42],[1009,331,84]]);
  await page.mouse.move(1009, 331);
  await page.mouse.down();
  await replayCursorPath(page, [[1009,331,108],[1009,332,67],[1009,332,33],[1008,332,33],[996,333,33],[986,335,33],[983,336,43],[976,340,41],[971,344,33],[964,351,33],[957,362,34],[953,375,33],[952,389,33],[955,403,34],[962,416,33],[969,424,33],[974,428,34],[976,429,33],[978,429,33],[985,429,33],[991,429,34],[999,428,34],[1009,425,33],[1016,423,33],[1022,420,34],[1026,417,33],[1030,411,33],[1033,402,33],[1033,392,33],[1032,385,34],[1031,384,52],[1028,383,32],[1027,383,32],[1024,383,34],[1020,384,33],[1017,384,34],[1013,386,33],[1011,387,33],[1008,389,34],[1006,391,33],[1004,392,33],[1003,393,35],[1003,393,48],[1001,395,34],[998,397,33],[998,397,43],[998,396,92],[998,396,49]]);
  await page.mouse.move(998, 396);
  await page.mouse.up();
  await replayCursorPath(page, [[998,396,166],[999,395,34],[1022,389,35],[1089,378,31],[1190,366,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1257,148,2833],[1175,150,34],[1159,145,33],[1150,136,33],[1124,122,33],[1066,104,33],[995,89,34],[904,77,33],[825,68,33],[803,64,34],[803,63,51],[803,63,41],[803,62,33],[803,61,142],[803,61,43]]);
  await replayCursorPath(page, [[801,59,32],[797,56,33],[793,51,33],[793,50,42],[789,50,33],[787,49,42],[785,48,33],[785,48,108],[782,48,34]]);
  await replayCursorPath(page, [[781,48,33],[780,48,33],[778,48,34],[777,48,75],[776,48,33],[775,48,59]]);
  await replayCursorPath(page, [[772,48,34],[771,48,34]]);
  await page.mouse.move(771, 48);
  await page.mouse.down();
  await page.mouse.move(771, 48);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(772, 46);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(754, 40);
  await replayCursorPath(page, [[771,48,256],[771,48,185]]);
  await replayCursorPath(page, [[766,52,32],[728,96,33],[668,187,35],[595,341,41],[555,469,33],[539,550,33],[528,589,34],[524,602,183],[524,602,42],[523,595,33],[508,569,33],[501,557,33],[494,546,34],[482,524,33]]);
  await page.mouse.move(479, 521);
  await page.mouse.down();
  await page.mouse.move(479, 521);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(640, 360);
  // Skipped fill: no valid selector or coordinates found
  // Skipped fill: no valid selector or coordinates found
  // Skipped fill: no valid selector or coordinates found
  // Skipped fill: no valid selector or coordinates found
  // Skipped fill: no valid selector or coordinates found
  await replayCursorPath(page, [[479,521,3385]]);
  await replayCursorPath(page, [[487,512,32],[518,499,32],[635,481,34],[901,488,39]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1231,118,2295],[1017,97,33],[878,81,33],[778,65,34],[726,52,33],[678,40,33]]);
  await replayCursorPath(page, [[623,31,39],[615,29,28],[615,29,33],[616,29,51],[616,29,34],[631,34,32]]);
  await replayCursorPath(page, [[659,40,34],[709,45,33],[734,44,32],[737,44,43],[743,44,33],[751,44,33]]);
  await replayCursorPath(page, [[761,41,41],[767,41,34],[775,40,34],[788,39,33],[792,37,33],[793,37,35],[796,37,32]]);
  await replayCursorPath(page, [[797,37,257],[797,38,27],[798,39,34],[798,39,1974]]);
  await replayCursorPath(page, [[803,38,32],[808,37,34],[813,37,33],[815,36,34],[816,36,42],[816,36,67]]);
  await replayCursorPath(page, [[821,35,33],[821,35,75],[821,35,158]]);
  await replayCursorPath(page, [[825,35,33],[826,36,34],[830,36,32],[834,36,34],[835,36,50],[836,36,33]]);
  await replayCursorPath(page, [[838,36,352]]);
  await page.mouse.move(838, 36);
  await page.mouse.down();
  await page.mouse.move(838, 36);
  await page.mouse.up();
  // Coordinate-only click (no selectors found)
  await page.mouse.click(840, 38);
  // Coordinate-only click (no selectors found)
  await page.mouse.click(834, 40);
  await replayCursorPath(page, [[838,36,707],[837,37,76],[837,40,31]]);
  await replayCursorPath(page, [[847,74,34],[889,138,34],[968,222,33],[1044,295,33],[1102,358,34],[1120,389,33],[1121,400,33],[1119,407,34],[1117,411,33],[1111,417,42],[1102,419,33],[1098,420,33],[1086,418,33],[1072,417,34],[1059,417,34],[1052,417,33],[1051,417,33],[1051,417,34],[1051,417,33],[1051,417,33],[1051,417,42],[1051,416,42]]);
  await page.mouse.move(1051, 416);
  await page.mouse.down();
  await replayCursorPath(page, [[1051,416,41],[1052,414,33],[1048,406,34],[1037,400,33],[1021,391,33],[994,382,33],[971,375,34],[962,375,33],[962,374,34],[961,375,158],[942,378,33],[925,381,33],[924,381,34],[924,381,47]]);
  await page.mouse.move(924, 381);
  await page.mouse.up();
  await replayCursorPath(page, [[924,382,36],[922,386,34],[920,390,33],[913,402,33],[909,417,34],[907,428,33],[907,439,41],[907,445,34],[907,445,67],[907,445,92],[907,445,150],[907,445,92],[907,445,50],[911,446,32],[992,463,42],[1140,490,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
`,
  },
  {
    name: "Test 13b: Text recording",
    targetUrl: "https://excalidraw.com",
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
    name: "Test 1: Move Element Basic",
    targetUrl: "https://excalidraw.com",
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
    name: "Test 20: Fit to Content",
    targetUrl: "https://excalidraw.com",
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

  // Screenshot after Ctrl+Shift+D
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });

  await replayCursorPath(page, [
    [720,445,635],[720,445,191],[721,445,34],[721,445,124]
  ]);

  // === STROKE 3: draw down-left, screenshot MID-STROKE ===
  await page.mouse.move(721, 445);
  await page.mouse.down();
  await replayCursorPathFast(page, [
    [721,445],[720,445],[713,438],[690,414],
    [675,402],[664,395],[653,388],[642,380],
    [636,375],[632,373],[624,366],[616,360],
    [614,358],[611,356],[606,353],[602,350]
  ]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPathFast(page, [
    [601,349],[600,348],[597,346],[591,341],
    [586,338],[584,336],[581,333],[581,332],
    [580,332],[571,323],[555,310],[554,308],[553,308]
  ]);
  await page.mouse.move(553, 308);
  await page.mouse.up();

  await replayCursorPath(page, [[553,308,324],[553,309,51],[553,309,124]]);
  await replayCursorPath(page, [
    [553,309,291],[554,309,417],[554,308,33],[554,304,34],
    [553,295,33],[552,292,33],[551,291,43],[545,285,33],
    [541,282,59]
  ]);

  // === STROKE 4: draw up-right, screenshot MID-STROKE ===
  await page.mouse.move(541, 282);
  await page.mouse.down();
  await replayCursorPathFast(page, [
    [541,282],[542,282],[549,286],[582,315],
    [637,357],[678,385],[703,402]
  ]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPathFast(page, [
    [716,413],[717,414],[720,415],[723,417],[725,418]
  ]);
  await page.mouse.move(725, 418);
  await page.mouse.up();
  await page.keyboard.up('Control');
  await page.keyboard.up('Shift');

  await page.screenshot({ path: getScreenshotPath(), fullPage: true });

  await replayCursorPath(page, [
    [725,418,175],[724,417,68],[722,417,33],[720,417,33],
    [719,416,33],[717,417,41],[718,424,33],[719,430,34],
    [724,439,33],[734,463,33],[760,487,34],[766,490,376],
    [750,479,32],[740,470,34],[720,457,33],[714,452,34],
    [714,451,33],[712,448,34],[707,443,33],[701,437,33],
    [692,432,33],[684,428,34],[682,427,42],[682,427,100],
    [683,427,134],[688,430,33],[697,434,40],[708,440,34],
    [714,443,34],[720,447,33],[724,450,41]
  ]);

  // === STROKE 5: draw down-left, screenshot MID-STROKE ===
  await page.mouse.move(724, 450);
  await page.mouse.down();
  await replayCursorPathFast(page, [
    [724,449],[724,448],[710,429],[678,398],
    [641,366],[605,336],[576,311],[556,291],[540,277]
  ]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPathFast(page, [[532,269]]);
  await page.mouse.move(531, 269);
  await page.mouse.up();
  await page.keyboard.up('Control');

  await replayCursorPath(page, [
    [530,268,49],[532,271,33],[534,275,33],[535,278,34],
    [540,284,33],[545,289,33],[548,293,34],[551,297,34],
    [551,297,74],[551,297,376]
  ]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
`,
  },
  {
    name: "Test 2: Move Binding Arrow",
    targetUrl: "https://excalidraw.com",
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
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1260,155,0],[1084,155,39],[970,156,34],[863,149,33],[774,138,33],[710,129,33],[667,121,33],[654,112,34],[642,102,33],[634,94,34],[620,85,33],[597,76,33],[586,71,33],[576,65,34],[572,63,49],[568,60,34]]);
  await replayCursorPath(page, [[558,51,34],[557,50,41],[549,44,34],[545,41,199],[545,42,83],[544,53,34]]);
  await replayCursorPath(page, [[549,87,34],[554,142,33],[555,198,33],[556,240,34],[554,259,33],[549,275,33],[547,282,34],[547,282,33],[547,282,50],[547,282,42],[546,278,33],[542,268,33],[532,256,33],[522,244,33],[516,237,34],[505,225,33],[501,222,33],[500,221,34],[486,212,34],[478,208,33],[472,205,33],[464,203,34],[460,202,33],[458,201,33],[458,201,34],[458,201,58],[458,201,124],[458,201,34],[457,201,58],[457,201,42],[454,202,33],[454,202,434],[450,203,33],[449,203,50]]);
  await page.mouse.move(449, 203);
  await page.mouse.down();
  await page.mouse.move(449, 203);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"div.excalidraw-app > div.excalidraw.excalidraw-container > canvas.excalidraw__canvas.interactive"}], 'click', null, {"x":640,"y":360});
  await page.keyboard.press('2');
  await replayCursorPath(page, [[448,203,1001],[437,206,33],[423,208,32],[413,209,34],[413,208,184],[413,208,32],[413,208,34],[413,208,142],[412,206,33],[408,202,37],[407,201,30],[398,190,33],[392,185,33],[391,183,51],[386,178,33],[386,178,49],[386,178,50],[384,176,34],[375,170,33],[367,165,33],[367,165,42],[366,163,33],[364,161,34],[364,161,83],[364,161,41]]);
  await page.mouse.move(364, 161);
  await page.mouse.down();
  await replayCursorPath(page, [[364,161,35],[364,161,66],[364,162,33],[369,172,34],[376,186,33],[388,201,34],[393,209,32],[399,215,33],[402,219,34],[405,223,33],[408,225,35],[415,230,40],[426,236,34],[436,241,41],[442,243,33],[447,245,35],[457,249,32],[463,251,34],[474,255,42],[486,260,33],[494,263,42],[495,263,33],[499,264,42],[499,264,58],[499,265,159],[499,265,32],[499,265,417]]);
  await page.mouse.move(499, 265);
  await page.mouse.up();
  await replayCursorPath(page, [[499,265,825],[513,268,34],[547,273,34],[587,280,32],[640,289,42],[660,292,33],[675,297,33],[702,303,34],[723,306,33],[729,307,33],[729,307,126],[729,307,32],[729,307,43],[729,307,50],[729,307,50],[729,307,33],[729,307,41],[729,307,34],[729,307,150],[729,307,200],[726,304,34],[722,300,33],[717,298,33],[708,298,33],[689,301,34],[673,304,33],[667,307,33],[666,307,50],[666,307,376]]);
  await page.keyboard.press('2');
  await page.mouse.move(666, 307);
  await page.mouse.down();
  await replayCursorPath(page, [[666,307,1515],[676,316,34],[684,326,34],[697,342,33],[719,362,33],[735,375,34],[746,385,33],[759,395,33],[773,406,34],[786,415,33],[799,421,33],[805,424,34]]);
  await page.mouse.move(806, 424);
  await page.mouse.up();
  await replayCursorPath(page, [[806,424,708],[806,424,183],[803,421,34],[798,416,33],[790,408,33],[782,400,34],[773,389,33],[757,364,34],[730,326,33],[705,286,32],[688,258,34],[675,235,33],[668,223,34],[666,218,33],[666,216,34],[666,216,33],[665,216,58],[665,215,41],[665,215,34],[665,215,34],[665,215,33],[665,215,33],[665,215,50],[665,215,34],[665,215,33],[665,215,33],[665,215,41],[665,215,43],[665,215,108],[660,197,34],[651,173,32],[644,147,34],[641,128,33],[640,118,34],[638,110,33],[637,102,42],[636,96,33],[636,90,33],[635,85,34],[635,81,32],[635,77,34],[635,75,33],[635,75,100],[635,75,42],[635,74,59],[635,71,33],[636,67,33],[637,63,33]]);
  await replayCursorPath(page, [[637,59,34],[638,57,32],[638,55,60],[638,55,83],[638,55,63],[638,55,28]]);
  await replayCursorPath(page, [[637,59,33],[636,72,34],[634,93,33],[631,113,34],[628,128,33],[624,139,33],[624,140,59],[624,140,108],[624,140,117],[624,140,134],[624,140,182],[624,140,108]]);
  await page.keyboard.press('5');
  await replayCursorPath(page, [[624,140,383],[624,140,59],[605,144,34],[581,151,33],[558,159,33],[540,166,34],[536,169,33],[531,171,34],[529,171,33],[525,175,33],[517,181,34],[512,188,33],[508,194,33],[505,199,34],[500,204,33],[496,209,33],[496,210,33],[495,210,33],[495,211,118],[495,210,116],[495,210,33],[496,210,42],[498,210,33],[499,209,34],[500,209,41]]);
  await page.mouse.move(500, 209);
  await page.mouse.down();
  await replayCursorPath(page, [[500,208,375],[505,208,33],[512,204,34],[522,201,33],[535,198,41],[545,195,34],[561,193,33],[574,191,34],[585,191,33],[604,193,34],[627,197,33],[646,200,34],[652,202,33],[664,206,33],[692,217,34],[715,223,33],[725,226,33],[731,229,34],[737,235,33],[745,242,33],[748,246,34],[750,250,33],[751,258,33],[751,264,34],[750,270,33],[749,276,33],[746,281,34],[743,285,33],[742,288,32],[740,291,35],[739,293,33],[738,295,33],[737,296,58],[736,297,33],[736,298,33],[735,299,34],[735,299,117],[735,299,116],[735,299,317]]);
  await page.mouse.move(735, 299);
  await page.mouse.up();
  await replayCursorPath(page, [[735,298,284],[736,297,33],[752,288,33],[803,274,34],[869,258,33],[936,244,34],[993,231,41],[1013,221,33],[1024,214,34],[1029,210,33],[1030,208,34],[1030,208,149],[1029,208,75],[1029,208,42],[1018,198,33],[1008,192,33],[1000,187,34],[987,178,33],[975,171,34],[967,167,33],[957,166,42],[943,163,33],[929,162,33],[918,160,33],[909,160,33],[903,159,34],[899,159,33],[899,159,34],[898,158,33],[895,158,34],[890,157,33],[885,156,34],[882,155,33],[878,155,33],[870,155,33],[856,155,34],[837,153,33],[832,153,58],[832,153,117],[832,153,142],[832,153,225],[820,172,33],[805,196,33],[804,199,50],[804,199,76],[804,199,40],[804,199,42],[803,201,34],[801,203,34],[801,203,41],[802,203,33],[803,203,51],[803,203,149],[803,203,34],[803,203,67],[845,209,32],[967,214,34],[1172,210,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1278,79,3860],[1124,98,39],[1011,108,33],[919,115,33],[832,117,34],[736,125,34],[612,129,32],[447,124,34],[307,119,33],[217,114,33]]);
  await replayCursorPath(page, [[181,112,34],[173,115,33],[165,121,33],[160,128,33],[153,143,35],[145,164,33]]);
  await replayCursorPath(page, [[138,185,33],[130,204,33],[122,221,41],[118,230,34],[115,235,34],[115,239,33],[115,242,33]]);
  await replayCursorPath(page, [[115,246,34],[115,252,33],[115,259,33],[115,267,33],[115,271,34],[115,275,33]]);
  await replayCursorPath(page, [[115,279,33],[115,283,33],[116,286,34],[116,287,33],[116,287,34],[119,292,33],[121,301,33],[123,310,33]]);
  await replayCursorPath(page, [[125,316,34],[125,320,34],[125,327,33],[125,333,33],[125,335,34],[125,337,33],[125,340,33]]);
  await replayCursorPath(page, [[124,348,42],[125,358,33],[126,372,42],[127,382,33],[129,389,34],[129,391,33],[130,393,32],[130,393,34],[130,393,92],[129,394,34]]);
  await replayCursorPath(page, [[129,398,33],[127,401,42],[127,402,41],[127,402,233],[127,402,59],[127,402,158],[127,402,42]]);
  await page.mouse.move(127, 402);
  await page.mouse.down();
  await page.mouse.move(127, 402);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"svg > g > path"}], 'click', null, {"x":124,"y":406});
  await locateWithFallback(page, [{"type":"name","value":"[name=\\"arrowtypes\\"]"},{"type":"css-path","value":"div.buttonList > label > input"}], 'click', null, {"x":125,"y":407});
  await replayCursorPath(page, [[127,402,567]]);
  await replayCursorPath(page, [[134,396,33],[197,380,34],[349,365,32],[633,351,34],[1002,342,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1273,132,2318],[1134,137,32],[1022,151,33],[920,172,33],[829,197,34],[742,222,34],[683,237,33],[638,245,34],[587,251,33],[526,255,33],[459,257,33],[374,258,41],[313,261,34],[270,266,33],[247,270,34],[230,273,33],[216,276,33]]);
  await replayCursorPath(page, [[209,277,33],[208,277,376],[208,278,75]]);
  await replayCursorPath(page, [[230,293,33],[300,324,33],[392,361,33],[465,386,34],[533,410,42],[584,427,33],[631,439,34],[671,444,33],[711,446,33],[730,446,33],[733,444,34],[737,441,33],[745,434,41],[750,428,34],[753,425,33],[756,423,33],[757,422,34],[758,419,37],[759,419,29],[760,419,42],[759,419,401],[760,418,83],[765,408,33],[769,400,33],[772,395,34],[773,390,33],[773,385,41],[772,383,34],[771,381,33],[768,378,34],[764,374,33],[759,372,33],[748,368,34],[740,365,33],[739,364,75]]);
  await page.mouse.move(739, 364);
  await page.mouse.down();
  await replayCursorPath(page, [[739,364,183]]);
  await page.mouse.move(739, 364);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"div.excalidraw-app > div.excalidraw.excalidraw-container > canvas.excalidraw__canvas.interactive"}], 'click', null, {"x":640,"y":360});
  await replayCursorPath(page, [[739,364,143],[739,364,365],[739,364,34],[732,365,33],[727,367,34],[723,368,33]]);
  await page.mouse.move(721, 369);
  await page.mouse.down();
  await page.mouse.move(721, 369);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"div.excalidraw-app > div.excalidraw.excalidraw-container > canvas.excalidraw__canvas.interactive"}], 'click', null, {"x":640,"y":360});
  await replayCursorPath(page, [[721,368,567],[728,363,33],[740,355,37],[756,344,38],[765,335,33],[768,332,50]]);
  await page.mouse.move(768, 332);
  await page.mouse.down();
  await replayCursorPath(page, [[769,332,76]]);
  await page.mouse.move(769, 332);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"div.excalidraw-app > div.excalidraw.excalidraw-container > canvas.excalidraw__canvas.interactive"}], 'click', null, {"x":640,"y":360});
  await replayCursorPath(page, [[769,332,41],[769,332,100],[774,327,33],[782,320,33],[788,315,34],[791,312,33],[792,311,42]]);
  await page.mouse.move(792, 311);
  await page.mouse.down();
  await replayCursorPath(page, [[792,311,199]]);
  await page.mouse.move(792, 311);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"div.excalidraw-app > div.excalidraw.excalidraw-container > canvas.excalidraw__canvas.interactive"}], 'click', null, {"x":640,"y":360});
  await replayCursorPath(page, [[792,312,788],[791,312,905],[791,312,4883],[787,315,33]]);
  await page.mouse.move(787, 315);
  await page.mouse.down();
  await replayCursorPath(page, [[787,315,875],[767,317,42],[755,317,32],[744,316,35],[737,316,32],[728,316,34],[719,316,34],[713,316,41],[704,317,33],[691,319,34],[681,320,32],[673,321,34],[667,321,34],[664,321,33],[660,322,33],[656,322,34],[656,322,33],[656,322,58],[656,322,183],[656,322,125]]);
  await page.mouse.move(656, 322);
  await page.mouse.up();
  await replayCursorPath(page, [[656,322,401],[735,312,33],[985,312,33]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1262,316,2101],[1128,339,33],[1019,355,32],[906,368,34],[814,385,34],[738,405,33],[642,429,42],[604,440,33],[597,441,33],[598,440,45],[599,440,30],[603,431,42],[609,421,33],[617,408,34],[621,400,33],[622,400,133],[622,401,33],[621,403,34],[622,407,42],[622,408,33],[622,407,83]]);
  await page.mouse.move(622, 407);
  await page.mouse.down();
  await replayCursorPath(page, [[623,408,175],[640,420,33],[665,435,33],[694,451,35],[723,465,32],[743,473,34],[756,478,33],[767,484,33],[784,493,34],[802,503,33],[823,515,34],[849,529,33],[871,540,34],[886,548,33],[903,556,33],[909,560,33],[911,560,33],[914,561,34],[913,561,74],[913,561,68],[913,561,133]]);
  await page.mouse.move(912, 561);
  await page.mouse.up();
  await replayCursorPath(page, [[913,561,100],[914,562,33],[914,562,116],[927,552,34],[1041,545,42]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1269,364,2017],[1228,396,33],[1213,421,33],[1199,449,33],[1160,480,34],[1102,499,33],[1045,512,33],[1000,518,34],[973,520,33],[959,523,33],[945,526,34],[939,528,33],[927,532,33],[922,534,33],[922,534,33],[922,534,43]]);
  await page.mouse.move(922, 534);
  await page.mouse.down();
  await replayCursorPath(page, [[922,533,45],[927,522,38],[946,488,34],[969,446,33],[990,399,33],[1010,354,33],[1027,314,34],[1037,278,33],[1042,242,33],[1042,215,34],[1042,198,33],[1040,184,33],[1038,174,33],[1037,172,34],[1037,172,122],[1036,172,45],[1036,172,41],[1034,173,33],[1029,175,34],[1008,182,33],[982,190,33],[974,194,33],[972,194,34],[972,194,42],[972,194,58],[972,194,50],[972,194,125],[972,194,84],[972,194,91],[972,194,83]]);
  await page.mouse.move(971, 194);
  await page.mouse.up();
  await replayCursorPath(page, [[971,194,375],[971,194,59],[970,195,33],[968,197,33],[968,197,84],[969,197,42],[1000,202,33],[1119,216,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await replayCursorPath(page, [[1201,316,2859],[983,297,32],[851,274,33],[747,263,34],[653,262,33],[587,262,34],[534,256,41],[507,249,33],[467,240,34],[425,235,33],[413,234,33],[409,233,33],[408,232,58],[408,232,117]]);
  await page.mouse.move(408, 232);
  await page.mouse.down();
  await replayCursorPath(page, [[408,232,109],[408,237,33],[408,248,34],[409,256,32],[409,266,34],[411,282,33],[413,294,33],[414,301,34],[416,311,33],[419,324,34],[420,327,100]]);
  await page.mouse.move(420, 327);
  await page.mouse.up();
  await replayCursorPath(page, [[420,327,33],[423,319,38],[430,307,28],[438,296,34],[446,284,33],[450,278,34],[454,275,33],[454,274,67],[455,273,33],[455,273,33],[455,273,59],[458,267,33],[460,264,34],[460,264,32]]);
  await page.mouse.move(460, 263);
  await page.mouse.down();
  await page.mouse.move(460, 263);
  await page.mouse.up();
  await locateWithFallback(page, [{"type":"css-path","value":"div.excalidraw-app > div.excalidraw.excalidraw-container > canvas.excalidraw__canvas.interactive"}], 'click', null, {"x":640,"y":360});
  await replayCursorPath(page, [[460,264,184],[460,264,284],[460,264,258]]);
  await page.mouse.move(460, 264);
  await page.mouse.down();
  await replayCursorPath(page, [[460,264,382],[458,268,34],[452,278,34],[445,290,33],[436,307,33],[427,326,33],[418,347,34],[410,366,33],[402,387,34],[396,408,33],[393,425,33],[393,434,34],[394,437,32],[398,443,41],[405,451,27],[413,459,33],[427,473,33],[442,485,34],[452,493,32],[459,499,34],[462,501,33],[464,503,34],[468,507,33],[473,510,33],[478,514,34],[485,516,34],[494,519,41],[501,521,33],[506,523,34],[512,525,33],[519,530,34],[521,532,33],[526,536,33],[531,540,34],[533,541,41],[538,543,42],[539,544,33],[542,544,33],[543,544,34],[543,544,41],[544,544,42],[548,544,33],[549,544,42]]);
  await page.mouse.move(549, 544);
  await page.mouse.up();
  await replayCursorPath(page, [[549,544,217],[550,544,141],[639,550,42],[830,570,33],[1120,579,34]]);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}`,
  },
  {
    name: "Test 3: ALT+Drag Duplicate",
    targetUrl: "https://excalidraw.com",
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
  }
];

async function seed() {
  // Look up repository by name
  const repo = await db.select().from(repositories).where(eq(repositories.fullName, EXCALIDRAW_REPO_NAME)).get();

  if (!repo) {
    console.error(`❌ Repository "${EXCALIDRAW_REPO_NAME}" not found in database.`);
    console.error('   Please add the repository first via the UI, then run this script again.');
    process.exit(1);
  }

  REPO_ID = repo.id;
  console.log(`Found repository: ${EXCALIDRAW_REPO_NAME} (${REPO_ID})`);

  // Create functional areas
  const faMap = new Map<string, string>();
  for (const faDef of FUNCTIONAL_AREA_DEFINITIONS) {
    const faId = uuid();
    await db.insert(functionalAreas).values({
      id: faId,
      repositoryId: REPO_ID,
      name: faDef.name,
    });
    faMap.set(faDef.name, faId);
    console.log(`✓ Created functional area: ${faDef.name}`);
  }

  console.log('Seeding Excalidraw tests...\n');

  const now = new Date();

  for (const def of TEST_DEFINITIONS) {
    const testId = uuid();

    await db.insert(tests).values({
      id: testId,
      repositoryId: REPO_ID,
      functionalAreaId: def.functionalArea ? faMap.get(def.functionalArea) ?? null : null,
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

  console.log(`\n✓ Seed complete! Created ${TEST_DEFINITIONS.length} tests.`);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
