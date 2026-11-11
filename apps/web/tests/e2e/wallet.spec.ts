// End-to-end: a driver who owes more than the debt limit shows as blocked in Finance; an admin
// records their top-up; the driver's Earnings page shows the new balance. DEVELOPMENT Supabase
// project; everything created here is removed afterwards.
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
const tag = randomUUID().slice(0, 8);
const ids = { admin: "", driver: "" };

async function signIn(page: import("@playwright/test").Page, email: string, next: string) {
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  await page.goto(`/auth/callback?token_hash=${link!.properties.hashed_token}&type=magiclink&next=${encodeURIComponent(next)}`);
}

test.afterAll(async () => {
  if (ids.driver) {
    await admin.from("driver_wallet_entries").delete().eq("driver_id", ids.driver);
    await admin.from("drivers").delete().eq("id", ids.driver);
    await admin.auth.admin.deleteUser(ids.driver);
  }
  if (ids.admin) await admin.auth.admin.deleteUser(ids.admin);
});

test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

test("finance records a top-up that unblocks an indebted driver", async ({ browser }) => {
  const a = await admin.auth.admin.createUser({ email: `e2e-fin-${tag}@liberiaride.test`, email_confirm: true, user_metadata: { full_name: "E2E Finance" } });
  ids.admin = a.data.user!.id;
  await admin.from("user_roles").insert({ user_id: ids.admin, role: "admin" });
  const d = await admin.auth.admin.createUser({ email: `e2e-owe-${tag}@liberiaride.test`, email_confirm: true, user_metadata: { full_name: `Owing Driver ${tag}` } });
  ids.driver = d.data.user!.id;
  await admin.from("user_roles").insert({ user_id: ids.driver, role: "driver" });
  const { error: dErr } = await admin.from("drivers").insert({ id: ids.driver, status: "approved", licence_number: `E2E-${tag}` });
  if (dErr) throw dErr;
  // Debt of USD 30 (limit is USD 25).
  const { error: wErr } = await admin.from("driver_wallet_entries").insert({
    driver_id: ids.driver, currency: "USD", kind: "adjustment", amount_minor: -3000, reference: `e2e:${tag}`, note: "E2E debt" });
  if (wErr) throw wErr;

  const ops = await browser.newPage();
  await signIn(ops, `e2e-fin-${tag}@liberiaride.test`, "/admin/finance");
  const row = ops.getByRole("row", { name: new RegExp(`Owing Driver ${tag}`) });
  await expect(row).toContainText("Owes US$30.00");
  await expect(row).toContainText("over limit — blocked");

  await row.getByRole("button", { name: "Record top-up" }).click();
  await row.getByLabel("Amount").fill("40");
  await row.getByLabel("Reference").fill(`RCPT-${tag}`);
  await row.getByRole("button", { name: "Save" }).click();
  await expect(row).toContainText("Owed US$10.00", { timeout: 15_000 });
  await expect(row).toContainText("in credit");

  const drv = await browser.newPage({ viewport: { width: 400, height: 860 } });
  await signIn(drv, `e2e-owe-${tag}@liberiaride.test`, "/driver/earnings");
  await expect(drv.getByText("Balance with LiberiaRide")).toBeVisible();
  await expect(drv.getByText(/LiberiaRide owes you/)).toContainText("US$10.00");
  await expect(drv.getByText("Top-up")).toBeVisible();

  const { data: audit } = await admin.from("audit_logs").select("action").eq("actor_id", ids.admin);
  expect(audit!.map((x) => x.action)).toContain("wallet.topup");
});
