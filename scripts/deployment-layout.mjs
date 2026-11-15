import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function fail(message) {
	throw new Error(message);
}

function ipv4(value) {
	const parts = value.split(".").map(Number);
	if (
		parts.length !== 4 ||
		parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
	)
		fail("网关静态网络必须使用有效 IPv4 地址。");
	return parts.reduce((total, part) => total * 256 + part, 0);
}

function subnet(value) {
	const [address, prefix, ...extra] = value.split("/");
	const bits = Number(prefix);
	if (extra.length || !/^\d+$/.test(prefix ?? "") || bits < 1 || bits > 30)
		fail("网关子网必须是有效 IPv4 CIDR。");
	const size = 2 ** (32 - bits);
	const start = ipv4(address);
	if (start % size !== 0) fail("网关子网必须使用规范网络地址。");
	return { start, end: start + size - 1 };
}

function networkList(value) {
	if (!value) return {};
	if (Array.isArray(value))
		return Object.fromEntries(value.map((name) => [name, null]));
	return value;
}

export function buildDeploymentOverlay(effective, options) {
	const application = effective.services?.qingyan;
	if (!application || (!application.image && !application.build))
		fail("现有 Compose 缺少 QingYan 服务，未修改部署文件。");
	const clientTarget = "/run/qingyan-gateway";
	const gateway = effective.services?.["onepanel-gateway"];
	if (gateway?.ports?.length || gateway?.network_mode === "host")
		fail("已有网关对外发布了端口，请先人工核对部署。 ");
	for (const volume of application.volumes ?? []) {
		if (
			typeof volume === "object" &&
			volume.target === clientTarget &&
			(volume.type !== "bind" ||
				path.resolve(volume.source) !==
					path.join(
						options.hostDirectory ?? options.directory,
						"gateway",
						"client",
					) ||
				!volume.read_only)
		)
			fail("已有网关凭据挂载与受限目录不一致，未修改部署文件。");
	}
	const services = {};
	const networks = {};
	const applicationNetworks = networkList(application.networks);
	const connectedNetworks = {};
	if (options.databaseNetwork) {
		const existingKey = Object.entries(effective.networks ?? {}).find(
			([, network]) => network.name === options.databaseNetwork,
		)?.[0];
		const databaseKey = existingKey ?? "qingyan-database";
		networks[databaseKey] = effective.networks?.[databaseKey] ?? {
			name: options.databaseNetwork,
			external: true,
		};
		connectedNetworks[databaseKey] = applicationNetworks[databaseKey] ?? {};
	}
	if (options.gatewaySupported) {
		const range = subnet(options.gatewaySubnet);
		const ownedNetworkName =
			effective.networks?.["panel-gateway"]?.name ??
			`${effective.name ?? "qingyan"}_panel-gateway`;
		const host = ipv4(options.gatewayHostIp);
		const source = ipv4(options.gatewayIp);
		if (
			host <= range.start ||
			host >= range.end ||
			source <= range.start ||
			source >= range.end ||
			host === source
		)
			fail("网关容器地址和宿主 bridge 地址必须在子网内且不能相同。");
		if (options.gatewayEnabled) {
			for (const network of options.existingNetworks ?? []) {
				if (network.Name === ownedNetworkName) {
					const current = network.IPAM?.Config?.[0];
					if (
						current?.Subnet !== options.gatewaySubnet ||
						(current?.Gateway && current.Gateway !== options.gatewayHostIp)
					)
						fail(
							"已有网关网络与静态地址配置不同，请先核对现有网络，未替换它。 ",
						);
					continue;
				}
				for (const config of network.IPAM?.Config ?? []) {
					if (!config.Subnet || config.Subnet.includes(":")) continue;
					const other = subnet(config.Subnet);
					if (range.start <= other.end && other.start <= range.end)
						fail("网关子网与已有 Docker 网络冲突，请设置独立子网后重试。");
				}
			}
			connectedNetworks["panel-gateway"] = {};
		}
		networks["panel-gateway"] = {
			name: ownedNetworkName,
			driver: "bridge",
			ipam: {
				config: [
					{ subnet: options.gatewaySubnet, gateway: options.gatewayHostIp },
				],
			},
		};
		services["onepanel-gateway"] = {
			// biome-ignore lint/suspicious/noTemplateCurlyInString: 此占位符由部署目录的 Compose 解析。
			image: "${QINGYAN_GATEWAY_IMAGE:?请先构建网关镜像}",
			pull_policy: "never",
			profiles: ["onepanel"],
			environment: { QINGYAN_GATEWAY_CONFIG_PATH: "/app/config/gateway.json" },
			volumes: [
				"./gateway/allowlist.json:/app/config/gateway.json:ro",
				"./gateway/secrets/onepanel-api-key:/run/secrets/onepanel-api-key:ro",
				"./gateway/client:/run/qingyan-gateway:ro",
			],
			networks: { "panel-gateway": { ipv4_address: options.gatewayIp } },
			healthcheck: {
				test: [
					"CMD",
					"node",
					"--input-type=module",
					"-e",
					"fetch('http://127.0.0.1:4402/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))",
				],
				interval: "15s",
				timeout: "5s",
				retries: 3,
				start_period: "10s",
			},
			read_only: true,
			...(gateway?.cap_drop?.includes("ALL") ? {} : { cap_drop: ["ALL"] }),
			...(gateway?.security_opt?.includes("no-new-privileges:true")
				? {}
				: { security_opt: ["no-new-privileges:true"] }),
			restart: "unless-stopped",
		};
	}
	if (Object.keys(connectedNetworks).length) {
		for (const key of Object.keys(applicationNetworks).length
			? Object.keys(applicationNetworks)
			: ["default"])
			connectedNetworks[key] ??= applicationNetworks[key] ?? {};
		services.qingyan = { networks: connectedNetworks };
	}
	if (options.gatewayEnabled) {
		services.qingyan ??= {};
		services.qingyan.environment = {
			// biome-ignore lint/suspicious/noTemplateCurlyInString: 网关启用与应用同步分别由部署配置决定。
			QINGYAN_WAF_ENABLED: "${QINGYAN_WAF_ENABLED:-false}",
			QINGYAN_WAF_MAPPING_FILE: "/app/config/waf-sites.json",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: 维护状态由部署目录的 Compose 环境解析。
			QINGYAN_WAF_SYNC_PAUSED: "${QINGYAN_WAF_SYNC_PAUSED:-false}",
			QINGYAN_WAF_GATEWAY_URL: "http://onepanel-gateway:4402",
			QINGYAN_WAF_GATEWAY_TOKEN_FILE:
				"/run/qingyan-gateway/qingyan-gateway-token",
		};
		services.qingyan.volumes = ["./gateway/client:/run/qingyan-gateway:ro"];
	}
	return { services, ...(Object.keys(networks).length ? { networks } : {}) };
}

export function writeDeploymentOverlay(directory, effective, options) {
	const overlay = buildDeploymentOverlay(effective, { ...options, directory });
	const filename = path.join(directory, "gateway.compose.json");
	fs.writeFileSync(
		`${filename}.next`,
		`${JSON.stringify(overlay, null, 2)}\n`,
		{ mode: 0o600 },
	);
	fs.renameSync(`${filename}.next`, filename);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	try {
		const directory = process.env.QINGYAN_LAYOUT_DIRECTORY ?? "/deployment";
		const effective = JSON.parse(
			fs.readFileSync(
				process.env.QINGYAN_LAYOUT_EFFECTIVE_PATH ??
					path.join(directory, ".compose-before-upgrade.json"),
				"utf8",
			),
		);
		const existingNetworks = JSON.parse(
			fs.readFileSync(
				process.env.QINGYAN_LAYOUT_NETWORKS_PATH ??
					path.join(directory, ".docker-networks.json"),
				"utf8",
			),
		);
		writeDeploymentOverlay(directory, effective, {
			hostDirectory: process.env.QINGYAN_LAYOUT_HOST_DIRECTORY ?? directory,
			gatewaySupported: process.env.QINGYAN_LAYOUT_GATEWAY_SUPPORTED === "true",
			gatewayEnabled: process.env.QINGYAN_LAYOUT_GATEWAY_ENABLED === "true",
			gatewaySubnet: process.env.QINGYAN_GATEWAY_SUBNET ?? "172.30.251.0/28",
			gatewayHostIp: process.env.QINGYAN_GATEWAY_HOST_IP ?? "172.30.251.1",
			gatewayIp: process.env.QINGYAN_GATEWAY_IP ?? "172.30.251.3",
			databaseNetwork: process.env.QINGYAN_DATABASE_NETWORK ?? "",
			existingNetworks,
		});
	} catch (error) {
		console.error(
			error instanceof Error ? error.message : "部署布局升级失败。",
		);
		process.exitCode = 1;
	}
}
