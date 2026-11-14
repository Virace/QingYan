#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALL_SCRIPT="$PROJECT_ROOT/scripts/install.sh"
mkdir -p "$PROJECT_ROOT/.temp/install-script"
TEST_ROOT="$(mktemp -d "$PROJECT_ROOT/.temp/install-script/run-XXXXXX")"
ORIGIN="$TEST_ROOT/origin.git"
ORIGIN_URL="file://$ORIGIN"
if command -v cygpath >/dev/null; then ORIGIN_URL="file:///$(cygpath -am "$ORIGIN")"; fi
SEED="$TEST_ROOT/seed"
FAKE_BIN="$TEST_ROOT/bin"
CALL_LOG="$TEST_ROOT/docker.log"
REAL_GIT="$(command -v git)"
mkdir -p "$FAKE_BIN"
printf '验证文件保留在：%s\n' "$TEST_ROOT"
trap 'printf "失败位置：%s:%s\n保留目录：%s\n" "${BASH_SOURCE[0]}" "$LINENO" "$TEST_ROOT" >&2' ERR

git init --bare --quiet "$ORIGIN"
git init --quiet "$SEED"
git -C "$SEED" config user.email test@example.com
git -C "$SEED" config user.name 'QingYan installer test'
printf 'FROM scratch\n' > "$SEED/Dockerfile"
printf '{"version":"1.0.0"}\n' > "$SEED/package.json"
git -C "$SEED" add Dockerfile package.json
git -C "$SEED" commit --quiet -m initial
git -C "$SEED" tag v1.0.0
printf '{"version":"1.1.0"}\n' > "$SEED/package.json"
git -C "$SEED" add package.json
git -C "$SEED" commit --quiet -m stable
git -C "$SEED" tag v1.1.0
git -C "$SEED" tag v2.0.0-rc.1
git -C "$SEED" push --quiet "$ORIGIN" HEAD:main --tags

cat > "$FAKE_BIN/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
printf '%s | docker %s\n' "$PWD" "$*" >> "$CALL_LOG"
case "$*" in
	"info"|"compose version"|"compose config --quiet"|"compose up -d qingyan"|"compose ps"|"compose restart qingyan"|"compose stop qingyan") exit 0 ;;
	"compose ps -q qingyan") printf 'container-id\n'; exit 0 ;;
	"inspect "*) if [[ "$*" == *State.Running* ]]; then printf 'true\n'; else printf 'healthy\n'; fi; exit 0 ;;
	"build "*) [[ "${FAKE_BUILD_FAIL:-0}" != 1 ]] || exit 42; exit 0 ;;
	"compose exec -T qingyan qyctl --version") printf 'QingYan 1.1.0\n'; exit 0 ;;
	"compose exec -T qingyan qyctl "*|"compose run --rm --no-deps qingyan qyctl "*|"compose exec -T qingyan node "*|"compose logs "*) exit 0 ;;
esac
printf 'unexpected docker command: %s\n' "$*" >&2
exit 91
DOCKER
chmod +x "$FAKE_BIN/docker"

cat > "$FAKE_BIN/curl" <<'CURL'
#!/usr/bin/env bash
set -euo pipefail
case "${*: -1}" in
	*registry.npmmirror.com*|*mirrors.tuna*|*npmmirror.com*) printf '0.100' ;;
	*) printf '0.300' ;;
esac
CURL
chmod +x "$FAKE_BIN/curl"

run_install() {
	env PATH="$FAKE_BIN:$PATH" CALL_LOG="$CALL_LOG" QINGYAN_REPOSITORY_URL="$ORIGIN_URL" \
		bash "$INSTALL_SCRIPT" --non-interactive --github-source direct --network-profile cn "$@"
}

PARENT="$TEST_ROOT/parent with spaces"
mkdir -p "$PARENT"
printf 'other app\n' > "$PARENT/keep.txt"
: > "$CALL_LOG"
run_install --dir "$PARENT" --prepare-only > "$TEST_ROOT/prepare.log" 2>&1
[[ "$(git -C "$PARENT/.qingyan-source" describe --tags --exact-match HEAD)" == v1.1.0 ]]
[[ -d "$PARENT/qingyan/config" && -d "$PARENT/qingyan/data" && -d "$PARENT/qingyan/logs" ]]
[[ ! -e "$PARENT/qingyan/config/qingyan.yml" && ! -e "$PARENT/qingyan/config/qingyan.installed.lock" ]]
[[ ! -s "$CALL_LOG" && "$(cat "$PARENT/keep.txt")" == 'other app' ]]
[[ -f "$PARENT/qingyan/update.sh" && ! -L "$PARENT/qingyan/update.sh" ]]
install_token="$(sed -n 's/^QINGYAN_INSTALL_TOKEN=//p' "$PARENT/qingyan/.env")"
[[ -n "$install_token" ]]
if grep -F "$install_token" "$TEST_ROOT/prepare.log" >/dev/null; then exit 1; fi
bash -n "$PARENT/qingyan/update.sh"

env RUNTIME_COMPOSE="$PARENT/qingyan/compose.yml" node - <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const yaml = require('yaml');
const service = yaml.parse(fs.readFileSync(process.env.RUNTIME_COMPOSE, 'utf8')).services.qingyan;
assert.equal(service.build, undefined);
assert.equal(service.image, '${QINGYAN_IMAGE:?请先设置本地构建镜像}');
assert.deepEqual(service.volumes, ['./config:/app/config', './data:/app/data', './logs:/app/logs']);
assert.equal(service.environment.QINGYAN_SERVER_HOST, '0.0.0.0');
assert.equal(service.environment.QINGYAN_INSTALL_TOKEN, '${QINGYAN_INSTALL_TOKEN:?请先设置安装令牌}');
NODE

printf 'preserve config\n' > "$PARENT/qingyan/config/qingyan.yml"
if run_install --dir "$PARENT" --prepare-only > "$TEST_ROOT/existing.log" 2>&1; then exit 1; fi
[[ "$(cat "$PARENT/qingyan/config/qingyan.yml")" == 'preserve config' ]]

if run_install --dir "$TEST_ROOT/invalid" --database mysql --prepare-only > "$TEST_ROOT/database.log" 2>&1; then exit 1; fi
[[ ! -e "$TEST_ROOT/invalid" ]]

CUSTOM_PARENT="$TEST_ROOT/custom"
CUSTOM_SOURCE="$TEST_ROOT/custom cache"
run_install --dir "$CUSTOM_PARENT" --source-dir "$CUSTOM_SOURCE" --version v1.0.0 --prepare-only > "$TEST_ROOT/custom.log" 2>&1
custom_token="$(sed -n 's/^QINGYAN_INSTALL_TOKEN=//p' "$CUSTOM_PARENT/qingyan/.env")"
[[ ! -e "$CUSTOM_PARENT/.qingyan-source" ]]
[[ "$(git -C "$CUSTOM_SOURCE" describe --tags --exact-match HEAD)" == v1.0.0 ]]

printf '\n\n\n\n' | env PATH="$FAKE_BIN:$PATH" CALL_LOG="$CALL_LOG" QINGYAN_REPOSITORY_URL="$ORIGIN_URL" \
	bash "$INSTALL_SCRIPT" --interactive --dir "$TEST_ROOT/interactive" --github-source direct --network-profile cn --prepare-only > "$TEST_ROOT/interactive.log" 2>&1
grep -F '请选择数据库' "$TEST_ROOT/interactive.log" >/dev/null
grep -F '1) postgresql' "$TEST_ROOT/interactive.log" >/dev/null

: > "$CALL_LOG"
run_install --dir "$TEST_ROOT/normal" --network-profile auto > "$TEST_ROOT/normal.log" 2>&1
grep -F -- '--tag qingyan:v1.1.0' "$CALL_LOG" >/dev/null
grep -F -- 'QINGYAN_PNPM_REGISTRY=https://registry.npmmirror.com' "$CALL_LOG" >/dev/null
grep -F "$TEST_ROOT/normal/qingyan | docker compose up -d qingyan" "$CALL_LOG" >/dev/null
if grep -E 'qyctl (backup|restore)' "$CALL_LOG" >/dev/null; then exit 1; fi

: > "$CALL_LOG"
env PATH="$FAKE_BIN:$PATH" CALL_LOG="$CALL_LOG" bash "$CUSTOM_PARENT/qingyan/update.sh" --start --non-interactive > "$TEST_ROOT/start.log" 2>&1
grep -F -- '--tag qingyan:v1.0.0' "$CALL_LOG" >/dev/null
if grep -E 'qyctl (backup|restore|upgrade)' "$CALL_LOG" >/dev/null; then exit 1; fi

mv "$CUSTOM_SOURCE" "$TEST_ROOT/archived-source"
printf '# local runtime change\n' >> "$CUSTOM_PARENT/qingyan/compose.yml"
: > "$CALL_LOG"
env PATH="$FAKE_BIN:$PATH" CALL_LOG="$CALL_LOG" bash "$PROJECT_ROOT/scripts/update.sh" --dir "$CUSTOM_PARENT" --yes --version v1.1.0 > "$TEST_ROOT/update.log" 2>&1
[[ "$(git -C "$CUSTOM_SOURCE" describe --tags --exact-match HEAD)" == v1.1.0 ]]
grep -Fx 'QINGYAN_IMAGE=qingyan:v1.1.0' "$CUSTOM_PARENT/qingyan/.env" >/dev/null
[[ "$(sed -n 's/^QINGYAN_INSTALL_TOKEN=//p' "$CUSTOM_PARENT/qingyan/.env")" == "$custom_token" ]]
grep -F '# local runtime change' "$CUSTOM_PARENT/qingyan/compose.yml" >/dev/null
grep -F 'qyctl backup' "$CALL_LOG" >/dev/null
grep -F 'qyctl upgrade --dry-run' "$CALL_LOG" >/dev/null

FAIL_PARENT="$TEST_ROOT/fail"
run_install --dir "$FAIL_PARENT" --version v1.0.0 --prepare-only > "$TEST_ROOT/fail-prepare.log" 2>&1
: > "$CALL_LOG"
if env PATH="$FAKE_BIN:$PATH" CALL_LOG="$CALL_LOG" FAKE_BUILD_FAIL=1 bash "$FAIL_PARENT/qingyan/update.sh" --yes --version v1.1.0 > "$TEST_ROOT/fail.log" 2>&1; then
	exit 1
else
	exit_code=$?
fi
[[ "$exit_code" -eq 42 ]]
[[ "$(git -C "$FAIL_PARENT/.qingyan-source" describe --tags --exact-match HEAD)" == v1.0.0 ]]
grep -Fx 'QINGYAN_IMAGE=qingyan:v1.0.0' "$FAIL_PARENT/qingyan/.env" >/dev/null
if grep -F 'compose up -d qingyan' "$CALL_LOG" >/dev/null; then exit 1; fi

cat > "$FAKE_BIN/git" <<'GIT'
#!/usr/bin/env bash
set -euo pipefail
arguments=("$@")
network=false
for argument in "$@"; do case "$argument" in ls-remote|clone|fetch) network=true ;; esac; done
if [[ "$network" == true ]]; then
	for ((index=0; index<${#arguments[@]}; index++)); do
		case "${arguments[index]}" in
			https://github.example.test/QingYan.git) exit 28 ;;
			https://proxy.example.test/https://github.example.test/QingYan.git) arguments[index]="$ORIGIN_FIXTURE" ;;
		esac
	done
fi
exec "$REAL_GIT" "${arguments[@]}"
GIT
chmod +x "$FAKE_BIN/git"
env PATH="$FAKE_BIN:$PATH" CALL_LOG="$CALL_LOG" REAL_GIT="$REAL_GIT" ORIGIN_FIXTURE="$ORIGIN_URL" \
	QINGYAN_REPOSITORY_URL=https://github.example.test/QingYan.git \
	bash "$INSTALL_SCRIPT" --non-interactive --dir "$TEST_ROOT/proxy" --github-source auto --github-proxy https://proxy.example.test --prepare-only > "$TEST_ROOT/proxy.log" 2>&1
[[ -d "$TEST_ROOT/proxy/.qingyan-source/.git" ]]
grep -F 'GitHub 来源：代理 https://proxy.example.test' "$TEST_ROOT/proxy.log" >/dev/null

printf 'install-script tests passed\n验证文件保留在：%s\n' "$TEST_ROOT"
