const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

(async () => {
  const request = await db.trainingRequest.findFirst({
    where: { refNumber: 'TR-2026-000100', deletedAt: null },
    include: {
      requestCourses: {
        where: { deletedAt: null },
        include: { course: true }
      }
    }
  });

  console.log('Request:', request?.refNumber, '| status:', request?.status);
  
  for (const rc of request.requestCourses) {
    console.log('');
    console.log('=== requestCourse:', rc.id, '===');
    console.log('rc.courseId:', rc.courseId);
    console.log('rc.course:', rc.course?.code, '|', rc.course?.title);
    console.log('rc.course.deletedAt:', rc.course?.deletedAt);

    let effectiveCourseId = rc.courseId;
    if (rc.course?.deletedAt) {
      console.log('Course is DELETED -- searching for active replacement...');
      const active = await db.course.findFirst({
        where: { title: rc.course.title, deletedAt: null },
        select: { id: true, code: true, title: true }
      });
      if (active) {
        console.log('Found active replacement:', active.code, '|', active.title, '| id:', active.id);
        effectiveCourseId = active.id;
      } else {
        console.log('No active replacement found!');
      }
    }

    const certs = await db.trainerCertification.findMany({
      where: { courseId: effectiveCourseId, status: 'VALID', deletedAt: null },
      include: {
        trainer: {
          select: { id: true, nameEn: true, nameAr: true, refNumber: true, deletedAt: true }
        }
      }
    });
    
    const validCerts = certs.filter(c => {
      const notExpired = !c.validUntil || new Date(c.validUntil) >= new Date();
      const trainerActive = c.trainer && !c.trainer.deletedAt;
      return notExpired && trainerActive;
    });
    
    console.log('');
    console.log('Trainer certifications for effective courseId:', validCerts.length);
    validCerts.forEach(c => {
      console.log('  OK', c.trainer.nameEn, '|', c.trainer.refNumber, '| validUntil:', c.validUntil || 'never');
    });
    
    if (validCerts.length > 0) {
      console.log('');
      console.log('PASS: DIALOG WILL SHOW', validCerts.length, 'CERTIFIED TRAINERS');
    } else {
      console.log('');
      console.log('FAIL: DIALOG WILL SHOW NO AUTHORIZED TRAINERS');
    }
  }

  await db.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
