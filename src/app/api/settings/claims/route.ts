// /api/settings/claims — claim configuration (main location + daily allowances).
//   GET   → current effective config + defaults + full history      (claims.view)
//   PATCH → insert a new effective-dated value for one key          (claims.edit)
import { withModuleAction, ok, fail, audit } from "@/lib/auth/api";
import {
  getClaimConfig,
  setClaimSetting,
  claimSettingHistory,
  ensureDefaultClaimSettings,
  CLAIM_SETTING_KEYS,
  CLAIM_SETTING_DEFAULTS,
  type ClaimSettingKey,
} from "@/lib/claims/config";

const KEYS = Object.values(CLAIM_SETTING_KEYS) as ClaimSettingKey[];

export const GET = withModuleAction("claims", "view", async ({ user }) => {
  await ensureDefaultClaimSettings(user.id);
  const config = await getClaimConfig();
  const histories = await Promise.all(KEYS.map((key) => claimSettingHistory(key)));
  return ok({
    config,
    defaults: CLAIM_SETTING_DEFAULTS,
    history: Object.fromEntries(KEYS.map((key, i) => [key, histories[i]])),
  });
});

export const PATCH = withModuleAction("claims", "edit", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const key = body.key;
  const value = typeof body.value === "string" ? body.value.trim() : "";
  const effectiveFrom = body.effectiveFrom ? new Date(body.effectiveFrom) : new Date();

  if (!KEYS.includes(key)) {
    return fail(`key must be one of: ${KEYS.join(", ")}`, 422, "VALIDATION_ERROR");
  }
  if (!value) return fail("value is required", 422, "VALIDATION_ERROR");

  if (key === CLAIM_SETTING_KEYS.EMPLOYEE_DAILY_ALLOWANCE || key === CLAIM_SETTING_KEYS.CONTRACTOR_DAILY_ALLOWANCE) {
    const n = Number.parseFloat(value);
    if (!Number.isFinite(n) || n < 0) {
      return fail("Daily allowance must be a non-negative number", 422, "VALIDATION_ERROR");
    }
  }
  if (Number.isNaN(effectiveFrom.getTime())) {
    return fail("effectiveFrom must be a valid date", 422, "VALIDATION_ERROR");
  }

  const row = await setClaimSetting(key, value, effectiveFrom, user.id);

  await audit({
    user,
    action: "UPDATE",
    entity: "CLAIM_SETTING",
    entityId: row.id,
    entityRef: key,
    description: `Updated claim setting ${key} = "${row.value}" effective ${row.effectiveFrom.toISOString().slice(0, 10)}`,
    descriptionAr: `تحديث إعداد المطالبات ${key}`,
    req,
    oldValue: { key, previous: (await claimSettingHistory(key))[1] ?? null },
    newValue: { key, value: row.value, effectiveFrom: row.effectiveFrom },
  });

  const config = await getClaimConfig();
  const histories = await Promise.all(KEYS.map((k) => claimSettingHistory(k)));
  return ok({
    config,
    defaults: CLAIM_SETTING_DEFAULTS,
    history: Object.fromEntries(KEYS.map((k, i) => [k, histories[i]])),
  });
});
