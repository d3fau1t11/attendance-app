import { Router, type IRouter } from "express";
import { and, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  attendanceSessions,
  db,
  departments,
  sessionSignals,
  employees,
  users,
  workplaces,
} from "@workspace/db";
import {
  requireAuth,
  requireCompany,
  requireRole,
} from "../middlewares/auth";
import { recordAudit } from "../services/audit";
import { hashPassword } from "../services/password";

const router: IRouter = Router();

/** Admin-only router requiring auth, company context, and manager/admin role. */
router.use("/admin", requireAuth, requireCompany, requireRole("manager"));

/**
 * Dashboard aggregate statistics for the manager/admin's company.
 */
router.get("/admin/stats", async (req, res) => {
  const companyId = req.auth!.companyId!;

  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [empCount] = await db
      .select({ count: count() })
      .from(employees)
      .where(and(eq(employees.companyId, companyId), eq(employees.isActive, true)));

    const [wpCount] = await db
      .select({ count: count() })
      .from(workplaces)
      .where(and(eq(workplaces.companyId, companyId), eq(workplaces.isActive, true)));

    const activeSessions = await db
      .select({
        status: attendanceSessions.status,
        needsReview: attendanceSessions.needsReview,
        isLate: attendanceSessions.isLate,
        checkInAt: attendanceSessions.checkInAt,
      })
      .from(attendanceSessions)
      .where(
        and(
          eq(attendanceSessions.companyId, companyId),
          gte(attendanceSessions.checkInAt, todayStart),
        ),
      );

    let checkedIn = 0;
    let pendingExit = 0;
    let needsReview = 0;
    let lateToday = 0;

    for (const s of activeSessions) {
      if (s.status === "checked_in") checkedIn++;
      if (s.status === "pending_exit") pendingExit++;
      if (s.needsReview) needsReview++;
      if (s.isLate) lateToday++;
    }

    const recentSessions = await db
      .select({
        id: attendanceSessions.id,
        status: attendanceSessions.status,
        checkInAt: attendanceSessions.checkInAt,
        checkOutAt: attendanceSessions.checkOutAt,
        isLate: attendanceSessions.isLate,
        needsReview: attendanceSessions.needsReview,
        flags: attendanceSessions.flags,
        employeeName: users.fullName,
        employeeCode: employees.employeeCode,
        workplaceName: workplaces.name,
      })
      .from(attendanceSessions)
      .innerJoin(employees, eq(employees.id, attendanceSessions.employeeId))
      .innerJoin(users, eq(users.id, employees.userId))
      .innerJoin(workplaces, eq(workplaces.id, attendanceSessions.workplaceId))
      .where(eq(attendanceSessions.companyId, companyId))
      .orderBy(desc(attendanceSessions.checkInAt))
      .limit(10);

    res.json({
      totalEmployees: empCount?.count ?? 0,
      activeWorkplaces: wpCount?.count ?? 0,
      checkedIn,
      pendingExit,
      needsReview,
      lateToday,
      recentActivity: recentSessions.map((s) => ({
        id: s.id,
        status: s.status,
        employeeName: s.employeeName,
        employeeCode: s.employeeCode,
        workplaceName: s.workplaceName,
        checkInAt: s.checkInAt.toISOString(),
        checkOutAt: s.checkOutAt?.toISOString() ?? null,
        isLate: s.isLate,
        needsReview: s.needsReview,
        flags: s.flags,
      })),
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to load admin stats");
    res.status(500).json({ code: "internal_error", message: "Failed to load admin dashboard stats." });
  }
});

/**
 * List all attendance sessions with search, status filters, and pagination.
 */
router.get("/admin/attendance", async (req, res) => {
  const companyId = req.auth!.companyId!;
  const statusFilter = req.query.status ? String(req.query.status) : null;
  const needsReviewOnly = req.query.needsReview === "true";
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  try {
    const conditions = [eq(attendanceSessions.companyId, companyId)];

    if (needsReviewOnly) {
      conditions.push(eq(attendanceSessions.needsReview, true));
    } else if (statusFilter) {
      conditions.push(eq(attendanceSessions.status, statusFilter as any));
    }

    const rows = await db
      .select({
        id: attendanceSessions.id,
        status: attendanceSessions.status,
        checkInAt: attendanceSessions.checkInAt,
        checkOutAt: attendanceSessions.checkOutAt,
        checkoutReason: attendanceSessions.checkoutReason,
        durationMinutes: attendanceSessions.durationMinutes,
        isLate: attendanceSessions.isLate,
        lateByMinutes: attendanceSessions.lateByMinutes,
        needsReview: attendanceSessions.needsReview,
        reviewNote: attendanceSessions.reviewNote,
        flags: attendanceSessions.flags,
        employeeId: employees.id,
        employeeName: users.fullName,
        employeeEmail: users.email,
        employeeCode: employees.employeeCode,
        jobTitle: employees.jobTitle,
        workplaceId: workplaces.id,
        workplaceName: workplaces.name,
      })
      .from(attendanceSessions)
      .innerJoin(employees, eq(employees.id, attendanceSessions.employeeId))
      .innerJoin(users, eq(users.id, employees.userId))
      .innerJoin(workplaces, eq(workplaces.id, attendanceSessions.workplaceId))
      .where(and(...conditions))
      .orderBy(desc(attendanceSessions.checkInAt))
      .limit(limit)
      .offset(offset);

    res.json({
      sessions: rows.map((r) => ({
        ...r,
        checkInAt: r.checkInAt.toISOString(),
        checkOutAt: r.checkOutAt?.toISOString() ?? null,
      })),
      limit,
      offset,
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch admin attendance sessions");
    res.status(500).json({ code: "internal_error", message: "Failed to list attendance sessions." });
  }
});

/**
 * Admin override: approve or manually force checkout of a session.
 */
router.post("/admin/attendance/:id/override", async (req, res) => {
  const companyId = req.auth!.companyId!;
  const sessionId = req.params.id;
  const { action, note } = req.body ?? {};

  try {
    const [session] = await db
      .select()
      .from(attendanceSessions)
      .where(and(eq(attendanceSessions.id, sessionId as string), eq(attendanceSessions.companyId, companyId)))
      .limit(1);

    if (!session) {
      res.status(404).json({ code: "not_found", message: "Attendance session not found." });
      return;
    }

    const now = new Date();
    const patch: Record<string, any> = {
      needsReview: false,
      reviewNote: note ? String(note).trim() : null,
      reviewedBy: req.auth!.userId,
      reviewedAt: now,
      updatedAt: now,
    };

    if (action === "force_checkout" || session.status === "checked_in" || session.status === "pending_exit") {
      patch.status = "checked_out";
      patch.checkOutAt = now;
      patch.checkoutReason = "admin_override";
      if (session.checkInAt) {
        const diffMs = now.getTime() - new Date(session.checkInAt).getTime();
        patch.durationMinutes = Math.max(0, Math.floor(diffMs / 60000));
      }
    }

    const [updated] = await db
      .update(attendanceSessions)
      .set(patch)
      .where(eq(attendanceSessions.id, sessionId as string))
      .returning();

    await recordAudit({
      companyId,
      actorUserId: req.auth!.userId,
      action: "attendance.admin_override",
      entityType: "attendance_session",
      entityId: sessionId as string,
      metadata: { action, note },
      ipAddress: req.ip ?? null,
    });

    res.json(updated);
  } catch (error) {
    req.log.error({ err: error }, "Failed to override attendance session");
    res.status(500).json({ code: "internal_error", message: "Failed to perform admin override." });
  }
});

/**
 * List employees in the company with details.
 */
router.get("/admin/employees", async (req, res) => {
  const companyId = req.auth!.companyId!;

  try {
    const rows = await db
      .select({
        id: employees.id,
        userId: users.id,
        fullName: users.fullName,
        email: users.email,
        role: users.role,
        employeeCode: employees.employeeCode,
        jobTitle: employees.jobTitle,
        phone: employees.phone,
        isActive: employees.isActive,
        departmentId: employees.departmentId,
        departmentName: departments.name,
        createdAt: employees.createdAt,
      })
      .from(employees)
      .innerJoin(users, eq(users.id, employees.userId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(eq(employees.companyId, companyId))
      .orderBy(users.fullName);

    res.json({
      employees: rows.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch employees");
    res.status(500).json({ code: "internal_error", message: "Failed to list employees." });
  }
});

/**
 * Add a new employee + user account.
 */
router.post("/admin/employees", requireRole("company_admin"), async (req, res) => {
  const companyId = req.auth!.companyId!;
  const { fullName, email, password, role, employeeCode, jobTitle, phone, departmentId } = req.body ?? {};

  if (!fullName || !email || !password || !employeeCode) {
    res.status(400).json({ code: "invalid_request", message: "Name, email, password and employee code are required." });
    return;
  }

  try {
    const passwordHash = await hashPassword(String(password));

    // 1. Create user account
    const [newUser] = await db
      .insert(users)
      .values({
        companyId,
        email: String(email).trim().toLowerCase(),
        passwordHash,
        fullName: String(fullName).trim(),
        role: role === "company_admin" || role === "manager" ? role : "employee",
      })
      .returning();

    // 2. Create employee record
    const [newEmp] = await db
      .insert(employees)
      .values({
        companyId,
        userId: newUser.id,
        employeeCode: String(employeeCode).trim(),
        jobTitle: jobTitle ? String(jobTitle).trim() : null,
        phone: phone ? String(phone).trim() : null,
        departmentId: departmentId ? String(departmentId) : null,
      })
      .returning();

    await recordAudit({
      companyId,
      actorUserId: req.auth!.userId,
      action: "employee.create",
      entityType: "employee",
      entityId: newEmp.id,
      metadata: { fullName, email, employeeCode },
      ipAddress: req.ip ?? null,
    });

    res.status(201).json({
      id: newEmp.id,
      userId: newUser.id,
      fullName: newUser.fullName,
      email: newUser.email,
      role: newUser.role,
      employeeCode: newEmp.employeeCode,
      jobTitle: newEmp.jobTitle,
      isActive: newEmp.isActive,
    });
  } catch (error: any) {
    req.log.error({ err: error }, "Failed to create employee");
    if (error.code === "23505") {
      res.status(409).json({ code: "duplicate", message: "An employee with this email or code already exists." });
      return;
    }
    res.status(500).json({ code: "internal_error", message: "Failed to create employee record." });
  }
});

/**
 * Patch employee details (active status, department, job title).
 */
router.patch("/admin/employees/:id", requireRole("company_admin"), async (req, res) => {
  const companyId = req.auth!.companyId!;
  const empId = req.params.id;
  const { jobTitle, phone, departmentId, isActive, role } = req.body ?? {};

  try {
    const [emp] = await db
      .select()
      .from(employees)
      .where(and(eq(employees.id, empId as string), eq(employees.companyId, companyId)))
      .limit(1);

    if (!emp) {
      res.status(404).json({ code: "not_found", message: "Employee not found." });
      return;
    }

    const empPatch: Record<string, any> = { updatedAt: new Date() };
    if (jobTitle !== undefined) empPatch.jobTitle = jobTitle ? String(jobTitle) : null;
    if (phone !== undefined) empPatch.phone = phone ? String(phone) : null;
    if (departmentId !== undefined) empPatch.departmentId = departmentId ? String(departmentId) : null;
    if (typeof isActive === "boolean") empPatch.isActive = isActive;

    await db.update(employees).set(empPatch).where(eq(employees.id, empId as string));

    if (role && (role === "employee" || role === "manager" || role === "company_admin")) {
      await db.update(users).set({ role }).where(eq(users.id, emp.userId));
    }

    await recordAudit({
      companyId,
      actorUserId: req.auth!.userId,
      action: "employee.update",
      entityType: "employee",
      entityId: empId as string,
      metadata: req.body,
      ipAddress: req.ip ?? null,
    });

    res.json({ updated: true });
  } catch (error) {
    req.log.error({ err: error }, "Failed to update employee");
    res.status(500).json({ code: "internal_error", message: "Failed to update employee." });
  }
});

/**
 * List departments for company.
 */
router.get("/admin/departments", async (req, res) => {
  const companyId = req.auth!.companyId!;

  try {
    const rows = await db
      .select()
      .from(departments)
      .where(eq(departments.companyId, companyId))
      .orderBy(departments.name);

    res.json({ departments: rows });
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch departments");
    res.status(500).json({ code: "internal_error", message: "Failed to list departments." });
  }
});

/**
 * Create a new department.
 */
router.post("/admin/departments", requireRole("company_admin"), async (req, res) => {
  const companyId = req.auth!.companyId!;
  const name = String(req.body?.name ?? "").trim();

  if (!name) {
    res.status(400).json({ code: "invalid_request", message: "Department name is required." });
    return;
  }

  try {
    const [dept] = await db
      .insert(departments)
      .values({ companyId, name })
      .returning();

    res.status(201).json(dept);
  } catch (error: any) {
    req.log.error({ err: error }, "Failed to create department");
    if (error.code === "23505") {
      res.status(409).json({ code: "duplicate", message: "Department already exists." });
      return;
    }
    res.status(500).json({ code: "internal_error", message: "Failed to create department." });
  }
});

/**
 * Device signal audit / anomaly logs.
 */
router.get("/admin/signals", async (req, res) => {
  const companyId = req.auth!.companyId!;

  try {
    const rows = await db
      .select({
        id: sessionSignals.id,
        signalType: sessionSignals.signalType,
        detail: sessionSignals.detail,
        occurredAt: sessionSignals.occurredAt,
        employeeName: users.fullName,
        employeeCode: employees.employeeCode,
      })
      .from(sessionSignals)
      .innerJoin(employees, eq(employees.id, sessionSignals.employeeId))
      .innerJoin(users, eq(users.id, employees.userId))
      .where(eq(sessionSignals.companyId, companyId))
      .orderBy(desc(sessionSignals.occurredAt))
      .limit(50);

    res.json({
      signals: rows.map((s) => ({
        ...s,
        occurredAt: s.occurredAt.toISOString(),
      })),
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch device signals");
    res.status(500).json({ code: "internal_error", message: "Failed to list device signals." });
  }
});

export default router;
