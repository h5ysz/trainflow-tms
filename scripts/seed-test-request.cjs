const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();
(async () => {
  const company = await prisma.company.findFirst({ where: { name: { contains: 'Test Contractor' } } });
  const course = await prisma.course.findFirst();
  const trainee = await prisma.trainee.findUnique({ where: { refNumber: 'TRN-TEST-001' } });
  if (!company || !course || !trainee) { console.log('Missing prereq'); process.exit(1); }

  // Create a training request in DRAFT status
  const request = await prisma.trainingRequest.create({
    data: {
      id: crypto.randomUUID(),
      refNumber: 'TR-' + Date.now(),
      companyId: company.id,
      courseId: course.id,
      traineeCount: 1,
      status: 'DRAFT',
      priority: 'NORMAL',
      preferredLanguage: 'en',
      updatedAt: new Date(),
    },
  });
  console.log(`Request: ${request.id} (${request.refNumber})`);

  // Create a TrainingRequestCourse
  const rc = await prisma.trainingRequestCourse.create({
    data: {
      id: crypto.randomUUID(),
      requestId: request.id,
      courseId: course.id,
      traineeCount: 1,
      updatedAt: new Date(),
    },
  });
  console.log(`RequestCourse: ${rc.id}`);

  // Link the trainee
  await prisma.trainingRequestCourseTrainee.create({
    data: {
      id: crypto.randomUUID(),
      requestCourseId: rc.id,
      traineeId: trainee.id,
      
      updatedAt: new Date(),
    },
  });
  console.log(`Linked trainee ${trainee.fullName}`);
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
