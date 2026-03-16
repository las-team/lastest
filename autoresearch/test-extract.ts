import { extractCodeFromResponse } from '../src/lib/ai/prompts';

// Test non-code response
const r1 = extractCodeFromResponse('The issue is that the original test looks wrong.');
console.log('T1 non-code:', r1 === '' ? 'EMPTY (correct)' : 'GOT: ' + r1.slice(0, 50));

// Test explanation then function
const r2 = extractCodeFromResponse('Here is the fix:\nexport async function test(page, baseUrl, screenshotPath, stepLogger) { }');
console.log('T2 explanation+code:', r2.startsWith('export async function') ? 'PASS' : 'FAIL: ' + r2.slice(0, 50));

// Test code block
const r3 = extractCodeFromResponse('```javascript\nexport async function test(page, baseUrl, screenshotPath, stepLogger) { }\n```');
console.log('T3 code block:', r3.startsWith('export async function') ? 'PASS' : 'FAIL: ' + r3.slice(0, 50));

// Test the actual failure case
const r4 = extractCodeFromResponse('The issue is that the original test is looking for `a[href*="/tests/"]` but there might not be any links visible on the page.');
console.log('T4 actual failure:', r4 === '' ? 'EMPTY (correct)' : 'GOT: ' + r4.slice(0, 80));
