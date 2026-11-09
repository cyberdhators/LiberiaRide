// End-to-end: a passenger saves Home from GPS on the account page, sees it offered when booking,
// and receives an in-app notification live (Realtime) with the unread badge clearing on open.
// Uses the DEVELOPMENT Supabase project; no QLS credits (reverse lookup is local).
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
  if (userId) await admin.auth.admin.deleteUser(userId);
});

test("passenger saves Home and receives a live notification", async ({ page }) => {
  const { data: user, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: "E2E Alerts" } });
  if (error) throw error;
  userId = user.user.id;
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError) throw linkError;
  await page.goto(`/auth/callback?token_hash=${link.properties.hashed_token}&type=magiclink&next=/passenger/account`);
  await expect(page).toHaveURL(/\/passenger\/account$/);

  // Save Home from GPS (mocked to Capitol Hill).
  await page.getByRole("button", { name: "Add Home" }).click();
  await page.getByRole("dialog", { name: "Set Home" }).getByRole("button", { name: "My location" }).click();
  await expect(page.getByText("Home", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Add Home" })).toHaveCount(0);

  // Offered as a saved place when booking.
  await page.goto("/passenger");
  await page.getByRole("button", { name: "Where to?" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: /^Home/ })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

  // Live notification → unread badge → list → badge clears.
  const alerts = page.getByRole("link", { name: /Alerts/ });
  await expect(alerts).toBeVisible();
  await page.waitForTimeout(2_000); // let the private channel subscribe
  const { error: insErr } = await admin.from("notifications").insert({ user_id: userId, kind: "test.e2e", title: "Hello from ops", body: "E2E notification" });
  if (insErr) throw insErr;
  await expect(alerts).toHaveAccessibleName(/1 unread/, { timeout: 15_000 });
  await alerts.click();
  await expect(page.getByText("Hello from ops")).toBeVisible();
  await expect.poll(async () => {
    const { count } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).is("read_at", null);
    return count;
  }, { timeout: 10_000 }).toBe(0);
});
