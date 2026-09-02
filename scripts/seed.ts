/**
 * Seed a working company so the Android app can be exercised end to end.
 *
 * Usage:
 *   pnpm tsx scripts/seed.ts --lat 9.0192 --lng 38.7468 --radius 150
 *
 * Pass your *actual* coordinates — the whole point is to place the geofence
 * where you can physically walk in and out of it. Without --lat/--lng the
 * workplace lands on a default that you will never be inside, and every
 * check-in will correctly refuse.
 *
 * Re-running is safe: existing rows are reused rather than duplicated.
 */
import { and, eq } from "drizzle-orm";
import {
  companies,
  db,
  departments,
  employees,
  employeeWorkplaces,
  users,
  workplaces,
} from "@workspace/db";
import { hashPassword } from "../artifacts/api-server/src/services/password";
import { generateQrSecret } from "../artifacts/api-server/src/services/qr";

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index === process.argv.length - 1) return fallback;
  return process.argv[index + 1];
}

const LAT = Number(arg("lat", "9.0192"));
const LNG = Number(arg("lng", "38.7468"));
const RADIUS = Number(arg("radius", "150"));
const PASSWORD = arg("password", "Passw0rd!123")!;

if (!Number.isFinite(LAT) || !Number.isFinite(LNG)) {
  console.error("--lat and --lng must be numbers");
  process.exit(1);
}

async function main() {
  console.log(`Seeding workplace at ${LAT}, ${LNG} (radius ${RADIUS}m)\n`);

  // --- Company ---
  let [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.slug, "demo-co"))
    .limit(1);

  if (!company) {
    [company] = await db
      .insert(companies)
      .values({ name: "Demo Company", slug: "demo-co", timezone: "Africa/Addis_Ababa" })
      .returning();
    console.log("✓ company created");
  } else {
    console.log("· company exists");
  }

  // --- Department ---
  let [department] = await db
    .select()
    .from(departments)
    .where(
      and(
        eq(departments.companyId, company.id),
        eq(departments.name, "Operations"),
      ),
    )
    .limit(1);

  if (!department) {
    [department] = await db
      .insert(departments)
      .values({ companyId: company.id, name: "Operations" })
      .returning();
    console.log("✓ department created");
  }

  // --- Workplace ---
  let [workplace] = await db
    .select()
    .from(workplaces)
    .where(
      and(eq(workplaces.companyId, company.id), eq(workplaces.name, "Head Office")),
    )
    .limit(1);

  if (!workplace) {
    [workplace] = await db
      .insert(workplaces)
      .values({
        companyId: company.id,
        name: "Head Office",
        address: "Seeded for local testing",
        latitude: LAT,
        longitude: LNG,
        radiusM: RADIUS,
        exitBufferM: 50,
        maxAccuracyM: 100,
        exitGraceSeconds: 300,
        qrMode: "rotating",
        qrSecret: generateQrSecret(),
        qrRotationSeconds: 30,
        timezone: "Africa/Addis_Ababa",
        workStart: "09:00:00",
        workEnd: "17:00:00",
        lateGraceMinutes: 10,
      })
      .returning();
    console.log("✓ workplace created");
  } else {
    // Keep the geofence in step with the coordinates passed this run.
    [workplace] = await db
      .update(workplaces)
      .set({ latitude: LAT, longitude: LNG, radiusM: RADIUS, updatedAt: new Date() })
      .where(eq(workplaces.id, workplace.id))
      .returning();
    console.log("· workplace updated to the supplied coordinates");
  }

  // --- Users ---
  const passwordHash = await hashPassword(PASSWORD);

  const accounts = [
    { email: "admin@demo.co", fullName: "Amina Admin", role: "company_admin" as const, employee: false },
    { email: "manager@demo.co", fullName: "Mekonnen Manager", role: "manager" as const, employee: true, code: "EMP-001" },
    { email: "abebe@demo.co", fullName: "Abebe Bekele", role: "employee" as const, employee: true, code: "EMP-002" },
    { email: "sara@demo.co", fullName: "Sara Tesfaye", role: "employee" as const, employee: true, code: "EMP-003" },
  ];

  for (const account of accounts) {
    let [user] = await db
      .select()
      .from(users)
      .where(
        and(eq(users.companyId, company.id), eq(users.email, account.email)),
      )
      .limit(1);

    if (!user) {
      [user] = await db
        .insert(users)
        .values({
          companyId: company.id,
          email: account.email,
          passwordHash,
          fullName: account.fullName,
          role: account.role,
        })
        .returning();
    } else {
      // Reset the password so a re-seed always yields known credentials.
      await db
        .update(users)
        .set({ passwordHash, failedLoginCount: 0, lockedUntil: null })
        .where(eq(users.id, user.id));
    }

    if (!account.employee) continue;

    let [employee] = await db
      .select()
      .from(employees)
      .where(eq(employees.userId, user.id))
      .limit(1);

    if (!employee) {
      [employee] = await db
        .insert(employees)
        .values({
          companyId: company.id,
          userId: user.id,
          departmentId: department.id,
          employeeCode: account.code!,
          jobTitle: account.role === "manager" ? "Operations Manager" : "Field Staff",
        })
        .returning();
    }

    const [assigned] = await db
      .select()
      .from(employeeWorkplaces)
      .where(
        and(
          eq(employeeWorkplaces.employeeId, employee.id),
          eq(employeeWorkplaces.workplaceId, workplace.id),
        ),
      )
      .limit(1);

    if (!assigned) {
      await db.insert(employeeWorkplaces).values({
        employeeId: employee.id,
        workplaceId: workplace.id,
        isPrimary: true,
      });
    }
  }

  console.log("✓ users and employees ready\n");
  console.log("─".repeat(58));
  console.log("Sign in with any of these (password below):\n");
  for (const a of accounts) {
    console.log(`  ${a.email.padEnd(20)} ${a.role}`);
  }
  console.log(`\n  password: ${PASSWORD}`);
  console.log("─".repeat(58));
  console.log(`\nWorkplace id: ${workplace.id}`);
  console.log(`Kiosk QR:     http://localhost:5000/api/workplaces/${workplace.id}/kiosk`);
  console.log("\nOpen the kiosk URL on this PC and scan it from the phone.\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });
