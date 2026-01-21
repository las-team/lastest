import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import { RouteInfo, ScanProgress, ScanResult } from './types';

export class RouteScanner {
  private resolvedScanPath: string = '';

  constructor(
    private scanPath: string,
    private onProgress?: (progress: ScanProgress) => void
  ) {}

  async scan(): Promise<ScanResult> {
    this.emitProgress('detecting', 0, 0);

    // Resolve monorepo structure first
    this.resolvedScanPath = await this.resolveMonorepoPath();

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
        routes.push(...(await this.scanGeneric()));
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
    const basePath = path.resolve(this.scanPath);

    // Check if there's a package.json at root
    try {
      await fs.access(path.join(basePath, 'package.json'));
      return basePath; // Has package.json, use as-is
    } catch {
      // No package.json at root, check for common monorepo structures
    }

    // Common frontend directory names in monorepos
    const frontendDirs = ['frontend', 'client', 'web', 'app', 'packages/frontend', 'packages/web', 'packages/client'];

    for (const dir of frontendDirs) {
      const frontendPath = path.join(basePath, dir);
      try {
        const pkgPath = path.join(frontendPath, 'package.json');
        const content = await fs.readFile(pkgPath, 'utf-8');
        const pkg = JSON.parse(content);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        // Check if this looks like a frontend project
        if (deps.next || deps.react || deps.vue) {
          return frontendPath;
        }
      } catch {
        // Not a valid frontend directory
      }
    }

    return basePath; // Fall back to original path
  }

  private emitProgress(phase: ScanProgress['phase'], progress: number, routesFound: number, currentFile?: string) {
    this.onProgress?.({ phase, progress, routesFound, currentFile });
  }

  private async detectProjectType(): Promise<string> {
    let searchPath = this.resolvedScanPath || path.resolve(this.scanPath);
    let packageJsonPath = path.join(searchPath, 'package.json');

    for (let i = 0; i < 3; i++) {
      try {
        const content = await fs.readFile(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(content);
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

        if (deps.next) {
          const projectRoot = path.dirname(packageJsonPath);
          try {
            await fs.access(path.join(projectRoot, 'app'));
            return 'nextjs-app';
          } catch {
            try {
              await fs.access(path.join(projectRoot, 'src', 'app'));
              return 'nextjs-app';
            } catch {
              return 'nextjs-pages';
            }
          }
        }

        if (deps['react-router'] || deps['react-router-dom']) {
          return 'react-router';
        }

        if (deps.vue && deps['vue-router']) {
          return 'vue';
        }

        break;
      } catch {
        searchPath = path.dirname(searchPath);
        packageJsonPath = path.join(searchPath, 'package.json');
      }
    }

    return 'unknown';
  }

  private async getProjectRoot(): Promise<string> {
    let searchPath = this.resolvedScanPath || path.resolve(this.scanPath);

    for (let i = 0; i < 3; i++) {
      try {
        await fs.access(path.join(searchPath, 'package.json'));
        return searchPath;
      } catch {
        searchPath = path.dirname(searchPath);
      }
    }

    return this.resolvedScanPath || path.resolve(this.scanPath);
  }

  /**
   * Scan for navigation/sidebar components and extract Link elements with labels
   */
  private async scanNavigationLinks(): Promise<Array<{ path: string; label: string; navSource: string }>> {
    const navLinks: Array<{ path: string; label: string; navSource: string }> = [];
    const projectRoot = await this.getProjectRoot();

    // Find potential navigation files
    const navFiles = await glob('**/{sidebar,nav,navigation,menu,header}*.{js,jsx,ts,tsx}', {
      cwd: path.join(projectRoot, 'src'),
      absolute: true,
      ignore: ['**/node_modules/**'],
      nocase: true,
    });

    // Also check components/ui directory specifically
    const uiNavFiles = await glob('**/components/{ui,layout}/**/*.{js,jsx,ts,tsx}', {
      cwd: projectRoot,
      absolute: true,
      ignore: ['**/node_modules/**'],
    });

    const allNavFiles = [...new Set([...navFiles, ...uiNavFiles])];

    for (const file of allNavFiles) {
      try {
        const content = await fs.readFile(file, 'utf-8');

        // Skip if no Link imports
        if (!content.includes('Link') && !content.includes('href')) continue;

        // Pattern 1: NavItem arrays like { label: 'Dashboard', href: '/dashboard' }
        const navItemPattern = /\{\s*(?:label|name|title):\s*['"`]([^'"`]+)['"`],\s*(?:href|to|path):\s*['"`]([^'"`]+)['"`]/g;
        let match;
        while ((match = navItemPattern.exec(content)) !== null) {
          const [, label, href] = match;
          if (href.startsWith('/') && !href.includes('http')) {
            navLinks.push({ path: href, label, navSource: file });
          }
        }

        // Pattern 2: Reversed order { href: '/dashboard', label: 'Dashboard' }
        const navItemReversedPattern = /\{\s*(?:href|to|path):\s*['"`]([^'"`]+)['"`],\s*(?:label|name|title):\s*['"`]([^'"`]+)['"`]/g;
        while ((match = navItemReversedPattern.exec(content)) !== null) {
          const [, href, label] = match;
          if (href.startsWith('/') && !href.includes('http')) {
            navLinks.push({ path: href, label, navSource: file });
          }
        }

        // Pattern 3: JSX Link elements <Link href="/path">Label</Link>
        const jsxLinkPattern = /<Link[^>]*href=["']([^"']+)["'][^>]*>([^<]+)</g;
        while ((match = jsxLinkPattern.exec(content)) !== null) {
          const [, href, label] = match;
          if (href.startsWith('/') && !href.includes('http') && label.trim()) {
            navLinks.push({ path: href, label: label.trim(), navSource: file });
          }
        }

      } catch {
        // Skip files that can't be read
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
    const projectRoot = await this.getProjectRoot();

    // Check both /app and /src/app
    let appDir = path.join(projectRoot, 'app');
    try {
      await fs.access(appDir);
    } catch {
      appDir = path.join(projectRoot, 'src', 'app');
    }

    try {
      await fs.access(appDir);
    } catch {
      return routes;
    }

    const pageFiles = await glob('**/page.{js,jsx,ts,tsx}', {
      cwd: appDir,
      absolute: true,
    });

    const total = pageFiles.length;
    let processed = 0;

    for (const file of pageFiles) {
      const relativePath = path.relative(appDir, path.dirname(file));
      let route = '/' + relativePath.replace(/\\/g, '/');

      // Clean up route
      if (route === '/') route = '/';
      else if (route.startsWith('/')) route = route;
      else route = '/' + route;

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
        filePath: file,
        component: path.basename(file),
        framework: 'nextjs-app',
      });

      processed++;
      this.emitProgress('scanning', 10 + Math.floor((processed / total) * 80), routes.length, file);
    }

    return routes;
  }

  private async scanNextJsPages(): Promise<RouteInfo[]> {
    const routes: RouteInfo[] = [];
    const projectRoot = await this.getProjectRoot();

    let pagesDir = path.join(projectRoot, 'pages');
    try {
      await fs.access(pagesDir);
    } catch {
      pagesDir = path.join(projectRoot, 'src', 'pages');
    }

    try {
      await fs.access(pagesDir);
    } catch {
      return routes;
    }

    const pageFiles = await glob('**/*.{js,jsx,ts,tsx}', {
      cwd: pagesDir,
      absolute: true,
      ignore: ['**/_*.{js,jsx,ts,tsx}', '**/api/**'],
    });

    const total = pageFiles.length;
    let processed = 0;

    for (const file of pageFiles) {
      const relativePath = path.relative(pagesDir, file);
      let route = '/' + relativePath.replace(/\\/g, '/').replace(/\.(js|jsx|ts|tsx)$/, '');

      if (route.endsWith('/index')) {
        route = route.replace('/index', '') || '/';
      }

      routes.push({
        path: route,
        type: route.includes('[') ? 'dynamic' : 'static',
        filePath: file,
        component: path.basename(file),
        framework: 'nextjs-pages',
      });

      processed++;
      this.emitProgress('scanning', 10 + Math.floor((processed / total) * 80), routes.length, file);
    }

    return routes;
  }

  private async scanReactRouter(): Promise<RouteInfo[]> {
    const routes: RouteInfo[] = [];
    const projectRoot = await this.getProjectRoot();

    const routeFiles = await glob('**/{routes,router,App}.{js,jsx,ts,tsx}', {
      cwd: path.join(projectRoot, 'src'),
      absolute: true,
      ignore: ['**/node_modules/**'],
    });

    for (const file of routeFiles) {
      const content = await fs.readFile(file, 'utf-8');
      const routerType = this.detectReactRouterType(content);
      const routeMatches = content.matchAll(/path:\s*['"`]([^'"`]+)['"`]/g);

      for (const match of routeMatches) {
        routes.push({
          path: match[1],
          type: match[1].includes(':') ? 'dynamic' : 'static',
          filePath: file,
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
    const projectRoot = await this.getProjectRoot();

    const routerFiles = await glob('**/router/*.{js,ts}', {
      cwd: path.join(projectRoot, 'src'),
      absolute: true,
    });

    for (const file of routerFiles) {
      const content = await fs.readFile(file, 'utf-8');
      const routeMatches = content.matchAll(/path:\s*['"`]([^'"`]+)['"`]/g);

      for (const match of routeMatches) {
        routes.push({
          path: match[1],
          type: match[1].includes(':') ? 'dynamic' : 'static',
          filePath: file,
          framework: 'vue',
        });
      }
    }

    return routes;
  }

  private async scanGeneric(): Promise<RouteInfo[]> {
    return [{
      path: '/',
      type: 'static',
      framework: 'unknown',
    }];
  }
}

export type { RouteInfo, ScanProgress, ScanResult } from './types';
