#!/bin/bash

# Integration test script for reflections endpoints
# Run this after starting the API server on port 3333

BASE_URL="http://localhost:3333"
PASSED=0
FAILED=0

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "Testing Reflections Endpoints..."
echo "================================"

# Test 1: POST /reflections with signals
echo -n "Test 1: Create reflection with signals... "
RESPONSE=$(curl -s -X POST "$BASE_URL/reflections" \
  -H "Content-Type: application/json" \
  -d '{
    "goalId": 999,
    "actionId": 1,
    "signals": ["clear_step", "enough_time"],
    "note": "Test note"
  }')

if echo "$RESPONSE" | grep -q '"ok":true'; then
  echo -e "${GREEN}✓ PASSED${NC}"
  PASSED=$((PASSED + 1))
else
  echo -e "${RED}✗ FAILED${NC}"
  echo "Response: $RESPONSE"
  FAILED=$((FAILED + 1))
fi

# Test 2: POST /reflections with answers
echo -n "Test 2: Create reflection with answers... "
RESPONSE=$(curl -s -X POST "$BASE_URL/reflections" \
  -H "Content-Type: application/json" \
  -d '{
    "goalId": 999,
    "answers": [
      {"promptId": "test-prompt", "value": "Test answer"}
    ]
  }')

if echo "$RESPONSE" | grep -q '"ok":true'; then
  echo -e "${GREEN}✓ PASSED${NC}"
  PASSED=$((PASSED + 1))
else
  echo -e "${RED}✗ FAILED${NC}"
  echo "Response: $RESPONSE"
  FAILED=$((FAILED + 1))
fi

# Test 3: POST /reflections without required fields (should fail)
echo -n "Test 3: Create reflection without data (expect failure)... "
RESPONSE=$(curl -s -X POST "$BASE_URL/reflections" \
  -H "Content-Type: application/json" \
  -d '{
    "goalId": 999
  }')

if echo "$RESPONSE" | grep -q '"ok":false'; then
  echo -e "${GREEN}✓ PASSED${NC}"
  PASSED=$((PASSED + 1))
else
  echo -e "${RED}✗ FAILED${NC}"
  echo "Response: $RESPONSE"
  FAILED=$((FAILED + 1))
fi

# Test 4: GET /reflections
echo -n "Test 4: List all reflections... "
RESPONSE=$(curl -s "$BASE_URL/reflections")

if echo "$RESPONSE" | grep -q '"ok":true'; then
  echo -e "${GREEN}✓ PASSED${NC}"
  PASSED=$((PASSED + 1))
else
  echo -e "${RED}✗ FAILED${NC}"
  echo "Response: $RESPONSE"
  FAILED=$((FAILED + 1))
fi

# Test 5: GET /reflections with goalId filter
echo -n "Test 5: List reflections for goalId 999... "
RESPONSE=$(curl -s "$BASE_URL/reflections?goalId=999")

if echo "$RESPONSE" | grep -q '"ok":true'; then
  echo -e "${GREEN}✓ PASSED${NC}"
  PASSED=$((PASSED + 1))
else
  echo -e "${RED}✗ FAILED${NC}"
  echo "Response: $RESPONSE"
  FAILED=$((FAILED + 1))
fi

# Test 6: GET /reflections with days filter
echo -n "Test 6: List reflections from last 7 days... "
RESPONSE=$(curl -s "$BASE_URL/reflections?days=7")

if echo "$RESPONSE" | grep -q '"ok":true'; then
  echo -e "${GREEN}✓ PASSED${NC}"
  PASSED=$((PASSED + 1))
else
  echo -e "${RED}✗ FAILED${NC}"
  echo "Response: $RESPONSE"
  FAILED=$((FAILED + 1))
fi

# Test 7: Verify existing endpoints still work (no breaking changes)
echo -n "Test 7: GET /tasks (verify no breaking changes)... "
RESPONSE=$(curl -s "$BASE_URL/tasks")

if echo "$RESPONSE" | grep -q '"ok":true'; then
  echo -e "${GREEN}✓ PASSED${NC}"
  PASSED=$((PASSED + 1))
else
  echo -e "${RED}✗ FAILED${NC}"
  echo "Response: $RESPONSE"
  FAILED=$((FAILED + 1))
fi

# Summary
echo ""
echo "================================"
echo "Test Results:"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}Some tests failed.${NC}"
  exit 1
fi
