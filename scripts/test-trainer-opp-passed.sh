#!/bin/bash
set -e
cd /home/z/my-project

echo "=== Clean up ==="
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  await p.retestRequest.deleteMany({});
  await p.examAttempt.deleteMany({ where: { refNumber: { startsWith: 'EXAM-RT-' } } });
  await p.sessionEnrollment.deleteMany({ where: { enrollmentStatus: 'MOVED' } });
  await p.trainee.deleteMany({ where: { fullName: 'Retest Trainee' } });
  console.log('Cleaned');
  await p.\$disconnect();
})();
" 2>&1 | head -2

echo ""
echo "=== Setup: trainee with attendance=PRESENT, evaluation=COMPLETED ==="
TEST_DATA=$(node scripts/setup-retest-test.cjs 2>&1 | tail -1)
SESSION_ID=$(echo "$TEST_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['sessionId'])")
ENROLLMENT_ID=$(echo "$TEST_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['enrollmentId'])")
echo "Enrollment: $ENROLLMENT_ID"

# Set attendance + evaluation to passing states so certificate eligibility can be ELIGIBLE
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.sessionEnrollment.update({
  where: { id: '$ENROLLMENT_ID' },
  data: { attendanceStatus: 'PRESENT', evaluationStatus: 'COMPLETED' }
}).then(() => p.\$disconnect()).catch(e => { console.error(e.message); process.exit(1); });
" 2>&1 | head -1

echo ""
echo "=== BEFORE trainer opportunity ==="
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.sessionEnrollment.findUnique({
  where: { id: '$ENROLLMENT_ID' },
  select: { finalTestStatus: true, certificateStatus: true, trainerOpportunityUsed: true, trainerOpportunityPassed: true, attendanceStatus: true, evaluationStatus: true }
}).then(e => { console.log(JSON.stringify(e, null, 2)); return p.\$disconnect(); })
  .catch(e => { console.error(e.message); process.exit(1); });
" 2>&1

echo ""
echo "=== TEST: Use Trainer Opportunity (PASSED) ==="
curl -s -X POST "http://localhost:3000/api/sessions/$SESSION_ID/enrollments/$ENROLLMENT_ID/trainer-opportunity" -b /tmp/cookies.txt -H "Content-Type: application/json" -d '{"passed":true,"scorePercent":85}' --max-time 15 | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('data',{}), indent=2))" 2>&1

echo ""
echo "=== AFTER trainer opportunity (should have finalTestStatus=PASSED, certificateStatus=ELIGIBLE) ==="
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.sessionEnrollment.findUnique({
  where: { id: '$ENROLLMENT_ID' },
  select: { finalTestStatus: true, certificateStatus: true, trainerOpportunityUsed: true, trainerOpportunityPassed: true, attendanceStatus: true, evaluationStatus: true }
}).then(e => { console.log(JSON.stringify(e, null, 2)); return p.\$disconnect(); })
  .catch(e => { console.error(e.message); process.exit(1); });
" 2>&1

echo ""
echo "=== TEST: Try to create Official Retest (should be blocked — ALREADY_PASSED) ==="
curl -s -X POST "http://localhost:3000/api/retests" -b /tmp/cookies.txt -H "Content-Type: application/json" -d "{\"enrollmentId\":\"$ENROLLMENT_ID\",\"sessionId\":\"$SESSION_ID\"}" --max-time 15 | python3 -c "import json,sys; d=json.load(sys.stdin); print('Error:', d.get('error','')[:80], '| Code:', d.get('code',''))" 2>&1
