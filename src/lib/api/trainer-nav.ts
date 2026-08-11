// GCCLAB TMS — Trainer nav-visibility computation
// =====================================================================
// Some trainer nav items are data-driven rather than permission-driven:
//   - Workshops  → shown only when the trainer has an assigned workshop.
//   - Evaluation → shown only when the trainer has sessions to evaluate.
// These flags are computed server-side from the authenticated trainerId and
// returned by /api/auth/me and /api/auth/login. The sidebar, command palette
// and router guard all consume them so an unassigned trainer neither sees the
// item nor can open the route by direct URL.
// =====================================================================
import { db } from "@/lib/db";

export interface TrainerNav {
  workshops: boolean;
  evaluation: boolean;
}

export async function computeTrainerNav(trainerId: string): Promise<TrainerNav> {
  const [workshops, sessions] = await Promise.all([
    db.workshopTrainerAuthorization.count({
      where: { trainerId, deletedAt: null },
    }),
    db.trainingSession.count({ where: { trainerId, deletedAt: null } }),
  ]);
  return { workshops: workshops > 0, evaluation: sessions > 0 };
}
