// End-to-end: an admin adds busy-hour pricing for a small test zone around the E2E pickup point;
// a passenger pricing a trip from there sees the busy-hour notice. The zone keeps the window from
// affecting anyone else using the dev project. Everything is removed afterwards.
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
const zoneCode = `e2e_surge_${tag}`;
const ids = { admin: "", pax: "" };

async function signIn(page: import("@playwright/test").Page, email: string, next: string) {
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  await page.goto(`/auth/callback?token_hash=${link!.properties.hashed_token}&type=magiclink&next=${encodeURIComponent(next)}`);
}

test.afterAll(async () => {
  const { data: zone } = await admin.from("geofences").select("id").eq("code", zoneCode).maybeSingle();
  if (zone) {
    await admin.from("surge_windows").delete().eq("geofence_id", zone.id);
    await admin.from("geofences").delete().eq("id", zone.id);
  }
  if (ids.pax) {
    await admin.from("fare_estimates").delete().eq("passenger_id", ids.pax);
    await admin.auth.admin.deleteUser(ids.pax);
  }
  if (ids.admin) await admin.auth.admin.deleteUser(ids.admin);
});

test("admin busy hours raise the quoted price in that zone", async ({ browser }) => {
  // ~300 m box around the mocked GPS position (Capitol Hill).
  const { error: zErr } = await admin.from("geofences").insert({
    code: zoneCode, name: `E2E surge zone ${tag}`, kind: "pricing_zone",
    area: "SRID=4326;MULTIPOLYGON(((-10.8013 6.2972,-10.7953 6.2972,-10.7953 6.3032,-10.8013 6.3032,-10.8013 6.2972)))",
  });
  if (zErr) throw zErr;
  const a = await admin.auth.admin.createUser({ email: `e2e-srg-${tag}@liberiaride.test`, email_confirm: true, user_metadata: { full_name: "E2E Pricing" } });
  ids.admin = a.data.user!.id;
  await admin.from("user_roles").insert({ user_id: ids.admin, role: "admin" });

  const ops = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await signIn(ops, `e2e-srg-${tag}@liberiaride.test`, "/admin/fares");
  await ops.getByRole("button", { name: "Add busy hours" }).click();
  await ops.getByLabel("Busy-hour label").fill(`E2E rush ${tag}`);
  await ops.getByLabel("Busy-hour area").selectOption({ label: `E2E surge zone ${tag}` });
  await ops.getByLabel("Busy-hour multiplier").fill("1.5");
  const now = new Date(); // Monrovia is UTC
  const hm = (d: Date) => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  await ops.getByLabel("Busy-hour from").fill(hm(new Date(now.getTime() - 5 * 60_000)));
  await ops.getByLabel("Busy-hour to").fill(hm(new Date(now.getTime() + 60 * 60_000)));
  for (const d of ["Sun", "Sat"]) await ops.getByRole("button", { name: d, exact: true }).click(); // all seven days
  await ops.getByRole("form", { name: "Busy-hour window" }).getByRole("button", { name: "Save" }).click();
  await expect(ops.getByText(`E2E rush ${tag}`)).toBeVisible({ timeout: 15_000 });
  await expect(ops.getByText(/×1\.50/)).toBeVisible();

  const p = await admin.auth.admin.createUser({ email: `e2e-srgp-${tag}@liberiaride.test`, email_confirm: true, user_metadata: { full_name: "E2E Rider" } });
  ids.pax = p.data.user!.id;
  const page = await browser.newPage({ geolocation: { latitude: 6.3002, longitude: -10.7983 }, permissions: ["geolocation"] });
  await signIn(page, `e2e-srgp-${tag}@liberiaride.test`, "/passenger");
  await expect(page.getByRole("button", { name: /Your current location|near |Near |Road|Street/ }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Where to?" }).click();
  await page.getByRole("button", { name: "Choose on map" }).click();
  const box = (await page.locator(".maplibregl-canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.2);
  await expect(page.getByRole("button", { name: "Where to?" })).toHaveCount(0, { timeout: 15_000 });
  await page.getByRole("button", { name: "See prices" }).click();
  await page.getByRole("radio", { name: /Car/ }).click({ timeout: 30_000 });
  await expect(page.getByText("Busy hours: prices ×1.50")).toBeVisible();

  const { data: est } = await admin.from("fare_estimates").select("surge_multiplier").eq("passenger_id", ids.pax).limit(1).single();
  expect(Number(est!.surge_multiplier)).toBe(1.5);
});
