// Deletes throw-away integration-test users (*@liberiaride.test) left by an interrupted run.
// Usage: node scripts/cleanup-test-users.mjs   (reads apps/web/.env.local)
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync("apps/web/.env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (error) throw error;
const test = data.users.filter((u) => u.email?.endsWith("@liberiaride.test"));
for (const u of test) {
  const { error: e } = await admin.auth.admin.deleteUser(u.id);
  console.log("deleted", u.email, e?.message ?? "ok");
}
console.log(`removed ${test.length} test user(s)`);
