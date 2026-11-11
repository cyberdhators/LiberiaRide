import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  retries: 0,
  // These tests sign in real users against the shared dev project and run a production server;
  // more than two browsers at once overloads a typical laptop and causes false failures.
  workers: 2,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`,
    ...devices["Pixel 7"],
    geolocation: { latitude: 6.3002, longitude: -10.7983 }, // Capitol Hill, Monrovia
    permissions: ["geolocation"],
    trace: "retain-on-failure",
  },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
