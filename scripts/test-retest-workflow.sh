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
echo "=== PATH 1: WITHOUT Trainer Opportunity (direct to Official Retest) ==="
echo ""
TEST_DATA=$(node scripts/setup-retest-test.cjs 2>&1 | tail -1)
SESSION_ID=$(echo "$TEST_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['sessionId'])")
ENROLLMENT_ID=$(echo "$TEST_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['enrollmentId'])")
echo "Enrollment: $ENROLLMENT_ID"

echo ""
echo "TEST 1: Create Official Retest WITHOUT trainer opportunity (should succeed)"
OFF_RES=$(curl -s -X POST "http://localhost:3000/api/retests" -b /tmp/cookies.txt -H "Content-Type: application/json" -d "{\"enrollmentId\":\"$ENROLLMENT_ID\",\"sessionId\":\"$SESSION_ID\"}" --max-time 15)
echo "$OFF_RES" | python3 -c "import json,sys; d=json.load(sys.stdin); print('Ref:', d.get('data',{}).get('refNumber'), '| Status:', d.get('data',{}).get('status'))" 2>&1

echo ""
echo "=== PATH 2: WITH Trainer Opportunity (then Official Retest) ==="
echo ""
TEST_DATA2=$(node scripts/setup-retest-test.cjs 2>&1 | tail -1)
SESSION_ID2=$(echo "$TEST_DATA2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['sessionId'])")
ENROLLMENT_ID2=$(echo "$TEST_DATA2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['enrollmentId'])")
echo "Enrollment: $ENROLLMENT_ID2"

echo ""
echo "TEST 2: Use Trainer Opportunity (FAILED)"
curl -s -X POST "http://localhost:3000/api/sessions/$SESSION_ID2/enrollments/$ENROLLMENT_ID2/trainer-opportunity" -b /tmp/cookies.txt -H "Content-Type: application/json" -d '{"passed":false,"scorePercent":55}' --max-time 15 | python3 -c "import json,sys; d=json.load(sys.stdin); print('Used:', d.get('data',{}).get('trainerOpportunityUsed'), '| Passed:', d.get('data',{}).get('trainerOpportunityPassed'))" 2>&1

echo ""
echo "TEST 3: Create Official Retest AFTER trainer opp failed (should succeed)"
OFF_RES2=$(curl -s -X POST "http://localhost:3000/api/retests" -b /tmp/cookies.txt -H "Content-Type: application/json" -d "{\"enrollmentId\":\"$ENROLLMENT_ID2\",\"sessionId\":\"$SESSION_ID2\"}" --max-time 15)
echo "$OFF_RES2" | python3 -c "import json,sys; d=json.load(sys.stdin); print('Ref:', d.get('data',{}).get('refNumber'), '| Status:', d.get('data',{}).get('status'))" 2>&1

echo ""
echo "=== PATH 3: Trainer Opportunity PASSED (should block Official Retest) ==="
echo ""
TEST_DATA3=$(node scripts/setup-retest-test.cjs 2>&1 | tail -1)
SESSION_ID3=$(echo "$TEST_DATA3" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['sessionId'])")
ENROLLMENT_ID3=$(echo "$TEST_DATA3" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['enrollmentId'])")

echo ""
echo "TEST 4: Use Trainer Opportunity (PASSED)"
curl -s -X POST "http://localhost:3000/api/sessions/$SESSION_ID3/enrollments/$ENROLLMENT_ID3/trainer-opportunity" -b /tmp/cookies.txt -H "Content-Type: application/json" -d '{"passed":true,"scorePercent":85}' --max-time 15 | python3 -c "import json,sys; d=json.load(sys.stdin); print('Used:', d.get('data',{}).get('trainerOpportunityUsed'), '| Passed:', d.get('data',{}).get('trainerOpportunityPassed'), '| FinalTest:', d.get('data',{}).get('finalTestStatus'))" 2>&1

echo ""
echo "TEST 5: Create Official Retest after trainer opp PASSED (should fail)"
curl -s -X POST "http://localhost:3000/api/retests" -b /tmp/cookies.txt -H "Content-Type: application/json" -d "{\"enrollmentId\":\"$ENROLLMENT_ID3\",\"sessionId\":\"$SESSION_ID3\"}" --max-time 15 | python3 -c "import json,sys; d=json.load(sys.stdin); print('Error:', d.get('error','')[:80], '| Code:', d.get('code',''))" 2>&1
