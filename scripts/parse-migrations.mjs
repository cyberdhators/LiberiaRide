// Syntax-checks every migration (SQL + PL/pgSQL bodies) with the real Postgres parser.
// Semantic checks (unknown columns, types) need a database: see docs/DEPLOYMENT.md.
import * as pg from "libpg-query";
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve("supabase/migrations");
if (pg.loadModule) await pg.loadModule();
let failures = 0;
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  const sql = fs.readFileSync(path.join(dir, file), "utf8");
  try {
    await pg.parse(sql);
    const fns = await pg.parsePlPgSQL(sql);
    console.log(`ok   ${file} (${fns.plpgsql_funcs?.length ?? 0} plpgsql functions)`);
  } catch (err) {
    failures++;
    console.error(`FAIL ${file}: ${err.message}`);
  }
}
process.exit(failures ? 1 : 0);
