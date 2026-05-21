import { db } from "../db/index";
import { sql } from "drizzle-orm";

(async () => {
  const cols = await db.all(sql`PRAGMA table_info(deals);`);
  console.log("Columns in deals table:");
  for (const c of cols as Array<{ name: string }>) {
    console.log("  -", c.name);
  }
})();