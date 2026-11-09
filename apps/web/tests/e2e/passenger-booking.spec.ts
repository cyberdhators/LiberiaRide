// End-to-end: a real passenger signs in (generated magic link → /auth/callback), books a ride on the
// map-first screen, lands on the live trip page, and cancels. Uses the DEVELOPMENT Supabase project.
// Requires apps/web/.env.local. Spends ~1 QLS credit for directions (then cached).
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const env = Object.fromEntries(
  readFileSync(join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const email = `e2e-${randomUUID().slice(0, 8)}@liberiaride.test`;
let userId = "";

test.afterAll(async () => {
  if (!userId) return;
  const { data: bookings } = await admin.from("bookings").select("id").eq("passenger_id", userId);
  const ids = (bookings ?? []).map((b) => b.id);
  if (ids.length) {
    await admin.from("payments").delete().in("booking_id", ids);
    await admin.from("bookings").delete().in("id", ids);
  }
  await admin.auth.admin.deleteUser(userId);
});

test("public home lists ride options", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Rides across Monrovia/ })).toBeVisible();
  await expect(page.getByText("Keke", { exact: true })).toBeVisible();
});

test("protected areas redirect to sign-in", async ({ page }) => {
  await page.goto("/passenger");
  await expect(page).toHaveURL(/\/login\?next=%2Fpassenger/);
  await expect(page.getByRole("button", { name: "Send code" })).toBeVisible();
});

test("passenger books and cancels a ride", async ({ page }) => {
  const { data: user, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: "E2E Passenger" } });
  if (error) throw error;
  userId = user.user.id;
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError) throw linkError;

  await page.goto(`/auth/callback?token_hash=${link.properties.hashed_token}&type=magiclink&next=/passenger`);
  await expect(page).toHaveURL(/\/passenger$/);

  // GPS (mocked to Capitol Hill) fills the pickup automatically.
  await expect(page.getByRole("button", { name: /Pinned location|Near / }).first()).toBeVisible({ timeout: 20_000 });

  // Destination: choose on map (free reverse lookup, no QLS search credit).
  await page.getByRole("button", { name: "Where to?" }).click();
  await page.getByRole("button", { name: "Choose on map" }).click();
  const map = page.locator(".maplibregl-canvas");
  await expect(map).toBeVisible();
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.2);
  await expect(page.getByRole("button", { name: /Pinned location \(6\./ }).nth(1)).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "See prices" }).click();
  const car = page.getByRole("radio", { name: /Car/ });
  await expect(car).toBeVisible({ timeout: 30_000 });
  await expect(car).toContainText("US$");
  await car.click();
  await page.getByRole("button", { name: /^Confirm Car/ }).click();

  // Trip page: searching (no online drivers in dev) → cancel.
  await expect(page).toHaveURL(/\/passenger\/trip\//, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: /Contacting a driver|Finding a driver|No driver found/ })).toBeVisible();
  await page.getByRole("button", { name: "Cancel ride" }).click();
  await page.getByRole("button", { name: "Cancel ride" }).last().click();
  await expect(page.getByRole("heading", { name: "Cancelled" })).toBeVisible({ timeout: 15_000 });

  const { data: rows } = await admin.from("bookings").select("status, booking_events(to_status)").eq("passenger_id", userId);
  expect(rows).toHaveLength(1);
  expect(rows![0]!.status).toBe("CANCELLED");
});
