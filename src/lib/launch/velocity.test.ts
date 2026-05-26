import { describe, it, expect } from 'vitest';
import { velocityScore, rankProfiles, pickWinnerSlug } from './velocity';
import type { LaunchProfile } from '@/lib/db/schema';

function profile(slug: string, upvoteCount: number, createdAt?: Date): LaunchProfile {
  return {
    slug,
    upvoteCount,
    createdAt: createdAt ?? new Date('2026-01-01T00:00:00Z'),
  } as unknown as LaunchProfile;
}

describe('launch/velocity', () => {
  const weekStart = new Date('2026-07-13T07:00:00Z'); // Mon 00:00 PDT

  it('velocityScore = upvotes / hours elapsed (1h floor)', () => {
    const now = new Date(weekStart.getTime() + 10 * 3_600_000); // 10h later
    expect(velocityScore(20, weekStart, now)).toBeCloseTo(2, 5);
    // Floors the denominator at 1h so a fresh cohort doesn't divide by ~0.
    const soon = new Date(weekStart.getTime() + 60_000);
    expect(velocityScore(5, weekStart, soon)).toBeCloseTo(5, 5);
  });

  it('rankProfiles sorts by velocity desc and assigns 1-based ranks', () => {
    const now = new Date(weekStart.getTime() + 5 * 3_600_000);
    const ranked = rankProfiles([profile('a', 3), profile('b', 9), profile('c', 1)], weekStart, now);
    expect(ranked.map((r) => r.profile.slug)).toEqual(['b', 'a', 'c']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('breaks ties on raw upvotes then earliest createdAt', () => {
    const now = new Date(weekStart.getTime() + 5 * 3_600_000);
    const early = new Date('2026-07-13T08:00:00Z');
    const late = new Date('2026-07-13T09:00:00Z');
    // Same elapsed window → same velocity for equal counts; earlier submit wins.
    const ranked = rankProfiles([profile('late', 4, late), profile('early', 4, early)], weekStart, now);
    expect(ranked[0].profile.slug).toBe('early');
  });

  it('pickWinnerSlug returns the top profile, or null when empty', () => {
    const now = new Date(weekStart.getTime() + 5 * 3_600_000);
    expect(pickWinnerSlug([profile('x', 2), profile('y', 8)], weekStart, now)).toBe('y');
    expect(pickWinnerSlug([], weekStart, now)).toBeNull();
  });
});
