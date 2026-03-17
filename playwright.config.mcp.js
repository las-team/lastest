module.exports = {
  testDir: './tests',
  outputDir: './.playwright-mcp',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    headless: false,
  },
};
