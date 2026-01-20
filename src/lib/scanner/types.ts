export interface RouteInfo {
  path: string;
  type: 'static' | 'dynamic';
  filePath?: string;
  component?: string;
  framework?: 'nextjs-app' | 'nextjs-pages' | 'react-router' | 'vue' | 'unknown';
  routerType?: 'hash' | 'browser';
}

export interface ScanProgress {
  phase: 'detecting' | 'scanning' | 'complete';
  progress: number; // 0-100
  currentFile?: string;
  routesFound: number;
}

export interface ScanResult {
  routes: RouteInfo[];
  framework: string;
}
