/**
 * Codebase Intelligence — gathers project context (deps, config, patterns)
 * to enrich AI prompts for test generation and route scanning.
 */

import { getFileContent, getRepoTree } from '@/lib/github/content';

// ============================================
// Types
// ============================================

export interface CodebaseIntelligence {
  /** Detected framework (e.g., "Next.js 14 App Router", "React + Vite") */
  framework: string;
  /** CSS framework in use (e.g., "Tailwind CSS", "CSS Modules", "styled-components") */
  cssFramework: string;
  /** Selector strategy recommendation based on project patterns */
  selectorStrategy: string;
  /** Auth mechanism detected (e.g., "NextAuth (JWT)", "Clerk", "Firebase Auth", "none") */
  authMechanism: string;
  /** Short project description from README */
  projectDescription: string;
  /** Key dependencies with testing implications */
  keyDeps: DependencyInsight[];
  /** Testing recommendations derived from deps and patterns */
  testingRecommendations: string[];
  /** State management approach */
  stateManagement: string;
  /** API layer detected (e.g., "REST", "GraphQL", "tRPC") */
  apiLayer: string;
  /** Sample selectors found in a component file */
  sampleSelectors: string[];
}

export interface DependencyInsight {
  name: string;
  category: 'ui' | 'state' | 'auth' | 'data' | 'animation' | 'form' | 'routing' | 'testing' | 'other';
  testingImplication: string;
}

// ============================================
// Dependency Analysis Map
// ============================================

const DEP_INSIGHTS: Record<string, Omit<DependencyInsight, 'name'>> = {
  // Animation — need stabilization
  'framer-motion': { category: 'animation', testingImplication: 'Wait for animations to complete before screenshots; use page.waitForTimeout(500) after interactions' },
  'react-spring': { category: 'animation', testingImplication: 'Wait for spring animations to settle before capturing screenshots' },
  'gsap': { category: 'animation', testingImplication: 'Wait for GSAP animations to complete; consider disabling via matchMedia' },
  '@formkit/auto-animate': { category: 'animation', testingImplication: 'List animations may affect screenshot timing' },

  // Auth — need setup scripts
  'next-auth': { category: 'auth', testingImplication: 'Requires auth setup; login flow needed before testing protected routes' },
  '@auth/core': { category: 'auth', testingImplication: 'Auth.js integration — requires session setup for protected routes' },
  '@clerk/nextjs': { category: 'auth', testingImplication: 'Clerk auth — protected routes need auth bypass or login setup' },
  '@clerk/clerk-react': { category: 'auth', testingImplication: 'Clerk auth — protected routes need auth bypass or login setup' },
  'firebase': { category: 'auth', testingImplication: 'Firebase auth — may need emulator or test credentials for protected routes' },
  '@supabase/auth-helpers-nextjs': { category: 'auth', testingImplication: 'Supabase auth — protected routes need auth session setup' },
  'lucia': { category: 'auth', testingImplication: 'Lucia auth — requires session cookie setup for protected routes' },
  'passport': { category: 'auth', testingImplication: 'Passport.js auth — login flow required for protected routes' },

  // Data fetching — need network idle waits
  '@tanstack/react-query': { category: 'data', testingImplication: 'Async data fetching — wait for network idle or specific elements before assertions' },
  'swr': { category: 'data', testingImplication: 'SWR data fetching — pages may re-render after stale-while-revalidate; wait for content' },
  'axios': { category: 'data', testingImplication: 'HTTP client — pages likely fetch data on load; wait for content to appear' },
  '@trpc/client': { category: 'data', testingImplication: 'tRPC client — type-safe API calls; wait for data to load' },
  '@apollo/client': { category: 'data', testingImplication: 'GraphQL client — queries may have loading states; wait for data' },
  'graphql-request': { category: 'data', testingImplication: 'GraphQL — pages may show loading states; wait for content' },

  // Forms — need interaction patterns
  'react-hook-form': { category: 'form', testingImplication: 'Form validation may be client-side; test both valid and invalid submissions' },
  'formik': { category: 'form', testingImplication: 'Formik forms — test validation messages and submission states' },
  '@conform-to/react': { category: 'form', testingImplication: 'Conform forms with server validation — test error states' },
  'zod': { category: 'form', testingImplication: 'Schema validation — forms likely have strict validation rules to test' },

  // UI libraries — selector hints
  '@radix-ui/react-dialog': { category: 'ui', testingImplication: 'Radix dialogs use [data-state] attributes; use role-based selectors' },
  '@radix-ui/react-dropdown-menu': { category: 'ui', testingImplication: 'Radix dropdowns — use role="menuitem" for option selection' },
  '@headlessui/react': { category: 'ui', testingImplication: 'Headless UI — components are accessible; prefer aria-label and role selectors' },
  '@mui/material': { category: 'ui', testingImplication: 'MUI components — use data-testid or aria-label; avoid class-based selectors' },
  'antd': { category: 'ui', testingImplication: 'Ant Design — components have ant-* class prefixes; prefer data-testid' },
  '@chakra-ui/react': { category: 'ui', testingImplication: 'Chakra UI — accessible components; prefer role and aria-label selectors' },
  'shadcn': { category: 'ui', testingImplication: 'shadcn/ui with Radix primitives — use role-based and [data-state] selectors' },

  // State management
  'zustand': { category: 'state', testingImplication: 'Zustand state — UI may update asynchronously; wait for state-driven content' },
  'jotai': { category: 'state', testingImplication: 'Jotai atoms — UI reactivity; wait for derived state to settle' },
  'redux': { category: 'state', testingImplication: 'Redux state — actions may trigger async updates; wait for UI to reflect changes' },
  '@reduxjs/toolkit': { category: 'state', testingImplication: 'RTK — may use createAsyncThunk; wait for loading states to resolve' },
  'recoil': { category: 'state', testingImplication: 'Recoil atoms — async selectors may cause loading states' },
  'mobx': { category: 'state', testingImplication: 'MobX observables — reactions may cause delayed UI updates' },

  // Routing hints
  'react-router-dom': { category: 'routing', testingImplication: 'Client-side routing — use waitForURL after navigation' },
  'next': { category: 'routing', testingImplication: 'Next.js routing — pages may have loading.tsx states; wait for content' },
  '@tanstack/react-router': { category: 'routing', testingImplication: 'TanStack Router — type-safe routes with loader patterns' },
  'vue-router': { category: 'routing', testingImplication: 'Vue Router — client-side navigation; wait for route transitions' },

  // Other testing-relevant
  'next-intl': { category: 'other', testingImplication: 'i18n — content may vary by locale; test default locale' },
  'i18next': { category: 'other', testingImplication: 'i18n — text content from translation keys; use getByText with actual translated text' },
  'next-themes': { category: 'other', testingImplication: 'Theme switching — screenshots may vary by theme; test default theme' },
  '@vercel/analytics': { category: 'other', testingImplication: 'Analytics scripts — may add loading delay' },
};

// ============================================
// CSS Framework Detection
// ============================================

function detectCSSFramework(deps: Record<string, string>, devDeps: Record<string, string>): string {
  const all = { ...deps, ...devDeps };
  if ('tailwindcss' in all) return 'Tailwind CSS';
  if ('@mui/material' in all || '@mui/system' in all) return 'Material UI';
  if ('styled-components' in all) return 'styled-components';
  if ('@emotion/react' in all || '@emotion/styled' in all) return 'Emotion';
  if ('@chakra-ui/react' in all) return 'Chakra UI';
  if ('antd' in all) return 'Ant Design';
  if ('bootstrap' in all || 'react-bootstrap' in all) return 'Bootstrap';
  return 'CSS Modules / plain CSS';
}

// ============================================
// Auth Detection
// ============================================

function detectAuthMechanism(deps: Record<string, string>): string {
  if ('next-auth' in deps || '@auth/core' in deps) return 'NextAuth / Auth.js';
  if ('@clerk/nextjs' in deps || '@clerk/clerk-react' in deps) return 'Clerk';
  if ('firebase' in deps) return 'Firebase Auth';
  if ('@supabase/auth-helpers-nextjs' in deps || '@supabase/ssr' in deps) return 'Supabase Auth';
  if ('lucia' in deps) return 'Lucia';
  if ('passport' in deps) return 'Passport.js';
  if ('@kinde-oss/kinde-auth-nextjs' in deps) return 'Kinde';
  return 'none detected';
}

// ============================================
// State Management Detection
// ============================================

function detectStateManagement(deps: Record<string, string>): string {
  const found: string[] = [];
  if ('zustand' in deps) found.push('Zustand');
  if ('@reduxjs/toolkit' in deps || 'redux' in deps) found.push('Redux');
  if ('jotai' in deps) found.push('Jotai');
  if ('recoil' in deps) found.push('Recoil');
  if ('mobx' in deps || 'mobx-react' in deps) found.push('MobX');
  if ('@tanstack/react-query' in deps) found.push('React Query (server state)');
  if ('swr' in deps) found.push('SWR (server state)');
  return found.length > 0 ? found.join(', ') : 'React state / Context';
}

// ============================================
// API Layer Detection
// ============================================

function detectAPILayer(deps: Record<string, string>): string {
  if ('@trpc/client' in deps || '@trpc/server' in deps) return 'tRPC';
  if ('@apollo/client' in deps || 'graphql' in deps) return 'GraphQL';
  if ('graphql-request' in deps) return 'GraphQL (graphql-request)';
  return 'REST';
}

// ============================================
// Framework Detection (enhanced)
// ============================================

function detectFramework(deps: Record<string, string>, devDeps: Record<string, string>, hasAppDir: boolean, hasPagesDir: boolean): string {
  const all = { ...deps, ...devDeps };
  if ('next' in all) {
    const version = deps['next'] || devDeps['next'] || '';
    const majorMatch = version.match(/(\d+)/);
    const major = majorMatch ? parseInt(majorMatch[1]) : 0;
    if (hasAppDir && major >= 13) return `Next.js ${major || ''} App Router`.trim();
    if (hasPagesDir) return `Next.js ${major || ''} Pages Router`.trim();
    return `Next.js ${major || ''}`.trim();
  }
  if ('nuxt' in all) return 'Nuxt';
  if ('gatsby' in all) return 'Gatsby';
  if ('@remix-run/react' in all) return 'Remix';
  if ('@sveltejs/kit' in all) return 'SvelteKit';
  if ('svelte' in all) return 'Svelte';
  if ('vue' in all) return 'Vue';
  if ('@angular/core' in all) return 'Angular';
  if ('vite' in all && 'react' in deps) return 'React + Vite';
  if ('react' in deps) return 'React';
  return 'unknown';
}

// ============================================
// Selector Strategy
// ============================================

function inferSelectorStrategy(deps: Record<string, string>, sampleSelectors: string[]): string {
  // Check if project uses data-testid
  if (sampleSelectors.some(s => s.includes('data-testid'))) {
    return 'data-testid (found in code) — prefer page.getByTestId()';
  }

  // Radix / shadcn — role-based
  const hasRadix = Object.keys(deps).some(d => d.startsWith('@radix-ui/'));
  if (hasRadix) {
    return 'Role + aria-label (Radix/shadcn) — prefer getByRole(), getByLabel(), [data-state]';
  }

  // Headless UI — accessible selectors
  if ('@headlessui/react' in deps) {
    return 'Role + aria-label (Headless UI) — prefer getByRole(), getByLabel()';
  }

  // MUI
  if ('@mui/material' in deps) {
    return 'aria-label + data-testid (MUI) — avoid MuiXyz class names';
  }

  return 'Text + role-based — prefer getByRole(), getByText(), then CSS selectors';
}

// ============================================
// Extract Selectors from Component Code
// ============================================

function extractSelectorsFromCode(code: string): string[] {
  const selectors: string[] = [];
  const patterns = [
    /data-testid=["']([^"']+)["']/g,
    /aria-label=["']([^"']+)["']/g,
    /role=["']([^"']+)["']/g,
    /className=["']([^"']+)["']/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      selectors.push(match[0]);
      if (selectors.length >= 10) break;
    }
    if (selectors.length >= 10) break;
  }

  return selectors;
}

// ============================================
// Main Intelligence Gathering Function
// ============================================

export async function gatherCodebaseIntelligence(
  accessToken: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<CodebaseIntelligence> {
  // Fetch in parallel: package.json, README, repo tree, sample config files
  const [packageJsonRaw, readmeRaw, repoTree, nextConfigRaw] = await Promise.all([
    getFileContent(accessToken, owner, repo, 'package.json', branch).catch(() => null),
    getFileContent(accessToken, owner, repo, 'README.md', branch)
      .catch(() => getFileContent(accessToken, owner, repo, 'readme.md', branch))
      .catch(() => null),
    getRepoTree(accessToken, owner, repo, branch).catch(() => null),
    getFileContent(accessToken, owner, repo, 'next.config.js', branch)
      .catch(() => getFileContent(accessToken, owner, repo, 'next.config.ts', branch))
      .catch(() => getFileContent(accessToken, owner, repo, 'next.config.mjs', branch))
      .catch(() => null),
  ]);

  // Parse package.json
  let deps: Record<string, string> = {};
  let devDeps: Record<string, string> = {};

  if (packageJsonRaw) {
    try {
      const pkg = JSON.parse(packageJsonRaw);
      deps = pkg.dependencies || {};
      devDeps = pkg.devDependencies || {};
    } catch {
      // Invalid JSON — proceed with defaults
    }
  }

  // Detect directory structure
  const tree = repoTree?.tree || [];
  const hasAppDir = tree.some(e => e.path.startsWith('app/') || e.path.startsWith('src/app/'));
  const hasPagesDir = tree.some(e => e.path.startsWith('pages/') || e.path.startsWith('src/pages/'));

  // Gather insights
  const framework = detectFramework(deps, devDeps, hasAppDir, hasPagesDir);
  const cssFramework = detectCSSFramework(deps, devDeps);
  const authMechanism = detectAuthMechanism(deps);
  const stateManagement = detectStateManagement(deps);
  const apiLayer = detectAPILayer(deps);

  // Analyze dependencies for testing implications
  const allDeps = { ...deps, ...devDeps };
  const keyDeps: DependencyInsight[] = [];
  const testingRecommendations: string[] = [];

  for (const [depName, insight] of Object.entries(DEP_INSIGHTS)) {
    if (depName in allDeps) {
      keyDeps.push({ name: depName, ...insight });
      testingRecommendations.push(`[${depName}] ${insight.testingImplication}`);
    }
  }

  // Try to find a sample component for selector extraction
  let sampleSelectors: string[] = [];
  const componentPatterns = [
    /^(?:src\/)?(?:app|pages)\/.*?page\.[tj]sx?$/,
    /^(?:src\/)?components\/.*?\.[tj]sx?$/,
  ];

  const sampleFile = tree.find(e =>
    e.type === 'blob' &&
    componentPatterns.some(p => p.test(e.path)) &&
    !e.path.includes('node_modules') &&
    !e.path.includes('layout.')
  );

  if (sampleFile) {
    const sampleCode = await getFileContent(accessToken, owner, repo, sampleFile.path, branch).catch(() => null);
    if (sampleCode) {
      sampleSelectors = extractSelectorsFromCode(sampleCode);
    }
  }

  const selectorStrategy = inferSelectorStrategy(deps, sampleSelectors);

  // Extract README description (first meaningful paragraph, max 500 chars)
  let projectDescription = '';
  if (readmeRaw) {
    const lines = readmeRaw.split('\n');
    const descLines: string[] = [];
    let foundContent = false;
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip headings, badges, empty lines at start
      if (!foundContent) {
        if (trimmed.startsWith('#') || trimmed.startsWith('![') || trimmed.startsWith('[![') || trimmed === '') continue;
        foundContent = true;
      }
      if (foundContent) {
        if (trimmed === '' && descLines.length > 0) break; // Stop at first blank line after content
        descLines.push(trimmed);
      }
    }
    projectDescription = descLines.join(' ').slice(0, 500);
  }

  // Add framework-specific recommendations
  if (framework.includes('Next.js') && framework.includes('App Router')) {
    testingRecommendations.push('[Next.js App Router] Pages may use Suspense boundaries — wait for loading states to resolve');
    testingRecommendations.push('[Next.js App Router] Server Components render HTML first — content should be immediately visible');
  }

  if (nextConfigRaw?.includes('i18n')) {
    testingRecommendations.push('[i18n config] App has locale routing — test default locale only unless specified');
  }

  return {
    framework,
    cssFramework,
    selectorStrategy,
    authMechanism,
    projectDescription,
    keyDeps,
    testingRecommendations,
    stateManagement,
    apiLayer,
    sampleSelectors,
  };
}
