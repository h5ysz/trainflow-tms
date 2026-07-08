// /api/attendance/[id] — get / update / delete
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, auditLog } from "@/lib/auth/api";

export const GET = withModuleAction("attendance", "view", async ({ params }) => {
  const id = params.id as string;
  const a = await db.attendance.findUnique({
    where: { id },
    include: { session: { include: { course: true } } },
  });
  if (!a) return notFound("Attendance record not found");
  return ok(a);
});

export const PUT = withModuleAction("attendance", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const existing = await db.attendance.findUnique({ where: { id } });
  if (!existing) return notFound("Attendance record not found");

  const { traineeName, traineeIdNational, traineeEmail, traineePhone, company, checkInAt, checkOutAt, status, checkInMethod, notes } = body;

  const updated = await db.attendance.update({
    where: { id },
    data: {
      ...(traineeName !== undefined && { traineeName }),
      ...(traineeIdNational !== undefined && { traineeIdNational }),
      ...(traineeEmail !== undefined && { traineeEmail }),
      ...(traineePhone !== undefined && { traineePhone }),
      ...(company !== undefined && { company }),
      ...(checkInAt !== undefined && { checkInAt: checkInAt ? new Date(checkInAt) : null }),
      ...(checkOutAt !== undefined && { checkOutAt: checkOutAt ? new Date(checkOutAt) : null }),
      ...(status !== undefined && { status }),
      ...(checkInMethod !== undefined && { checkInMethod }),
      ...(notes !== undefined && { notes }),
    },
  });

  await auditLog({
    userId: user.id,
    action: "UPDATE",
    entity: "SESSION",
    entityId: existing.sessionId,
    description: `Updated attendance for ${existing.traineeName}`,
    req,
  });

  return ok(updated);
});

export const DELETE = withModuleAction("attendance", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.attendance.findUnique({ where: { id } });
  if (!existing) return notFound("Attendance record not found");

  await db.attendance.delete({ where: { id } });

  // Decrement actualTrainees
  await db.trainingSession.update({
    where: { id: existing.sessionId },
    data: { actualTrainees: { decrement: 1 } },
  });

  await auditLog({
    userId: user.id,
    action: "DELETE",
    entity: "SESSION",
    entityId: existing.sessionId,
    description: `Removed attendance for ${existing.traineeName}`,
    req,
  });

  return ok({ success: true });
});
