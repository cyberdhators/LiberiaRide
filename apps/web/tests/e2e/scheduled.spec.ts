// End-to-end: a passenger schedules a ride for someone else for tomorrow morning, sees it under
// Upcoming, and cancels it free of charge. DEVELOPMENT Supabase project; cleaned up afterwards.
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
const email = `e2e-sched-${randomUUID().slice(0, 8)}@liberiaride.test`;
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

test("passenger schedules a ride for someone else and cancels it", async ({ page }) => {
  const { data: user, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: "E2E Scheduler" } });
  if (error) throw error;
  userId = user.user.id;
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  await page.goto(`/auth/callback?token_hash=${link!.properties.hashed_token}&type=magiclink&next=/passenger`);
  await expect(page).toHaveURL(/\/passenger$/);

  await expect(page.getByRole("button", { name: /Your current location|near |Near |Road|Street/ }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Where to?" }).click();
  await page.getByRole("button", { name: "Choose on map" }).click();
  const box = (await page.locator(".maplibregl-canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.2);
  await expect(page.getByRole("button", { name: "Where to?" })).toHaveCount(0, { timeout: 15_000 });
  await page.getByRole("button", { name: "See prices" }).click();
  const car = page.getByRole("radio", { name: /Car/ });
  await expect(car).toBeVisible({ timeout: 30_000 });
  await car.click();

  // Tomorrow 07:30 (device time), for someone else.
  await page.getByRole("radio", { name: "Schedule" }).click();
  const t = new Date(Date.now() + 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  await page.getByLabel("Pickup time").fill(`${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T07:30`);
  await page.getByLabel(/Booking for someone else/).check();
  await page.getByLabel("Rider's name").fill("Musu Kamara");
  await page.getByLabel("Rider's phone").fill("077 012 3456");
  await page.getByRole("button", { name: /^Schedule ride/ }).click();

  await expect(page).toHaveURL(/\/passenger\/trip\//, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Scheduled" })).toBeVisible();
  await expect(page.getByText(/Pickup .*07:30/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Send Musu the PIN/ })).toBeVisible();

  const { data: rows } = await admin.from("bookings").select("id, status, scheduled_for, booking_riders(name, phone)").eq("passenger_id", userId);
  expect(rows).toHaveLength(1);
  expect(rows![0]!.status).toBe("SCHEDULED");
  expect(rows![0]!.booking_riders).toMatchObject({ name: "Musu Kamara", phone: "+231770123456" });

  // The trip link already works for a scheduled ride (no driver yet), even signed out.
  const { data: tok } = await admin.from("bookings").select("share_token").eq("id", rows![0]!.id).single();
  const anon = await page.context().browser()!.newPage();
  await anon.goto(`/share/${encodeURIComponent(tok!.share_token)}`);
  await expect(anon.getByText(/Pickup .*07:30/)).toBeVisible();
  await anon.close();

  await page.goto("/passenger/trips");
  await expect(page.getByRole("heading", { name: "Upcoming" })).toBeVisible();
  await page.getByRole("link", { name: /07:30/ }).click();
  await page.getByRole("button", { name: "Cancel ride" }).click();
  await page.getByRole("button", { name: "Cancel ride" }).last().click();
  await expect(page.getByRole("heading", { name: "Cancelled" })).toBeVisible({ timeout: 15_000 });
  const { data: after } = await admin.from("bookings").select("status, cancellation_fee_minor").eq("passenger_id", userId).single();
  expect(after).toMatchObject({ status: "CANCELLED", cancellation_fee_minor: 0 });
});
