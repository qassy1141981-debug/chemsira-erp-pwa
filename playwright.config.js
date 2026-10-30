const { defineConfig } = require("@playwright/test");
const { existsSync } = require("node:fs");

const bundledChromium = "/repl/tools/bin/chromium";
const executablePath =
  process.env.CHROMIUM_PATH ||
  (existsSync(bundledChromium) ? bundledChromium : undefined);

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5000",
    browserName: "chromium",
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: "python3 run.py",
    url: "http://127.0.0.1:5000",
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
