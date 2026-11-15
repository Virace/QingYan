import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
	createServer,
	request as httpRequest,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";

export type ParameterRule =
	| {
			type: "string";
			values?: string[];
			minLength?: number;
			maxLength?: number;
			prefix?: string;
			format?: "ip" | "name";
	  }
	| { type: "integer"; min?: number; max?: number }
	| { type: "boolean"; value?: boolean }
	| { type: "array"; items: ParameterRule; minItems?: number; maxItems: number }
	| {
			type: "object";
			fields: Record<string, ParameterRule>;
			required?: string[];
	  };

export interface GatewayRoute {
	id: string;
	method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
	path: string;
	purpose: string;
	query?: Record<string, ParameterRule>;
	body?: ParameterRule;
}

export interface GatewayConfig {
	listen: { host: string; port: number };
	upstreamBaseUrl: string;
	upstreamApiKeyFile: string;
	upstreamNode: string;
	clients: Array<{ id: string; tokenFile: string; allowedRouteIds: string[] }>;
	routes: GatewayRoute[];
	requestTimeoutMs: number;
	maxRequestBytes: number;
	maxResponseBytes: number;
}

export interface GatewayRuntime {
	config: GatewayConfig;
	apiKey: string;
	clients: Array<{
		id: string;
		tokenHash: Buffer;
		allowedRouteIds: Set<string>;
	}>;
}

class GatewayError extends Error {
	statusCode: number;
	code: string;
	constructor(statusCode: number, code: string) {
		super(code);
		this.statusCode = statusCode;
		this.code = code;
	}
}

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid gateway configuration");
	return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: string[]) {
	if (Object.keys(value).some((key) => !allowed.includes(key)))
		throw new Error("Unknown gateway configuration field");
}

function text(value: unknown): string {
	if (
		typeof value !== "string" ||
		!value.trim() ||
		value.length > 4096 ||
		Array.from(value).some(
			(character) =>
				character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
		)
	)
		throw new Error("Invalid gateway configuration string");
	return value;
}

function integer(value: unknown, min: number, max: number): number {
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < min ||
		value > max
	)
		throw new Error("Invalid gateway configuration number");
	return value;
}

function list(value: unknown, max: number): unknown[] {
	if (!Array.isArray(value) || value.length > max)
		throw new Error("Invalid gateway configuration list");
	return value;
}

function fieldRules(
	value: unknown,
	depth: number,
): Record<string, ParameterRule> {
	const fields = object(value);
	if (Object.keys(fields).length > 100)
		throw new Error("Too many gateway fields");
	return Object.fromEntries(
		Object.entries(fields).map(([key, rule]) => {
			if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(key))
				throw new Error("Invalid gateway field name");
			return [key, parameterRule(rule, depth + 1)];
		}),
	);
}

function parameterRule(value: unknown, depth = 0): ParameterRule {
	if (depth > 8) throw new Error("Gateway parameter rule is too deep");
	const rule = object(value);
	switch (rule.type) {
		case "string": {
			keys(rule, [
				"type",
				"values",
				"minLength",
				"maxLength",
				"prefix",
				"format",
			]);
			if (
				rule.format !== undefined &&
				rule.format !== "ip" &&
				rule.format !== "name"
			)
				throw new Error("Invalid gateway string format");
			return {
				type: "string",
				values:
					rule.values === undefined
						? undefined
						: list(rule.values, 1000).map((value) =>
								value === "" ? "" : text(value),
							),
				maxLength:
					rule.maxLength === undefined
						? undefined
						: integer(rule.maxLength, 1, 1048576),
				format: rule.format,
				minLength:
					rule.minLength === undefined
						? undefined
						: integer(rule.minLength, 0, 1048576),
				prefix: rule.prefix === undefined ? undefined : text(rule.prefix),
			};
		}
		case "integer": {
			keys(rule, ["type", "min", "max"]);
			const min =
				rule.min === undefined
					? undefined
					: integer(rule.min, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
			const max =
				rule.max === undefined
					? undefined
					: integer(rule.max, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
			if (min !== undefined && max !== undefined && min > max)
				throw new Error("Invalid gateway integer range");
			return { type: "integer", min, max };
		}
		case "boolean":
			keys(rule, ["type", "value"]);
			if (rule.value !== undefined && typeof rule.value !== "boolean")
				throw new Error("Invalid gateway boolean value");
			return { type: "boolean", value: rule.value };
		case "array":
			keys(rule, ["type", "items", "minItems", "maxItems"]);
			return {
				type: "array",
				items: parameterRule(rule.items, depth + 1),
				maxItems: integer(rule.maxItems, 0, 10000),
				minItems:
					rule.minItems === undefined
						? undefined
						: integer(rule.minItems, 0, 10000),
			};
		case "object": {
			keys(rule, ["type", "fields", "required"]);
			const fields = fieldRules(rule.fields, depth);
			const required =
				rule.required === undefined ? [] : list(rule.required, 100).map(text);
			if (required.some((key) => !Object.hasOwn(fields, key)))
				throw new Error("Unknown required gateway field");
			return { type: "object", fields, required };
		}
		default:
			throw new Error("Unknown gateway parameter type");
	}
}

function canonicalPath(value: string): boolean {
	return /^\/[A-Za-z0-9/_-]*$/u.test(value) && !value.includes("//");
}

export function parseGatewayConfig(value: unknown): GatewayConfig {
	const config = object(value);
	keys(config, [
		"listen",
		"upstreamBaseUrl",
		"upstreamApiKeyFile",
		"upstreamNode",
		"clients",
		"routes",
		"requestTimeoutMs",
		"maxRequestBytes",
		"maxResponseBytes",
	]);
	const listen = object(config.listen);
	keys(listen, ["host", "port"]);
	const upstreamBaseUrl = text(config.upstreamBaseUrl);
	const upstream = new URL(upstreamBaseUrl);
	if (
		!["http:", "https:"].includes(upstream.protocol) ||
		upstream.username ||
		upstream.password ||
		upstream.pathname !== "/" ||
		upstream.search ||
		upstream.hash
	)
		throw new Error("Upstream must be a fixed HTTP origin");
	const routes = list(config.routes, 256).map((value) => {
		const route = object(value);
		keys(route, ["id", "method", "path", "purpose", "query", "body"]);
		const path = text(route.path);
		if (
			!canonicalPath(path) ||
			!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(String(route.method))
		)
			throw new Error("Invalid gateway route");
		return {
			id: text(route.id),
			method: route.method as GatewayRoute["method"],
			path,
			purpose: text(route.purpose),
			query: route.query === undefined ? {} : fieldRules(route.query, 0),
			body: route.body === undefined ? undefined : parameterRule(route.body),
		};
	});
	if (
		new Set(routes.map((route) => route.id)).size !== routes.length ||
		new Set(routes.map((route) => `${route.method} ${route.path}`)).size !==
			routes.length
	)
		throw new Error("Duplicate gateway route");
	const clients = list(config.clients, 32).map((value) => {
		const client = object(value);
		keys(client, ["id", "tokenFile", "allowedRouteIds"]);
		const allowedRouteIds = list(client.allowedRouteIds, 256).map(text);
		if (allowedRouteIds.some((id) => !routes.some((route) => route.id === id)))
			throw new Error("Unknown gateway client route");
		return {
			id: text(client.id),
			tokenFile: text(client.tokenFile),
			allowedRouteIds,
		};
	});
	if (new Set(clients.map((client) => client.id)).size !== clients.length)
		throw new Error("Duplicate gateway client");
	return {
		listen: { host: text(listen.host), port: integer(listen.port, 1, 65535) },
		upstreamBaseUrl: upstream.origin,
		upstreamApiKeyFile: text(config.upstreamApiKeyFile),
		upstreamNode: text(config.upstreamNode ?? "local"),
		clients,
		routes,
		requestTimeoutMs: integer(config.requestTimeoutMs ?? 10000, 100, 120000),
		maxRequestBytes: integer(config.maxRequestBytes ?? 262144, 1, 10485760),
		maxResponseBytes: integer(config.maxResponseBytes ?? 4194304, 1, 67108864),
	};
}

async function secret(path: string): Promise<string> {
	const value = (await readFile(path, "utf8")).trim();
	if (value.length < 16 || value.length > 4096 || /\s/u.test(value))
		throw new Error("Invalid gateway secret");
	return value;
}

export async function loadGatewayRuntime(
	configPath: string,
): Promise<GatewayRuntime> {
	const config = parseGatewayConfig(
		JSON.parse(await readFile(configPath, "utf8")),
	);
	const apiKey = await secret(config.upstreamApiKeyFile);
	const clients = await Promise.all(
		config.clients.map(async (client) => {
			const token = await secret(client.tokenFile);
			if (token === apiKey)
				throw new Error("Gateway client token must be independent");
			return {
				id: client.id,
				tokenHash: createHash("sha256").update(token).digest(),
				allowedRouteIds: new Set(client.allowedRouteIds),
			};
		}),
	);
	if (
		new Set(clients.map((client) => client.tokenHash.toString("hex"))).size !==
		clients.length
	)
		throw new Error("Gateway client tokens must be unique");
	return { config, apiKey, clients };
}

function validParameter(
	value: unknown,
	rule: ParameterRule,
	query = false,
): boolean {
	switch (rule.type) {
		case "string":
			return (
				typeof value === "string" &&
				value.length >= (rule.minLength ?? 0) &&
				value.length <= (rule.maxLength ?? 4096) &&
				(!rule.values || rule.values.includes(value)) &&
				(!rule.prefix || value.startsWith(rule.prefix)) &&
				(rule.format !== "ip" || isIP(value) !== 0) &&
				(rule.format !== "name" ||
					/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(value))
			);
		case "integer": {
			const number =
				query && typeof value === "string" && /^-?\d+$/u.test(value)
					? Number(value)
					: value;
			return (
				typeof number === "number" &&
				Number.isSafeInteger(number) &&
				(rule.min === undefined || number >= rule.min) &&
				(rule.max === undefined || number <= rule.max)
			);
		}
		case "boolean":
			return (
				(typeof value === "boolean" &&
					(rule.value === undefined || value === rule.value)) ||
				(query &&
					(value === "true" || value === "false") &&
					(rule.value === undefined || value === String(rule.value)))
			);
		case "array":
			return (
				Array.isArray(value) &&
				value.length >= (rule.minItems ?? 0) &&
				value.length <= rule.maxItems &&
				value.every((item) => validParameter(item, rule.items))
			);
		case "object": {
			if (!value || typeof value !== "object" || Array.isArray(value))
				return false;
			const fields = value as Record<string, unknown>;
			return (
				(rule.required ?? []).every((key) => Object.hasOwn(fields, key)) &&
				Object.entries(fields).every(
					([key, nested]) =>
						Object.hasOwn(rule.fields, key) &&
						validParameter(nested, rule.fields[key]),
				)
			);
		}
	}
}

function internalClient(request: IncomingMessage, runtime: GatewayRuntime) {
	const matches = [...request.rawHeaders.keys()].filter(
		(index) =>
			index % 2 === 0 &&
			request.rawHeaders[index].toLowerCase() === "authorization",
	).length;
	const token = /^Bearer ([^\s]+)$/u.exec(
		request.headers.authorization ?? "",
	)?.[1];
	if (matches !== 1 || !token || token.length > 4096)
		throw new GatewayError(401, "GATEWAY_AUTH_REQUIRED");
	const hash = createHash("sha256").update(token).digest();
	const client = runtime.clients.find((client) =>
		timingSafeEqual(client.tokenHash, hash),
	);
	if (!client) throw new GatewayError(401, "GATEWAY_AUTH_REQUIRED");
	return client;
}

function requestBody(
	request: IncomingMessage,
	maxBytes: number,
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let length = 0;
		let exceeded = false;
		request.on("data", (chunk: Buffer) => {
			length += chunk.length;
			if (length > maxBytes) {
				if (!exceeded) reject(new GatewayError(413, "GATEWAY_BODY_TOO_LARGE"));
				exceeded = true;
				return;
			}
			if (!exceeded) chunks.push(chunk);
		});
		request.on("end", () => {
			if (!exceeded) resolve(Buffer.concat(chunks));
		});
		request.on("error", reject);
	});
}

async function forward(
	request: IncomingMessage,
	route: GatewayRoute,
	runtime: GatewayRuntime,
) {
	const url = new URL(request.url ?? "/", runtime.config.upstreamBaseUrl);
	const seen = new Set<string>();
	for (const [key, value] of url.searchParams) {
		if (
			seen.has(key) ||
			!Object.hasOwn(route.query ?? {}, key) ||
			!validParameter(
				value,
				(route.query as Record<string, ParameterRule>)[key],
				true,
			)
		)
			throw new GatewayError(403, "GATEWAY_PARAMETER_DENIED");
		seen.add(key);
	}
	const body = await requestBody(request, runtime.config.maxRequestBytes);
	if (route.body) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(body.toString("utf8"));
		} catch {
			throw new GatewayError(400, "GATEWAY_JSON_REQUIRED");
		}
		if (
			!/^application\/json(?:\s*;|$)/iu.test(
				request.headers["content-type"] ?? "",
			) ||
			!validParameter(parsed, route.body)
		)
			throw new GatewayError(403, "GATEWAY_PARAMETER_DENIED");
	} else if (body.length)
		throw new GatewayError(403, "GATEWAY_PARAMETER_DENIED");
	const timestamp = String(Math.floor(Date.now() / 1000));
	const signature = createHmac("sha256", runtime.apiKey)
		.update(`1panel:${timestamp}`)
		.digest("hex");
	return new Promise<{
		statusCode: number;
		contentType: string;
		retryAfter?: string;
		body: Buffer;
	}>((resolve, reject) => {
		const upstreamRequest = (
			url.protocol === "https:" ? httpsRequest : httpRequest
		)(
			url,
			{
				method: route.method,
				headers: {
					"1Panel-Token": signature,
					"1Panel-Timestamp": timestamp,
					CurrentNode: runtime.config.upstreamNode,
					accept: "application/json",
					...(body.length
						? {
								"content-type": "application/json",
								"content-length": String(body.length),
							}
						: {}),
				},
			},
			(upstream) => {
				if (
					(upstream.statusCode ?? 500) >= 300 &&
					(upstream.statusCode ?? 500) < 400
				) {
					upstream.resume();
					reject(new GatewayError(502, "GATEWAY_UPSTREAM_REDIRECT"));
					return;
				}
				const chunks: Buffer[] = [];
				let length = 0;
				upstream.on("data", (chunk: Buffer) => {
					length += chunk.length;
					if (length > runtime.config.maxResponseBytes)
						upstreamRequest.destroy(
							new GatewayError(502, "GATEWAY_RESPONSE_TOO_LARGE"),
						);
					else chunks.push(chunk);
				});
				upstream.on("end", () =>
					resolve({
						statusCode: upstream.statusCode ?? 502,
						contentType: upstream.headers["content-type"] ?? "application/json",
						retryAfter: upstream.headers["retry-after"],
						body: Buffer.concat(chunks),
					}),
				);
				upstream.on("error", reject);
			},
		);
		const timer = setTimeout(
			() =>
				upstreamRequest.destroy(
					new GatewayError(504, "GATEWAY_UPSTREAM_TIMEOUT"),
				),
			runtime.config.requestTimeoutMs,
		);
		upstreamRequest.on("close", () => clearTimeout(timer));
		upstreamRequest.on("error", reject);
		upstreamRequest.end(body);
	});
}

function json(response: ServerResponse, statusCode: number, code: string) {
	response.writeHead(statusCode, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	response.end(JSON.stringify({ code }));
}

export function createGatewayServer(runtime: GatewayRuntime) {
	const server = createServer(async (request, response) => {
		try {
			if (request.method === "GET" && request.url === "/healthz") {
				json(response, 200, "GATEWAY_READY");
				return;
			}
			const client = internalClient(request, runtime);
			const path = (request.url ?? "").split("?", 1)[0];
			if (!canonicalPath(path) || request.url?.includes("#"))
				throw new GatewayError(403, "GATEWAY_ROUTE_DENIED");
			if (
				Object.keys(request.headers).some((header) =>
					/^(?:1panel-|currentnode$|x-forwarded-|x-real-ip$|forwarded$|proxy-authorization$|x-original-url$|x-rewrite-url$|x-http-method-override$)/u.test(
						header,
					),
				)
			)
				throw new GatewayError(403, "GATEWAY_HEADER_DENIED");
			const route = runtime.config.routes.find(
				(route) =>
					route.method === request.method &&
					route.path === path &&
					client.allowedRouteIds.has(route.id),
			);
			if (!route) throw new GatewayError(403, "GATEWAY_ROUTE_DENIED");
			const upstream = await forward(request, route, runtime);
			response.writeHead(upstream.statusCode, {
				"content-type": upstream.contentType,
				"cache-control": "no-store",
				...(upstream.retryAfter ? { "retry-after": upstream.retryAfter } : {}),
			});
			response.end(upstream.body);
		} catch (error) {
			const failure =
				error instanceof GatewayError
					? error
					: new GatewayError(502, "GATEWAY_UPSTREAM_UNAVAILABLE");
			if (!response.headersSent)
				json(response, failure.statusCode, failure.code);
			request.resume();
		}
	});
	server.requestTimeout = runtime.config.requestTimeoutMs + 1000;
	server.headersTimeout = Math.min(10000, server.requestTimeout);
	server.maxHeadersCount = 64;
	return server;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	try {
		const runtime = await loadGatewayRuntime(
			process.env.QINGYAN_GATEWAY_CONFIG_PATH ?? "/app/config/gateway.json",
		);
		const server = createGatewayServer(runtime);
		server.listen(runtime.config.listen.port, runtime.config.listen.host, () =>
			process.stdout.write("onepanel-gateway.ready\n"),
		);
		server.on("error", () => {
			process.stderr.write("onepanel-gateway.listen_failed\n");
			process.exitCode = 1;
		});
		for (const signal of ["SIGINT", "SIGTERM"] as const)
			process.on(signal, () =>
				server.close(() => {
					process.exitCode = 0;
				}),
			);
	} catch {
		process.stderr.write("onepanel-gateway.configuration_failed\n");
		process.exitCode = 1;
	}
}
