// Load Greater Monrovia landmarks (OpenStreetMap) into public.landmarks for type-ahead search.
//   node scripts/import-landmarks.mjs            (uses apps/web/.env.local; service role key)
// Idempotent: rows are upserted on (source, source_id). Data: supabase/seed/osm-monrovia-landmarks.csv
// © OpenStreetMap contributors, ODbL 1.0 — see supabase/seed/README.md.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "apps/web/package.json"));
const { createClient } = require("@supabase/supabase-js");

const env = Object.fromEntries(
  readFileSync(join(root, "apps/web/.env.local"), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const url = process.env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (apps/web/.env.local).");
const db = createClient(url, key, { auth: { persistSession: false } });

/** Minimal CSV parser (quoted fields, commas and quotes inside quotes). */
function parseCsv(text) {
  const rows = []; let row = []; let field = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const [header, ...data] = parseCsv(readFileSync(join(root, "supabase/seed/osm-monrovia-landmarks.csv"), "utf8"));
const col = Object.fromEntries(header.map((h, i) => [h, i]));
const records = data.map((r) => ({
  source: "osm",
  source_id: r[col.osm_id],
  name: r[col.name],
  category: r[col.category] || null,
  locality: r[col.locality] || null,
  alt_names: r[col.alt_names] || null,
  location: `SRID=4326;POINT(${Number(r[col.lng])} ${Number(r[col.lat])})`,
  updated_at: new Date().toISOString(),
}));

for (let i = 0; i < records.length; i += 500) {
  const { error } = await db.from("landmarks").upsert(records.slice(i, i + 500), { onConflict: "source,source_id" });
  if (error) throw error;
}
console.log(`landmarks: ${records.length} upserted`);
