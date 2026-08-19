#!/usr/bin/env bash
set -Eeuo pipefail

SERVICE_NAME="qingyan"
AUTO_YES=false
TARGET_TAG=""
NETWORK_PROFILE="auto"
APT_MAIN_MIRROR=""
COREPACK_NPM_REGISTRY=""
PNPM_REGISTRY=""
NODE_DIST_URL=""
BETTER_SQLITE3_BINARY_HOST=""
PHASE="初始化"
REPOSITORY_ROOT=""
PREVIOUS_COMMIT=""
PREVIOUS_REF=""
BACKUP_DIRECTORY=""
SWITCHED_REVISION=false
ACTIVATION_STARTED=false
LOCAL_CHANGES_PRESENT=false
LOCAL_CHANGES_STASH=""
LOCAL_CHANGES_APPLY_ATTEMPTED=false
LOCAL_CHANGES_APPLIED=false

usage() {
	cat <<'USAGE'
用法：
  ./scripts/update.sh [--yes] [--network-profile auto|official|cn] [vX.Y.Z]
  bash <(curl -fsSL https://raw.githubusercontent.com/Virace/QingYan/<release-tag>/scripts/update.sh) [选项]

不指定版本时，脚本会 fetch tags 并选择最高的稳定 vX.Y.Z tag。
默认会在切换版本和应用数据升级前请求确认；--yes 表示接受两次确认。
--network-profile 默认使用 auto，在 official 和 cn 之间探测并选择更快的构建依赖源。
显式选择配置档时不会在构建期间自动回退，便于复现和排错。
USAGE
}

log() {
	printf '\n==> %s\n' "$1"
}

fail() {
	printf '错误：%s\n' "$1" >&2
	return 1
}

confirm() {
	local prompt="$1"
	local answer
	if [[ "$AUTO_YES" == "true" ]]; then
		return 0
	fi
	if [[ ! -r /dev/tty ]]; then
		fail "当前没有可交互终端；确认风险后使用 --yes。"
	fi
	printf '%s [y/N] ' "$prompt" > /dev/tty
	read -r answer < /dev/tty
	[[ "$answer" == "y" || "$answer" == "Y" ]]
}

restore_previous_revision() {
	if [[ -n "$PREVIOUS_REF" ]]; then
		git switch "$PREVIOUS_REF"
	else
		git switch --detach "$PREVIOUS_COMMIT"
	fi
}

drop_stash_commit() {
	local expected_commit="$1"
	local stash_commit
	local stash_ref

	while IFS=' ' read -r stash_commit stash_ref; do
		if [[ "$stash_commit" == "$expected_commit" ]]; then
			git stash drop "$stash_ref" > /dev/null
			return 0
		fi
	done < <(git stash list --format='%H %gd')
	return 1
}

apply_local_deployment_files() {
	[[ -n "$LOCAL_CHANGES_STASH" ]] || return 0
	LOCAL_CHANGES_APPLY_ATTEMPTED=true
	git stash apply --index "$LOCAL_CHANGES_STASH"
	LOCAL_CHANGES_APPLIED=true
}

restore_pre_activation_state() {
	local rollback_stash=""

	if [[ "$LOCAL_CHANGES_APPLIED" == "true" ]]; then
		git stash push --include-untracked --message "qingyan-update-rollback" > /dev/null
		rollback_stash="$(git rev-parse refs/stash)"
		LOCAL_CHANGES_APPLIED=false
	elif [[ "$LOCAL_CHANGES_APPLY_ATTEMPTED" == "true" ]]; then
		git reset --hard HEAD > /dev/null
		git clean -fd > /dev/null
	fi

	restore_previous_revision || return 1

	if [[ -n "$LOCAL_CHANGES_STASH" ]]; then
		git stash apply --index "$LOCAL_CHANGES_STASH" || return 1
		LOCAL_CHANGES_APPLIED=true
		drop_stash_commit "$LOCAL_CHANGES_STASH" || true
		if [[ -n "$rollback_stash" ]]; then
			drop_stash_commit "$rollback_stash" || true
		fi
		LOCAL_CHANGES_STASH=""
	fi
}

on_error() {
	local exit_code=$?
	trap - ERR
	set +e
	printf '\n更新失败：阶段=%s，退出码=%s\n' "$PHASE" "$exit_code" >&2
	if [[ -n "$PREVIOUS_COMMIT" ]]; then
		printf '原 Git revision：%s\n' "$PREVIOUS_COMMIT" >&2
	fi
	if [[ -n "$BACKUP_DIRECTORY" ]]; then
		printf '升级前整站备份：%s\n' "$BACKUP_DIRECTORY" >&2
	fi

	if [[ "$ACTIVATION_STARTED" == "false" && ( "$SWITCHED_REVISION" == "true" || -n "$LOCAL_CHANGES_STASH" ) ]]; then
		if restore_pre_activation_state; then
			if [[ "$LOCAL_CHANGES_PRESENT" == "true" ]]; then
				printf '已恢复原 Git revision 和本地部署文件；运行中的旧容器未被替换。\n' >&2
			else
				printf '已恢复原 Git revision；运行中的旧容器未被替换。\n' >&2
			fi
		else
			printf '无法自动恢复 Git revision 或本地部署文件，请保留现场并人工检查。\n' >&2
		fi
	fi

	if [[ "$ACTIVATION_STARTED" == "true" ]]; then
		if [[ -n "$LOCAL_CHANGES_STASH" ]]; then
			printf '本地部署文件的安全 stash：%s\n' "$LOCAL_CHANGES_STASH" >&2
		fi
		printf '\n新容器已经开始激活，脚本不会自动覆盖数据库或配置。最近日志如下：\n' >&2
		docker compose logs --tail=200 "$SERVICE_NAME" >&2 || true
	fi
	exit "$exit_code"
}
trap on_error ERR

wait_for_container_running() {
	local timeout_seconds="${QINGYAN_UPDATE_START_TIMEOUT:-60}"
	local deadline=$((SECONDS + timeout_seconds))
	local container_id
	local running
	local state

	while (( SECONDS < deadline )); do
		container_id="$(docker compose ps -q "$SERVICE_NAME")"
		if [[ -n "$container_id" ]]; then
			running="$(docker inspect --format '{{.State.Running}}' "$container_id" 2>/dev/null || true)"
			if [[ "$running" == "true" ]]; then
				return 0
			fi
			state="$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || true)"
			if [[ "$state" == "exited" || "$state" == "dead" ]]; then
				fail "容器状态为 $state。"
			fi
		fi
		sleep 2
	done
	fail "等待容器进程启动超时（${timeout_seconds}s）。"
}
wait_for_health() {
	local timeout_seconds="${QINGYAN_UPDATE_HEALTH_TIMEOUT:-180}"
	local deadline=$((SECONDS + timeout_seconds))
	local container_id
	local state

	while (( SECONDS < deadline )); do
		container_id="$(docker compose ps -q "$SERVICE_NAME")"
		if [[ -n "$container_id" ]]; then
			state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
			if [[ "$state" == "healthy" || "$state" == "running" ]]; then
				return 0
			fi
			if [[ "$state" == "unhealthy" || "$state" == "exited" || "$state" == "dead" ]]; then
				fail "容器状态为 $state。"
			fi
		fi
		sleep 5
	done
	fail "等待容器健康状态超时（${timeout_seconds}s）。"
}

while (( $# > 0 )); do
	case "$1" in
		--yes|-y)
			AUTO_YES=true
			shift
			;;
		--network-profile)
			[[ $# -ge 2 ]] || fail "--network-profile 缺少参数。"
			NETWORK_PROFILE="$2"
			shift 2
			;;
		--help|-h)
			usage
			exit 0
			;;
		v[0-9]*.[0-9]*.[0-9]*)
			if [[ -n "$TARGET_TAG" ]]; then
				fail "只能指定一个目标版本。"
			fi
			TARGET_TAG="$1"
			shift
			;;
		*)
			usage >&2
			fail "未知参数：$1"
			;;
	esac
done

apply_network_profile() {
	case "$1" in
		official)
			APT_MAIN_MIRROR="http://deb.debian.org/debian"
			COREPACK_NPM_REGISTRY="https://registry.npmjs.org"
			PNPM_REGISTRY="https://registry.npmjs.org"
			NODE_DIST_URL="https://nodejs.org/download/release"
			BETTER_SQLITE3_BINARY_HOST="https://github.com/WiseLibs/better-sqlite3/releases/download"
			;;
		cn)
			APT_MAIN_MIRROR="http://mirrors.tuna.tsinghua.edu.cn/debian"
			COREPACK_NPM_REGISTRY="https://registry.npmmirror.com"
			PNPM_REGISTRY="https://registry.npmmirror.com"
			NODE_DIST_URL="https://npmmirror.com/mirrors/node"
			BETTER_SQLITE3_BINARY_HOST="https://registry.npmmirror.com/-/binary/better-sqlite3"
			;;
	esac
}

probe_network_route() {
	local duration
	local total="0"
	local url
	for url in "$@"; do
		if ! duration="$(curl -fsSL -o /dev/null \
			--connect-timeout "${QINGYAN_NETWORK_PROBE_CONNECT_TIMEOUT:-2}" \
			--max-time "${QINGYAN_NETWORK_PROBE_TIMEOUT:-4}" \
			-w '%{time_total}' "$url" 2>/dev/null)"; then
			return 1
		fi
		[[ "$duration" =~ ^[0-9]+([.][0-9]+)?$ ]] || return 1
		total="$(awk -v total="$total" -v duration="$duration" 'BEGIN { printf "%.6f", total + duration }')"
	done
	printf '%s' "$total"
}

case "$NETWORK_PROFILE" in
	auto)
		command -v curl > /dev/null || fail "auto 网络配置档需要 curl；也可以显式使用 --network-profile official 或 cn。"
		command -v awk > /dev/null || fail "auto 网络配置档需要 awk；也可以显式使用 --network-profile official 或 cn。"
		official_latency="$(probe_network_route \
			"http://deb.debian.org/debian/dists/bookworm/InRelease" \
			"https://registry.npmjs.org/-/ping" \
			"https://nodejs.org/download/release/latest-v24.x/SHASUMS256.txt" || true)"
		cn_latency="$(probe_network_route \
			"http://mirrors.tuna.tsinghua.edu.cn/debian/dists/bookworm/InRelease" \
			"https://registry.npmmirror.com/-/ping" \
			"https://npmmirror.com/mirrors/node/latest-v24.x/SHASUMS256.txt" || true)"
		if [[ -z "$official_latency" && -z "$cn_latency" ]]; then
			fail "official 和 cn 网络配置档均不可用；请检查网络或显式选择配置档后重试。"
		elif [[ -z "$official_latency" ]]; then
			RESOLVED_NETWORK_PROFILE="cn"
		elif [[ -z "$cn_latency" ]]; then
			RESOLVED_NETWORK_PROFILE="official"
		elif awk -v official="$official_latency" -v cn="$cn_latency" 'BEGIN { exit !(cn < official) }'; then
			RESOLVED_NETWORK_PROFILE="cn"
		else
			RESOLVED_NETWORK_PROFILE="official"
		fi
		apply_network_profile "$RESOLVED_NETWORK_PROFILE"
		printf '网络配置档：auto -> %s（official=%s，cn=%s）\n' \
			"$RESOLVED_NETWORK_PROFILE" "${official_latency:-不可用}" "${cn_latency:-不可用}"
		;;
	official|cn)
		apply_network_profile "$NETWORK_PROFILE"
		;;
	*)
		fail "未知网络配置档：$NETWORK_PROFILE；可选值为 auto、official、cn。"
		;;
esac
[[ "$NETWORK_PROFILE" == "auto" ]] || printf '网络配置档：%s\n' "$NETWORK_PROFILE"
printf '  APT 主仓库：%s\n' "$APT_MAIN_MIRROR"
printf '  Corepack/npm registry：%s\n' "$COREPACK_NPM_REGISTRY"
printf '  pnpm registry：%s\n' "$PNPM_REGISTRY"
printf '  Node headers：%s\n' "$NODE_DIST_URL"
printf '  better-sqlite3：%s\n' "$BETTER_SQLITE3_BINARY_HOST"

if [[ -n "$TARGET_TAG" && ! "$TARGET_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
	fail "目标版本必须是稳定 tag，例如 v0.2.5。"
fi

PHASE="环境预检"
command -v git > /dev/null || fail "缺少 git。"
command -v docker > /dev/null || fail "缺少 docker。"
docker compose version > /dev/null
docker info > /dev/null

if [[ -n "${QINGYAN_ROOT:-}" ]]; then
	REPOSITORY_ROOT="$QINGYAN_ROOT"
else
	REPOSITORY_ROOT="$(git rev-parse --show-toplevel)"
fi
cd "$REPOSITORY_ROOT"
REPOSITORY_ROOT="$(pwd)"
[[ -f compose.yml ]] || fail "$REPOSITORY_ROOT 不是 QingYan Docker Compose 仓库根目录。"

worktree_status="$(git status --porcelain=v1 --untracked-files=normal)"
tracked_changes="$(git diff --name-only HEAD --)"
while IFS= read -r tracked_path; do
	[[ -n "$tracked_path" ]] || continue
	if [[ "$tracked_path" != "compose.yml" ]]; then
		fail "检测到 compose.yml 之外的已跟踪改动（$tracked_path）；为避免把源码现场带入新镜像，更新已停止。"
	fi
done <<< "$tracked_changes"
if [[ -n "$worktree_status" ]]; then
	LOCAL_CHANGES_PRESENT=true
fi

PREVIOUS_COMMIT="$(git rev-parse HEAD)"
PREVIOUS_REF="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"

container_id="$(docker compose ps -q "$SERVICE_NAME")"
[[ -n "$container_id" ]] || fail "未找到正在运行的 $SERVICE_NAME 容器，无法创建升级前整站备份。"

PHASE="获取 Release"
log "获取最新 release tags"
git fetch --tags origin

if [[ -z "$TARGET_TAG" ]]; then
	while IFS= read -r candidate; do
		if [[ "$candidate" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
			TARGET_TAG="$candidate"
			break
		fi
	done < <(git tag --list 'v[0-9]*' --sort=-v:refname)
fi
[[ -n "$TARGET_TAG" ]] || fail "没有找到稳定的 vX.Y.Z release tag。"
git rev-parse --verify "refs/tags/${TARGET_TAG}^{commit}" > /dev/null

log "当前实例"
docker compose exec -T "$SERVICE_NAME" qyctl --version </dev/null
if ! docker compose exec -T "$SERVICE_NAME" qyctl update check </dev/null; then
	printf '警告：旧版本更新检测失败，但目标 tag 已由 Git 验证，继续执行。\n' >&2
fi
printf '目标版本：%s\n' "$TARGET_TAG"
printf '原 Git revision：%s\n' "$PREVIOUS_COMMIT"

if ! confirm "将备份实例并更新到 $TARGET_TAG，是否继续？"; then
	fail "用户取消更新。"
fi

PHASE="整站备份"
BACKUP_DIRECTORY="/app/data/backups/pre-update-$(date -u +%Y%m%dT%H%M%SZ)"
log "创建升级前整站备份"
docker compose exec -T "$SERVICE_NAME" qyctl backup "$BACKUP_DIRECTORY" --yes </dev/null

PHASE="切换 Release"
if [[ "$LOCAL_CHANGES_PRESENT" == "true" ]]; then
	log "安全暂存本地部署文件"
	git stash push --include-untracked --message "qingyan-update-${PREVIOUS_COMMIT}" > /dev/null
	LOCAL_CHANGES_STASH="$(git rev-parse refs/stash)"
fi
log "切换到 $TARGET_TAG"
git switch --detach "$TARGET_TAG"
SWITCHED_REVISION=true
if [[ "$LOCAL_CHANGES_PRESENT" == "true" ]]; then
	apply_local_deployment_files
	printf '已保留并恢复本地部署文件，将按当前 compose.yml 构建。\n'
fi

PHASE="构建镜像"
log "构建 $TARGET_TAG 镜像"
docker compose --progress plain build --pull \
	--build-arg "QINGYAN_APT_MAIN_MIRROR=$APT_MAIN_MIRROR" \
	--build-arg "QINGYAN_COREPACK_NPM_REGISTRY=$COREPACK_NPM_REGISTRY" \
	--build-arg "QINGYAN_PNPM_REGISTRY=$PNPM_REGISTRY" \
	--build-arg "QINGYAN_NODE_DIST_URL=$NODE_DIST_URL" \
	--build-arg "QINGYAN_BETTER_SQLITE3_BINARY_HOST=$BETTER_SQLITE3_BINARY_HOST" \
	"$SERVICE_NAME"

PHASE="启动新容器"
ACTIVATION_STARTED=true
log "启动新容器"
docker compose up -d "$SERVICE_NAME"
wait_for_container_running

PHASE="检查升级计划"
log "UpgradePlan"
docker compose exec -T "$SERVICE_NAME" qyctl upgrade --dry-run </dev/null

if ! confirm "确认上述 UpgradePlan 和备份后，应用数据升级？"; then
	fail "用户未确认数据升级；新容器保持当前状态，未写入升级数据。"
fi

PHASE="应用数据升级"
log "应用数据升级"
docker compose exec -T "$SERVICE_NAME" qyctl upgrade --yes </dev/null

PHASE="重启并验收"
log "重启并等待健康状态"
docker compose restart "$SERVICE_NAME"
wait_for_health

installed_version="$(docker compose exec -T "$SERVICE_NAME" qyctl --version </dev/null)"
printf '%s\n' "$installed_version"
expected_version="${TARGET_TAG#v}"
[[ "$installed_version" == "QingYan $expected_version" ]] || fail "容器版本与目标 tag 不一致：$installed_version。"

if ! docker compose exec -T "$SERVICE_NAME" qyctl update check </dev/null; then
	printf '警告：最终 GitHub Release 检测失败，请稍后重试；容器版本和健康状态已验证。\n' >&2
fi
docker compose ps

if [[ -n "$LOCAL_CHANGES_STASH" ]]; then
	if drop_stash_commit "$LOCAL_CHANGES_STASH"; then
		LOCAL_CHANGES_STASH=""
	else
		printf '警告：本地部署文件已恢复，但未能清理安全 stash：%s\n' "$LOCAL_CHANGES_STASH" >&2
	fi
fi

trap - ERR
printf '\n更新完成：%s\n' "$TARGET_TAG"
printf '整站备份：%s\n' "$BACKUP_DIRECTORY"
