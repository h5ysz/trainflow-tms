import { db } from "../src/lib/db";

async function main() {
  const requests = await db.trainingRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    include: {
      company: { select: { name: true } },
      course: { select: { title: true } },
      requestCourses: {
        where: { deletedAt: null },
        include: {
          course: { select: { title: true } },
          trainees: { where: { deletedAt: null }, select: { id: true } },
        },
      },
    },
  });
  for (const r of requests) {
    console.log("=".repeat(80));
    console.log(`Ref: ${r.refNumber}  Status: ${r.status}  TraineeCount: ${r.traineeCount}`);
    console.log(`Company: ${r.company?.name}  Course(legacy): ${r.course?.title}  CourseId: ${r.courseId}`);
    console.log(`RequestCourses junction rows: ${r.requestCourses.length}`);
    for (const rc of r.requestCourses) {
      console.log(`  - [${rc.id}] course=${rc.course.title}  trainees=${rc.trainees.length}  (min ${rc.minTrainees}, max ${rc.maxTrainees})`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
