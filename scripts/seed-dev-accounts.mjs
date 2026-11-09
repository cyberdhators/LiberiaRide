// Seeds one passenger and one fully approved driver on the DEVELOPMENT project, through the real RPCs.
// Driver documents are 1x1 placeholder images marked TEST — never run this against production.
//
//   node scripts/seed-dev-accounts.mjs --confirm-dev <approver-email> <passenger-email> <driver-email>
//
// The approver must already be an admin; approvals are audited under that account.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const [flag, approverEmail, passengerEmail, driverEmail] = process.argv.slice(2);
if (flag !== "--confirm-dev" || !driverEmail) {
  console.error("usage: node scripts/seed-dev-accounts.mjs --confirm-dev <approver-email> <passenger-email> <driver-email>");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(new URL("../apps/web/.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };

async function ensureUser(email, fullName) {
  const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: fullName } });
  if (!created.error) return created.data.user.id;
  const { data } = await admin.from("profiles").select("id").eq("email", email.toLowerCase()).maybeSingle();
  if (!data) throw new Error(`${email}: ${created.error.message}`);
  return data.id;
}

async function sessionFor(email) {
  const link = must(await admin.auth.admin.generateLink({ type: "magiclink", email }), `link ${email}`);
  const client = createClient(url, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  must(await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" }), `sign in ${email}`);
  return client;
}

const passengerId = await ensureUser(passengerEmail, "Test Passenger");
console.log("passenger", passengerEmail, passengerId);

const driverId = await ensureUser(driverEmail, "Test Driver");
const drv = await sessionFor(driverEmail);
const existing = must(await drv.from("drivers").select("id").eq("id", driverId).maybeSingle(), "driver lookup");
if (!existing) {
  must(await drv.rpc("register_driver", {
    p_full_name: "Test Driver", p_licence_number: `TEST-${driverId.slice(0, 8)}`, p_licence_expiry: "2028-12-31",
    p_date_of_birth: "1990-01-01", p_address_text: "Sinkor, Monrovia",
  }), "register_driver");
  const vehicle = must(await drv.rpc("register_vehicle", {
    p_category_code: "car", p_make: "Toyota", p_model: "Corolla", p_year: 2015, p_color: "Silver",
    p_plate_number: `TEST-${driverId.slice(0, 4)}`, p_registration_number: `TEST-REG-${driverId.slice(0, 6)}`,
  }), "register_vehicle");
  for (const [type, vehicleId] of [["driver_licence", null], ["vehicle_registration", vehicle.id]]) {
    const path = `${driverId}/TEST-placeholder-${type}.png`;
    must(await drv.storage.from("driver-documents").upload(path, PNG, { contentType: "image/png", upsert: true }), `upload ${type}`);
    must(await drv.rpc("submit_driver_document", {
      p_doc_type: type, p_storage_path: path, p_mime_type: "image/png", p_vehicle_id: vehicleId,
      p_document_number: "TEST-PLACEHOLDER", p_expires_at: "2028-12-31",
    }), `submit ${type}`);
  }
}

const ops = await sessionFor(approverEmail);
const note = "Development test account (placeholder documents)";
for (const d of must(await ops.from("driver_documents").select("id").eq("driver_id", driverId).eq("status", "pending"), "docs")) {
  must(await ops.rpc("admin_review_document", { p_document_id: d.id, p_decision: "approved", p_note: note }), "approve document");
}
for (const v of must(await ops.from("vehicles").select("id").eq("driver_id", driverId).eq("status", "pending"), "vehicles")) {
  must(await ops.rpc("admin_review_vehicle", { p_vehicle_id: v.id, p_decision: "approved", p_note: note }), "approve vehicle");
}
must(await ops.rpc("admin_review_driver", { p_driver_id: driverId, p_decision: "approved", p_note: note }), "approve driver");

const summary = must(await admin.from("drivers").select("status, current_vehicle_id").eq("id", driverId).single(), "summary");
const docs = must(await admin.from("driver_documents").select("doc_type, status").eq("driver_id", driverId), "docs summary");
console.log("driver", driverEmail, driverId, JSON.stringify({ ...summary, docs }));
