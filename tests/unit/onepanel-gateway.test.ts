import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createGatewayServer,
	type GatewayRuntime,
	parseGatewayConfig,
} from "../../services/onepanel-gateway/gateway.mjs";

const servers: Server[] = [];
const TOKEN = "gateway-test-client-token";
const API_KEY = "panel-test-signing-secret";

afterEach(async () => {
	await Promise.all(
		servers.splice(0).map(
			(server) =>
				new Promise<void>((resolve, reject) => {
					server.closeAllConnections();
					server.close((error) => (error ? reject(error) : resolve()));
				}),
		),
	);
});

async function listen(server: Server): Promise<string> {
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function fixture(options?: {
	redirect?: boolean;
	delayMs?: number;
	deployedAclRules?: boolean;
}) {
	const requests: Array<{
		method: string;
		path: string;
		body: string;
		headers: Record<string, string | string[] | undefined>;
	}> = [];
	const upstream = await listen(
		createServer(async (request, response) => {
			let body = "";
			for await (const chunk of request) body += String(chunk);
			requests.push({
				method: request.method ?? "",
				path: request.url ?? "",
				body,
				headers: request.headers,
			});
			if (options?.delayMs)
				await new Promise((resolve) => setTimeout(resolve, options.delayMs));
			if (options?.redirect) {
				response.writeHead(302, { location: "/api/v2/core/settings/search" });
				response.end();
				return;
			}
			response.writeHead(200, {
				"content-type": "application/json",
				"set-cookie": "panel-session=private",
				"1Panel-Token": "upstream-private-header",
			});
			response.end(
				JSON.stringify({ code: 200, data: { total: 0, items: [] } }),
			);
		}),
	);
	const defaultConfig = {
		listen: { host: "127.0.0.1", port: 4402 },
		upstreamBaseUrl: upstream,
		upstreamApiKeyFile: "/unused-panel-key",
		upstreamNode: "local",
		clients: [
			{
				id: "qingyan",
				tokenFile: "/unused-client-token",
				allowedRouteIds: ["logs", "status"],
			},
		],
		routes: [
			{
				id: "status",
				method: "GET",
				path: "/api/v2/xpack/waf/status",
				purpose: "检查 WAF 状态",
			},
			{
				id: "logs",
				method: "POST",
				path: "/api/v2/xpack/waf/log/search",
				purpose: "读取指定站点事件",
				body: {
					type: "object",
					required: ["page", "pageSize", "website"],
					fields: {
						page: { type: "integer", min: 1, max: 1000000 },
						pageSize: { type: "integer", min: 1, max: 100 },
						website: { type: "string", values: ["site.example.test"] },
					},
				},
			},
			{
				id: "not-granted",
				method: "GET",
				path: "/api/v2/core/settings/search/available",
				purpose: "未授权给此接入方",
			},
		],
		requestTimeoutMs: options?.delayMs ? 100 : 1000,
		maxRequestBytes: 1024,
	};
	const config = parseGatewayConfig(
		options?.deployedAclRules
			? {
					...JSON.parse(
						await readFile(
							resolve("services/onepanel-gateway/allowlist.example.json"),
							"utf8",
						),
					),
					upstreamBaseUrl: upstream,
				}
			: defaultConfig,
	);
	const runtime: GatewayRuntime = {
		config,
		apiKey: API_KEY,
		clients: [
			{
				id: "qingyan",
				tokenHash: createHash("sha256").update(TOKEN).digest(),
				allowedRouteIds: new Set(config.clients[0].allowedRouteIds),
			},
		],
	};
	const gateway = await listen(createGatewayServer(runtime));
	return { gateway, requests, config };
}

async function rawRequest(
	baseUrl: string,
	path: string,
	headers?: Record<string, string | undefined>,
	method = "GET",
	body?: string,
) {
	const origin = new URL(baseUrl);
	return new Promise<{ status: number; body: string }>((resolve, reject) => {
		const request = httpRequest(
			{
				hostname: origin.hostname,
				port: origin.port,
				method,
				path,
				headers: { authorization: `Bearer ${TOKEN}`, ...headers },
			},
			async (response) => {
				let body = "";
				for await (const chunk of response) body += String(chunk);
				resolve({ status: response.statusCode ?? 0, body });
			},
		);
		request.on("error", reject);
		request.end(body);
	});
}

describe("独立 1Panel API 网关", () => {
	it("部署白名单只允许指定站点的受管单一 IP ACL，拒绝扩大范围", async () => {
		const { gateway, requests } = await fixture({ deployedAclRules: true });
		const payload = {
			name: "qingyan-test-contract",
			state: "on",
			description: "QingYan managed penalty test",
			rule: "",
			conditions: [
				{ field: "IP", pattern: "eq", rule: "192.0.2.254", name: "" },
			],
			ipBlock: "off",
			ipBlockTime: 600,
			websiteKey: "YOUR_WEBSITE_ALIAS",
			websiteID: 1,
			code: 403,
			action: "deny",
			type: "acl",
			res: "",
			expireTime: 24,
			unit: "h",
		};
		const send = (body: unknown) =>
			rawRequest(
				gateway,
				"/api/v2/xpack/waf/rule/acl/create",
				{ "content-type": "application/json" },
				"POST",
				JSON.stringify(body),
			);
		expect((await send(payload)).status).toBe(200);
		expect(requests).toHaveLength(1);
		for (const change of [
			{ websiteID: 2 },
			{ websiteKey: "other-site" },
			{ name: "manual-rule" },
			{ action: "allow" },
			{ ipBlock: "on" },
			{ conditions: [] },
			{ conditions: [{ field: "URL", pattern: "eq", rule: "/", name: "" }] },
			{
				conditions: [
					{ field: "IP", pattern: "eq", rule: "192.0.2.0/24", name: "" },
				],
			},
			{ conditions: [...payload.conditions, ...payload.conditions] },
		])
			expect((await send({ ...payload, ...change })).status).toBe(403);
		expect(requests).toHaveLength(1);
	});
	it("只向固定上游转发获准的官方请求，并独立生成 HMAC-SHA256 签名", async () => {
		const { gateway, requests } = await fixture();
		const body = JSON.stringify({
			page: 1,
			pageSize: 100,
			website: "site.example.test",
		});
		const response = await fetch(`${gateway}/api/v2/xpack/waf/log/search`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${TOKEN}`,
				"content-type": "application/json",
				cookie: "ignored-browser-session=private",
			},
			body,
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			code: 200,
			data: { total: 0, items: [] },
		});
		expect(response.headers.get("set-cookie")).toBeNull();
		expect(response.headers.get("1Panel-Token")).toBeNull();
		expect(requests).toHaveLength(1);
		expect(requests[0].body).toBe(body);
		expect(requests[0].path).toBe("/api/v2/xpack/waf/log/search");
		expect(requests[0].method).toBe("POST");
		expect(requests[0].headers.authorization).toBeUndefined();
		expect(requests[0].headers.cookie).toBeUndefined();
		expect(requests[0].headers.currentnode).toBe("local");
		const timestamp = String(requests[0].headers["1panel-timestamp"]);
		expect(requests[0].headers["1panel-token"]).toBe(
			createHmac("sha256", API_KEY).update(`1panel:${timestamp}`).digest("hex"),
		);
	});

	it("拒绝未认证、其他方法、未授予路径及参数范围外请求，且不接触上游", async () => {
		const { gateway, requests } = await fixture();
		for (const request of [
			{
				path: "/api/v2/xpack/waf/status",
				headers: { authorization: "Bearer wrong-token" },
			},
			{ path: "/api/v2/xpack/waf/status", method: "DELETE" },
			{ path: "/api/v2/core/settings/search/available" },
			{ path: "/api/v2/core/settings/search" },
			{ path: "/api/v2/xpack/waf/status?target=http://other.test" },
			{
				path: "/api/v2/xpack/waf/log/search",
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					page: 1,
					pageSize: 101,
					website: "site.example.test",
				}),
			},
			{
				path: "/api/v2/xpack/waf/log/search",
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					page: 1,
					pageSize: 1,
					website: "other.example.test",
				}),
			},
			{
				path: "/api/v2/xpack/waf/log/search",
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					page: 1,
					pageSize: 1,
					website: "site.example.test",
					node: "other",
				}),
			},
		]) {
			const response = await rawRequest(
				gateway,
				request.path,
				request.headers,
				request.method,
				request.body,
			);
			expect([401, 403]).toContain(response.status);
		}
		expect(requests).toHaveLength(0);
	});

	it("按原始规范路径判权，拒绝编码、路径遍历与转发头改写", async () => {
		const { gateway, requests } = await fixture();
		for (const path of [
			"/api/v2/xpack/waf/%73tatus",
			"/api/v2/xpack/waf/log/../status",
			"//api/v2/xpack/waf/status",
			"/api/v2/xpack/waf/status/",
			"http://other.test/api/v2/xpack/waf/status",
		]) {
			expect((await rawRequest(gateway, path)).status).toBe(403);
		}
		for (const header of [
			"1Panel-Token",
			"1Panel-Timestamp",
			"CurrentNode",
			"X-Forwarded-Host",
			"X-Original-URL",
			"X-HTTP-Method-Override",
		]) {
			expect(
				(
					await rawRequest(gateway, "/api/v2/xpack/waf/status", {
						[header]: "caller-controlled",
					})
				).status,
			).toBe(403);
		}
		expect(requests).toHaveLength(0);
	});

	it("不跟随上游跳转，且不把签名或原始上游诊断返回调用方", async () => {
		const { gateway, requests } = await fixture({ redirect: true });
		const response = await rawRequest(gateway, "/api/v2/xpack/waf/status");
		expect(response).toEqual({
			status: 502,
			body: JSON.stringify({ code: "GATEWAY_UPSTREAM_REDIRECT" }),
		});
		expect(requests).toHaveLength(1);
		expect(response.body).not.toContain(API_KEY);
		expect(response.body).not.toContain(TOKEN);
	});

	it("上游超时返回稳定错误，健康接口不调用面板", async () => {
		const { gateway, requests } = await fixture({ delayMs: 300 });
		expect((await rawRequest(gateway, "/healthz")).status).toBe(200);
		expect(requests).toHaveLength(0);
		expect(await rawRequest(gateway, "/api/v2/xpack/waf/status")).toEqual({
			status: 504,
			body: JSON.stringify({ code: "GATEWAY_UPSTREAM_TIMEOUT" }),
		});
	});
});
