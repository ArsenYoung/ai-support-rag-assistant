#!/usr/bin/env bash
set -euo pipefail

URL="${N8N_INGEST_URL:?N8N_INGEST_URL is required}"
HDR=(-H "Content-Type: application/json")

fail() { echo "❌ $*" >&2; exit 1; }
pass() { echo "✅ $*"; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"; }

require_cmd curl
require_cmd jq

# Helper: POST JSON, returns "HTTP_CODE<TAB>BODY"
post_json() {
  local payload="$1"
  local resp http body
  resp="$(curl -sS -w "\n%{http_code}" -X POST "${URL}" "${HDR[@]}" -d "${payload}")"
  http="$(echo "$resp" | tail -n1)"
  body="$(echo "$resp" | sed '$d')"
  printf "%s\t%s" "$http" "$body"
}

# Normalize body to a single JSON object:
# - if body is [ {...} ] -> returns {...}
# - if body is {...}     -> returns {...}
norm_obj() {
  echo "$1" | jq -c 'if type=="array" then .[0] else . end'
}

# ----- Test 1: VALIDATION_FAIL -> 400 + missing text -----
t1="$(post_json '{"kb_ref":"demo-support","doc":"x","section":"y","replace":true}')"
http="$(echo "$t1" | cut -f1)"
body="$(echo "$t1" | cut -f2-)"
[[ "$http" == "400" ]] || fail "Test1 expected 400, got $http. Body: $body"

obj="$(norm_obj "$body")"
echo "$obj" | jq -e '.ok == false
  and .error.code == "missing_required_fields"
  and (.error.missing | index("text")) != null' >/dev/null \
  || fail "Test1 unexpected JSON. Body: $body"

pass "Test1 validation -> 400"

# ----- Test 2: INGEST_OK -> 200 + ok:true + chunks_upserted >= 1 -----
payload_ok='{
  "kb_ref":"demo-support",
  "doc":"Access request process",
  "section":"Onboarding",
  "source_url":"https://example.com/access",
  "text":"# Onboarding\n\nTo request access, fill the form.\n\n## SLA\nWe respond within 24h.\n\n## Steps\n1) Open ticket\n2) Approve\n3) Access granted",
  "tags":["onboarding","access"],
  "replace": true
}'
t2="$(post_json "$payload_ok")"
http="$(echo "$t2" | cut -f1)"
body="$(echo "$t2" | cut -f2-)"
[[ "$http" == "200" ]] || fail "Test2 expected 200, got $http. Body: $body"

obj="$(norm_obj "$body")"
echo "$obj" | jq -e '.ok == true
  and .kb_ref == "demo-support"
  and (.chunks_upserted|tonumber) >= 1' >/dev/null \
  || fail "Test2 unexpected JSON. Body: $body"

last_chunk_id="$(echo "$obj" | jq -r '.last_chunk_id // empty')"
[[ -n "$last_chunk_id" ]] || fail "Test2 expected last_chunk_id. Body: $body"
pass "Test2 ingest ok -> 200 (last_chunk_id=$last_chunk_id)"

# ----- Test 3: UPSERT_UPDATE (replace=false) -> 200 + ok:true + replace:false -----
payload_update='{
  "kb_ref":"demo-support",
  "doc":"Access request process",
  "section":"Onboarding",
  "source_url":"https://example.com/access",
  "text":"# Onboarding\n\nUPDATED: SLA is 48h.\n\nSteps unchanged.",
  "tags":["onboarding","access"],
  "replace": false
}'
t3="$(post_json "$payload_update")"
http="$(echo "$t3" | cut -f1)"
body="$(echo "$t3" | cut -f2-)"
[[ "$http" == "200" ]] || fail "Test3 expected 200, got $http. Body: $body"

obj="$(norm_obj "$body")"
echo "$obj" | jq -e '.ok == true
  and .kb_ref == "demo-support"
  and .replace == false' >/dev/null \
  || fail "Test3 unexpected JSON. Body: $body"

pass "Test3 upsert update -> 200"

# ----- Test 4: DOC_ID_BRANCH (replace=true with doc_id) -> 200 + doc_id echoed -----
payload_docid='{
  "kb_ref":"demo-support",
  "doc":"Access request process",
  "section":"Onboarding",
  "doc_id":"access-onboarding-v1",
  "source_url":"https://example.com/access",
  "text":"# Onboarding\n\nDoc_id branch test. SLA is 24h.",
  "tags":["onboarding","access"],
  "replace": true
}'
t4="$(post_json "$payload_docid")"
http="$(echo "$t4" | cut -f1)"
body="$(echo "$t4" | cut -f2-)"
[[ "$http" == "200" ]] || fail "Test4 expected 200, got $http. Body: $body"

obj="$(norm_obj "$body")"
echo "$obj" | jq -e '.ok == true
  and .doc_id == "access-onboarding-v1"
  and .replace == true' >/dev/null \
  || fail "Test4 unexpected JSON. Body: $body"

pass "Test4 doc_id branch -> 200"

echo
pass "All smoke tests passed."