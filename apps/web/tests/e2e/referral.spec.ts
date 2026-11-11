// End-to-end: every passenger sees their referral code; a new passenger enters a friend's code once.
// DEVELOPMENT Supabase project; both accounts are removed afterwards.
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
const ids: string[] = [];

test.afterAll(async () => {
  for (const id of ids) await admin.auth.admin.deleteUser(id);
});

test("new passenger enters a friend's referral code", async ({ page }) => {
  for (const who of ["friend", "newbie"]) {
    const { data, error } = await admin.auth.admin.createUser({ email: `e2e-${who}-${tag}@liberiaride.test`, email_confirm: true,
      user_metadata: { full_name: who === "friend" ? "Kebeh Friend" : "New Rider" } });
    if (error) throw error;
    ids.push(data.user.id);
  }
  const { data: friend } = await admin.from("passengers").select("referral_code").eq("id", ids[0]!).single();
  expect(friend!.referral_code).toMatch(/^[A-Z2-9]{6}$/);

  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: `e2e-newbie-${tag}@liberiaride.test` });
  await page.goto(`/auth/callback?token_hash=${link!.properties.hashed_token}&type=magiclink&next=/passenger/account`);
  await expect(page.getByText("Invite friends")).toBeVisible();
  await expect(page.getByLabel("Your referral code")).toHaveText(/^[A-Z2-9]{6}$/);

  await page.getByLabel("Friend's referral code").fill(friend!.referral_code.toLowerCase());
  await page.getByRole("button", { name: "Use code" }).click();
  await expect(page.getByText(/Code from Kebeh saved/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Invited by Kebeh.")).toBeVisible();
  await expect(page.getByLabel("Friend's referral code")).toHaveCount(0);

  const { data: me } = await admin.from("passengers").select("referred_by").eq("id", ids[1]!).single();
  expect(me!.referred_by).toBe(ids[0]);
});
