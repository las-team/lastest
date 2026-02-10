import type { StabilizationSettings } from '@/lib/db/schema';
import { DEFAULT_STABILIZATION_SETTINGS } from '@/lib/db/schema';

export const TESTING_TEMPLATE_IDS = [
  'saas',
  'marketing',
  'canvas',
  'ecommerce',
  'documentation',
  'mobile-first',
  'spa',
  'cms',
  'custom',
] as const;

export type TestingTemplateId = (typeof TESTING_TEMPLATE_IDS)[number];

export interface TestingTemplateSettings {
  browser: string;
  viewportWidth: number;
  viewportHeight: number;
  headlessMode: string;
  freezeAnimations: boolean;
  screenshotDelay: number;
  navigationTimeout: number;
  actionTimeout: number;
  maxParallelTests: number;
  stabilization: StabilizationSettings;
}

export interface TestingTemplate {
  name: string;
  description: string;
  icon: string;
  settings: TestingTemplateSettings;
}

export const TESTING_TEMPLATES: Record<Exclude<TestingTemplateId, 'custom'>, TestingTemplate> = {
  saas: {
    name: 'SaaS / Dashboard',
    description: 'Data-heavy dashboards with dynamic content, timestamps, and charts',
    icon: 'LayoutDashboard',
    settings: {
      browser: 'chromium',
      viewportWidth: 1920,
      viewportHeight: 1080,
      headlessMode: 'true',
      freezeAnimations: true,
      screenshotDelay: 500,
      navigationTimeout: 45000,
      actionTimeout: 10000,
      maxParallelTests: 2,
      stabilization: {
        ...DEFAULT_STABILIZATION_SETTINGS,
        waitForNetworkIdle: true,
        networkIdleTimeout: 8000,
        waitForDomStable: true,
        domStableTimeout: 3000,
        freezeTimestamps: true,
        autoMaskDynamicContent: true,
      },
    },
  },
  marketing: {
    name: 'Marketing Website',
    description: 'Static marketing pages with third-party scripts and hero images',
    icon: 'Globe',
    settings: {
      browser: 'chromium',
      viewportWidth: 1440,
      viewportHeight: 900,
      headlessMode: 'true',
      freezeAnimations: true,
      screenshotDelay: 300,
      navigationTimeout: 30000,
      actionTimeout: 5000,
      maxParallelTests: 3,
      stabilization: {
        ...DEFAULT_STABILIZATION_SETTINGS,
        blockThirdParty: true,
        mockThirdPartyImages: true,
        hideLoadingIndicators: true,
      },
    },
  },
  canvas: {
    name: 'Canvas / Drawing',
    description: 'WebGL, canvas-based, or drawing apps with rendering variability',
    icon: 'Palette',
    settings: {
      browser: 'chromium',
      viewportWidth: 1920,
      viewportHeight: 1080,
      headlessMode: 'shell',
      freezeAnimations: true,
      screenshotDelay: 1000,
      navigationTimeout: 60000,
      actionTimeout: 15000,
      maxParallelTests: 1,
      stabilization: {
        ...DEFAULT_STABILIZATION_SETTINGS,
        waitForNetworkIdle: true,
        networkIdleTimeout: 10000,
        waitForDomStable: true,
        domStableTimeout: 5000,
        burstCapture: true,
        burstFrameCount: 5,
      },
    },
  },
  ecommerce: {
    name: 'E-commerce',
    description: 'Product catalogs with prices, images, and dynamic cart content',
    icon: 'ShoppingCart',
    settings: {
      browser: 'chromium',
      viewportWidth: 1440,
      viewportHeight: 900,
      headlessMode: 'true',
      freezeAnimations: true,
      screenshotDelay: 500,
      navigationTimeout: 45000,
      actionTimeout: 10000,
      maxParallelTests: 2,
      stabilization: {
        ...DEFAULT_STABILIZATION_SETTINGS,
        waitForNetworkIdle: true,
        networkIdleTimeout: 8000,
        freezeTimestamps: true,
        autoMaskDynamicContent: true,
        mockThirdPartyImages: true,
      },
    },
  },
  documentation: {
    name: 'Documentation',
    description: 'Mostly static text content with code blocks and minimal JS',
    icon: 'BookOpen',
    settings: {
      browser: 'chromium',
      viewportWidth: 1280,
      viewportHeight: 720,
      headlessMode: 'true',
      freezeAnimations: false,
      screenshotDelay: 0,
      navigationTimeout: 15000,
      actionTimeout: 5000,
      maxParallelTests: 4,
      stabilization: {
        ...DEFAULT_STABILIZATION_SETTINGS,
        waitForNetworkIdle: true,
        networkIdleTimeout: 3000,
        waitForFonts: true,
        freezeTimestamps: false,
        freezeRandomValues: false,
      },
    },
  },
  'mobile-first': {
    name: 'Mobile-First',
    description: 'Mobile viewport with touch interactions and responsive layouts',
    icon: 'Smartphone',
    settings: {
      browser: 'webkit',
      viewportWidth: 390,
      viewportHeight: 844,
      headlessMode: 'true',
      freezeAnimations: true,
      screenshotDelay: 300,
      navigationTimeout: 30000,
      actionTimeout: 8000,
      maxParallelTests: 2,
      stabilization: {
        ...DEFAULT_STABILIZATION_SETTINGS,
        waitForNetworkIdle: true,
        networkIdleTimeout: 5000,
        waitForDomStable: true,
        domStableTimeout: 2000,
        waitForFonts: true,
      },
    },
  },
  spa: {
    name: 'SPA',
    description: 'Single-page app with client-side routing and dynamic state',
    icon: 'AppWindow',
    settings: {
      browser: 'chromium',
      viewportWidth: 1920,
      viewportHeight: 1080,
      headlessMode: 'true',
      freezeAnimations: true,
      screenshotDelay: 500,
      navigationTimeout: 45000,
      actionTimeout: 10000,
      maxParallelTests: 2,
      stabilization: {
        ...DEFAULT_STABILIZATION_SETTINGS,
        waitForNetworkIdle: true,
        networkIdleTimeout: 8000,
        waitForDomStable: true,
        domStableTimeout: 3000,
        freezeTimestamps: true,
      },
    },
  },
  cms: {
    name: 'CMS',
    description: 'Content management systems with rich editors, media, and loaders',
    icon: 'FileEdit',
    settings: {
      browser: 'chromium',
      viewportWidth: 1920,
      viewportHeight: 1080,
      headlessMode: 'true',
      freezeAnimations: true,
      screenshotDelay: 500,
      navigationTimeout: 45000,
      actionTimeout: 10000,
      maxParallelTests: 2,
      stabilization: {
        ...DEFAULT_STABILIZATION_SETTINGS,
        waitForNetworkIdle: true,
        networkIdleTimeout: 8000,
        waitForDomStable: true,
        domStableTimeout: 3000,
        freezeTimestamps: true,
        autoMaskDynamicContent: true,
        hideLoadingIndicators: true,
      },
    },
  },
};

export function isValidTemplateId(id: string): id is TestingTemplateId {
  return TESTING_TEMPLATE_IDS.includes(id as TestingTemplateId);
}
