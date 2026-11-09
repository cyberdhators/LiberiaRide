// End-to-end: a registered driver joins a fleet with its code; the fleet operator sees the driver
// in /fleet and removes them. Uses the DEVELOPMENT Supabase project; no QLS credits.
import { expect, test, type Browser, type Page } from "@playwright/test";
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
const created: string[] = [];
let fleetId = "";

async function makeUser(name: string) {
  const email = `e2e-${name.toLowerCase().replace(/\W/g, "")}-${tag}@liberiaride.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: name } });
  if (error) throw error;
  created.push(data.user.id);
  return { id: data.user.id, email };
}

async function signIn(browser: Browser, email: string, next: string): Promise<Page> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const page = await (await browser.newContext()).newPage();
  await page.goto(`/auth/callback?token_hash=${data.properties.hashed_token}&type=magiclink&next=${encodeURIComponent(next)}`);
  return page;
}

test.afterAll(async () => {
  for (const id of created) await admin.from("fleet_drivers").delete().eq("driver_id", id);
  if (fleetId) await admin.from("fleets").delete().eq("id", fleetId);
  for (const id of created) {
    await admin.from("drivers").delete().eq("id", id);
    await admin.auth.admin.deleteUser(id);
  }
});

test("driver joins a fleet with its code; operator sees and removes them", async ({ browser }) => {
  const owner = await makeUser("Fleet Owner");
  const driver = await makeUser("Fleet Driver");

  // Driver registers through the real RPC with their own session.
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: driver.email });
  const asDriver = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { error: otpErr } = await asDriver.auth.verifyOtp({ token_hash: link!.properties.hashed_token, type: "magiclink" });
  if (otpErr) throw otpErr;
  const { error: regErr } = await asDriver.rpc("register_driver", {
    p_full_name: "Fleet Driver", p_licence_number: `E2E-${tag}`, p_licence_expiry: "2030-01-01", p_date_of_birth: "1990-01-01", p_address_text: "Sinkor",
  });
  if (regErr) throw regErr;

  // Fleet set up by operations (service role stands in for the admin RPC, which is covered by supabase/tests/fleet_test.sql).
  const { data: fleet, error: fErr } = await admin.from("fleets").insert({ name: `E2E Fleet ${tag}`, owner_id: owner.id }).select("id, join_code").single();
  if (fErr) throw fErr;
  fleetId = fleet.id;
  await admin.from("user_roles").insert({ user_id: owner.id, role: "fleet_operator" });

  // Driver joins from Earnings.
  const dp = await signIn(browser, driver.email, "/driver/earnings");
  await expect(dp).toHaveURL(/\/driver\/earnings$/);
  await dp.getByLabel("Fleet code").fill(fleet.join_code.toLowerCase());
  await dp.getByRole("button", { name: "Join" }).click();
  await expect(dp.getByText(`E2E Fleet ${tag}`)).toBeVisible({ timeout: 15_000 });

  // Operator sees the driver and removes them.
  const op = await signIn(browser, owner.email, "/fleet");
  await expect(op).toHaveURL(/\/fleet$/);
  await expect(op.getByRole("heading", { name: `E2E Fleet ${tag}` })).toBeVisible();
  await expect(op.getByText(fleet.join_code)).toBeVisible();
  await expect(op.getByText("Fleet Driver")).toBeVisible();
  op.once("dialog", (d) => void d.accept());
  await op.getByRole("button", { name: "Remove" }).click();
  await expect(op.getByText("No drivers yet")).toBeVisible({ timeout: 15_000 });

  const { data: row } = await admin.from("drivers").select("fleet_id").eq("id", driver.id).single();
  expect(row!.fleet_id).toBeNull();
});
