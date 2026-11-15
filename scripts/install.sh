#!/usr/bin/env bash
set -Eeuo pipefail

qy_init() {
	QY_PARENT="$PWD"
	QY_RUNTIME=""
	QY_SOURCE=""
	QY_REPOSITORY="${QINGYAN_REPOSITORY_URL:-https://github.com/Virace/QingYan.git}"
	QY_GITHUB_SOURCE="auto"
	QY_GITHUB_PROXY="https://gh-proxy.org"
	QY_NETWORK="auto"
	QY_DATABASE="postgresql"
	QY_DATABASES=(postgresql)
	QY_TAG=""
	QY_INTERACTIVE=auto
	QY_YES=false
	QY_PREPARE=false
	QY_START=false
	QY_INSTALLED_TAG=""
	QY_MODE=install
	QY_PHASE="参数检查"
	QY_REMOTE_TAGS=""
	QY_URL=""
	QY_PREVIOUS_COMMIT=""
	QY_PREVIOUS_REF=""
	QY_BACKUP=""
	QY_ACTIVATED=false
	QY_IMAGE_CHANGED=false
	QY_PREVIOUS_IMAGE=""
	QY_CREATE_DATABASE=false
	QY_DATABASE_URL="${QINGYAN_DATABASE_URL:-}"
	QY_DATABASE_NETWORK="${QINGYAN_DATABASE_NETWORK:-}"
	QY_DATABASE_CREATED=false
	QY_POSTGRES_IMAGE="postgres:18.7@sha256:9f4fd4aa918f52ae3d6f3b687f1de90d8f867cd4d520021545a9a50c120eae3b"
	QY_GATEWAY_CONFIG=""
	QY_PANEL_KEY_FILE=""
	QY_WAF_MAPPING=""
	QY_LAYOUT_BACKUP=""
	QY_GATEWAY_ENABLED=false
	QY_DISABLE_GATEWAY=false
	QY_STOPPED=false
	QY_SCHEMA_WRITES_STARTED=false
	QY_PREVIOUS_SYNC_PAUSED=""
}

qy_fail() { printf '错误：%s\n' "$1" >&2; return 1; }
qy_log() { printf '\n==> %s\n' "$1"; }

qy_usage() {
	cat <<'USAGE'
用法：
  bash install.sh [选项]
  bash qingyan/update.sh [--yes] [选项] [vX.Y.Z]

  --dir <path>                    部署父目录，默认当前目录
  --source-dir <path>             可选源码目录，默认 <父目录>/.qingyan-source
  --version <vX.Y.Z>              稳定版本，默认最高稳定 tag
  --database postgresql          使用预建的 PostgreSQL 18 数据库和专用账号
  --create-database              明确同意新建独立 PostgreSQL 18 容器
  --database-network <name>       已有数据库容器所在的 Docker 网络
  --gateway-config <file>         启用网关，读取已审定的白名单 JSON
  --panel-api-key-file <file>     网关专用 1Panel Key 文件，与网关配置同时提供
  --waf-mapping <file>            显式启用 WAF 同步的可信站点映射 JSON
  --disable-gateway              显式停用网关同步，保留配置和凭据
  --github-source auto|direct|proxy  GitHub 来源，默认 auto
  --github-proxy <url>            GitHub 代理前缀，默认 https://gh-proxy.org
  --network-profile auto|official|cn  构建依赖源，默认 auto
  --prepare-only                 仅准备源码和部署文件，不构建、不启动
  --start                        更新入口专用：按准备时的版本构建并启动
  --interactive                  显式启用交互输入
  --non-interactive              使用参数和默认值，不询问安装选项
  --yes, -y                      非交互；更新时同时接受两次升级确认
  --help, -h                     显示帮助

运行文件保存在 <父目录>/qingyan，源码缓存可移除，更新时重新获取。
首次启动后通过 /qingyan/admin/install 完成应用安装。
USAGE
}

qy_parse() {
	while (( $# > 0 )); do
		case "$1" in
			--dir|--source-dir|--version|--database|--github-source|--github-proxy|--network-profile|--database-network|--gateway-config|--panel-api-key-file|--waf-mapping)
				[[ $# -ge 2 && -n "$2" && "$2" != --* ]] || qy_fail "$1 缺少参数。"
				case "$1" in
					--dir) QY_PARENT="$2" ;;
					--source-dir) QY_SOURCE="$2" ;;
					--version) QY_TAG="$2" ;;
					--database) QY_DATABASE="$2" ;;
					--github-source) QY_GITHUB_SOURCE="$2" ;;
					--github-proxy) QY_GITHUB_PROXY="$2" ;;
					--network-profile) QY_NETWORK="$2" ;;
					--database-network) QY_DATABASE_NETWORK="$2" ;;
					--gateway-config) QY_GATEWAY_CONFIG="$2" ;;
					--panel-api-key-file) QY_PANEL_KEY_FILE="$2" ;;
					--waf-mapping) QY_WAF_MAPPING="$2" ;;
				esac
				shift 2 ;;
			--prepare-only) QY_PREPARE=true; shift ;;
			--create-database) QY_CREATE_DATABASE=true; shift ;;
			--disable-gateway) QY_DISABLE_GATEWAY=true; shift ;;
			--start) QY_START=true; shift ;;
			--interactive) QY_INTERACTIVE=true; shift ;;
			--non-interactive) QY_INTERACTIVE=false; shift ;;
			--yes|-y) QY_YES=true; QY_INTERACTIVE=false; shift ;;
			--help|-h) qy_usage; exit 0 ;;
			v[0-9]*.[0-9]*.[0-9]*) QY_TAG="$1"; shift ;;
			*) qy_fail "未知参数：$1；使用 --help 查看用法。" ;;
		esac
	done
	[[ "$QY_INTERACTIVE" != auto ]] || { if [[ -t 0 ]]; then QY_INTERACTIVE=true; else QY_INTERACTIVE=false; fi; }
}

qy_prompt() {
	local answer
	printf '%s [%s]：' "$2" "${!1}"
	read -r answer || qy_fail "输入已结束；自动化运行请使用 --non-interactive。"
	[[ -z "$answer" ]] || printf -v "$1" '%s' "$answer"
}

qy_validate() {
	local supported=false database
	for database in "${QY_DATABASES[@]}"; do [[ "$QY_DATABASE" != "$database" ]] || supported=true; done
	[[ "$supported" == true ]] || qy_fail "不支持数据库 $QY_DATABASE；当前可选值：${QY_DATABASES[*]}。"
	[[ -z "$QY_TAG" || "$QY_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || qy_fail "版本必须是稳定 tag，例如 v0.2.5。"
	case "$QY_GITHUB_SOURCE" in auto|direct|proxy) ;; *) qy_fail "GitHub 来源可选值：auto、direct、proxy。" ;; esac
	case "$QY_NETWORK" in auto|official|cn) ;; *) qy_fail "构建依赖源可选值：auto、official、cn。" ;; esac
	[[ "$QY_GITHUB_PROXY" =~ ^https?:// ]] || qy_fail "GitHub 代理必须是 http 或 https 地址前缀。"
	[[ "$QY_PARENT$QY_SOURCE$QY_REPOSITORY$QY_GITHUB_PROXY" != *$'\n'* ]] || qy_fail "目录和来源不能包含换行。"
	[[ "$QY_MODE" == install || "$QY_PREPARE" == false ]] || qy_fail "更新入口不支持 --prepare-only。"
	[[ "$QY_MODE" == update || "$QY_START" == false ]] || qy_fail "--start 用于运行目录中的 update.sh。"
	[[ -z "$QY_DATABASE_NETWORK" || "$QY_DATABASE_NETWORK" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || qy_fail "数据库网络名包含不支持的字符。"
	[[ -z "$QY_GATEWAY_CONFIG$QY_PANEL_KEY_FILE" || ( -n "$QY_GATEWAY_CONFIG" && -n "$QY_PANEL_KEY_FILE" ) ]] || qy_fail "--gateway-config 与 --panel-api-key-file 必须同时提供。"
	[[ -z "$QY_GATEWAY_CONFIG" || ( -s "$QY_GATEWAY_CONFIG" && -s "$QY_PANEL_KEY_FILE" ) ]] || qy_fail "网关配置和 Key 文件必须存在且非空。"
	[[ "$QY_CREATE_DATABASE" != true || -z "$QY_DATABASE_URL" ]] || qy_fail "连接已有数据库与创建新数据库只能选择一种。"
	[[ "$QY_DISABLE_GATEWAY" != true || -z "$QY_GATEWAY_CONFIG" ]] || qy_fail "配置和停用网关不能同时选择。"
	[[ -z "$QY_WAF_MAPPING" || -s "$QY_WAF_MAPPING" ]] || qy_fail "WAF 站点映射文件必须存在且非空。"
	[[ "$QY_DISABLE_GATEWAY" != true || -z "$QY_WAF_MAPPING" ]] || qy_fail "停用网关时不能启用 WAF 同步。"
}

qy_write_env() {
	local key="$1" value="$2" line found=false
	[[ "$key" =~ ^[A-Z][A-Z0-9_]*$ && ! "$value" =~ [[:cntrl:]] ]] || qy_fail "部署环境字段包含不支持的字符。"
	value="${value//\'/\\\'}"
	{
		if [[ -f "$QY_RUNTIME/.env" ]]; then
			while IFS= read -r line || [[ -n "$line" ]]; do
				if [[ "$line" == "$key="* ]]; then printf "%s='%s'\n" "$key" "$value"; found=true; else printf '%s\n' "$line"; fi
			done < "$QY_RUNTIME/.env"
		fi
		[[ "$found" == true ]] || printf "%s='%s'\n" "$key" "$value"
	} > "$QY_RUNTIME/.env.next"
	if [[ -f "$QY_RUNTIME/.env" ]]; then chmod --reference="$QY_RUNTIME/.env" "$QY_RUNTIME/.env.next"; else chmod 600 "$QY_RUNTIME/.env.next"; fi
	mv -- "$QY_RUNTIME/.env.next" "$QY_RUNTIME/.env"
}

qy_read_env() {
	local line value
	[[ -f "$QY_RUNTIME/.env" ]] || return 0
	while IFS= read -r line || [[ -n "$line" ]]; do
		if [[ "$line" == "$1="* ]]; then
			value="${line#*=}"
			if [[ "$value" == \'*\' ]]; then value="${value:1:${#value}-2}"; value="${value//\\\'/\'}"; fi
			if [[ "$value" == \"*\" ]]; then value="${value:1:${#value}-2}"; value="${value//\\\"/\"}"; fi
			printf '%s' "$value"
			return 0
		fi
	done < "$QY_RUNTIME/.env"
}

qy_remove_env() {
	local key="$1" line
	[[ -f "$QY_RUNTIME/.env" ]] || return 0
	while IFS= read -r line || [[ -n "$line" ]]; do
		[[ "$line" == "$key="* ]] || printf '%s\n' "$line"
	done < "$QY_RUNTIME/.env" > "$QY_RUNTIME/.env.next"
	chmod --reference="$QY_RUNTIME/.env" "$QY_RUNTIME/.env.next"
	mv -- "$QY_RUNTIME/.env.next" "$QY_RUNTIME/.env"
}

qy_detect_database() {
	local candidates=""
	candidates="$(docker ps --format '{{.Names}} {{.Image}}' | awk 'tolower($0) ~ /postgres|postgresql/ { print $1 }')"
	if [[ -n "$candidates" ]]; then printf '本机 PostgreSQL 容器：%s\n' "${candidates//$'\n'/、}"; return 0; fi
	if command -v pg_isready >/dev/null && pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then printf '本机 PostgreSQL 服务正在监听 5432。\n'; return 0; fi
	if command -v ss >/dev/null && ss -H -lnt | awk '$4 ~ /:5432$/ { found=1 } END { exit !found }'; then printf '本机 5432 端口已有监听，请确认对应 PostgreSQL 实例。\n'; return 0; fi
	return 1
}

qy_select_database() {
	[[ "$QY_PREPARE" != true ]] || return 0
	[[ ! -s "$QY_RUNTIME/config/qingyan.yml" ]] || return 0
	QY_PHASE="选择数据库连接"
	[[ -n "$QY_DATABASE_URL" ]] || QY_DATABASE_URL="$(qy_read_env QINGYAN_DATABASE_URL)"
	if [[ -z "$QY_DATABASE_URL" && "$QY_CREATE_DATABASE" != true ]]; then
		local detected=false choice=""
		if qy_detect_database; then detected=true; fi
		if [[ "$QY_INTERACTIVE" != true ]]; then
			qy_fail "未提供数据库连接，安装已取消。请设置 QINGYAN_DATABASE_URL，或显式使用 --create-database。"
		fi
		printf '1) 输入已有 PostgreSQL 的连接信息\n'
		[[ "$detected" == true ]] || printf '2) 创建独立 PostgreSQL 18 容器\n'
		printf '其他输入或回车：取消安装\n'
		read -r -p '数据库连接方式：' choice || qy_fail "输入已结束，安装已取消。"
		if [[ "$choice" == 1 ]]; then
			read -r -s -p 'PostgreSQL URL（输入隐藏，密码中的特殊字符须按 URL 编码）：' QY_DATABASE_URL || qy_fail "输入已结束，安装已取消。"
			printf '\n'
			qy_prompt QY_DATABASE_NETWORK '数据库容器所在的 Docker 网络（远程数据库留空）'
		elif [[ "$choice" == 2 && "$detected" != true ]]; then
			QY_CREATE_DATABASE=true
		else qy_fail "未选择数据库连接方式，安装已取消。"; fi
	fi
	if [[ -n "$QY_DATABASE_URL" ]]; then
		[[ "$QY_DATABASE_URL" =~ ^postgres(ql)?:// && ! "$QY_DATABASE_URL" =~ [[:cntrl:]] ]] || qy_fail "PostgreSQL 连接必须是合法的单行 postgresql:// URL。"
	fi
}

qy_create_database() {
	[[ "$QY_CREATE_DATABASE" == true ]] || return 0
	QY_PHASE="创建独立 PostgreSQL"
	local database_root="$QY_PARENT/qingyan-postgresql" admin_password app_password deadline
	[[ ! -e "$database_root" ]] || qy_fail "数据库目录已存在，请提供其连接信息，不覆盖已有数据：$database_root。"
	if docker container inspect qingyan-postgresql >/dev/null 2>&1; then qy_fail "qingyan-postgresql 容器已存在，请提供连接信息。"; fi
	if docker network inspect qingyan-database >/dev/null 2>&1; then qy_fail "qingyan-database 网络已存在，请确认其归属后提供连接信息。"; fi
	umask 077
	mkdir -p -- "$database_root/data"
	# PostgreSQL 18 会切换到 postgres 用户，挂载父目录必须允许遍历。
	chmod 755 "$database_root/data"
	admin_password="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
	app_password="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
	printf '%s' "$admin_password" > "$database_root/postgres-password"
	docker network create --label qingyan.owner=database qingyan-database >/dev/null
	docker run -d --name qingyan-postgresql --restart unless-stopped --label qingyan.owner=database \
		--network qingyan-database \
		-v "$database_root/data:/var/lib/postgresql" \
		-v "$database_root/postgres-password:/run/secrets/postgres-password:ro" \
		-e POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password \
		"$QY_POSTGRES_IMAGE" >/dev/null
	QY_DATABASE_CREATED=true
	deadline=$((SECONDS + 90))
	until docker exec qingyan-postgresql pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do
		(( SECONDS < deadline )) || qy_fail "PostgreSQL 初始化超时；已创建的数据库保留在 $database_root。"
		sleep 2
	done
	docker exec -i qingyan-postgresql psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null <<SQL
CREATE ROLE qingyan LOGIN PASSWORD '$app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE qingyan OWNER qingyan ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C';
ALTER DATABASE qingyan SET timezone TO 'UTC';
SQL
	QY_DATABASE_URL="postgresql://qingyan:$app_password@qingyan-postgresql:5432/qingyan"
	printf "QINGYAN_DATABASE_URL='%s'\nQINGYAN_DATABASE_NETWORK='qingyan-database'\n" "$QY_DATABASE_URL" > "$database_root/qingyan.env"
	chmod 600 "$database_root/qingyan.env"
	QY_DATABASE_NETWORK=qingyan-database
	qy_write_env QINGYAN_DATABASE_NETWORK qingyan-database
	printf '独立 PostgreSQL 已创建；数据与管理员凭据保存在 %s，应用更新不会停止或删除它。\n' "$database_root"
}

qy_gateway_supported() { [[ -f "$QY_SOURCE/services/onepanel-gateway/Dockerfile" && -f "$QY_SOURCE/scripts/deployment-layout.mjs" ]]; }

qy_backup_layout() {
	[[ -z "$QY_LAYOUT_BACKUP" ]] || return 0
	QY_LAYOUT_BACKUP="$QY_RUNTIME/data/deployment-backups/$(date -u +%Y%m%dT%H%M%SZ)-$$"
	umask 077
	mkdir -p -- "$QY_LAYOUT_BACKUP/files"
	local relative
	for relative in .env deployment.conf update.sh gateway.compose.json gateway/allowlist.json gateway/secrets/onepanel-api-key gateway/client/qingyan-gateway-token config/waf-sites.json; do
		if [[ -f "$QY_RUNTIME/$relative" ]]; then
			mkdir -p -- "$QY_LAYOUT_BACKUP/files/$(dirname "$relative")"
			cp -p -- "$QY_RUNTIME/$relative" "$QY_LAYOUT_BACKUP/files/$relative"
			printf 'present %s\n' "$relative" >> "$QY_LAYOUT_BACKUP/manifest"
		else printf 'absent %s\n' "$relative" >> "$QY_LAYOUT_BACKUP/manifest"; fi
	done
	printf '部署配置快照：%s\n' "$QY_LAYOUT_BACKUP"
}

qy_restore_layout() {
	[[ -n "$QY_LAYOUT_BACKUP" && -f "$QY_LAYOUT_BACKUP/manifest" ]] || return 0
	local state relative
	while read -r state relative; do
		if [[ "$state" == present ]]; then
			mkdir -p -- "$QY_RUNTIME/$(dirname "$relative")" || return 1
			cp -p -- "$QY_LAYOUT_BACKUP/files/$relative" "$QY_RUNTIME/$relative" || return 1
		elif [[ -f "$QY_RUNTIME/$relative" ]]; then
			mkdir -p -- "$QY_LAYOUT_BACKUP/unapplied/$(dirname "$relative")" || return 1
			mv -- "$QY_RUNTIME/$relative" "$QY_LAYOUT_BACKUP/unapplied/$relative" || return 1
		fi
	done < "$QY_LAYOUT_BACKUP/manifest"
	QY_GATEWAY_ENABLED=false
	[[ "$(qy_read_env QINGYAN_GATEWAY_ENABLED)" != true && "$(qy_read_env QINGYAN_WAF_ENABLED)" != true ]] || QY_GATEWAY_ENABLED=true
}

qy_prepare_gateway() {
	QY_GATEWAY_ENABLED=false
	[[ "$(qy_read_env QINGYAN_GATEWAY_ENABLED)" != true && "$(qy_read_env QINGYAN_WAF_ENABLED)" != true ]] || QY_GATEWAY_ENABLED=true
	if [[ -n "$QY_GATEWAY_CONFIG" ]]; then
		qy_gateway_supported || qy_fail "目标版本未包含受限网关，不能启用。"
		umask 077
		mkdir -p -- "$QY_RUNTIME/gateway/secrets" "$QY_RUNTIME/gateway/client"
		cp -- "$QY_GATEWAY_CONFIG" "$QY_RUNTIME/gateway/allowlist.json.next"
		cp -- "$QY_PANEL_KEY_FILE" "$QY_RUNTIME/gateway/secrets/onepanel-api-key.next"
		chmod 600 "$QY_RUNTIME/gateway/allowlist.json.next" "$QY_RUNTIME/gateway/secrets/onepanel-api-key.next"
		mv -- "$QY_RUNTIME/gateway/allowlist.json.next" "$QY_RUNTIME/gateway/allowlist.json"
		mv -- "$QY_RUNTIME/gateway/secrets/onepanel-api-key.next" "$QY_RUNTIME/gateway/secrets/onepanel-api-key"
		if [[ ! -s "$QY_RUNTIME/gateway/client/qingyan-gateway-token" ]]; then
			od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > "$QY_RUNTIME/gateway/client/qingyan-gateway-token"
			chmod 600 "$QY_RUNTIME/gateway/client/qingyan-gateway-token"
		fi
		QY_GATEWAY_ENABLED=true
	fi
	[[ "$QY_DISABLE_GATEWAY" != true ]] || QY_GATEWAY_ENABLED=false
	local waf_enabled="$(qy_read_env QINGYAN_WAF_ENABLED)"
	[[ -n "$waf_enabled" ]] || waf_enabled=false
	if [[ -n "$QY_WAF_MAPPING" ]]; then
		[[ "$QY_GATEWAY_ENABLED" == true ]] || qy_fail "启用 WAF 同步前需要先配置并启用受限网关。"
		mkdir -p -- "$QY_RUNTIME/config"
		cp -- "$QY_WAF_MAPPING" "$QY_RUNTIME/config/waf-sites.json.next"
		chmod 600 "$QY_RUNTIME/config/waf-sites.json.next"
		mv -- "$QY_RUNTIME/config/waf-sites.json.next" "$QY_RUNTIME/config/waf-sites.json"
		waf_enabled=true
	fi
	[[ "$QY_GATEWAY_ENABLED" == true ]] || waf_enabled=false
	[[ "$waf_enabled" != true || -s "$QY_RUNTIME/config/waf-sites.json" ]] || qy_fail "WAF 同步已启用但缺少可信站点映射，请提供 --waf-mapping。"
	if [[ "$QY_GATEWAY_ENABLED" == true ]]; then
		qy_gateway_supported || qy_fail "目标版本缺少已启用的网关；请先按回滚方案停用同步。"
		[[ -s "$QY_RUNTIME/gateway/allowlist.json" && -s "$QY_RUNTIME/gateway/secrets/onepanel-api-key" && -s "$QY_RUNTIME/gateway/client/qingyan-gateway-token" ]] || qy_fail "网关已启用但缺少配置或凭据文件。"
	fi
	local profiles="$(qy_read_env COMPOSE_PROFILES)" selected=() profile
	[[ -n "$profiles" ]] || profiles="${COMPOSE_PROFILES:-}"
	IFS=',' read -r -a selected <<< "$profiles"
	profiles=""
	for profile in "${selected[@]}"; do
		[[ -z "$profile" || "$profile" == onepanel ]] || profiles="${profiles:+$profiles,}$profile"
	done
	[[ "$QY_GATEWAY_ENABLED" != true ]] || profiles="${profiles:+$profiles,}onepanel"
	qy_write_env COMPOSE_PROFILES "$profiles"
	qy_write_env QINGYAN_GATEWAY_ENABLED "$QY_GATEWAY_ENABLED"
	qy_write_env QINGYAN_WAF_ENABLED "$waf_enabled"
}

qy_prepare_layout() {
	local network_ids compose_files gateway_supported=false helper_image="qingyan:$QY_TAG" gateway_subnet gateway_host_ip gateway_ip
	[[ -n "$QY_DATABASE_NETWORK" ]] || QY_DATABASE_NETWORK="$(qy_read_env QINGYAN_DATABASE_NETWORK)"
	if [[ -n "$QY_DATABASE_NETWORK" ]]; then
		docker network inspect "$QY_DATABASE_NETWORK" >/dev/null || qy_fail "数据库 Docker 网络不存在，请核对连接配置。"
		qy_write_env QINGYAN_DATABASE_NETWORK "$QY_DATABASE_NETWORK"
	fi
	if qy_gateway_supported; then
		gateway_supported=true
		helper_image="qingyan-onepanel-gateway:$QY_TAG"
		qy_write_env QINGYAN_GATEWAY_IMAGE "$helper_image"
		gateway_subnet="${QINGYAN_GATEWAY_SUBNET:-$(qy_read_env QINGYAN_GATEWAY_SUBNET)}"
		gateway_host_ip="${QINGYAN_GATEWAY_HOST_IP:-$(qy_read_env QINGYAN_GATEWAY_HOST_IP)}"
		gateway_ip="${QINGYAN_GATEWAY_IP:-$(qy_read_env QINGYAN_GATEWAY_IP)}"
		gateway_subnet="${gateway_subnet:-172.30.251.0/28}"
		gateway_host_ip="${gateway_host_ip:-172.30.251.1}"
		gateway_ip="${gateway_ip:-172.30.251.3}"
		qy_write_env QINGYAN_GATEWAY_SUBNET "$gateway_subnet"
		qy_write_env QINGYAN_GATEWAY_HOST_IP "$gateway_host_ip"
		qy_write_env QINGYAN_GATEWAY_IP "$gateway_ip"
	fi
	if [[ "$gateway_supported" != true && -z "$QY_DATABASE_NETWORK" ]]; then return 0; fi
	[[ -f "$QY_SOURCE/scripts/deployment-layout.mjs" ]] || qy_fail "目标版本不支持独立数据库网络部署，请使用当前安装器对应版本。"
	qy_backup_layout
	qy_compose config --format json > "$QY_LAYOUT_BACKUP/compose-effective.json"
	network_ids="$(docker network ls -q)"
	if [[ -n "$network_ids" ]]; then docker network inspect $network_ids > "$QY_LAYOUT_BACKUP/docker-networks.json"; else printf '[]\n' > "$QY_LAYOUT_BACKUP/docker-networks.json"; fi
	docker run --rm --entrypoint node \
		-v "$QY_SOURCE/scripts/deployment-layout.mjs:/deployment-layout.mjs:ro" -v "$QY_RUNTIME:/deployment" \
		-e "QINGYAN_LAYOUT_EFFECTIVE_PATH=/deployment/${QY_LAYOUT_BACKUP#"$QY_RUNTIME/"}/compose-effective.json" \
		-e "QINGYAN_LAYOUT_NETWORKS_PATH=/deployment/${QY_LAYOUT_BACKUP#"$QY_RUNTIME/"}/docker-networks.json" \
		-e "QINGYAN_LAYOUT_GATEWAY_SUPPORTED=$gateway_supported" -e "QINGYAN_LAYOUT_GATEWAY_ENABLED=$QY_GATEWAY_ENABLED" \
		-e "QINGYAN_LAYOUT_HOST_DIRECTORY=$QY_RUNTIME" \
		-e "QINGYAN_DATABASE_NETWORK=$QY_DATABASE_NETWORK" \
		-e "QINGYAN_GATEWAY_SUBNET=${gateway_subnet:-172.30.251.0/28}" \
		-e "QINGYAN_GATEWAY_HOST_IP=${gateway_host_ip:-172.30.251.1}" \
		-e "QINGYAN_GATEWAY_IP=${gateway_ip:-172.30.251.3}" \
		"$helper_image" /deployment-layout.mjs
	compose_files="${COMPOSE_FILE:-$(qy_read_env COMPOSE_FILE)}"
	[[ -n "$compose_files" ]] || compose_files=compose.yml
	case ":$compose_files:" in *:gateway.compose.json:*) ;; *) compose_files="$compose_files:gateway.compose.json" ;; esac
	qy_write_env COMPOSE_FILE "$compose_files"
	qy_compose config --quiet
}

qy_check_database() {
	[[ -n "$QY_DATABASE_URL" ]] || return 0
	local network_args=()
	[[ -z "$QY_DATABASE_NETWORK" ]] || network_args=(--network "$QY_DATABASE_NETWORK")
	if ! QINGYAN_DATABASE_URL="$QY_DATABASE_URL" docker run --rm "${network_args[@]}" --env QINGYAN_DATABASE_URL --entrypoint node "qingyan:$QY_TAG" -e '
const {Client}=require("pg");
(async()=>{const client=new Client({connectionString:process.env.QINGYAN_DATABASE_URL,connectionTimeoutMillis:5000});try{await client.connect();const result=await client.query("SHOW server_version_num");const version=Number(result.rows[0].server_version_num);if(version<180000||version>=190000)throw Error("version");}finally{await client.end();}})().catch(()=>{console.error("PostgreSQL 18 连接检查失败，请核对账号、容器服务名及网络；连接信息未输出。");process.exitCode=1;});
' </dev/null; then qy_fail "数据库不可达或版本不匹配，安装尚未继续。"; fi
}

qy_start_services() {
	if [[ "$QY_GATEWAY_ENABLED" == true ]]; then qy_compose up -d qingyan onepanel-gateway; else qy_compose up -d qingyan; fi
}

qy_wait_gateway() {
	[[ "$QY_GATEWAY_ENABLED" == true ]] || return 0
	local deadline=$((SECONDS + ${QINGYAN_UPDATE_HEALTH_TIMEOUT:-180})) container state
	while (( SECONDS < deadline )); do
		container="$(qy_compose ps -q onepanel-gateway)"
		if [[ -n "$container" ]]; then
			state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")"
			[[ "$state" != healthy ]] || return 0
			case "$state" in unhealthy|exited|dead) qy_fail "网关容器状态异常；请核对白名单与凭据。" ;; esac
		fi
		sleep 2
	done
	qy_fail "等待网关健康状态超时。"
}

qy_pause_gateway_sync() {
	QY_PREVIOUS_SYNC_PAUSED="$(qy_read_env QINGYAN_WAF_SYNC_PAUSED)"
	[[ "$QY_GATEWAY_ENABLED" == true || -n "$QY_GATEWAY_CONFIG" ]] || return 0
	qy_write_env QINGYAN_WAF_SYNC_PAUSED true
}

qy_resume_gateway_sync() {
	if [[ -n "$QY_PREVIOUS_SYNC_PAUSED" ]]; then qy_write_env QINGYAN_WAF_SYNC_PAUSED "$QY_PREVIOUS_SYNC_PAUSED"
	else qy_remove_env QINGYAN_WAF_SYNC_PAUSED; fi
	[[ "$QY_GATEWAY_ENABLED" == true ]] || return 0
	qy_compose up -d --force-recreate qingyan
	qy_wait healthy
	qy_wait_gateway
}

qy_absolute_path() {
	# realpath -m 无需创建目录，便于在写入前检查两个位置是否重叠。
	realpath -m -- "$1"
}

qy_paths() {
	QY_PARENT="$(qy_absolute_path "$QY_PARENT")"
	QY_RUNTIME="$QY_PARENT/qingyan"
	QY_SOURCE="$(qy_absolute_path "${QY_SOURCE:-$QY_PARENT/.qingyan-source}")"
	case "$QY_SOURCE/" in "$QY_RUNTIME/"*) qy_fail "源码目录不能位于运行目录内。" ;; esac
	case "$QY_RUNTIME/" in "$QY_SOURCE/"*) qy_fail "运行目录不能位于源码目录内。" ;; esac
	printf '部署父目录：%s\n运行目录：%s\n源码缓存：%s\n数据库：%s\n' "$QY_PARENT" "$QY_RUNTIME" "$QY_SOURCE" "$QY_DATABASE"
}

qy_empty_directory() {
	[[ ! -e "$1" ]] && return 0
	[[ -d "$1" ]] || return 1
	local entries
	entries="$(find "$1" -mindepth 1 -maxdepth 1 -print -quit)"
	[[ -z "$entries" ]]
}

qy_check_docker() {
	command -v docker >/dev/null || qy_fail "缺少 Docker，请先安装 Docker 和 Compose。"
	docker compose version >/dev/null
	docker info >/dev/null
}

qy_probe_git() {
	timeout "${QINGYAN_GITHUB_PROBE_TIMEOUT:-5}" git \
		-c http.lowSpeedLimit=1024 -c http.lowSpeedTime=3 \
		ls-remote --tags --refs --sort=-v:refname "$1" 'v[0-9]*'
}

qy_select_github() {
	QY_PHASE="选择 GitHub 来源"
	command -v timeout >/dev/null || qy_fail "缺少 timeout（GNU coreutils）。"
	local started=$SECONDS
	if [[ "$QY_GITHUB_SOURCE" == auto ]]; then
		if QY_REMOTE_TAGS="$(qy_probe_git "$QY_REPOSITORY" 2>/dev/null)"; then
			QY_URL="$QY_REPOSITORY"
			printf 'GitHub 来源：直连（Git refs 探测耗时 %ss）\n' "$((SECONDS - started))"
		else
			printf 'GitHub 直连失败或超时，改用代理探测。\n'
			[[ "$QY_INTERACTIVE" != true ]] || qy_prompt QY_GITHUB_PROXY 'GitHub 代理前缀'
			QY_URL="${QY_GITHUB_PROXY%/}/$QY_REPOSITORY"
			QY_REMOTE_TAGS="$(qy_probe_git "$QY_URL")"
			printf 'GitHub 来源：代理 %s\n' "$QY_GITHUB_PROXY"
		fi
	else
		QY_URL="$QY_REPOSITORY"
		[[ "$QY_GITHUB_SOURCE" != proxy ]] || QY_URL="${QY_GITHUB_PROXY%/}/$QY_REPOSITORY"
		QY_REMOTE_TAGS="$(qy_probe_git "$QY_URL")"
		printf 'GitHub 来源：%s\n' "$QY_GITHUB_SOURCE"
	fi
	if [[ -z "$QY_TAG" ]]; then
		local object ref
		while read -r object ref; do
			if [[ "$ref" =~ ^refs/tags/(v[0-9]+\.[0-9]+\.[0-9]+)$ ]]; then QY_TAG="${BASH_REMATCH[1]}"; break; fi
		done <<< "$QY_REMOTE_TAGS"
	fi
	[[ -n "$QY_TAG" ]] || qy_fail "没有找到稳定的 vX.Y.Z tag。"
	printf '目标版本：%s\n' "$QY_TAG"
}

qy_source_checkout() {
	QY_PHASE="准备源码"
	if qy_empty_directory "$QY_SOURCE"; then
		mkdir -p -- "$(dirname "$QY_SOURCE")"
		git -c advice.detachedHead=false clone --depth 1 --branch "$QY_TAG" -- "$QY_URL" "$QY_SOURCE"
		git -C "$QY_SOURCE" remote set-url origin "$QY_REPOSITORY"
	else
		[[ -d "$QY_SOURCE/.git" && -f "$QY_SOURCE/Dockerfile" ]] || qy_fail "源码目录已有无关文件：$QY_SOURCE。"
		[[ "$(git -C "$QY_SOURCE" remote get-url origin)" == "$QY_REPOSITORY" ]] || qy_fail "源码缓存的 origin 与本次仓库来源不同。"
		[[ -z "$(git -C "$QY_SOURCE" status --porcelain=v1 --untracked-files=normal)" ]] || qy_fail "源码缓存存在本地改动，请先保留并处理：$QY_SOURCE。"
		QY_PREVIOUS_COMMIT="$(git -C "$QY_SOURCE" rev-parse HEAD)"
		QY_PREVIOUS_REF="$(git -C "$QY_SOURCE" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
		git -C "$QY_SOURCE" fetch --depth 1 "$QY_URL" "refs/tags/$QY_TAG:refs/tags/$QY_TAG"
	fi
	[[ -f "$QY_SOURCE/Dockerfile" ]] || qy_fail "所选版本缺少 Dockerfile。"
}

qy_probe_dependencies() {
	local total=0 duration url
	for url in "$@"; do
		duration="$(curl -fsSL -o /dev/null --connect-timeout 2 --max-time 4 -w '%{time_total}' "$url" 2>/dev/null)" || return 1
		[[ "$duration" =~ ^[0-9]+([.][0-9]+)?$ ]] || return 1
		total="$(awk -v total="$total" -v duration="$duration" 'BEGIN { printf "%.6f", total + duration }')"
	done
	printf '%s' "$total"
}

qy_select_network() {
	QY_PHASE="选择构建依赖源"
	local profile="$QY_NETWORK" official cn
	if [[ "$profile" == auto ]]; then
		command -v curl >/dev/null || qy_fail "auto 构建依赖源需要 curl。"
		official="$(qy_probe_dependencies http://deb.debian.org/debian/dists/trixie/InRelease https://registry.npmjs.org/-/ping || true)"
		cn="$(qy_probe_dependencies http://mirrors.tuna.tsinghua.edu.cn/debian/dists/trixie/InRelease https://registry.npmmirror.com/-/ping || true)"
		[[ -n "$official$cn" ]] || qy_fail "官方和国内构建依赖源均不可用，请检查网络。"
		profile=official
		if [[ -z "$official" ]] || { [[ -n "$cn" ]] && awk -v cn="$cn" -v official="$official" 'BEGIN { exit !(cn < official) }'; }; then profile=cn; fi
	fi
	local apt registry
	if [[ "$profile" == cn ]]; then
		apt=http://mirrors.tuna.tsinghua.edu.cn/debian
		registry=https://registry.npmmirror.com
	else
		apt=http://deb.debian.org/debian
		registry=https://registry.npmjs.org
	fi
	QY_BUILD_ARGS=(--build-arg "QINGYAN_APT_MAIN_MIRROR=$apt" --build-arg "QINGYAN_COREPACK_NPM_REGISTRY=$registry" --build-arg "QINGYAN_PNPM_REGISTRY=$registry")
	printf '构建依赖源：%s -> %s\nAPT：%s\nnpm：%s\n' "$QY_NETWORK" "$profile" "$apt" "$registry"
}

qy_build() {
	qy_select_network
	QY_PHASE="构建镜像"
	git -C "$QY_SOURCE" switch --detach "$QY_TAG"
	docker build --pull --progress plain "${QY_BUILD_ARGS[@]}" --tag "qingyan:$QY_TAG" "$QY_SOURCE"
	if [[ -f "$QY_SOURCE/services/onepanel-gateway/Dockerfile" ]]; then
		docker build --pull --progress plain --tag "qingyan-onepanel-gateway:$QY_TAG" \
			-f "$QY_SOURCE/services/onepanel-gateway/Dockerfile" "$QY_SOURCE/services/onepanel-gateway"
	fi
}

qy_render_compose() {
	# 运行布局的服务模板只在此维护；源码仓库的 compose.yml 保留旧布局部署用途。
	cat <<'COMPOSE'
name: qingyan
services:
  qingyan:
    image: ${QINGYAN_IMAGE:?请先设置本地构建镜像}
    pull_policy: never
    container_name: qingyan
    ports:
      - "4401:4401"
    environment:
      NODE_ENV: production
      TZ: Asia/Shanghai
      QINGYAN_CONFIG_PATH: /app/config/qingyan.yml
      QINGYAN_SERVER_HOST: 0.0.0.0
      QINGYAN_INSTALL_TOKEN: ${QINGYAN_INSTALL_TOKEN:?请先设置安装令牌}
      QINGYAN_INSTALL_TRANSITION_MODE: exit_for_supervisor
      QINGYAN_DATABASE_URL:
    volumes:
      - ./config:/app/config
      - ./data:/app/data
      - ./logs:/app/logs
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:4401/qingyan/healthz').then((res)=>{if(!res.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s
    restart: unless-stopped
COMPOSE
}

qy_write_image() {
	local image="$1" line found=false
	{
		if [[ -f "$QY_RUNTIME/.env" ]]; then
			while IFS= read -r line || [[ -n "$line" ]]; do
				if [[ "$line" == QINGYAN_IMAGE=* ]]; then printf 'QINGYAN_IMAGE=%s\n' "$image"; found=true; else printf '%s\n' "$line"; fi
			done < "$QY_RUNTIME/.env"
		fi
		[[ "$found" == true ]] || printf 'QINGYAN_IMAGE=%s\n' "$image"
	} > "$QY_RUNTIME/.env.next"
	if [[ -f "$QY_RUNTIME/.env" ]]; then chmod --reference="$QY_RUNTIME/.env" "$QY_RUNTIME/.env.next"; fi
	mv -- "$QY_RUNTIME/.env.next" "$QY_RUNTIME/.env"
}

qy_create_install_token() {
	local token
	token="qy_install_$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
	printf 'QINGYAN_INSTALL_TOKEN=%s\n' "$token" >> "$QY_RUNTIME/.env"
	chmod 600 "$QY_RUNTIME/.env"
}

qy_save_metadata() {
	# 元信息是按键读取的数据文件，不作为 shell source 执行，也不存应用密钥。
	local source_override=""
	[[ "$QY_SOURCE" == "$QY_PARENT/.qingyan-source" ]] || source_override="$QY_SOURCE"
	printf 'FORMAT=1\nREPOSITORY=%s\nSOURCE_DIR=%s\nGITHUB_SOURCE=%s\nGITHUB_PROXY=%s\nNETWORK=%s\nDATABASE=%s\nVERSION=%s\n' \
		"$QY_REPOSITORY" "$source_override" "$QY_GITHUB_SOURCE" "$QY_GITHUB_PROXY" "$QY_NETWORK" "$QY_DATABASE" "$QY_TAG" > "$QY_RUNTIME/deployment.conf.next"
	mv -- "$QY_RUNTIME/deployment.conf.next" "$QY_RUNTIME/deployment.conf"
}

qy_load_metadata() {
	local key value format=""
	while IFS='=' read -r key value; do
		case "$key" in
			FORMAT) format="$value" ;;
			REPOSITORY) QY_REPOSITORY="$value" ;;
			SOURCE_DIR) QY_SOURCE="$value" ;;
			GITHUB_SOURCE) QY_GITHUB_SOURCE="$value" ;;
			GITHUB_PROXY) QY_GITHUB_PROXY="$value" ;;
			NETWORK) QY_NETWORK="$value" ;;
			DATABASE) QY_DATABASE="$value" ;;
			VERSION) QY_INSTALLED_TAG="$value" ;;
		esac
	done < "$QY_RUNTIME/deployment.conf"
	[[ "$format" == 1 ]] || qy_fail "不支持的部署元信息格式。"
}

qy_render_updater() {
	# 序列化本入口的函数，生成可脱离源码缓存运行的单文件更新器；远程入口无需复制 /dev/fd。
	printf '#!/usr/bin/env bash\nset -Eeuo pipefail\n'
	local functions
	mapfile -t functions < <(compgen -A function qy_)
	declare -f "${functions[@]}"
	printf '\nqy_init\nqy_update_main "$@"\n'
}

qy_compose() {
	(trap - ERR
		cd "$QY_RUNTIME"
		[[ -z "$QY_DATABASE_URL" ]] || export QINGYAN_DATABASE_URL="$QY_DATABASE_URL"
		local compose_env=() key
		for key in COMPOSE_FILE COMPOSE_PROFILES; do
			if [[ -f .env ]] && grep -q "^$key=" .env; then compose_env+=("$key=$(qy_read_env "$key")"); fi
		done
		env "${compose_env[@]}" docker compose "$@"
	)
}

qy_wait() {
	local expected="$1" deadline=$((SECONDS + ${QINGYAN_UPDATE_HEALTH_TIMEOUT:-180})) container state
	while (( SECONDS < deadline )); do
		container="$(qy_compose ps -q qingyan)"
		if [[ -n "$container" ]]; then
			if [[ "$expected" == running ]]; then
				state="$(docker inspect --format '{{.State.Running}}' "$container")"
				[[ "$state" != true ]] || return 0
			else
				state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")"
				if [[ "$state" == healthy || "$state" == running ]]; then
                    qy_compose exec -T qingyan node -e 'fetch("http://127.0.0.1:4401/qingyan/healthz").then(async r=>{const b=await r.json();if(!r.ok||b.mode!=="normal")process.exit(1)}).catch(()=>process.exit(1))' </dev/null && return 0
                fi
			fi
			case "$state" in unhealthy|exited|dead) qy_fail "容器状态为 $state。" ;; esac
		fi
		sleep 2
	done
	qy_fail "等待容器 $expected 状态超时。"
}

qy_error() {
	local status="$1" layout_restored=true
	trap - ERR
	set +e
	printf '\n%s失败：阶段=%s，退出码=%s\n运行目录：%s\n源码缓存：%s\n' "$QY_MODE" "$QY_PHASE" "$status" "$QY_RUNTIME" "$QY_SOURCE" >&2
	if [[ "$QY_SCHEMA_WRITES_STARTED" == false ]]; then
		if [[ "$QY_ACTIVATED" == true && "$QY_GATEWAY_ENABLED" == true ]]; then qy_compose stop onepanel-gateway >/dev/null 2>&1; fi
		if [[ -n "$QY_PREVIOUS_COMMIT" ]]; then
			if [[ -n "$QY_PREVIOUS_REF" ]]; then git -C "$QY_SOURCE" switch "$QY_PREVIOUS_REF" >/dev/null 2>&1
			else git -C "$QY_SOURCE" switch --detach "$QY_PREVIOUS_COMMIT" >/dev/null 2>&1; fi
		fi
		if [[ -n "$QY_LAYOUT_BACKUP" ]]; then
			if ! qy_restore_layout; then layout_restored=false; printf '部署快照恢复失败，已保留现场，不重新启动服务。\n' >&2; fi
		else [[ "$QY_IMAGE_CHANGED" == false ]] || qy_write_image "$QY_PREVIOUS_IMAGE"; fi
		if [[ "$QY_MODE" == update && "$QY_STOPPED" == true && "$layout_restored" == true ]]; then
			if [[ "$QY_ACTIVATED" == true ]]; then qy_start_services; qy_wait running; qy_wait_gateway
			elif [[ "$QY_GATEWAY_ENABLED" == true ]]; then qy_compose start qingyan onepanel-gateway
			else qy_compose start qingyan; fi
		fi
	else
		printf '已开始激活新容器，请保留现场。\n' >&2
		qy_compose logs --tail=200 qingyan >&2
	fi
	[[ -z "$QY_BACKUP" ]] || printf '升级前整站备份：%s\n' "$QY_BACKUP" >&2
	[[ -z "$QY_LAYOUT_BACKUP" ]] || printf '部署配置和双镜像引用快照：%s\n' "$QY_LAYOUT_BACKUP" >&2
	[[ "$QY_DATABASE_CREATED" == false ]] || printf '本轮新建的独立数据库已保留：%s/qingyan-postgresql；不会自动删除。\n' "$QY_PARENT" >&2
	exit "$status"
}

qy_install_main() {
	trap 'qy_error "$?"' ERR
	qy_parse "$@"
	if [[ "$QY_INTERACTIVE" == true ]]; then
		qy_prompt QY_PARENT '部署父目录'
		printf '请选择数据库：\n'
		local index=1 database choice
		for database in "${QY_DATABASES[@]}"; do printf '%s) %s\n' "$index" "$database"; index=$((index + 1)); done
		choice="$QY_DATABASE"
		qy_prompt choice '数据库（回车使用默认值）'
		if [[ "$choice" =~ ^[1-9][0-9]*$ && "$choice" -le "${#QY_DATABASES[@]}" ]]; then QY_DATABASE="${QY_DATABASES[choice-1]}"; else QY_DATABASE="$choice"; fi
		qy_prompt QY_GITHUB_SOURCE 'GitHub 来源 auto/direct/proxy'
		if [[ "$QY_GITHUB_SOURCE" == proxy ]]; then qy_prompt QY_GITHUB_PROXY 'GitHub 代理前缀'; fi
		qy_prompt QY_NETWORK '构建依赖源 auto/official/cn'
	fi
	qy_validate
	command -v git >/dev/null || qy_fail "缺少 Git。"
	qy_paths
	qy_empty_directory "$QY_RUNTIME" || qy_fail "运行目录已有文件，请使用现有实例的更新入口：$QY_RUNTIME。"
	[[ "$QY_PREPARE" == true ]] || qy_check_docker
	qy_select_database
	qy_select_github
	qy_source_checkout
	QY_PHASE="生成部署文件"
	mkdir -p -- "$QY_RUNTIME/config" "$QY_RUNTIME/data" "$QY_RUNTIME/logs"
	qy_render_compose > "$QY_RUNTIME/compose.yml"
	qy_write_image "qingyan:$QY_TAG"
	qy_create_install_token
	qy_save_metadata
	qy_render_updater > "$QY_RUNTIME/update.sh"
	chmod +x "$QY_RUNTIME/update.sh"
	if [[ "$QY_PREPARE" == true ]]; then
		printf '\n文件已准备，服务尚未启动。搬入已有实例文件后，执行：\n'
		printf 'bash %q --start\n' "$QY_RUNTIME/update.sh"
		return 0
	fi
	qy_build
	qy_backup_layout
	qy_create_database
	[[ -z "$QY_DATABASE_URL" ]] || qy_write_env QINGYAN_DATABASE_URL "$QY_DATABASE_URL"
	qy_prepare_gateway
	qy_prepare_layout
	qy_check_database
	QY_PHASE="启动安装服务"
	qy_compose config --quiet
	QY_ACTIVATED=true
	qy_start_services
	qy_wait running
	qy_wait_gateway
	qy_compose ps
	printf '\n容器已启动，请通过服务器的 4401 端口或反向代理访问 /qingyan/admin/install 完成应用安装。\n'
	printf '安装令牌位于 %s/.env 的 QINGYAN_INSTALL_TOKEN 字段。\n' "$QY_RUNTIME"
}

qy_confirm() {
	[[ "$QY_YES" != true ]] || return 0
	local answer
	[[ -t 0 ]] || qy_fail "更新需要交互确认；接受备份与升级计划时使用 --yes。"
	read -r -p "$1 [y/N] " answer
	[[ "$answer" == y || "$answer" == Y ]] || qy_fail "用户取消更新。"
}

qy_update_main() {
	QY_MODE=update
	trap 'qy_error "$?"' ERR
	QY_PARENT="$(cd "$(dirname "$0")/.." && pwd)"
	local arguments=("$@") index=0
	while (( index < ${#arguments[@]} )); do
		if [[ "${arguments[index]}" == --dir ]]; then
			(( index + 1 < ${#arguments[@]} )) || qy_fail "--dir 缺少参数。"
			QY_PARENT="${arguments[index+1]}"
		fi
		index=$((index + 1))
	done
	QY_PARENT="$(qy_absolute_path "$QY_PARENT")"
	QY_RUNTIME="$QY_PARENT/qingyan"
	[[ -f "$QY_RUNTIME/deployment.conf" ]] || qy_fail "未找到运行目录的 deployment.conf：$QY_RUNTIME。"
	qy_load_metadata
    [[ "$QY_DATABASE" != sqlite ]] || qy_fail "SQLite 实例需要离线转换：先停写，运行独立 SQLite 到 PostgreSQL 转换并核对，切换新配置后再继续更新。"
	qy_parse "$@"
	qy_validate
	qy_paths
	qy_check_docker
	QY_GATEWAY_ENABLED=false
	[[ "$(qy_read_env QINGYAN_GATEWAY_ENABLED)" != true && "$(qy_read_env QINGYAN_WAF_ENABLED)" != true ]] || QY_GATEWAY_ENABLED=true
	if [[ "$QY_START" == true ]]; then
		# 准备模式后的启动沿用原版本，不走更新、备份或数据恢复。
		[[ -z "$QY_TAG" || "$QY_TAG" == "$QY_INSTALLED_TAG" ]] || qy_fail "--start 使用准备时的版本；切换版本请使用正常更新流程。"
		QY_TAG="$QY_INSTALLED_TAG"
		qy_select_database
		qy_select_github
		qy_source_checkout
		qy_build
		qy_backup_layout
		qy_create_database
		[[ -z "$QY_DATABASE_URL" ]] || qy_write_env QINGYAN_DATABASE_URL "$QY_DATABASE_URL"
		qy_prepare_gateway
		qy_prepare_layout
		qy_check_database
		QY_PHASE="启动已有文件"
		QY_ACTIVATED=true
		qy_start_services
		qy_wait running
		qy_wait_gateway
		qy_compose ps
		return 0
	fi
	[[ -n "$(qy_compose ps -q qingyan)" ]] || qy_fail "未找到运行中的实例；仅准备文件后请先使用 --start。"
	qy_select_github
	qy_source_checkout
	qy_compose exec -T qingyan qyctl --version </dev/null
	if ! qy_compose exec -T qingyan qyctl update check </dev/null; then
		printf '警告：当前实例的 Release 检测失败，目标 tag 已通过 Git 验证。\n' >&2
	fi
	qy_confirm "将备份实例并更新到 $QY_TAG，是否继续？"
	QY_PHASE="整站备份"
	QY_BACKUP="/app/data/backups/pre-update-$(date -u +%Y%m%dT%H%M%SZ)"
	qy_backup_layout
	QY_STOPPED=true
	if [[ "$QY_GATEWAY_ENABLED" == true ]]; then qy_compose stop qingyan onepanel-gateway; else qy_compose stop qingyan; fi
	qy_pause_gateway_sync
	qy_compose run --rm --no-deps qingyan qyctl backup "$QY_BACKUP" --yes --service-stopped </dev/null
	qy_build
	QY_PHASE="切换镜像"
	local line
	while IFS= read -r line; do [[ "$line" != QINGYAN_IMAGE=* ]] || QY_PREVIOUS_IMAGE="${line#*=}"; done < "$QY_RUNTIME/.env"
	QY_IMAGE_CHANGED=true
	qy_write_image "qingyan:$QY_TAG"
	qy_prepare_gateway
	qy_prepare_layout
	qy_compose config --quiet
	QY_PHASE="启动新容器"
	QY_ACTIVATED=true
	qy_start_services
	qy_wait running
	qy_wait_gateway
	QY_PHASE="检查升级计划"
	qy_compose exec -T qingyan qyctl upgrade --dry-run </dev/null
	qy_confirm '确认上述 UpgradePlan 和备份后，应用数据升级？'
	QY_PHASE="应用数据升级"
	qy_compose stop qingyan
	QY_SCHEMA_WRITES_STARTED=true
	qy_compose run --rm --no-deps qingyan qyctl upgrade --yes --service-stopped </dev/null
	qy_compose restart qingyan
	qy_wait healthy
	qy_wait_gateway
	local installed
	installed="$(qy_compose exec -T qingyan qyctl --version </dev/null)"
	[[ "$installed" == "QingYan ${QY_TAG#v}" ]] || qy_fail "容器版本与目标 tag 不一致：$installed。"
	qy_resume_gateway_sync
	if ! qy_compose exec -T qingyan qyctl update check </dev/null; then
		printf '警告：最终 Release 检测失败；容器版本与健康状态已验证。\n' >&2
	fi
	qy_save_metadata
	if [[ -f "$QY_SOURCE/scripts/install.sh" ]]; then
		bash "$QY_SOURCE/scripts/install.sh" --emit-updater > "$QY_RUNTIME/update.sh.next"
		chmod +x "$QY_RUNTIME/update.sh.next"
		mv -- "$QY_RUNTIME/update.sh.next" "$QY_RUNTIME/update.sh"
	fi
	qy_compose ps
	printf '\n更新完成：%s\n整站备份：%s\n' "$QY_TAG" "$QY_BACKUP"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
	if [[ "${1:-}" == --emit-updater ]]; then qy_render_updater; exit 0; fi
	qy_init
	qy_install_main "$@"
fi
