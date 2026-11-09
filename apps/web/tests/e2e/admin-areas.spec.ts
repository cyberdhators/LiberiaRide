// End-to-end: an administrator manages ride types and service areas. Uses the DEVELOPMENT Supabase project
// with a temporary admin; everything created here is removed afterwards.
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
const tag = randomUUID().slice(0, 6);
const email = `e2e-admin-${tag}@liberiaride.test`;
const zoneCode = `e2e_zone_${tag}`;
const typeCode = `zz_${[...tag].map((c) => String.fromCharCode(97 + (parseInt(c, 16) % 26))).join("")}`; // letters only, as codes require
let userId = "";

test.afterAll(async () => {
  await admin.from("geofences").delete().eq("code", zoneCode);
  await admin.from("vehicle_categories").delete().eq("code", typeCode);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

test("admin manages ride types and service areas", async ({ page }) => {
  const { data: u, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: "E2E Admin" } });
  if (error) throw error;
  userId = u.user.id;
  await admin.from("user_roles").insert({ user_id: userId, role: "admin" });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  await page.goto(`/auth/callback?token_hash=${link!.properties.hashed_token}&type=magiclink&next=/admin/areas`);
  await expect(page.getByRole("heading", { name: "Ride types & areas" })).toBeVisible();

  // Service area is listed and drawn.
  await expect(page.getByText("Greater Monrovia").first()).toBeVisible();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();

  // The last service area cannot be switched off.
  await page.getByRole("button", { name: "Edit" }).last().click();
  await page.getByLabel("Active").uncheck();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/keep at least one active service area/i)).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  // Add an airport zone from GeoJSON.
  await page.getByRole("button", { name: "Add area" }).click();
  await page.getByLabel("Code").last().fill(zoneCode);
  await page.getByLabel("Kind").selectOption("airport");
  await page.getByLabel("Name").last().fill("E2E Airport");
  await page.getByLabel("Shape").fill(JSON.stringify({ type: "Polygon", coordinates: [[[-10.375, 6.225], [-10.345, 6.225], [-10.345, 6.25], [-10.375, 6.25], [-10.375, 6.225]]] }));
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("E2E Airport")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Airport · 9\.2 km²/)).toBeVisible();

  // A new ride type cannot be offered before it has a fare rule.
  await page.getByRole("button", { name: "Add ride type" }).click();
  await page.getByLabel("Code").first().fill(typeCode);
  await page.getByLabel("Name").first().fill("E2E Bus");
  await page.getByLabel(/Offered to passengers/).check();
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText(/add an active fare rule/i)).toBeVisible();
  await page.getByLabel(/Offered to passengers/).uncheck();
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByRole("cell", { name: /E2E Bus/ })).toBeVisible({ timeout: 15_000 });

  const { data: rows } = await admin.from("audit_logs").select("action").eq("actor_id", userId);
  expect(rows!.map((r) => r.action).sort()).toEqual(["category.create", "geofence.create"]);
});
