// End-to-end: suggestions appear while typing (free landmark list, no QLS), and nothing on the
// passenger's search screen mentions QLS. DEVELOPMENT Supabase project; account removed afterwards.
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
const email = `e2e-ta-${randomUUID().slice(0, 8)}@liberiaride.test`;
let userId = "";

test.afterAll(async () => {
  if (!userId) return;
  await admin.from("fare_estimates").delete().eq("passenger_id", userId);
  await admin.auth.admin.deleteUser(userId);
});

test("destination suggestions appear while typing", async ({ page }) => {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: "E2E Typist" } });
  if (error) throw error;
  userId = data.user.id;
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  await page.goto(`/auth/callback?token_hash=${link!.properties.hashed_token}&type=magiclink&next=/passenger`);
  await expect(page.getByRole("button", { name: /Your current location|near |Near |Road|Street/ }).first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Where to?" }).click();
  const qlsCalls: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/geo/search")) qlsCalls.push(r.url()); });

  await page.getByLabel("Search location").pressSequentially("elwa", { delay: 60 });
  const list = page.getByRole("heading", { name: "Suggestions" }).locator("..");
  await expect(list.getByRole("button", { name: /ELWA Junction/ }).first()).toBeVisible({ timeout: 10_000 });
  await expect(list).toContainText("© OpenStreetMap contributors");

  // Typing more narrows it; a typo still finds the place.
  await page.getByLabel("Search location").fill("");
  await page.getByLabel("Search location").pressSequentially("sinkr", { delay: 60 });
  await expect(list.getByRole("button", { name: /^Sinkor/ }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("dialog")).not.toContainText("QLS");
  expect(qlsCalls).toHaveLength(0);   // suggestions never call the paid service

  await page.getByLabel("Search location").fill("");
  await page.getByLabel("Search location").pressSequentially("ELWA Junc", { delay: 60 });
  await list.getByRole("button", { name: /ELWA Junction/ }).first().click();
  await expect(page.getByRole("button", { name: /ELWA Junction/ })).toBeVisible();
  await page.getByRole("button", { name: "See prices" }).click();
  await expect(page.getByRole("radio", { name: /Car/ })).toContainText("US$", { timeout: 30_000 });
});
