import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import { RouteInfo, ScanProgress, ScanResult } from './types';

export class RouteScanner {
  constructor(
    private scanPath: string,
    private onProgress?: (progress: ScanProgress) => void
  ) {}

  async scan(): Promise<ScanResult> {
    this.emitProgress('detecting', 0, 0);

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

    this.emitProgress('complete', 100, routes.length);

    return { routes, framework: projectType };
  }

  private emitProgress(phase: ScanProgress['phase'], progress: number, routesFound: number, currentFile?: string) {
    this.onProgress?.({ phase, progress, routesFound, currentFile });
  }

  private async detectProjectType(): Promise<string> {
    let searchPath = path.resolve(this.scanPath);
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
    let searchPath = path.resolve(this.scanPath);

    for (let i = 0; i < 3; i++) {
      try {
        await fs.access(path.join(searchPath, 'package.json'));
        return searchPath;
      } catch {
        searchPath = path.dirname(searchPath);
      }
    }

    return path.resolve(this.scanPath);
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
