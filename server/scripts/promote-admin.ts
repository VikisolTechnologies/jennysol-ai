// One-off bootstrapping tool: there's no in-app way to grant the first admin
// (the admin dashboard is itself gated behind having one), so this exists to
// break that chicken-and-egg problem from the command line.
//
// Usage: npx tsx scripts/promote-admin.ts someone@example.com
import "../src/db/index.js";
import { db } from "../src/db/index.js";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Usage: npx tsx scripts/promote-admin.ts <email>");
  process.exit(1);
}

const result = db.prepare("UPDATE users SET role = 'admin', updated_at = datetime('now') WHERE email = ?").run(email);
if (result.changes === 0) {
  console.error(`No user found with email ${email}. Sign up first, then run this again.`);
  process.exit(1);
}
console.log(`${email} is now an admin.`);
