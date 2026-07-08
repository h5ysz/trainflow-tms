// /api/attendance/[id] — get / update / soft-delete
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, audit } from "@/lib/auth/api";

export const GET = withModuleAction("attendance", "view", async ({ params }) => {
  const id = params.id as string;
  const a = await db.attendance.findUnique({
    where: { id },
    include: { session: { include: { course: true } } },
  });
  if (!a || a.deletedAt) return notFound("Attendance record not found");
  return ok(a);
});

export const PUT = withModuleAction("attendance", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const existing = await db.attendance.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Attendance record not found");

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
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "ATTENDANCE",
    entityId: id,
    description: `Updated attendance for ${existing.traineeName}`,
    descriptionAr: `تم تحديث حضور ${existing.traineeName}`,
    req,
  });

  return ok(updated);
});

export const DELETE = withModuleAction("attendance", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.attendance.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Attendance record not found");

  await db.attendance.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: user.id },
  });

  await db.trainingSession.update({
    where: { id: existing.sessionId },
    data: { actualTrainees: { decrement: 1 } },
  });

  await audit({
    user,
    action: "DELETE",
    entity: "ATTENDANCE",
    entityId: id,
    description: `Removed attendance for ${existing.traineeName}`,
    descriptionAr: `تم حذف حضور ${existing.traineeName}`,
    req,
  });

  return ok({ success: true });
});
