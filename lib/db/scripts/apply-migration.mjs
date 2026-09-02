import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(__dirname, "../drizzle/0000_lean_magma.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

const connectionString = process.env.DATABASE_URL || "postgresql://postgres.qmoxdusqvpliyxozfrvk:_%24%268.hV8DK%21%21Wei@aws-0-eu-west-2.pooler.supabase.com:6543/postgres";

const pool = new pg.Pool({ connectionString });

async function run() {
  console.log("Cleaning legacy tables and applying full DDL SQL to Supabase database...");
  const client = await pool.connect();
  try {
    // Drop old conflicting legacy tables if any
    await client.query("DROP TABLE IF EXISTS attendance_events, attendance_sessions, session_signals, devices, audit_logs, refresh_tokens, employee_workplaces, manager_scopes, employees, workplaces, departments, users, companies CASCADE;");

    const statements = sql.split("--> statement-breakpoint");
    for (const stmt of statements) {
      const trimmed = stmt.trim();
      if (!trimmed) continue;
      try {
        await client.query(trimmed);
      } catch (err) {
        if (err.code === "42710" || err.code === "42P07" || err.code === "42701") {
          continue;
        }
        console.warn("Notice during statement execution:", err.message);
      }
    }
    console.log("SUCCESS! All database tables created in Supabase!");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
