const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const p = new PrismaClient();

(async () => {
  const company = await p.company.findFirst({ where: { name: { contains: 'Test Contractor' } } });
  const course = await p.course.findFirst();
  if (!company || !course) { console.log('Missing prereqs'); process.exit(1); }

  // Create 1 request with 50 trainees
  const req = await p.trainingRequest.create({
    data: {
      id: crypto.randomUUID(),
      refNumber: 'TR-LARGE-' + Date.now(),
      companyId: company.id,
      courseId: course.id,
      traineeCount: 50,
      status: 'COMPLETED',
      priority: 'NORMAL',
      preferredLanguage: 'en',
      createdBy: '070fa259-0f8a-47c0-ba4d-53786748243e',
      updatedBy: '070fa259-0f8a-47c0-ba4d-53786748243e',
      updatedAt: new Date(),
    },
  });
  console.log('Request:', req.refNumber);

  // Create request course
  const rc = await p.trainingRequestCourse.create({
    data: {
      id: crypto.randomUUID(),
      requestId: req.id,
      courseId: course.id,
      traineeCount: 50,
      createdBy: '070fa259-0f8a-47c0-ba4d-53786748243e',
      updatedBy: '070fa259-0f8a-47c0-ba4d-53786748243e',
      updatedAt: new Date(),
    },
  });

  // Create 50 trainees with documents
  for (let i = 0; i < 50; i++) {
    const trainee = await p.trainee.create({
      data: {
        id: crypto.randomUUID(),
        refNumber: 'TRA-LARGE-' + i,
        fullName: 'Large Dataset Trainee ' + i,
        nationalId: 'LD' + String(i).padStart(6, '0'),
        nationality: 'Saudi',
        jobTitle: 'Worker',
        companyId: company.id,
        documents: JSON.stringify([
          { url: '/uploads/trainee-docs/test.png', filename: 'test.png', type: 'iqama', uploadedAt: new Date().toISOString() },
        ]),
        idAttachmentUrl: '/uploads/trainee-ids/test.png',
        updatedAt: new Date(),
      },
    });

    await p.trainingRequestCourseTrainee.create({
      data: {
        id: crypto.randomUUID(),
        requestCourseId: rc.id,
        traineeId: trainee.id,
        createdBy: '070fa259-0f8a-47c0-ba4d-53786748243e',
        updatedBy: '070fa259-0f8a-47c0-ba4d-53786748243e',
        updatedAt: new Date(),
      },
    });
  }
  console.log('Created 50 trainees with documents');
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
