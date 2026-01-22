/**
 * Remote Route Scanner - scans repositories via GitHub API without local clones
 */

import {
  getRepoTree,
  getFileContent,
  filterTree,
  pathExists,
  type TreeEntry,
} from '@/lib/github/content';
import type { RouteInfo, ScanProgress, ScanResult } from './types';

export interface RemoteScannerConfig {
  accessToken: string;
  owner: string;
  repo: string;
  branch: string;
}

export class RemoteRouteScanner {
  private tree: TreeEntry[] = [];
  private resolvedBasePath: string = '';

  constructor(
    private config: RemoteScannerConfig,
    private onProgress?: (progress: ScanProgress) => void
  ) {}

  async scan(): Promise<ScanResult> {
    this.emitProgress('detecting', 0, 0);

    // Fetch repo tree
    const repoTree = await getRepoTree(
      this.config.accessToken,
      this.config.owner,
      this.config.repo,
      this.config.branch
    );

    if (!repoTree || repoTree.tree.length === 0) {
      return { routes: [], framework: 'unknown' };
    }

    this.tree = repoTree.tree;

    // Resolve monorepo structure
    this.resolvedBasePath = await this.resolveMonorepoPath();

    const projectType = await this.detectProjectType();
    const routes: RouteInfo[] = [];

    this.emitProgress('scanning', 10, 0);

    switch (projectType) {
      case 'nextjs-app':
        routes.push(...(await this.scanNextJsApp()));
        break;
      case 'nextjs-pages':
        routes.push(...(await this.scanNextJsPages()));
        break;
      case 'react-router':
        routes.push(...(await this.scanReactRouter()));
        break;
      case 'vue':
        routes.push(...(await this.scanVueRouter()));
        break;
      default:
        routes.push(...this.scanGeneric());
    }

    // Scan navigation components for labels
    const navLinks = await this.scanNavigationLinks();

    // Merge nav labels into routes
    for (const route of routes) {
      const navLink = navLinks.find(n => n.path === route.path);
      if (navLink) {
        route.label = navLink.label;
        route.navSource = navLink.navSource;
      }
    }

    // Add any nav links that weren't found as file routes
    for (const navLink of navLinks) {
      if (!routes.find(r => r.path === navLink.path)) {
        routes.push({
          path: navLink.path,
          type: navLink.path.includes('[') || navLink.path.includes(':') ? 'dynamic' : 'static',
          label: navLink.label,
          navSource: navLink.navSource,
          framework: projectType as RouteInfo['framework'],
        });
      }
    }

    this.emitProgress('complete', 100, routes.length);

    return { routes, framework: projectType };
  }

  /**
   * Detect monorepo structure and return the correct frontend path
   */
  private async resolveMonorepoPath(): Promise<string> {
    // Check if there's a package.json at root
    if (this.tree.some(e => e.path === 'package.json')) {
      return ''; // Has package.json at root, use root
    }

    // Common frontend directory names in monorepos
    const frontendDirs = [
      'frontend',
      'client',
      'web',
      'app',
      'packages/frontend',
      'packages/web',
      'packages/client',
    ];

    for (const dir of frontendDirs) {
      const pkgPath = `${dir}/package.json`;
      if (!this.tree.some(e => e.path === pkgPath)) continue;

      const content = await getFileContent(
        this.config.accessToken,
        this.config.owner,
        this.config.repo,
        pkgPath,
        this.config.branch
      );

      if (!content) continue;

      try {
        const pkg = JSON.parse(content);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        if (deps.next || deps.react || deps.vue) {
          return dir;
        }
      } catch {
        // Invalid JSON
      }
    }

    return ''; // Fall back to root
  }

  private emitProgress(
    phase: ScanProgress['phase'],
    progress: number,
    routesFound: number,
    currentFile?: string
  ) {
    this.onProgress?.({ phase, progress, routesFound, currentFile });
  }

  private async detectProjectType(): Promise<string> {
    const basePath = this.resolvedBasePath;
    const pkgPath = basePath ? `${basePath}/package.json` : 'package.json';

    const content = await getFileContent(
      this.config.accessToken,
      this.config.owner,
      this.config.repo,
      pkgPath,
      this.config.branch
    );

    if (!content) return 'unknown';

    try {
      const packageJson = JSON.parse(content);
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

      if (deps.next) {
        // Check for app directory
        const appDir = basePath ? `${basePath}/app` : 'app';
        const srcAppDir = basePath ? `${basePath}/src/app` : 'src/app';

        if (pathExists(this.tree, appDir) || pathExists(this.tree, srcAppDir)) {
          return 'nextjs-app';
        }
        return 'nextjs-pages';
      }

      if (deps['react-router'] || deps['react-router-dom']) {
        return 'react-router';
      }

      if (deps.vue && deps['vue-router']) {
        return 'vue';
      }
    } catch {
      // Invalid JSON
    }

    return 'unknown';
  }

  private getBasePath(subDir: string): string {
    if (this.resolvedBasePath) {
      return `${this.resolvedBasePath}/${subDir}`;
    }
    return subDir;
  }

  /**
   * Scan for navigation/sidebar components and extract Link elements with labels
   */
  private async scanNavigationLinks(): Promise<Array<{ path: string; label: string; navSource: string }>> {
    const navLinks: Array<{ path: string; label: string; navSource: string }> = [];

    // Find potential navigation files
    const navPatterns = [
      '**/sidebar*.tsx',
      '**/sidebar*.jsx',
      '**/nav*.tsx',
      '**/nav*.jsx',
      '**/navigation*.tsx',
      '**/navigation*.jsx',
      '**/menu*.tsx',
      '**/menu*.jsx',
      '**/header*.tsx',
      '**/header*.jsx',
      '**/components/ui/**/*.tsx',
      '**/components/layout/**/*.tsx',
    ];

    const basePath = this.resolvedBasePath;
    const srcPath = basePath ? `${basePath}/src` : 'src';

    // Filter tree entries for potential nav files
    const navFiles = this.tree.filter(entry => {
      if (entry.type !== 'blob') return false;
      const path = entry.path;
      if (!path.startsWith(srcPath) && !path.startsWith(basePath || '')) return false;
      if (path.includes('node_modules')) return false;

      const fileName = path.split('/').pop()?.toLowerCase() || '';
      return (
        fileName.includes('sidebar') ||
        fileName.includes('nav') ||
        fileName.includes('navigation') ||
        fileName.includes('menu') ||
        fileName.includes('header')
      ) && (fileName.endsWith('.tsx') || fileName.endsWith('.jsx') || fileName.endsWith('.ts') || fileName.endsWith('.js'));
    });

    for (const file of navFiles.slice(0, 10)) { // Limit to 10 files to avoid rate limits
      const content = await getFileContent(
        this.config.accessToken,
        this.config.owner,
        this.config.repo,
        file.path,
        this.config.branch
      );

      if (!content) continue;

      // Skip if no Link imports
      if (!content.includes('Link') && !content.includes('href')) continue;

      // Pattern 1: NavItem arrays like { label: 'Dashboard', href: '/dashboard' }
      const navItemPattern = /\{\s*(?:label|name|title):\s*['"`]([^'"`]+)['"`],\s*(?:href|to|path):\s*['"`]([^'"`]+)['"`]/g;
      let match;
      while ((match = navItemPattern.exec(content)) !== null) {
        const [, label, href] = match;
        if (href.startsWith('/') && !href.includes('http')) {
          navLinks.push({ path: href, label, navSource: file.path });
        }
      }

      // Pattern 2: Reversed order { href: '/dashboard', label: 'Dashboard' }
      const navItemReversedPattern = /\{\s*(?:href|to|path):\s*['"`]([^'"`]+)['"`],\s*(?:label|name|title):\s*['"`]([^'"`]+)['"`]/g;
      while ((match = navItemReversedPattern.exec(content)) !== null) {
        const [, href, label] = match;
        if (href.startsWith('/') && !href.includes('http')) {
          navLinks.push({ path: href, label, navSource: file.path });
        }
      }

      // Pattern 3: JSX Link elements <Link href="/path">Label</Link>
      const jsxLinkPattern = /<Link[^>]*href=["']([^"']+)["'][^>]*>([^<]+)</g;
      while ((match = jsxLinkPattern.exec(content)) !== null) {
        const [, href, label] = match;
        if (href.startsWith('/') && !href.includes('http') && label.trim()) {
          navLinks.push({ path: href, label: label.trim(), navSource: file.path });
        }
      }
    }

    // Deduplicate by path, keeping first occurrence
    const seen = new Set<string>();
    return navLinks.filter(link => {
      if (seen.has(link.path)) return false;
      seen.add(link.path);
      return true;
    });
  }

  private async scanNextJsApp(): Promise<RouteInfo[]> {
    const routes: RouteInfo[] = [];

    // Check both /app and /src/app
    let appDir = this.getBasePath('app');
    if (!pathExists(this.tree, appDir)) {
      appDir = this.getBasePath('src/app');
    }

    if (!pathExists(this.tree, appDir)) {
      return routes;
    }

    // Find all page.{js,jsx,ts,tsx} files
    const pageFiles = this.tree.filter(
      entry =>
        entry.type === 'blob' &&
        entry.path.startsWith(appDir) &&
        /\/page\.(js|jsx|ts|tsx)$/.test(entry.path)
    );

    const total = pageFiles.length;
    let processed = 0;

    for (const file of pageFiles) {
      const relativePath = file.path
        .replace(appDir, '')
        .replace(/\/page\.(js|jsx|ts|tsx)$/, '');

      let route = relativePath || '/';

      // Remove route groups like (marketing)
      route = route.replace(/\/\([^)]+\)/g, '');

      // Normalize double slashes
      route = route.replace(/\/+/g, '/');
      if (route !== '/' && route.endsWith('/')) {
        route = route.slice(0, -1);
      }

      routes.push({
        path: route || '/',
        type: route.includes('[') ? 'dynamic' : 'static',
        filePath: file.path,
        component: file.path.split('/').pop(),
        framework: 'nextjs-app',
      });

      processed++;
      this.emitProgress('scanning', 10 + Math.floor((processed / total) * 80), routes.length, file.path);
    }

    return routes;
  }

  private async scanNextJsPages(): Promise<RouteInfo[]> {
    const routes: RouteInfo[] = [];

    // Check both /pages and /src/pages
    let pagesDir = this.getBasePath('pages');
    if (!pathExists(this.tree, pagesDir)) {
      pagesDir = this.getBasePath('src/pages');
    }

    if (!pathExists(this.tree, pagesDir)) {
      return routes;
    }

    // Find all page files, excluding _* and api/**
    const pageFiles = this.tree.filter(entry => {
      if (entry.type !== 'blob') return false;
      if (!entry.path.startsWith(pagesDir)) return false;
      if (!entry.path.match(/\.(js|jsx|ts|tsx)$/)) return false;

      const fileName = entry.path.split('/').pop() || '';
      if (fileName.startsWith('_')) return false;

      const relativePath = entry.path.replace(pagesDir + '/', '');
      if (relativePath.startsWith('api/')) return false;

      return true;
    });

    const total = pageFiles.length;
    let processed = 0;

    for (const file of pageFiles) {
      const relativePath = file.path
        .replace(pagesDir + '/', '')
        .replace(/\.(js|jsx|ts|tsx)$/, '');

      let route = '/' + relativePath;

      if (route.endsWith('/index')) {
        route = route.replace('/index', '') || '/';
      }

      routes.push({
        path: route,
        type: route.includes('[') ? 'dynamic' : 'static',
        filePath: file.path,
        component: file.path.split('/').pop(),
        framework: 'nextjs-pages',
      });

      processed++;
      this.emitProgress('scanning', 10 + Math.floor((processed / total) * 80), routes.length, file.path);
    }

    return routes;
  }

  private async scanReactRouter(): Promise<RouteInfo[]> {
    const routes: RouteInfo[] = [];
    const srcPath = this.getBasePath('src');

    // Find route config files
    const routeFiles = this.tree.filter(entry => {
      if (entry.type !== 'blob') return false;
      if (!entry.path.startsWith(srcPath)) return false;

      const fileName = entry.path.split('/').pop()?.toLowerCase() || '';
      return (
        (fileName.includes('routes') || fileName.includes('router') || fileName === 'app.tsx' || fileName === 'app.jsx') &&
        entry.path.match(/\.(js|jsx|ts|tsx)$/)
      );
    });

    for (const file of routeFiles.slice(0, 5)) { // Limit to avoid rate limits
      const content = await getFileContent(
        this.config.accessToken,
        this.config.owner,
        this.config.repo,
        file.path,
        this.config.branch
      );

      if (!content) continue;

      const routerType = this.detectReactRouterType(content);
      const routeMatches = content.matchAll(/path:\s*['"`]([^'"`]+)['"`]/g);

      for (const match of routeMatches) {
        routes.push({
          path: match[1],
          type: match[1].includes(':') ? 'dynamic' : 'static',
          filePath: file.path,
          framework: 'react-router',
          routerType,
        });
      }
    }

    return routes;
  }

  private detectReactRouterType(content: string): 'hash' | 'browser' | undefined {
    if (content.includes('createHashRouter') || content.includes('<HashRouter') || content.includes('HashRouter>')) {
      return 'hash';
    }
    if (content.includes('createBrowserRouter') || content.includes('<BrowserRouter') || content.includes('BrowserRouter>')) {
      return 'browser';
    }
    return undefined;
  }

  private async scanVueRouter(): Promise<RouteInfo[]> {
    const routes: RouteInfo[] = [];
    const srcPath = this.getBasePath('src');

    // Find router config files
    const routerFiles = this.tree.filter(entry => {
      if (entry.type !== 'blob') return false;
      if (!entry.path.startsWith(srcPath)) return false;

      return entry.path.includes('/router/') && entry.path.match(/\.(js|ts)$/);
    });

    for (const file of routerFiles.slice(0, 5)) { // Limit to avoid rate limits
      const content = await getFileContent(
        this.config.accessToken,
        this.config.owner,
        this.config.repo,
        file.path,
        this.config.branch
      );

      if (!content) continue;

      const routeMatches = content.matchAll(/path:\s*['"`]([^'"`]+)['"`]/g);

      for (const match of routeMatches) {
        routes.push({
          path: match[1],
          type: match[1].includes(':') ? 'dynamic' : 'static',
          filePath: file.path,
          framework: 'vue',
        });
      }
    }

    return routes;
  }

  private scanGeneric(): RouteInfo[] {
    return [
      {
        path: '/',
        type: 'static',
        framework: 'unknown',
      },
    ];
  }
}

export type { RouteInfo, ScanProgress, ScanResult } from './types';
