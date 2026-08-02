const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  // Get the Test Contractor Co.
  const company = await prisma.company.findFirst({ where: { name: { contains: 'Test Contractor' } } });
  if (!company) {
    console.log("No Test Contractor Co. found — create one first");
    process.exit(1);
  }
  console.log(`Found company: ${company.name} (${company.id})`);

  // Create or update a test trainee
  const trainee = await prisma.trainee.upsert({
    where: { refNumber: 'TRN-TEST-001' },
    create: {
      id: require('crypto').randomUUID(),
      refNumber: 'TRN-TEST-001',
      fullName: 'Ahmed Test Trainee',
      nationalId: '1234567890',
      nationality: 'Saudi',
      jobTitle: 'Worker',
      mobile: '+966500000000',
      companyId: company.id,
      updatedAt: new Date(),
    },
    update: {
      fullName: 'Ahmed Test Trainee',
      nationalId: '1234567890',
      companyId: company.id,
      updatedAt: new Date(),
    },
  });
  console.log(`Trainee: ${trainee.id} (${trainee.fullName})`);
  await prisma.$disconnect();
})();
