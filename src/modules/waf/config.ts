import { readFile } from "node:fs/promises";
import { z } from "zod";

export const wafSiteMappingSchema = z
	.object({
		siteKey: z.string().min(1),
		websiteId: z.number().int().positive(),
		websiteKey: z.string().min(1).max(128),
		hosts: z.array(z.string().min(1).max(253)).min(1).max(20),
		autoBanScans: z.boolean().default(false),
	})
	.strict();

const mappingsSchema = z
	.object({
		sites: z.array(wafSiteMappingSchema).max(100),
		collectUnknownHosts: z.boolean().default(false),
	})
	.strict();
export type WafSiteMapping = z.infer<typeof wafSiteMappingSchema>;
export interface WafConnection {
	gatewayUrl: string;
	token: string;
	sites: WafSiteMapping[];
	collectUnknownHosts: boolean;
}

export async function loadWafConnection(
	env: NodeJS.ProcessEnv = process.env,
): Promise<WafConnection | null> {
	if (env.QINGYAN_WAF_ENABLED !== "true") return null;
	const url = new URL(env.QINGYAN_WAF_GATEWAY_URL ?? "");
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	)
		throw new Error("WAF_GATEWAY_CONFIG_INVALID");
	if (!env.QINGYAN_WAF_GATEWAY_TOKEN_FILE || !env.QINGYAN_WAF_MAPPING_FILE)
		throw new Error("WAF_GATEWAY_CONFIG_REQUIRED");
	const token = (
		await readFile(env.QINGYAN_WAF_GATEWAY_TOKEN_FILE, "utf8")
	).trim();
	if (token.length < 16 || /\s/u.test(token))
		throw new Error("WAF_GATEWAY_TOKEN_INVALID");
	const mapping = mappingsSchema.parse(
		JSON.parse(await readFile(env.QINGYAN_WAF_MAPPING_FILE, "utf8")),
	);
	if (
		new Set(mapping.sites.map((site) => site.siteKey)).size !==
			mapping.sites.length ||
		new Set(mapping.sites.map((site) => site.websiteId)).size !==
			mapping.sites.length ||
		new Set(mapping.sites.map((site) => site.websiteKey)).size !==
			mapping.sites.length
	)
		throw new Error("WAF_SITE_MAPPING_DUPLICATE");
	return { gatewayUrl: url.origin, token, ...mapping };
}
