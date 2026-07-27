#!/usr/bin/env bash
set -Eeuo pipefail

SERVICE_NAME="qingyan"
AUTO_YES=false
TARGET_TAG=""
PHASE="初始化"
REPOSITORY_ROOT=""
PREVIOUS_COMMIT=""
PREVIOUS_REF=""
BACKUP_DIRECTORY=""
SWITCHED_REVISION=false
ACTIVATION_STARTED=false

usage() {
	cat <<'USAGE'
用法：
  ./scripts/update.sh [--yes] [vX.Y.Z]
  bash <(curl -fsSL https://raw.githubusercontent.com/Virace/QingYan/v0.2.2/scripts/update.sh) [--yes] [vX.Y.Z]

不指定版本时，脚本会 fetch tags 并选择最高的稳定 vX.Y.Z tag。
默认会在切换版本和应用数据升级前请求确认；--yes 表示接受两次确认。
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

	if [[ "$SWITCHED_REVISION" == "true" && "$ACTIVATION_STARTED" == "false" ]]; then
		if restore_previous_revision; then
			printf '已恢复原 Git revision；运行中的旧容器未被替换。\n' >&2
		else
			printf '无法自动恢复 Git revision，请保留现场并人工检查。\n' >&2
		fi
	fi

	if [[ "$ACTIVATION_STARTED" == "true" ]]; then
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

if [[ -n "$TARGET_TAG" && ! "$TARGET_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
	fail "目标版本必须是稳定 tag，例如 v0.2.2。"
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

if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
	fail "工作区存在未提交改动；为避免覆盖现场，更新已停止。"
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
docker compose exec -T "$SERVICE_NAME" qyctl --version
if ! docker compose exec -T "$SERVICE_NAME" qyctl update check; then
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
docker compose exec -T "$SERVICE_NAME" qyctl backup "$BACKUP_DIRECTORY" --yes

PHASE="切换 Release"
log "切换到 $TARGET_TAG"
git switch --detach "$TARGET_TAG"
SWITCHED_REVISION=true

PHASE="构建镜像"
log "构建 $TARGET_TAG 镜像"
docker compose --progress plain build --pull "$SERVICE_NAME"

PHASE="启动新容器"
ACTIVATION_STARTED=true
log "启动新容器"
docker compose up -d "$SERVICE_NAME"
wait_for_container_running

PHASE="检查升级计划"
log "UpgradePlan"
docker compose exec -T "$SERVICE_NAME" qyctl upgrade --dry-run

if ! confirm "确认上述 UpgradePlan 和备份后，应用数据升级？"; then
	fail "用户未确认数据升级；新容器保持当前状态，未写入升级数据。"
fi

PHASE="应用数据升级"
log "应用数据升级"
docker compose exec -T "$SERVICE_NAME" qyctl upgrade --yes

PHASE="重启并验收"
log "重启并等待健康状态"
docker compose restart "$SERVICE_NAME"
wait_for_health

installed_version="$(docker compose exec -T "$SERVICE_NAME" qyctl --version)"
printf '%s\n' "$installed_version"
expected_version="${TARGET_TAG#v}"
[[ "$installed_version" == "QingYan $expected_version" ]] || fail "容器版本与目标 tag 不一致：$installed_version。"

if ! docker compose exec -T "$SERVICE_NAME" qyctl update check; then
	printf '警告：最终 GitHub Release 检测失败，请稍后重试；容器版本和健康状态已验证。\n' >&2
fi
docker compose ps

trap - ERR
printf '\n更新完成：%s\n' "$TARGET_TAG"
printf '整站备份：%s\n' "$BACKUP_DIRECTORY"
