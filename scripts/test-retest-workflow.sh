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
echo "=== Setup test data ==="
TEST_DATA=$(node scripts/setup-retest-test.cjs 2>&1 | tail -1)
SESSION_ID=$(echo "$TEST_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['sessionId'])")
ENROLLMENT_ID=$(echo "$TEST_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['enrollmentId'])")
ATTEMPT_ID=$(echo "$TEST_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['attemptId'])")
echo "Session: $SESSION_ID | Enrollment: $ENROLLMENT_ID | Attempt: $ATTEMPT_ID"

echo ""
echo "=== TEST 1: Use Trainer Opportunity (FAILED) ==="
curl -s -X POST "http://localhost:3000/api/sessions/$SESSION_ID/enrollments/$ENROLLMENT_ID/trainer-opportunity" -b /tmp/cookies.txt -H "Content-Type: application/json" -d '{"passed":false,"scorePercent":55}' --max-time 15 | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('data',{}), indent=2))" 2>&1 | head -8

echo ""
echo "=== TEST 2: Try 2nd Trainer Opportunity (should fail) ==="
curl -s -X POST "http://localhost:3000/api/sessions/$SESSION_ID/enrollments/$ENROLLMENT_ID/trainer-opportunity" -b /tmp/cookies.txt -H "Content-Type: application/json" -d '{"passed":true}' --max-time 15 | python3 -c "import json,sys; d=json.load(sys.stdin); print('Error:', d.get('error','')[:80], '| Code:', d.get('code',''))" 2>&1

echo ""
echo "=== TEST 3: Create Official Retest (should succeed) ==="
OFF_RES=$(curl -s -X POST "http://localhost:3000/api/retests" -b /tmp/cookies.txt -H "Content-Type: application/json" -d "{\"enrollmentId\":\"$ENROLLMENT_ID\",\"sessionId\":\"$SESSION_ID\"}" --max-time 15)
echo "$OFF_RES" | python3 -c "import json,sys; d=json.load(sys.stdin); print('Ref:', d.get('data',{}).get('refNumber'), '| Type:', d.get('data',{}).get('retestType'), '| Status:', d.get('data',{}).get('status'))" 2>&1
OFF_ID=$(echo "$OFF_RES" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('id',''))" 2>/dev/null)

echo ""
echo "=== TEST 4: 2nd Official Retest (should fail) ==="
curl -s -X POST "http://localhost:3000/api/retests" -b /tmp/cookies.txt -H "Content-Type: application/json" -d "{\"enrollmentId\":\"$ENROLLMENT_ID\",\"sessionId\":\"$SESSION_ID\"}" --max-time 15 | python3 -c "import json,sys; d=json.load(sys.stdin); print('Error:', d.get('error','')[:80], '| Code:', d.get('code',''))" 2>&1

echo ""
echo "=== TEST 5: Schedule Official Retest ==="
curl -s -X POST "http://localhost:3000/api/retests/$OFF_ID" -b /tmp/cookies.txt -H "Content-Type: application/json" -d '{"action":"schedule","retestDate":"2026-08-20T10:00:00","retestShift":"MORNING"}' --max-time 15 | python3 -c "import json,sys; d=json.load(sys.stdin); print('Status:', d.get('data',{}).get('status'))" 2>&1

echo ""
echo "=== TEST 6: Record Official Retest as FAILED ==="
curl -s -X PUT "http://localhost:3000/api/retests/$OFF_ID" -b /tmp/cookies.txt -H "Content-Type: application/json" -d '{"passed":false,"scorePercent":48}' --max-time 15 | python3 -c "import json,sys; d=json.load(sys.stdin); print('Status:', d.get('data',{}).get('status'), '| Passed:', d.get('data',{}).get('passed'))" 2>&1

echo ""
echo "=== TEST 7: List retests (should be ONLY official, no trainer opp record) ==="
curl -s -b /tmp/cookies.txt "http://localhost:3000/api/retests?pageSize=10" --max-time 15 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('Total:', d.get('meta',{}).get('total'))
for r in d.get('data', []):
    print(f'  {r[\"refNumber\"]} | Type: {r[\"retestType\"]} | Status: {r[\"status\"]} | Passed: {r.get(\"passed\")}')
"

echo ""
echo "=== TEST 8: Verify enrollment has trainerOpportunityUsed=true ==="
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.sessionEnrollment.findUnique({ where: { id: '$ENROLLMENT_ID' }, select: { trainerOpportunityUsed: true, trainerOpportunityPassed: true, finalTestStatus: true } })
  .then(e => { console.log(JSON.stringify(e)); return p.\$disconnect(); })
  .catch(e => { console.error(e.message); process.exit(1); });
" 2>&1 | head -2
