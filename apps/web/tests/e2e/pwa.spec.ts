// End-to-end: the app is installable (manifest + PNG icons), the service worker
// registers and controls the page, and navigations fall back to /offline when the
// network is gone. No sign-in needed.
import { expect, test } from "@playwright/test";

test("installable: manifest, icons and service worker", async ({ page, request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/");
  for (const icon of manifest.icons as { src: string; sizes: string }[]) {
    const res = await request.get(icon.src);
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
    const png = await res.body();
    expect(png.readUInt32BE(16), `${icon.src} width`).toBe(Number(icon.sizes.split("x")[0]));
  }

  await page.goto("/");
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toMatch(/\/$/);

  const latest = await request.get("/api/push/latest");
  expect((await latest.json()).items).toEqual([]);   // signed out: nothing to show
});

test("offline navigation shows the offline page", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();   // make sure the page is controlled by the worker
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.goto("/passenger").catch(() => undefined);
  await expect(page.getByRole("heading", { name: "No internet connection" })).toBeVisible();
  await context.setOffline(false);
});
