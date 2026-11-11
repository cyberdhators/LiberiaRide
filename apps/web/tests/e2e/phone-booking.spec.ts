// End-to-end: a support agent books a ride for a caller without a smartphone. The caller's
// account is created from their phone number; places come from two temporary landmarks (free
// local search, no QLS search credits). DEVELOPMENT Supabase project; everything removed afterwards.
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const env = Object.fromEntries(
  readFileSync(join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const tag = randomUUID().slice(0, 6);
const localPhone = `0779${String(randomInt(0, 1_000_000)).padStart(6, "0")}`;   // 077 9xx xxxx
const e164 = `+231${localPhone.slice(1)}`;
const ids = { ops: "", caller: "" };

test.afterAll(async () => {
  const { data: caller } = await admin.from("profiles").select("id").eq("phone", e164).maybeSingle();
  if (caller) {
    const { data: bookings } = await admin.from("bookings").select("id").eq("passenger_id", caller.id);
    if (bookings?.length) await admin.from("bookings").delete().in("id", bookings.map((b) => b.id));
    await admin.auth.admin.deleteUser(caller.id);
  }
  await admin.from("address_aliases").delete().like("alias", `E2E % ${tag}`);
  if (ids.ops) await admin.auth.admin.deleteUser(ids.ops);
});

test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

test("support agent books a ride for a caller", async ({ page }) => {
  const { error: aErr } = await admin.from("address_aliases").insert([
    { alias: `E2E Pickup ${tag}`, address_text: "Capitol Hill, Monrovia", location: "SRID=4326;POINT(-10.7983 6.3002)", is_verified: true },
    { alias: `E2E Dropoff ${tag}`, address_text: "ELWA Junction, Paynesville", location: "SRID=4326;POINT(-10.7066 6.2394)", is_verified: true },
  ]);
  if (aErr) throw aErr;
  const { data: u, error } = await admin.auth.admin.createUser({ email: `e2e-agent-${tag}@liberiaride.test`, email_confirm: true, user_metadata: { full_name: "E2E Agent" } });
  if (error) throw error;
  ids.ops = u.user.id;
  await admin.from("user_roles").insert({ user_id: ids.ops, role: "support_agent" });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: `e2e-agent-${tag}@liberiaride.test` });
  await page.goto(`/auth/callback?token_hash=${link!.properties.hashed_token}&type=magiclink&next=/admin/bookings/new`);
  await expect(page.getByRole("heading", { name: "New booking (phone)" })).toBeVisible();

  await page.getByLabel("Caller phone").fill(localPhone);
  await page.getByLabel("Caller name").fill("Old Ma Gbessay");
  for (const [field, name] of [["Pickup", `E2E Pickup ${tag}`], ["Destination", `E2E Dropoff ${tag}`]] as const) {
    await page.getByRole("button", { name: new RegExp(`^${field}:`) }).click();
    await page.getByLabel("Search location").fill(name);
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByRole("button", { name: new RegExp(name) }).first().click();
  }
  await page.getByRole("button", { name: "Get prices" }).click();
  await expect(page.getByText(/New caller account created for/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("radio", { name: /Car/ })).toContainText("US$");
  await page.getByRole("radio", { name: /Car/ }).click();
  await page.getByLabel("Note for the driver").fill("Blue gate opposite the school");
  await page.getByRole("button", { name: "Book for caller" }).click();
  await expect(page.getByText(/^Booked LR-/)).toBeVisible({ timeout: 20_000 });

  const { data: caller } = await admin.from("profiles").select("id, full_name").eq("phone", e164).single();
  expect(caller!.full_name).toBe("Old Ma Gbessay");
  const { data: b } = await admin.from("bookings").select("channel, created_by, passenger_note, status").eq("passenger_id", caller!.id).single();
  expect(b).toMatchObject({ channel: "admin", created_by: ids.ops, passenger_note: "Blue gate opposite the school" });
  expect(["SEARCHING_DRIVER", "DRIVER_OFFERED", "EXPIRED"]).toContain(b!.status);
});
