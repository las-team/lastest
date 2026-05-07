/**
 * Reverse-parse the markdown test plan emitted by `createPlanFromUserStoryPrompt`
 * into discrete scenarios, picking up the `<!-- AC: ac_xxx, ac_yyy -->` annotations.
 * One scenario per AC group → one placeholder test seeded by the user-stories action.
 */
export interface ParsedPlanScenario {
  title: string;
  body: string;
  acIds: string[];
}

export function parsePlanForPlaceholders(planMarkdown: string): ParsedPlanScenario[] {
  if (!planMarkdown) return [];

  const acRe = /<!--\s*AC:\s*([^>]+?)\s*-->/g;
  const lines = planMarkdown.split('\n');
  const scenarios: ParsedPlanScenario[] = [];
  const seen = new Set<string>();

  let currentStory = '';
  for (const line of lines) {
    const storyMatch = line.match(/^##\s+Story:\s+(.+)$/);
    if (storyMatch) {
      currentStory = storyMatch[1].trim();
      continue;
    }
    acRe.lastIndex = 0;
    const acIdsForLine = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = acRe.exec(line)) !== null) {
      m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(id => acIdsForLine.add(id));
    }
    if (acIdsForLine.size === 0) continue;

    const cleanLine = line
      .replace(acRe, '')
      .replace(/^\s*[-*]\s*/, '')
      // Strip the "Step N:" prefix the planner emits — purely scaffolding, useless for test names.
      .replace(/^\s*Step\s+\d+\s*:\s*/i, '')
      .trim();
    const key = `${currentStory}|${[...acIdsForLine].sort().join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const titleSeed = cleanLine.split(/[.,;]/)[0].trim().slice(0, 80);
    const title = currentStory ? `${currentStory}: ${titleSeed}` : titleSeed;

    scenarios.push({
      title: title || 'Test scenario',
      body: cleanLine,
      acIds: [...acIdsForLine],
    });
  }
  return scenarios;
}
