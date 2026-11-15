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
printf 'services:\n  qingyan:\n    image: old\n    build: .\n    ports: ["4401:4401"]\n    volumes: ["./config:/app/config", "./data:/app/data"]\n' > "$SEED/compose.yml"
printf 'data/\nlogs/\n' > "$SEED/.gitignore"
git -C "$SEED" add Dockerfile package.json compose.yml .gitignore
git -C "$SEED" commit --quiet -m initial
git -C "$SEED" tag v1.0.0
printf '{"version":"1.1.0"}\n' > "$SEED/package.json"
mkdir -p "$SEED/services/onepanel-gateway" "$SEED/scripts"
printf 'FROM scratch\n' > "$SEED/services/onepanel-gateway/Dockerfile"
cp "$PROJECT_ROOT/scripts/install.sh" "$SEED/scripts/install.sh"
cp "$PROJECT_ROOT/scripts/deployment-layout.mjs" "$SEED/scripts/deployment-layout.mjs"
cp "$PROJECT_ROOT/.gitignore" "$SEED/.gitignore"
printf 'services:\n  qingyan:\n    image: ${QINGYAN_IMAGE:-qingyan:local}\n    build: .\n    ports: ["4401:4401"]\n    volumes: ["./config:/app/config", "./data:/app/data"]\n' > "$SEED/compose.yml"
git -C "$SEED" add package.json services scripts compose.yml .gitignore
git -C "$SEED" commit --quiet -m stable
git -C "$SEED" tag v1.1.0
git -C "$SEED" tag v2.0.0-rc.1
git -C "$SEED" push --quiet "$ORIGIN" HEAD:main --tags

cat > "$FAKE_BIN/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
printf '%s | docker %s\n' "$PWD" "$*" >> "$CALL_LOG"
case "$*" in
	"info"|"compose version"|"compose config --quiet"|"compose up -d qingyan"|"compose up -d --force-recreate qingyan"|"compose up -d qingyan onepanel-gateway"|"compose ps"|"compose restart qingyan"|"compose stop qingyan"|"compose stop qingyan onepanel-gateway"|"compose stop onepanel-gateway"|"compose start qingyan"|"compose start qingyan onepanel-gateway") exit 0 ;;
	"compose ps -q qingyan") printf 'container-id\n'; exit 0 ;;
	"compose ps -q onepanel-gateway") printf 'gateway-id\n'; exit 0 ;;
	"ps --format "*) [[ "${FAKE_DATABASE_PRESENT:-0}" != 1 ]] || printf '1Panel-postgresql postgres:18.7\n'; exit 0 ;;
	"container inspect qingyan-postgresql") [[ -f "$FAKE_BIN/database-created" ]]; exit ;;
	"network inspect qingyan-database") [[ -f "$FAKE_BIN/database-network-created" ]] || exit 1; printf '[{"Name":"qingyan-database","IPAM":{"Config":[{"Subnet":"172.28.0.0/16"}]}}]\n'; exit 0 ;;
	"network inspect existing-database") printf '[{"Name":"existing-database","IPAM":{"Config":[{"Subnet":"172.28.0.0/16"}]}}]\n'; exit 0 ;;
	"network create "*) touch "$FAKE_BIN/database-network-created"; exit 0 ;;
	"network ls -q") printf 'network-default\n'; exit 0 ;;
	"network inspect network-default") if [[ "${FAKE_NETWORK_CONFLICT:-0}" == 1 ]]; then printf '[{"Name":"another-app","IPAM":{"Config":[{"Subnet":"172.30.251.0/24"}]}}]\n'; else printf '[{"Name":"bridge","IPAM":{"Config":[{"Subnet":"172.17.0.0/16"}]}}]\n'; fi; exit 0 ;;
	"run -d --name qingyan-postgresql "*) touch "$FAKE_BIN/database-created"; exit 0 ;;
	"exec qingyan-postgresql pg_isready "*) exit 0 ;;
	"exec -i qingyan-postgresql psql "*) cat > "$FAKE_BIN/database-init.sql"; exit 0 ;;
	"inspect "*) if [[ "$*" == *State.Running* ]]; then printf 'true\n'; else printf 'healthy\n'; fi; exit 0 ;;
	"build "*|"compose --progress plain build "*) [[ "${FAKE_BUILD_FAIL:-0}" != 1 ]] || exit 42; if [[ "${FAKE_GATEWAY_BUILD_FAIL:-0}" == 1 && "$*" == *'--tag qingyan-onepanel-gateway:'* ]]; then exit 44; fi; exit 0 ;;
	"compose config --format json") node -e 'const fs=require("fs");const yaml=require("yaml");console.log(JSON.stringify(yaml.parse(fs.readFileSync("compose.yml","utf8"))))'; exit 0 ;;
	"compose exec -T qingyan qyctl upgrade --dry-run") if [[ -f .env ]]; then grep '^QINGYAN_WAF_SYNC_PAUSED=' .env >> "$FAKE_BIN/pause-observations" || true; fi; [[ "${FAKE_PLAN_FAIL:-0}" != 1 ]] || exit 45; exit 0 ;;
	"compose exec -T qingyan qyctl --version") printf 'QingYan 1.1.0\n'; exit 0 ;;
	"compose exec -T qingyan qyctl "*|"compose run --rm --no-deps qingyan qyctl "*|"compose exec -T qingyan node "*|"compose logs "*) exit 0 ;;
esac
if [[ "$*" == run\ --rm* && "$*" == *'/deployment-layout.mjs' ]]; then
	arguments=("$@")
	for ((index=0; index<${#arguments[@]}; index++)); do
		case "${arguments[index]}" in
			-v)
				binding="${arguments[index+1]}"
				case "$binding" in *:/deployment-layout.mjs:ro) helper="${binding%:/deployment-layout.mjs:ro}" ;; *:/deployment) directory="${binding%:/deployment}" ;; esac
				;;
			-e) export "${arguments[index+1]}" ;;
		esac
	done
	export QINGYAN_LAYOUT_DIRECTORY="$directory"
	export QINGYAN_LAYOUT_EFFECTIVE_PATH="${QINGYAN_LAYOUT_EFFECTIVE_PATH/\/deployment\//$directory/}"
	export QINGYAN_LAYOUT_NETWORKS_PATH="${QINGYAN_LAYOUT_NETWORKS_PATH/\/deployment\//$directory/}"
	node "$helper"
	exit
fi
if [[ "$*" == run\ --rm* && "$*" == *'--env QINGYAN_DATABASE_URL --entrypoint node '* ]]; then [[ "${FAKE_DATABASE_CONNECT_FAIL:-0}" != 1 ]]; exit; fi
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
	env PATH="$FAKE_BIN:$PATH" FAKE_BIN="$FAKE_BIN" CALL_LOG="$CALL_LOG" QINGYAN_REPOSITORY_URL="$ORIGIN_URL" QINGYAN_DATABASE_URL="${TEST_DATABASE_URL-postgresql://app:local-test-only@database:5432/qingyan}" \
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
env PATH="$FAKE_BIN:$PATH" FAKE_BIN="$FAKE_BIN" CALL_LOG="$CALL_LOG" QINGYAN_DATABASE_URL=postgresql://app:local-test-only@database:5432/qingyan bash "$CUSTOM_PARENT/qingyan/update.sh" --start --non-interactive > "$TEST_ROOT/start.log" 2>&1
grep -F -- '--tag qingyan:v1.0.0' "$CALL_LOG" >/dev/null
if grep -E 'qyctl (backup|restore|upgrade)' "$CALL_LOG" >/dev/null; then exit 1; fi

mv "$CUSTOM_SOURCE" "$TEST_ROOT/archived-source"
printf '# local runtime change\n' >> "$CUSTOM_PARENT/qingyan/compose.yml"
: > "$CALL_LOG"
env PATH="$FAKE_BIN:$PATH" FAKE_BIN="$FAKE_BIN" CALL_LOG="$CALL_LOG" bash "$PROJECT_ROOT/scripts/update.sh" --dir "$CUSTOM_PARENT" --yes --version v1.1.0 > "$TEST_ROOT/update.log" 2>&1
[[ "$(git -C "$CUSTOM_SOURCE" describe --tags --exact-match HEAD)" == v1.1.0 ]]
grep -Fx 'QINGYAN_IMAGE=qingyan:v1.1.0' "$CUSTOM_PARENT/qingyan/.env" >/dev/null
[[ "$(sed -n 's/^QINGYAN_INSTALL_TOKEN=//p' "$CUSTOM_PARENT/qingyan/.env")" == "$custom_token" ]]
grep -F '# local runtime change' "$CUSTOM_PARENT/qingyan/compose.yml" >/dev/null
grep -F 'qyctl backup' "$CALL_LOG" >/dev/null
grep -F 'qyctl upgrade --dry-run' "$CALL_LOG" >/dev/null

FAIL_PARENT="$TEST_ROOT/fail"
run_install --dir "$FAIL_PARENT" --version v1.0.0 --prepare-only > "$TEST_ROOT/fail-prepare.log" 2>&1
: > "$CALL_LOG"
if env PATH="$FAKE_BIN:$PATH" FAKE_BIN="$FAKE_BIN" CALL_LOG="$CALL_LOG" FAKE_BUILD_FAIL=1 bash "$FAIL_PARENT/qingyan/update.sh" --yes --version v1.1.0 > "$TEST_ROOT/fail.log" 2>&1; then
	exit 1
else
	exit_code=$?
fi
[[ "$exit_code" -eq 42 ]]
[[ "$(git -C "$FAIL_PARENT/.qingyan-source" describe --tags --exact-match HEAD)" == v1.0.0 ]]
grep -Fx 'QINGYAN_IMAGE=qingyan:v1.0.0' "$FAIL_PARENT/qingyan/.env" >/dev/null
if grep -F 'compose up -d qingyan' "$CALL_LOG" >/dev/null; then exit 1; fi

: > "$CALL_LOG"
if FAKE_DATABASE_CONNECT_FAIL=1 run_install --dir "$TEST_ROOT/unreachable-database" > "$TEST_ROOT/unreachable-database.log" 2>&1; then exit 1; fi
grep -F '数据库不可达或版本不匹配' "$TEST_ROOT/unreachable-database.log" >/dev/null
if grep -F 'compose up -d' "$CALL_LOG" >/dev/null; then exit 1; fi

: > "$CALL_LOG"
if TEST_DATABASE_URL='' FAKE_DATABASE_PRESENT=1 run_install --dir "$TEST_ROOT/no-database-choice" > "$TEST_ROOT/no-database-choice.log" 2>&1; then exit 1; fi
[[ ! -e "$TEST_ROOT/no-database-choice" ]]
grep -F '安装已取消' "$TEST_ROOT/no-database-choice.log" >/dev/null
if grep -F 'run -d --name qingyan-postgresql' "$CALL_LOG" >/dev/null; then exit 1; fi

EXISTING_DATABASE_PARENT="$TEST_ROOT/existing-database"
printf '\n\n\n\n1\npostgresql://app:fixture-password@1Panel-postgresql:5432/qingyan\nexisting-database\n' | env PATH="$FAKE_BIN:$PATH" FAKE_BIN="$FAKE_BIN" CALL_LOG="$CALL_LOG" QINGYAN_REPOSITORY_URL="$ORIGIN_URL" QINGYAN_DATABASE_URL='' FAKE_DATABASE_PRESENT=1 \
	bash "$INSTALL_SCRIPT" --interactive --dir "$EXISTING_DATABASE_PARENT" --github-source direct --network-profile cn > "$TEST_ROOT/existing-database.log" 2>&1
if grep -F 'fixture-password' "$TEST_ROOT/existing-database.log" "$CALL_LOG" >/dev/null; then exit 1; fi
grep -F "QINGYAN_DATABASE_NETWORK='existing-database'" "$EXISTING_DATABASE_PARENT/qingyan/.env" >/dev/null

: > "$CALL_LOG"
TEST_DATABASE_URL='' run_install --dir "$TEST_ROOT/new-database" --create-database > "$TEST_ROOT/new-database.log" 2>&1
grep -F 'run -d --name qingyan-postgresql' "$CALL_LOG" >/dev/null
if grep -F 'run -d --name qingyan-postgresql' "$CALL_LOG" | grep -E -- ' -p | --publish ' >/dev/null; then exit 1; fi
grep -F 'NOSUPERUSER NOCREATEDB NOCREATEROLE' "$FAKE_BIN/database-init.sql" >/dev/null
env RUNTIME="$TEST_ROOT/new-database/qingyan" node - <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const overlay = JSON.parse(fs.readFileSync(path.join(process.env.RUNTIME, 'gateway.compose.json'), 'utf8'));
assert.equal(overlay.services.postgresql, undefined);
assert.equal(overlay.networks['qingyan-database'].external, true);
assert.equal(overlay.networks['qingyan-database'].name, 'qingyan-database');
assert.deepEqual(overlay.services.qingyan.networks['qingyan-database'], {});
assert.equal(overlay.services['onepanel-gateway'].ports, undefined);
assert.deepEqual(overlay.services['onepanel-gateway'].profiles, ['onepanel']);
NODE

env DEPLOYMENT_HELPER="$PROJECT_ROOT/scripts/deployment-layout.mjs" node --input-type=module - <<'NODE'
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { buildDeploymentOverlay } = await import(pathToFileURL(process.env.DEPLOYMENT_HELPER).href);
const hostDirectory = path.resolve('fixture-host-deployment');
const effective = {
  services: { qingyan: { image: 'fixture:1', networks: { database: {} }, volumes: [{ type: 'bind', source: path.join(hostDirectory, 'gateway', 'client'), target: '/run/qingyan-gateway', read_only: true }] } },
  networks: { database: { name: '1panel-network', external: true } },
};
const overlay = buildDeploymentOverlay(effective, { directory: path.resolve('fixture-container-mount'), hostDirectory, databaseNetwork: '1panel-network', gatewaySupported: false });
assert.deepEqual(Object.keys(overlay.services.qingyan.networks), ['database']);
assert.deepEqual(overlay.networks, effective.networks);
const repeated = buildDeploymentOverlay({ ...effective, networks: overlay.networks }, { directory: path.resolve('fixture-container-mount'), hostDirectory, databaseNetwork: '1panel-network', gatewaySupported: false });
assert.deepEqual(repeated.networks, effective.networks);
const secured = buildDeploymentOverlay({ ...effective, services: { ...effective.services, 'onepanel-gateway': { cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'] } } }, { directory: path.resolve('fixture-container-mount'), hostDirectory, databaseNetwork: '1panel-network', gatewaySupported: true, gatewayEnabled: true, gatewaySubnet: '172.30.251.0/28', gatewayHostIp: '172.30.251.1', gatewayIp: '172.30.251.3' });
assert.equal(secured.services['onepanel-gateway'].security_opt, undefined);
assert.equal(secured.services['onepanel-gateway'].cap_drop, undefined);
NODE

cp "$PROJECT_ROOT/services/onepanel-gateway/allowlist.example.json" "$TEST_ROOT/gateway-policy.json"
printf '00000000000000000000000000000000' > "$TEST_ROOT/panel-key"
printf '{"sites":[{"siteKey":"example","websiteId":1,"websiteKey":"example.test","hosts":["example.test"],"autoBanScans":false}],"collectUnknownHosts":false}\n' > "$TEST_ROOT/waf-sites.json"
GATEWAY_PARENT="$TEST_ROOT/gateway-enabled"
: > "$CALL_LOG"
run_install --dir "$GATEWAY_PARENT" --version v1.1.0 --gateway-config "$TEST_ROOT/gateway-policy.json" --panel-api-key-file "$TEST_ROOT/panel-key" --waf-mapping "$TEST_ROOT/waf-sites.json" > "$TEST_ROOT/gateway-enabled.log" 2>&1
cmp "$TEST_ROOT/panel-key" "$GATEWAY_PARENT/qingyan/gateway/secrets/onepanel-api-key"
cmp "$TEST_ROOT/gateway-policy.json" "$GATEWAY_PARENT/qingyan/gateway/allowlist.json"
grep -F "QINGYAN_WAF_ENABLED='true'" "$GATEWAY_PARENT/qingyan/.env" >/dev/null
grep -F "COMPOSE_PROFILES='onepanel'" "$GATEWAY_PARENT/qingyan/.env" >/dev/null
grep -F 'compose up -d qingyan onepanel-gateway' "$CALL_LOG" >/dev/null
env RUNTIME="$GATEWAY_PARENT/qingyan" node - <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const overlay = JSON.parse(fs.readFileSync(path.join(process.env.RUNTIME, 'gateway.compose.json'), 'utf8'));
assert.equal(overlay.services.qingyan.environment.QINGYAN_WAF_ENABLED, '${QINGYAN_WAF_ENABLED:-false}');
assert.equal(overlay.services.qingyan.environment.QINGYAN_WAF_MAPPING_FILE, '/app/config/waf-sites.json');
assert.deepEqual(overlay.services.qingyan.volumes, ['./gateway/client:/run/qingyan-gateway:ro']);
assert.equal(overlay.services['onepanel-gateway'].ports, undefined);
assert.equal(overlay.services['onepanel-gateway'].networks['panel-gateway'].ipv4_address, '172.30.251.3');
assert.ok(!overlay.services.qingyan.volumes.some(value => value.includes('onepanel-api-key')));
NODE

GENERIC_GATEWAY_PARENT="$TEST_ROOT/generic-gateway"
run_install --dir "$GENERIC_GATEWAY_PARENT" --version v1.1.0 --gateway-config "$TEST_ROOT/gateway-policy.json" --panel-api-key-file "$TEST_ROOT/panel-key" > "$TEST_ROOT/generic-gateway.log" 2>&1
grep -F "QINGYAN_GATEWAY_ENABLED='true'" "$GENERIC_GATEWAY_PARENT/qingyan/.env" >/dev/null
grep -F "QINGYAN_WAF_ENABLED='false'" "$GENERIC_GATEWAY_PARENT/qingyan/.env" >/dev/null

: > "$CALL_LOG"
if FAKE_NETWORK_CONFLICT=1 run_install --dir "$TEST_ROOT/network-conflict" --gateway-config "$TEST_ROOT/gateway-policy.json" --panel-api-key-file "$TEST_ROOT/panel-key" > "$TEST_ROOT/network-conflict.log" 2>&1; then exit 1; fi
grep -F '与已有 Docker 网络冲突' "$TEST_ROOT/network-conflict.log" >/dev/null
if grep -F 'compose up -d' "$CALL_LOG" >/dev/null; then exit 1; fi

printf '{"version":"1.2.0"}\n' > "$SEED/package.json"
git -C "$SEED" add package.json
git -C "$SEED" commit --quiet -m next
git -C "$SEED" tag v1.2.0
git -C "$SEED" push --quiet "$ORIGIN" HEAD:main --tags
cp "$GATEWAY_PARENT/qingyan/.env" "$TEST_ROOT/gateway-previous.env"
printf '# preserve gateway deployment customization\n' >> "$GATEWAY_PARENT/qingyan/compose.yml"
: > "$CALL_LOG"
if env PATH="$FAKE_BIN:$PATH" FAKE_BIN="$FAKE_BIN" CALL_LOG="$CALL_LOG" FAKE_PLAN_FAIL=1 bash "$GATEWAY_PARENT/qingyan/update.sh" --yes --version v1.2.0 > "$TEST_ROOT/gateway-rollback.log" 2>&1; then exit 1; else exit_code=$?; fi
[[ "$exit_code" -eq 45 ]]
cmp "$TEST_ROOT/gateway-previous.env" "$GATEWAY_PARENT/qingyan/.env"
[[ "$(git -C "$GATEWAY_PARENT/.qingyan-source" describe --tags --exact-match HEAD)" == v1.1.0 ]]
grep -F '# preserve gateway deployment customization' "$GATEWAY_PARENT/qingyan/compose.yml" >/dev/null
grep -F 'compose up -d qingyan onepanel-gateway' "$CALL_LOG" >/dev/null
if grep -F 'qyctl upgrade --yes' "$CALL_LOG" >/dev/null; then exit 1; fi

: > "$CALL_LOG"
env PATH="$FAKE_BIN:$PATH" FAKE_BIN="$FAKE_BIN" CALL_LOG="$CALL_LOG" bash "$GATEWAY_PARENT/qingyan/update.sh" --yes --version v1.1.0 > "$TEST_ROOT/gateway-resume.log" 2>&1
grep -F 'compose up -d --force-recreate qingyan' "$CALL_LOG" >/dev/null
grep -F "QINGYAN_WAF_SYNC_PAUSED='true'" "$FAKE_BIN/pause-observations" >/dev/null
if grep -q '^QINGYAN_WAF_SYNC_PAUSED=' "$GATEWAY_PARENT/qingyan/.env"; then exit 1; fi

LEGACY="$TEST_ROOT/legacy-checkout"
git clone --quiet "$ORIGIN_URL" "$LEGACY"
git -C "$LEGACY" config user.email test@example.com
git -C "$LEGACY" config user.name 'QingYan installer test'
git -C "$LEGACY" switch --quiet --detach v1.0.0
sed -i 's/4401:4401/54401:4401/' "$LEGACY/compose.yml"
printf 'PRIVATE_OVERRIDE=must-not-enter-stash\n' > "$LEGACY/.env"
: > "$CALL_LOG"
env PATH="$FAKE_BIN:$PATH" FAKE_BIN="$FAKE_BIN" CALL_LOG="$CALL_LOG" QINGYAN_ROOT="$LEGACY" \
	bash "$PROJECT_ROOT/scripts/update.sh" --yes --network-profile cn v1.1.0 --gateway-config "$TEST_ROOT/gateway-policy.json" --panel-api-key-file "$TEST_ROOT/panel-key" --waf-mapping "$TEST_ROOT/waf-sites.json" > "$TEST_ROOT/legacy-gateway.log" 2>&1
[[ "$(git -C "$LEGACY" describe --tags --exact-match HEAD)" == v1.1.0 ]]
grep -F '54401:4401' "$LEGACY/compose.yml" >/dev/null
grep -F 'PRIVATE_OVERRIDE=must-not-enter-stash' "$LEGACY/.env" >/dev/null
grep -F 'QINGYAN_IMAGE=qingyan:v1.1.0' "$LEGACY/.env" >/dev/null
grep -F "QINGYAN_GATEWAY_IMAGE='qingyan-onepanel-gateway:v1.1.0'" "$LEGACY/.env" >/dev/null
grep -F 'compose up -d qingyan onepanel-gateway' "$CALL_LOG" >/dev/null
git -C "$LEGACY" fsck --unreachable --no-reflogs > "$TEST_ROOT/legacy-unreachable.log" 2>/dev/null
while read -r state kind object; do
	if [[ "$kind" == blob ]] && git -C "$LEGACY" cat-file -p "$object" | grep -F 'must-not-enter-stash' >/dev/null; then exit 1; fi
done < "$TEST_ROOT/legacy-unreachable.log"

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
