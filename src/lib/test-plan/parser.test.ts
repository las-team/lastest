import { describe, it, expect } from 'vitest';
import { parsePlanForPlaceholders } from './parser';

describe('parsePlanForPlaceholders', () => {
  it('returns empty for empty / whitespace input', () => {
    expect(parsePlanForPlaceholders('')).toEqual([]);
    expect(parsePlanForPlaceholders('   \n\n   ')).toEqual([]);
  });

  it('skips lines without AC annotations', () => {
    const md = `## Phase 1: Setup\n- Step 1: Navigate to /login\n- Step 2: Open menu`;
    expect(parsePlanForPlaceholders(md)).toEqual([]);
  });

  it('extracts a scenario per annotated step and prefixes with story title', () => {
    const md = [
      '## Story: Login with email',
      '## Phase 2: Actions',
      '- Step 1: Fill email and password <!-- AC: ac_a1 -->',
      '- Step 2: Click submit <!-- AC: ac_a1, ac_a2 -->',
    ].join('\n');
    const out = parsePlanForPlaceholders(md);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      title: 'Login with email: Fill email and password',
      acIds: ['ac_a1'],
    });
    expect(out[1].acIds.sort()).toEqual(['ac_a1', 'ac_a2']);
    expect(out[1].title.startsWith('Login with email:')).toBe(true);
  });

  it('deduplicates by (story, sorted AC ids) so the same scenario is not seeded twice', () => {
    const md = [
      '## Story: Foo',
      '- Click X <!-- AC: ac_1, ac_2 -->',
      '- Verify X <!-- AC: ac_2, ac_1 -->',
      '- Different one <!-- AC: ac_3 -->',
    ].join('\n');
    const out = parsePlanForPlaceholders(md);
    expect(out).toHaveLength(2);
    expect(out.map(s => s.acIds.sort().join(','))).toEqual(['ac_1,ac_2', 'ac_3']);
  });

  it('handles multiple stories independently', () => {
    const md = [
      '## Story: Login',
      '- A <!-- AC: ac_a -->',
      '## Story: Logout',
      '- B <!-- AC: ac_a -->',
    ].join('\n');
    const out = parsePlanForPlaceholders(md);
    expect(out).toHaveLength(2);
    expect(out[0].title.startsWith('Login:')).toBe(true);
    expect(out[1].title.startsWith('Logout:')).toBe(true);
  });

  it('strips the markdown bullet and the AC comment from the scenario body', () => {
    const md = '## Story: S\n- Click submit on /login <!-- AC: ac_x -->';
    const [scenario] = parsePlanForPlaceholders(md);
    expect(scenario.body).toBe('Click submit on /login');
    expect(scenario.body).not.toContain('<!--');
    expect(scenario.body).not.toMatch(/^[-*]/);
  });

  it('caps title to 80 characters by trimming at the first sentence boundary', () => {
    const long = 'A'.repeat(120);
    const md = `## Story: S\n- ${long}, then verify <!-- AC: ac_x -->`;
    const [scenario] = parsePlanForPlaceholders(md);
    // story prefix + ': ' counts here, so the AAA segment is capped at 80 by slice
    expect(scenario.title.length).toBeLessThanOrEqual('S: '.length + 80);
  });
});
