// GCCLAB TMS — Rebuild course/workshop/trainer catalog from the Excel baseline
// =====================================================================
// Source: "14 July 2026 قائمة المدربين المعتمدين للكهرباء.xlsx", sheet "المدربين المعتمدين 14 يوليو".
// Rules honoured:
//   - 14 July sheet is the FINAL baseline (21 June is only for comparison, never merged).
//   - Old catalog courses are SOFT-deleted (deletedAt) so historical rows (requests,
//     sessions, attendance, tests, certificates, worker passports) keep their FKs.
//   - Trainers are upserted by fullName (never duplicated); existing records are reused.
//   - Course→trainer grants become TrainerCertification rows (VALID) — the exact rows
//     that validateTrainerAssignment() checks when a session is created.
//   - CTCT rows (Technical Certification Tests) become Workshop + WorkshopTrainerAuthorization.
//   - Course codes, titles and durations come verbatim from the sheet (nothing invented).
//   - Idempotent: safe to re-run — it re-syncs to the baseline.

const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const BASELINE_DATE = "2026-07-14";
const IMPORT_NOTE = "Imported from trainer authorization baseline (14 July 2026)";

function pad(n, width = 6) {
  return n.toString().padStart(width, "0");
}

async function nextRef(entityType, prefix) {
  const yearKey = 0; // non-yearly continuous sequence
  const counter = await prisma.refNumberCounter.upsert({
    where: { entityType_year: { entityType, year: yearKey } },
    update: { sequence: { increment: 1 } },
    create: { entityType, year: yearKey, sequence: 1 },
  });
  return `${prefix}-${pad(counter.sequence)}`;
}

function cellText(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return (v.text ?? v.result ?? "") + "";
  return String(v).trim();
}

function normalizeTrainerName(name) {
  return name.replace(/\s+/g, " ").trim();
}

async function findExcelFile(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.startsWith("14 July") && f.toLowerCase().endsWith(".xlsx"));
  if (files.length === 0) throw new Error(`No "14 July ... .xlsx" found in ${dir}`);
  return path.join(dir, files[0]);
}

async function parseBaseline(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets.find((s) => s.name.includes("14"));
  if (!ws) throw new Error("14 July sheet not found in workbook");

  // Header row 1: trainers start at column 6.
  const trainers = [];
  for (let c = 6; c <= 20; c++) {
    const name = normalizeTrainerName(cellText(ws.getRow(1).getCell(c).value));
    if (name) trainers.push({ col: c, name });
  }

  const courses = [];
  for (let r = 2; r <= 23; r++) {
    const row = ws.getRow(r);
    const code = cellText(row.getCell(2).value);
    if (!code) continue;
    const title = cellText(row.getCell(3).value);
    const durationDays = parseInt(cellText(row.getCell(4).value), 10) || 0;
    const authorized = trainers.filter((t) => cellText(row.getCell(t.col).value) !== "").map((t) => t.name);
    courses.push({ code, title, durationDays, authorized });
  }

  const workshops = [];
  for (let r = 25; r <= 30; r++) {
    const row = ws.getRow(r);
    const code = cellText(row.getCell(2).value);
    if (!code) continue;
    const title = cellText(row.getCell(3).value);
    const durationText = cellText(row.getCell(4).value);
    const authorized = trainers.filter((t) => cellText(row.getCell(t.col).value) !== "").map((t) => t.name);
    workshops.push({ code, title, durationText, authorized });
  }

  return { trainers: trainers.map((t) => t.name), courses, workshops };
}

async function run() {
  const dir = "C:\\Users\\h5ysz\\OneDrive\\Desktop";
  const file = await findExcelFile(dir);
  const data = await parseBaseline(file);
  console.log(`Source: ${file}`);
  console.log(`  trainers=${data.trainers.length} courses=${data.courses.length} workshops=${data.workshops.length}`);

  const stats = {
    coursesDeleted: 0,
    coursesCreated: 0,
    coursesUpdated: 0,
    workshopsCreated: 0,
    workshopsUpdated: 0,
    trainersCreated: 0,
    trainersReused: 0,
    certificationsCreated: 0,
    workshopAuthorizationsCreated: 0,
    certificationsCleared: 0,
  };

  // 1) Soft-delete the OLD catalog (courses not in the new baseline).
  const targetCodes = new Set([...data.courses.map((c) => c.code), ...data.workshops.map((w) => w.code)]);
  const oldCourses = await prisma.course.findMany({ where: { deletedAt: null } });
  for (const c of oldCourses) {
    if (targetCodes.has(c.code)) continue;
    await prisma.course.update({ where: { id: c.id }, data: { deletedAt: new Date(), updatedBy: null } });
    stats.coursesDeleted++;
  }
  console.log(`Soft-deleted ${stats.coursesDeleted} old catalog course(s).`);

  // 2) Clear catalog-level authorization data (course certifications + workshop grants).
  const clearedCerts = await prisma.trainerCertification.updateMany({
    where: { deletedAt: null },
    data: { deletedAt: new Date(), updatedBy: null },
  });
  stats.certificationsCleared = clearedCerts.count;
  const clearedWs = await prisma.workshopTrainerAuthorization.updateMany({
    where: { deletedAt: null },
    data: { deletedAt: new Date(), updatedBy: null },
  });
  console.log(`Cleared ${stats.certificationsCleared} trainer certification(s) and ${clearedWs.count} workshop grant(s).`);

  // 3) Upsert trainers by fullName.
  const trainerIds = new Map();
  for (const name of data.trainers) {
    let t = await prisma.trainer.findFirst({ where: { fullName: name } });
    if (t && t.deletedAt) {
      await prisma.trainer.update({ where: { id: t.id }, data: { deletedAt: null } });
    } else if (!t) {
      const ref = await nextRef("TRAINER", "TRN");
      t = await prisma.trainer.create({ data: { refNumber: ref, fullName: name, status: "ACTIVE" } });
      stats.trainersCreated++;
    } else {
      stats.trainersReused++;
    }
    trainerIds.set(name, t.id);
  }
  console.log(`Trainers: ${stats.trainersCreated} created, ${stats.trainersReused} reused.`);

  // 4) Upsert courses by code.
  const courseIds = new Map();
  for (const c of data.courses) {
    let course = await prisma.course.findUnique({ where: { code: c.code } });
    const fields = {
      title: c.title,
      durationHours: c.durationDays * 8,
      category: "Safety Certification",
      language: "en",
      validityMonths: 12,
      passScore: 70,
      maxTrainees: 20,
      hasPreTest: true,
      hasFinalTest: true,
      hasEvaluation: true,
      status: "ACTIVE",
    };
    if (!course) {
      const ref = await nextRef("COURSE", "CRS");
      course = await prisma.course.create({ data: { ...fields, code: c.code, refNumber: ref } });
      stats.coursesCreated++;
    } else {
      if (course.deletedAt) fields.deletedAt = null;
      course = await prisma.course.update({ where: { id: course.id }, data: fields });
      stats.coursesUpdated++;
    }
    courseIds.set(c.code, course.id);
  }
  console.log(`Courses: ${stats.coursesCreated} created, ${stats.coursesUpdated} updated.`);

  // 5) Upsert workshops by code.
  const workshopIds = new Map();
  for (const w of data.workshops) {
    let ws = await prisma.workshop.findUnique({ where: { code: w.code } });
    const fields = {
      title: w.title,
      description: null,
      category: "Technical Certification",
      durationDays: 1,
      durationText: w.durationText,
      durationHours: 8,
      status: "ACTIVE",
      isActive: true,
    };
    if (!ws) {
      const ref = await nextRef("WORKSHOP", "WSH");
      ws = await prisma.workshop.create({ data: { ...fields, code: w.code, refNumber: ref } });
      stats.workshopsCreated++;
    } else {
      if (ws.deletedAt) fields.deletedAt = null;
      ws = await prisma.workshop.update({ where: { id: ws.id }, data: fields });
      stats.workshopsUpdated++;
    }
    workshopIds.set(w.code, ws.id);
  }
  console.log(`Workshops: ${stats.workshopsCreated} created, ${stats.workshopsUpdated} updated.`);

  // 6) Course certifications (TrainerCertification) for each X mark.
  for (const c of data.courses) {
    const courseId = courseIds.get(c.code);
    for (const name of c.authorized) {
      const trainerId = trainerIds.get(name);
      if (!trainerId) throw new Error(`Unknown trainer ${name} for ${c.code}`);
      await prisma.trainerCertification.create({
        data: {
          trainerId,
          courseId,
          validFrom: new Date(BASELINE_DATE),
          validUntil: null,
          status: "VALID",
          notes: IMPORT_NOTE,
        },
      });
      stats.certificationsCreated++;
    }
  }
  console.log(`Created ${stats.certificationsCreated} course certifications.`);

  // 7) Workshop authorizations for CTCT rows.
  for (const w of data.workshops) {
    const workshopId = workshopIds.get(w.code);
    for (const name of w.authorized) {
      const trainerId = trainerIds.get(name);
      if (!trainerId) throw new Error(`Unknown trainer ${name} for ${w.code}`);
      await prisma.workshopTrainerAuthorization.create({
        data: {
          trainerId,
          workshopId,
          validFrom: new Date(BASELINE_DATE),
          validUntil: null,
          status: "VALID",
          notes: IMPORT_NOTE,
        },
      });
      stats.workshopAuthorizationsCreated++;
    }
  }
  console.log(`Created ${stats.workshopAuthorizationsCreated} workshop authorizations.`);

  // 8) Trainer.primarySpecialization derived from the baseline grants.
  for (const name of data.trainers) {
    const trainerId = trainerIds.get(name);
    const csccCount = await prisma.trainerCertification.count({ where: { trainerId, deletedAt: null } });
    const wsCount = await prisma.workshopTrainerAuthorization.count({ where: { trainerId, deletedAt: null } });
    const parts = [];
    if (csccCount > 0) parts.push("Safety Certification Courses");
    if (wsCount > 0) parts.push("Technical Certification Tests");
    const spec = parts.join(" & ") || null;
    await prisma.trainer.update({ where: { id: trainerId }, data: { primarySpecialization: spec } });
  }

  console.log("\n=== REBUILD COMPLETE ===");
  console.log(JSON.stringify(stats, null, 2));
}

run()
  .catch((e) => {
    console.error("REBUILD FAILED:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
