import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const companies = await prisma.company.findMany({ orderBy: { refNumber: "asc" } });
  console.log("COMPANIES:", companies.length);
  for (const c of companies) {
    console.log(
      JSON.stringify({
        id: c.id,
        refNumber: c.refNumber,
        name: c.name,
        nameAr: c.nameAr,
        contactPerson: c.contactPerson,
        contactPhone: c.contactPhone,
        contactEmail: c.contactEmail,
        status: c.status,
        deletedAt: c.deletedAt,
      }),
    );
  }

  const contacts = await prisma.companyContact.findMany({ orderBy: { createdAt: "asc" } });
  console.log("\nCOMPANY_CONTACTS:", contacts.length);
  for (const ct of contacts) {
    console.log(
      JSON.stringify({
        id: ct.id,
        companyId: ct.companyId,
        fullName: ct.fullName,
        jobTitle: ct.jobTitle,
        email: ct.email,
        phone: ct.phone,
        mobile: ct.mobile,
        preferredContact: ct.preferredContact,
        isPrimary: ct.isPrimary,
        isActive: ct.isActive,
        notes: ct.notes,
        deletedAt: ct.deletedAt,
      }),
    );
  }

  const reqs = await prisma.trainingRequest.findMany({
    select: { id: true, refNumber: true, companyId: true, company: { select: { name: true } } },
    take: 5,
  });
  console.log("\nTRAINING REQUESTS (sample):", reqs.length);
  for (const r of reqs) console.log(JSON.stringify(r));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
