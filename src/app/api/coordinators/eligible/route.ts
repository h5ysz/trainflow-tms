// /api/coordinators/eligible — returns coordinators who can handle
// requests in a specific region. Used by the contractor UI to show
// the optional coordinator selector.
//
// Query params:
//   region — one of CENTRAL/EASTERN/WESTERN/SOUTHERN (required)
//
// Returns coordinators whose:
//   - role = COORDINATOR
//   - isActive = true
//   - region matches the query region, OR
//   - regionsCovered (JSON array) includes the query region
//
// The coordinator's course qualifications are NOT checked here because
// coordinators don't deliver courses — trainers do. The coordinator
// only needs to be in the right region.
import { db } from "@/lib/db";
import { requireAuth, ok, fail } from "@/lib/auth/api";
import { REGIONS, isRegionCode } from "@/lib/regions";
import { parseRegionsCovered } from "@/lib/api/region-scope";

export const GET = async (req: Request) => {
  try {
    await requireAuth();
  } catch {
    return fail("Unauthorized", 401);
  }

  const url = new URL(req.url);
  const region = url.searchParams.get("region");

  if (!region || !isRegionCode(region)) {
    return fail("Valid region is required", 422, "VALIDATION_ERROR");
  }

  // Fetch all active coordinators
  const coordinators = await db.user.findMany({
    where: {
      role: "COORDINATOR",
      isActive: true,
      deletedAt: null,
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      region: true,
      regionsCovered: true,
    },
  });

  // Filter: coordinator's primary region matches OR regionsCovered includes the region
  const eligible = coordinators.filter((c) => {
    if (c.region === region) return true;
    const covered = parseRegionsCovered(c.regionsCovered);
    return covered.includes(region);
  });

  return ok(eligible.map((c) => ({
    id: c.id,
    fullName: c.fullName,
    email: c.email,
    region: c.region,
    isPrimary: c.region === region,
  })));
};
