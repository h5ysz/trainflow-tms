// /api/sessions/[id]/audit — return the full audit trail for a session.
//
// Queries AuditLog filtered by `entity = "SESSION"` AND
// (`entityId = sessionId` OR `metadata` contains `sessionId`). The latter
// catches audit entries from split/merge/move-trainees/assemble where the
// `entityId` is a different session (e.g. the source session for a split)
// but this session appears in the metadata.
//
// Results are paginated and ordered newest-first. JSON columns
// (`oldValue`, `newValue`, `metadata`) are deserialized via
// `parseJsonColumn` for direct UI consumption.
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound } from "@/lib/auth/api";
import { parseJsonColumn } from "@/lib/api/json-column";

const PAGE_SIZE = 50;

interface AuditRow {
  id: string;
  userId: string | null;
  userName: string | null;
  userRole: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  entityRef: string | null;
  description: string;
  descriptionAr: string | null;
  ipAddress: string | null;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  metadata: unknown;
  createdAt: string;
}

export const GET = withModuleAction("sessions", "view", async ({ req, params }) => {
  const id = params.id as string;
  const session = await db.trainingSession.findUnique({
    where: { id },
    select: { id: true, refNumber: true, deletedAt: true },
  });
  if (!session || session.deletedAt) return notFound("Session not found");

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get("pageSize") ?? String(PAGE_SIZE), 10)));

  // Build the where clause. We want:
  //   - Direct entries: entity=SESSION AND entityId=sessionId
  //   - Related entries: entity=SESSION AND metadata LIKE '%"sessionId":"..."%'
  //     (catches split/merge/move/assemble audit entries that reference this
  //     session in their metadata but have a different entityId)
  // The LIKE pattern is loose — it may pick up false positives if a session
  // ID appears in unrelated metadata, but the UI shows the full description
  // so the user can filter visually.
  const sessionIdPattern = `%"sessionId":"${id}"%`;
  const sourceSessionIdPattern = `%"sourceSessionId":"${id}"%`;
  const targetSessionIdPattern = `%"targetSessionId":"${id}"%`;
  const mergedSessionIdPattern = `%"mergedSessionId":"${id}"%`;

  const where = {
    entity: "SESSION",
    AND: [
      {
        OR: [
          { entityId: id },
          { metadata: { contains: sessionIdPattern } },
          { metadata: { contains: sourceSessionIdPattern } },
          { metadata: { contains: targetSessionIdPattern } },
          { metadata: { contains: mergedSessionIdPattern } },
        ],
      },
    ],
  };

  const [rows, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      include: { user: { select: { id: true, fullName: true, email: true, role: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.auditLog.count({ where }),
  ]);

  const auditRows: AuditRow[] = rows.map((a) => ({
    id: a.id,
    userId: a.userId,
    userName: a.user?.fullName ?? null,
    userRole: a.user?.role ?? a.userRole ?? null,
    action: a.action,
    entity: a.entity,
    entityId: a.entityId,
    entityRef: a.entityRef,
    description: a.description,
    descriptionAr: a.descriptionAr,
    ipAddress: a.ipAddress,
    oldValue: parseJsonColumn(a.oldValue, null, "session-audit.oldValue"),
    newValue: parseJsonColumn(a.newValue, null, "session-audit.newValue"),
    reason: a.reason,
    metadata: parseJsonColumn(a.metadata, null, "session-audit.metadata"),
    createdAt: a.createdAt.toISOString(),
  }));

  return ok({
    session: { id: session.id, refNumber: session.refNumber },
    audit: auditRows,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
});
