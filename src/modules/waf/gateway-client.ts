import { z } from "zod";
import type { WafConnection } from "./config";

export const wafAclRuleSchema = z.object({
	name: z.string().min(1).max(128),
	rule: z.string().default(""),
	state: z.string(),
	code: z.number(),
	action: z.string(),
	type: z.string(),
	res: z.string().default(""),
	ipBlock: z.string(),
	ipBlockTime: z.number(),
	description: z.string(),
	conditions: z.array(
		z.object({
			field: z.string(),
			pattern: z.string(),
			rule: z.string(),
			name: z.string().default(""),
		}),
	),
	expireTime: z.number().default(24),
	unit: z.string().default("h"),
});
export type WafAclRule = z.infer<typeof wafAclRuleSchema>;
const pageSchema = <T extends z.ZodType>(item: T) =>
	z.object({
		total: z.number().int().nonnegative(),
		items: z
			.array(item)
			.nullable()
			.transform((items) => items ?? []),
	});
export const wafLogSchema = z.object({
	id: z.number().int().nonnegative(),
	ip: z.string(),
	action: z.string(),
	uri: z.string(),
	execRule: z.string(),
	host: z.string(),
	localtime: z.string(),
});
export type WafLog = z.infer<typeof wafLogSchema>;

export class WafGatewayError extends Error {
	public constructor(
		public readonly code:
			| "WAF_GATEWAY_UNAVAILABLE"
			| "WAF_GATEWAY_RESPONSE_INVALID"
			| "WAF_GATEWAY_REJECTED"
			| "WAF_SYNC_PAUSED",
	) {
		super(code);
	}
}

export class WafGatewayClient {
	public constructor(
		private readonly connection: Pick<WafConnection, "gatewayUrl" | "token">,
		private readonly fetcher: typeof fetch = fetch,
	) {}

	private async request(path: string, body?: unknown): Promise<unknown> {
		if (process.env.QINGYAN_WAF_SYNC_PAUSED === "true")
			throw new WafGatewayError("WAF_SYNC_PAUSED");
		try {
			const response = await this.fetcher(
				`${this.connection.gatewayUrl}/api/v2/xpack/waf${path}`,
				{
					method: body === undefined ? "GET" : "POST",
					headers: {
						authorization: `Bearer ${this.connection.token}`,
						...(body === undefined
							? {}
							: { "content-type": "application/json" }),
					},
					body: body === undefined ? undefined : JSON.stringify(body),
					signal: AbortSignal.timeout(12000),
					redirect: "error",
				},
			);
			if (!response.ok) throw new WafGatewayError("WAF_GATEWAY_REJECTED");
			const payload = z
				.object({ code: z.number(), data: z.unknown().optional() })
				.parse(await response.json());
			if (payload.code !== 200)
				throw new WafGatewayError("WAF_GATEWAY_REJECTED");
			return payload.data;
		} catch (error) {
			if (error instanceof WafGatewayError) throw error;
			throw new WafGatewayError(
				error instanceof z.ZodError
					? "WAF_GATEWAY_RESPONSE_INVALID"
					: "WAF_GATEWAY_UNAVAILABLE",
			);
		}
	}

	public async findRule(
		websiteId: number,
		name: string,
	): Promise<WafAclRule | null> {
		const data = pageSchema(wafAclRuleSchema).parse(
			await this.request("/rule/acl/search", {
				page: 1,
				pageSize: 100,
				name,
				websiteID: websiteId,
			}),
		);
		const exact = data.items.filter((rule) => rule.name === name);
		if (exact.length > 1 || data.total > 100)
			throw new WafGatewayError("WAF_GATEWAY_RESPONSE_INVALID");
		return exact[0] ?? null;
	}
	public async createRule(
		websiteId: number,
		websiteKey: string,
		rule: WafAclRule,
	) {
		await this.request("/rule/acl/create", {
			...rule,
			rule: "",
			websiteID: websiteId,
			websiteKey,
		});
	}
	public async updateRule(
		websiteId: number,
		websiteKey: string,
		rule: WafAclRule,
	) {
		await this.request("/rule/acl/update", {
			...rule,
			rule: "",
			websiteID: websiteId,
			websiteKey,
		});
	}
	public async deleteRule(websiteId: number, name: string) {
		await this.request("/rule/acl/delete", { websiteID: websiteId, name });
	}
	public async logs(websiteKey: string, page: number) {
		return pageSchema(wafLogSchema).parse(
			await this.request("/log/search", {
				page,
				pageSize: 100,
				websiteKey,
				action: "all",
				execRules: [],
			}),
		);
	}
	public async websites() {
		return z
			.array(
				z.object({
					id: z.number().int().positive(),
					alias: z.string(),
					primaryDomain: z.string(),
				}),
			)
			.parse(await this.request("/websites"));
	}
}
