const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  // Get the most recent trainees with their attachments
  const trainees = await prisma.trainee.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      fullName: true,
      nationalId: true,
      idAttachmentUrl: true,
      documents: true,
      createdAt: true,
    },
  });
  console.log('Recent trainees:');
  for (const t of trainees) {
    console.log('---');
    console.log('Name:', t.fullName);
    console.log('NationalId:', t.nationalId);
    console.log('idAttachmentUrl:', t.idAttachmentUrl);
    console.log('documents (raw):', t.documents);
    try {
      const docs = t.documents ? JSON.parse(t.documents) : [];
      console.log('documents parsed count:', docs.length);
      for (const d of docs) {
        console.log('  - url:', d.url, '| type:', d.type, '| originalName:', d.originalName || d.filename);
      }
    } catch (e) {
      console.log('documents parse error:', e.message);
    }
  }
  await prisma.$disconnect();
})();
