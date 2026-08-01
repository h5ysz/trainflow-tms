/**
 * Sprint 6 — Upsert the expanded branding settings into the live DB.
 *
 * This script is idempotent: running it multiple times is safe.
 * It does NOT touch any existing settings other than the branding.* keys.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const BRANDING_SETTINGS: { key: string; value: string; category: string; description: string; isPublic: boolean }[] = [
  { key: "branding.companyNameEn", value: "GCCLAB", category: "BRANDING", description: "Company name (English)", isPublic: true },
  { key: "branding.companyNameAr", value: "المختبر الخليجي", category: "BRANDING", description: "Company name (Arabic)", isPublic: true },
  { key: "branding.companyFullNameEn", value: "Gulf Calibration Laboratory", category: "BRANDING", description: "Full company name (English)", isPublic: true },
  { key: "branding.companyFullNameAr", value: "المختبر الخليجي للمعايرة", category: "BRANDING", description: "Full company name (Arabic)", isPublic: true },
  { key: "branding.logoUrl", value: "/gcclab-logo-official.png", category: "BRANDING", description: "Official logo URL (color, for light backgrounds)", isPublic: true },
  { key: "branding.logoWhiteUrl", value: "/gcclab-logo-white.png", category: "BRANDING", description: "White logo URL (for dark/burgundy backgrounds)", isPublic: true },
  { key: "branding.faviconUrl", value: "/gcclab-icon.png", category: "BRANDING", description: "Favicon URL", isPublic: true },
  { key: "branding.primaryColor", value: "#7B1E2B", category: "BRANDING", description: "Primary brand color (burgundy)", isPublic: true },
  { key: "branding.secondaryColor", value: "#1F2937", category: "BRANDING", description: "Secondary brand color (slate)", isPublic: true },
  { key: "branding.supportEmail", value: "support@gcclab.com", category: "BRANDING", description: "Support contact email", isPublic: true },
  { key: "branding.supportPhone", value: "+966 11 XXX XXXX", category: "BRANDING", description: "Support contact phone", isPublic: true },
];

async function main() {
  console.log("Upserting branding settings…");
  for (const s of BRANDING_SETTINGS) {
    await db.setting.upsert({
      where: { key: s.key },
      create: s,
      update: { value: s.value, category: s.category, description: s.description, isPublic: s.isPublic },
    });
    console.log(`  ✓ ${s.key} = ${s.value}`);
  }
  console.log("\nDone.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
