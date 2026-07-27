#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UPDATE_SCRIPT="$PROJECT_ROOT/scripts/update.sh"
TEST_ROOT="$(mktemp -d)"
ORIGIN="$TEST_ROOT/origin.git"
SEED="$TEST_ROOT/seed"
FAKE_BIN="$TEST_ROOT/bin"
CALL_LOG="$TEST_ROOT/calls.log"
FAKE_STATE_DIR="$TEST_ROOT/state"
trap 'rm -rf "$TEST_ROOT"' EXIT

mkdir -p "$FAKE_BIN" "$FAKE_STATE_DIR"
git init --bare --quiet "$ORIGIN"
git init --quiet "$SEED"
git -C "$SEED" config user.email test@example.com
git -C "$SEED" config user.name 'QingYan updater test'
printf 'services:\n  qingyan:\n    image: old\n' > "$SEED/compose.yml"
printf 'old\n' > "$SEED/release.txt"
git -C "$SEED" add compose.yml release.txt
git -C "$SEED" commit --quiet -m old
git -C "$SEED" tag v0.2.2
printf 'new\n' > "$SEED/release.txt"
git -C "$SEED" add release.txt
git -C "$SEED" commit --quiet -m new
git -C "$SEED" tag v0.2.3
git -C "$SEED" remote add origin "$ORIGIN"
git -C "$SEED" push --quiet origin HEAD:main --tags
git --git-dir="$ORIGIN" symbolic-ref HEAD refs/heads/main

cat > "$FAKE_BIN/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\n' "$*" >> "$CALL_LOG"
case "$*" in
	"info"|"compose version"|"compose up -d qingyan"|"compose restart qingyan"|"compose ps") exit 0 ;;
	"compose ps -q qingyan") printf 'container-id\n'; exit 0 ;;
esac
if [[ "${1:-}" == "inspect" ]]; then
	if [[ "$*" == *"{{.State.Running}}"* ]]; then printf 'true\n'; else printf 'healthy\n'; fi
	exit 0
fi
if [[ "$*" == *"qyctl --version"* ]]; then printf 'QingYan 0.2.3\n'; exit 0; fi
if [[ "$*" == *"qyctl update check"* ]]; then printf '状态：当前已是最新版本\n'; exit 0; fi
if [[ "$*" == *"qyctl backup"* ]]; then printf 'backup-created\n'; exit 0; fi
if [[ "$*" == *" build --pull "* && "$*" == *" qingyan" ]]; then
	if [[ "${FAKE_BUILD_FAIL:-0}" == "1" ]]; then exit 42; fi
	exit 0
fi
if [[ "$*" == *"qyctl upgrade --dry-run"* ]]; then printf '{"state":"upgrade_required"}\n'; exit 0; fi
if [[ "$*" == *"qyctl upgrade --yes"* ]]; then printf '{"state":"normal_current"}\n'; exit 0; fi
if [[ "$*" == "compose logs --tail=200 qingyan" ]]; then exit 0; fi
printf 'unexpected docker command: %s\n' "$*" >&2
exit 91
FAKE_DOCKER
chmod +x "$FAKE_BIN/docker"

prepare_checkout() {
	local destination="$1"
	git clone --quiet "$ORIGIN" "$destination"
	git -C "$destination" config user.email test@example.com
	git -C "$destination" config user.name 'QingYan updater test'
	git -C "$destination" switch --quiet --detach v0.2.2
	printf '# production override\n' >> "$destination/compose.yml"
	printf '#!/bin/sh\necho local helper\n' > "$destination/up.sh"
	chmod +x "$destination/up.sh"
}

assert_deployment_state() {
	local checkout="$1"
	local expected_status=$' M compose.yml\n?? up.sh'
	local actual_status
	actual_status="$(git -C "$checkout" status --porcelain=v1 --untracked-files=normal)"
	[[ "$actual_status" == "$expected_status" ]]
	grep -F '# production override' "$checkout/compose.yml" > /dev/null
	grep -F 'local helper' "$checkout/up.sh" > /dev/null
	[[ -z "$(git -C "$checkout" stash list)" ]]
}

SUCCESS_REPO="$TEST_ROOT/success"
prepare_checkout "$SUCCESS_REPO"
: > "$CALL_LOG"
env PATH="$FAKE_BIN:$PATH" QINGYAN_ROOT="$SUCCESS_REPO" CALL_LOG="$CALL_LOG" FAKE_STATE_DIR="$FAKE_STATE_DIR" \
	bash "$UPDATE_SCRIPT" --yes --network-profile cn v0.2.3 > /dev/null
[[ "$(git -C "$SUCCESS_REPO" describe --tags --exact-match HEAD)" == "v0.2.3" ]]
assert_deployment_state "$SUCCESS_REPO"

FAIL_REPO="$TEST_ROOT/fail"
prepare_checkout "$FAIL_REPO"
OLD_COMMIT="$(git -C "$FAIL_REPO" rev-parse HEAD)"
: > "$CALL_LOG"
set +e
env PATH="$FAKE_BIN:$PATH" QINGYAN_ROOT="$FAIL_REPO" CALL_LOG="$CALL_LOG" FAKE_STATE_DIR="$FAKE_STATE_DIR" FAKE_BUILD_FAIL=1 \
	bash "$UPDATE_SCRIPT" --yes --network-profile cn v0.2.3 > /dev/null 2>&1
exit_code=$?
set -e
[[ "$exit_code" -eq 42 ]]
[[ "$(git -C "$FAIL_REPO" rev-parse HEAD)" == "$OLD_COMMIT" ]]
assert_deployment_state "$FAIL_REPO"
if grep -F 'docker compose up -d qingyan' "$CALL_LOG" > /dev/null; then
	printf 'failed build activated the new container\n' >&2
	exit 1
fi

echo 'real-git updater transaction passed'
