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
echo "Session: $SESSION_ID"
echo "Enrollment: $ENROLLMENT_ID"
echo "Attempt: $ATTEMPT_ID"

echo ""
echo "=== TEST 1: Create TRAINER_OPPORTUNITY ==="
OPP_RES=$(curl -s -X POST "http://localhost:3000/api/retests" -b /tmp/cookies.txt -H "Content-Type: application/json" -d "{\"enrollmentId\":\"$ENROLLMENT_ID\",\"sessionId\":\"$SESSION_ID\",\"retestType\":\"TRAINER_OPPORTUNITY\"}" --max-time 15)
echo "$OPP_RES" | python3 -c "import json,sys; d=json.load(sys.stdin); print('Ref:', d.get('data',{}).get('refNumber'), '| Type:', d.get('data',{}).get('retestType'), '| Status:', d.get('data',{}).get('status'))" 2>&1
OPP_ID=$(echo "$OPP_RES" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('id',''))" 2>/dev/null)

echo ""
echo "=== TEST 2: 2nd TRAINER_OPPORTUNITY (should fail) ==="
curl -s -X POST "http://localhost:3000/api/retests" -b /tmp/cookies.txt -H "Content-Type: application/json" -d "{\"enrollmentId\":\"$ENROLLMENT_ID\",\"sessionId\":\"$SESSION_ID\",\"retestType\":\"TRAINER_OPPORTUNITY\"}" --max-time 15 | python3 -c "import json,sys; d=json.load(sys.stdin); print('Error:', d.get('error','')[:80], '| Code:', d.get('code',''))" 2>&1

echo ""
echo "=== TEST 3: Record trainer opp as FAILED ==="
curl -s -X PUT "http://localhost:3000/api/retests/$OPP_ID" -b /tmp/cookies.txt -H "Content-Type: application/json" -d '{"passed":false,"scorePercent":55}' --max-time 15 | python3 -c "import json,sys; d=json.load(sys.stdin); print('Status:', d.get('data',{}).get('status'), '| Passed:', d.get('data',{}).get('passed'))" 2>&1

echo ""
echo "=== TEST 4: Create OFFICIAL retest (should succeed) ==="
OFF_RES=$(curl -s -X POST "http://localhost:3000/api/retests" -b /tmp/cookies.txt -H "Content-Type: application/json" -d "{\"enrollmentId\":\"$ENROLLMENT_ID\",\"sessionId\":\"$SESSION_ID\",\"retestType\":\"OFFICIAL\"}" --max-time 15)
echo "$OFF_RES" | python3 -c "import json,sys; d=json.load(sys.stdin); print('Ref:', d.get('data',{}).get('refNumber'), '| Type:', d.get('data',{}).get('retestType'), '| Status:', d.get('data',{}).get('status'))" 2>&1
OFF_ID=$(echo "$OFF_RES" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('id',''))" 2>/dev/null)

echo ""
echo "=== TEST 5: 2nd OFFICIAL (should fail) ==="
curl -s -X POST "http://localhost:3000/api/retests" -b /tmp/cookies.txt -H "Content-Type: application/json" -d "{\"enrollmentId\":\"$ENROLLMENT_ID\",\"sessionId\":\"$SESSION_ID\",\"retestType\":\"OFFICIAL\"}" --max-time 15 | python3 -c "import json,sys; d=json.load(sys.stdin); print('Error:', d.get('error','')[:80], '| Code:', d.get('code',''))" 2>&1

echo ""
echo "=== TEST 6: Schedule official retest ==="
curl -s -X POST "http://localhost:3000/api/retests/$OFF_ID" -b /tmp/cookies.txt -H "Content-Type: application/json" -d '{"action":"schedule","retestDate":"2026-08-20T10:00:00","retestShift":"MORNING"}' --max-time 15 | python3 -c "import json,sys; d=json.load(sys.stdin); print('Status:', d.get('data',{}).get('status'))" 2>&1

echo ""
echo "=== TEST 7: Record official retest as FAILED ==="
curl -s -X PUT "http://localhost:3000/api/retests/$OFF_ID" -b /tmp/cookies.txt -H "Content-Type: application/json" -d '{"passed":false,"scorePercent":48}' --max-time 15 | python3 -c "import json,sys; d=json.load(sys.stdin); print('Status:', d.get('data',{}).get('status'), '| Passed:', d.get('data',{}).get('passed'))" 2>&1

echo ""
echo "=== TEST 8: List all retests (history) ==="
curl -s -b /tmp/cookies.txt "http://localhost:3000/api/retests?pageSize=10" --max-time 15 | python3 -c "
import json, sys
d = json.load(sys.stdin)
for r in d.get('data', []):
    print(f'  {r[\"refNumber\"]} | Type: {r[\"retestType\"]} | Status: {r[\"status\"]} | Passed: {r.get(\"passed\")}')
"
