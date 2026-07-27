#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UPDATE_SCRIPT="$PROJECT_ROOT/scripts/update.sh"
TEST_ROOT="$(mktemp -d)"
FAKE_BIN="$TEST_ROOT/bin"
FAKE_REPO="$TEST_ROOT/repo"
CALL_LOG="$TEST_ROOT/calls.log"
OUTPUT_LOG="$TEST_ROOT/output.log"
FAKE_STATE_DIR="$TEST_ROOT/state"

cleanup() {
	rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

mkdir -p "$FAKE_BIN" "$FAKE_REPO" "$FAKE_STATE_DIR"
touch "$FAKE_REPO/compose.yml"

cat > "$FAKE_BIN/git" <<'FAKE_GIT'
#!/usr/bin/env bash
set -euo pipefail
printf 'git %s\n' "$*" >> "$CALL_LOG"

if [[ "${1:-}" == "status" ]]; then
	if [[ "${FAKE_DEPLOYMENT_DIRTY:-0}" == "1" ]]; then
		printf ' M compose.yml\n?? up.sh\n'
	fi
	if [[ "${FAKE_SOURCE_DIRTY:-0}" == "1" ]]; then
		printf ' M src/server.ts\n'
	fi
	exit 0
fi
if [[ "${1:-}" == "diff" && "${2:-}" == "--name-only" && "${3:-}" == "HEAD" ]]; then
	if [[ "${FAKE_DEPLOYMENT_DIRTY:-0}" == "1" ]]; then
		printf 'compose.yml\n'
	fi
	if [[ "${FAKE_SOURCE_DIRTY:-0}" == "1" ]]; then
		printf 'src/server.ts\n'
	fi
	exit 0
fi
if [[ "${1:-}" == "rev-parse" && "${2:-}" == "--show-toplevel" ]]; then
	printf '%s\n' "$QINGYAN_ROOT"
	exit 0
fi
if [[ "${1:-}" == "rev-parse" && "${2:-}" == "HEAD" ]]; then
	printf 'oldcommit\n'
	exit 0
fi
if [[ "${1:-}" == "rev-parse" && "${2:-}" == "--verify" ]]; then
	printf 'newcommit\n'
	exit 0
fi
if [[ "${1:-}" == "rev-parse" && "${2:-}" == "refs/stash" ]]; then
	if [[ -f "$FAKE_STATE_DIR/rollback-stash" ]]; then
		printf 'rollbackstash\n'
	else
		printf 'localstash\n'
	fi
	exit 0
fi
if [[ "${1:-}" == "symbolic-ref" ]]; then
	exit 1
fi
if [[ "${1:-}" == "fetch" ]]; then
	exit 0
fi
if [[ "${1:-}" == "tag" && "${2:-}" == "--list" ]]; then
	printf 'v0.2.3\nv0.2.2\n'
	exit 0
fi
if [[ "${1:-}" == "switch" ]]; then
	if [[ "${FAKE_SWITCH_FAIL:-0}" == "1" && "$*" == *"v0.2.3"* ]]; then
		exit 43
	fi
	exit 0
fi
if [[ "${1:-}" == "stash" && "${2:-}" == "push" ]]; then
	if [[ -f "$FAKE_STATE_DIR/local-applied" ]]; then
		touch "$FAKE_STATE_DIR/rollback-stash"
	else
		touch "$FAKE_STATE_DIR/local-stash"
	fi
	exit 0
fi
if [[ "${1:-}" == "stash" && "${2:-}" == "apply" ]]; then
	if [[ "${3:-}" == "--index" && "${4:-}" == "localstash" ]]; then
		touch "$FAKE_STATE_DIR/local-applied"
	fi
	exit 0
fi
if [[ "${1:-}" == "stash" && "${2:-}" == "list" ]]; then
	if [[ -f "$FAKE_STATE_DIR/rollback-stash" ]]; then
		printf 'rollbackstash stash@{0}\n'
	fi
	if [[ -f "$FAKE_STATE_DIR/local-stash" ]]; then
		printf 'localstash stash@{1}\n'
	fi
	exit 0
fi
if [[ "${1:-}" == "stash" && "${2:-}" == "drop" ]]; then
	exit 0
fi

printf 'unexpected git command: %s\n' "$*" >&2
exit 90
FAKE_GIT
chmod +x "$FAKE_BIN/git"

cat > "$FAKE_BIN/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\n' "$*" >> "$CALL_LOG"

if [[ "$*" == "info" || "$*" == "compose version" ]]; then
	exit 0
fi
if [[ "$*" == "compose ps -q qingyan" ]]; then
	printf 'container-id\n'
	exit 0
fi
if [[ "${1:-}" == "inspect" ]]; then
	if [[ "$*" == *"{{.State.Running}}"* ]]; then
		printf 'true\n'
	elif [[ "${FAKE_UPGRADE_MODE:-0}" == "1" && ! -f "$FAKE_STATE_DIR/upgraded" ]]; then
		printf 'starting\n'
	else
		printf 'healthy\n'
	fi
	exit 0
fi
if [[ "$*" == *"qyctl --version"* ]]; then
	printf 'QingYan 0.2.3\n'
	exit 0
fi
if [[ "$*" == *"qyctl update check"* ]]; then
	printf '状态：当前已是最新版本\n'
	exit 0
fi
if [[ "$*" == *"qyctl backup"* ]]; then
	printf 'backup-created\n'
	exit 0
fi
if [[ "$*" == *" build --pull qingyan"* ]]; then
	if [[ "${FAKE_BUILD_FAIL:-0}" == "1" ]]; then
		printf 'simulated build failure\n' >&2
		exit 42
	fi
	exit 0
fi
if [[ "$*" == "compose up -d qingyan" ]]; then
	exit 0
fi
if [[ "$*" == *"qyctl upgrade --dry-run"* ]]; then
	printf '{"state":"upgrade_required"}\n'
	exit 0
fi
if [[ "$*" == *"qyctl upgrade --yes"* ]]; then
	touch "$FAKE_STATE_DIR/upgraded"
	printf '{"state":"normal_current"}\n'
	exit 0
fi
if [[ "$*" == "compose restart qingyan" || "$*" == "compose ps" ]]; then
	exit 0
fi
if [[ "$*" == "compose logs --tail=200 qingyan" ]]; then
	printf 'service log\n'
	exit 0
fi

printf 'unexpected docker command: %s\n' "$*" >&2
exit 91
FAKE_DOCKER
chmod +x "$FAKE_BIN/docker"

reset_case() {
	: > "$CALL_LOG"
	: > "$OUTPUT_LOG"
	rm -f "$FAKE_STATE_DIR/local-stash" "$FAKE_STATE_DIR/local-applied" "$FAKE_STATE_DIR/rollback-stash"
}

line_number() {
	local pattern="$1"
	grep -n -F "$pattern" "$CALL_LOG" | head -n 1 | cut -d: -f1
}

assert_before() {
	local first="$1"
	local second="$2"
	local first_line
	local second_line
	first_line="$(line_number "$first")"
	second_line="$(line_number "$second")"
	if [[ -z "$first_line" || -z "$second_line" || "$first_line" -ge "$second_line" ]]; then
		printf 'expected command before another command:\n  first: %s\n  second: %s\n' "$first" "$second" >&2
		cat "$CALL_LOG" >&2
		exit 1
	fi
}

run_update() {
	env \
		PATH="$FAKE_BIN:$PATH" \
		QINGYAN_ROOT="$FAKE_REPO" \
		CALL_LOG="$CALL_LOG" \
		FAKE_STATE_DIR="$FAKE_STATE_DIR" \
		"$@" \
		bash "$UPDATE_SCRIPT" --yes
}

reset_case
if ! run_update > "$OUTPUT_LOG" 2>&1; then
	cat "$OUTPUT_LOG" >&2
	exit 1
fi
assert_before "docker compose exec -T qingyan qyctl backup" "git switch --detach v0.2.3"
assert_before "git switch --detach v0.2.3" "docker compose --progress plain build --pull qingyan"
assert_before "docker compose exec -T qingyan qyctl upgrade --dry-run" "docker compose exec -T qingyan qyctl upgrade --yes"
assert_before "docker compose exec -T qingyan qyctl upgrade --yes" "docker compose restart qingyan"
grep -F "更新完成" "$OUTPUT_LOG" > /dev/null

reset_case
rm -f "$FAKE_STATE_DIR/upgraded"
if ! run_update FAKE_UPGRADE_MODE=1 QINGYAN_UPDATE_HEALTH_TIMEOUT=1 > "$OUTPUT_LOG" 2>&1; then
	cat "$OUTPUT_LOG" >&2
	exit 1
fi
grep -F "docker inspect --format {{.State.Running}} container-id" "$CALL_LOG" > /dev/null
reset_case
if ! run_update FAKE_DEPLOYMENT_DIRTY=1 > "$OUTPUT_LOG" 2>&1; then
	cat "$OUTPUT_LOG" >&2
	exit 1
fi
assert_before "git stash push --include-untracked" "git switch --detach v0.2.3"
assert_before "git switch --detach v0.2.3" "git stash apply --index localstash"
assert_before "git stash apply --index localstash" "docker compose --progress plain build --pull qingyan"
grep -F "已保留并恢复本地部署文件" "$OUTPUT_LOG" > /dev/null

reset_case
if run_update FAKE_SOURCE_DIRTY=1 > "$OUTPUT_LOG" 2>&1; then
	printf 'tracked source changes should be rejected\n' >&2
	exit 1
fi
if grep -F "qyctl backup" "$CALL_LOG" > /dev/null; then
	printf 'tracked source changes must fail before backup\n' >&2
	exit 1
fi
grep -F "compose.yml 之外的已跟踪改动" "$OUTPUT_LOG" > /dev/null

reset_case
if run_update FAKE_DEPLOYMENT_DIRTY=1 FAKE_SWITCH_FAIL=1 > "$OUTPUT_LOG" 2>&1; then
	printf 'release switch failure should be returned to the caller\n' >&2
	exit 1
fi
grep -F "git switch --detach oldcommit" "$CALL_LOG" > /dev/null
if [[ "$(grep -c -F "git stash apply --index localstash" "$CALL_LOG")" -ne 1 ]]; then
	printf 'switch failure should restore the original deployment changes\n' >&2
	cat "$CALL_LOG" >&2
	exit 1
fi
grep -F "已恢复原 Git revision 和本地部署文件" "$OUTPUT_LOG" > /dev/null

reset_case
if run_update FAKE_BUILD_FAIL=1 > "$OUTPUT_LOG" 2>&1; then
	printf 'build failure should be returned to the caller\n' >&2
	exit 1
fi
grep -F "git switch --detach oldcommit" "$CALL_LOG" > /dev/null
if grep -F "docker compose up -d qingyan" "$CALL_LOG" > /dev/null; then
	printf 'failed build must not activate the new container\n' >&2
	exit 1
fi
grep -F "已恢复原 Git revision" "$OUTPUT_LOG" > /dev/null

reset_case
if run_update FAKE_DEPLOYMENT_DIRTY=1 FAKE_BUILD_FAIL=1 > "$OUTPUT_LOG" 2>&1; then
	printf 'build failure with deployment changes should be returned to the caller\n' >&2
	exit 1
fi
grep -F "git stash push --include-untracked" "$CALL_LOG" > /dev/null
grep -F "git switch --detach oldcommit" "$CALL_LOG" > /dev/null
if [[ "$(grep -c -F "git stash apply --index localstash" "$CALL_LOG")" -ne 2 ]]; then
	printf 'original deployment changes should be applied once for the target and once after rollback\n' >&2
	cat "$CALL_LOG" >&2
	exit 1
fi
grep -F "已恢复原 Git revision 和本地部署文件" "$OUTPUT_LOG" > /dev/null

echo "update-script tests passed"
