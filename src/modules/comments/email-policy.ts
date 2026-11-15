import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import { z } from "zod";
import { AppError } from "../shared/errors";

function normalizeDomain(value: string): string {
	const input = value.trim().toLowerCase();
	// domainToASCII 使用 URL 主机解析，必须先拒绝会被截断、解码或忽略的输入。
	if (/[/\\?#%:\s\p{Cc}]/u.test(input)) throw new Error("INVALID_EMAIL_DOMAIN");
	const domain = domainToASCII(input);
	if (
		!domain ||
		(isIP(domain) === 4 && domain !== input) ||
		domain.length > 253 ||
		!domain.includes(".") ||
		domain
			.split(".")
			.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
	) {
		throw new Error("INVALID_EMAIL_DOMAIN");
	}
	return domain;
}

export function normalizeCommentEmail(value: string): string {
	const address = value.trim().toLowerCase();
	const at = address.lastIndexOf("@");
	if (at <= 0 || at !== address.indexOf("@") || /\s/u.test(address))
		throw new Error("INVALID_EMAIL_ADDRESS");
	const normalized = `${address.slice(0, at)}@${normalizeDomain(address.slice(at + 1))}`;
	if (
		normalized.length > 254 ||
		at > 64 ||
		!z.email().safeParse(`${address.slice(0, at)}@example.org`).success
	)
		throw new Error("INVALID_EMAIL_ADDRESS");
	return normalized;
}

const normalizedDomainSchema = z
	.string()
	.trim()
	.transform((value, context) => {
		try {
			return normalizeDomain(value);
		} catch {
			context.addIssue({
				code: "custom",
				message: "请输入合法域名，不支持 URL、正则或通配符。",
			});
			return z.NEVER;
		}
	});
export const normalizedEmailSchema = z
	.string()
	.trim()
	.transform((value, context) => {
		try {
			return normalizeCommentEmail(value);
		} catch {
			context.addIssue({ code: "custom", message: "请输入合法邮箱地址。" });
			return z.NEVER;
		}
	});
export const emailRuleSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("email"), value: normalizedEmailSchema }).strict(),
	z
		.object({
			type: z.literal("domain"),
			value: normalizedDomainSchema,
			includeSubdomains: z.boolean().default(false),
		})
		.strict(),
]);
export const emailPolicySchema = z
	.object({
		mode: z.enum(["allow_all", "allow_selected"]).default("allow_all"),
		allowed: z.array(emailRuleSchema).max(200).default([]),
		denied: z.array(emailRuleSchema).max(200).default([]),
		protectedDomains: z
			.array(
				z
					.object({
						value: normalizedDomainSchema,
						includeSubdomains: z.boolean().default(false),
					})
					.strict(),
			)
			.max(100)
			.default([]),
	})
	.strict()
	.superRefine((policy, context) => {
		if (policy.mode === "allow_selected" && policy.allowed.length === 0)
			context.addIssue({
				code: "custom",
				path: ["allowed"],
				message: "仅允许指定来源时，至少添加一条允许规则。",
			});
	});
export type EmailPolicy = z.infer<typeof emailPolicySchema>;
export type EmailRule = z.infer<typeof emailRuleSchema>;

export function readEmailPolicy(json?: string | null): EmailPolicy {
	return emailPolicySchema.parse(json ? JSON.parse(json) : {});
}

function matchesDomain(
	domain: string,
	rule: { value: string; includeSubdomains: boolean },
) {
	return (
		domain === rule.value ||
		(rule.includeSubdomains && domain.endsWith(`.${rule.value}`))
	);
}
function matchesRule(address: string, domain: string, rule: EmailRule) {
	return rule.type === "email"
		? address === rule.value
		: matchesDomain(domain, rule);
}

export function evaluateEmailPolicy(input: {
	email?: string;
	policy: EmailPolicy;
	reservedEmail?: string;
	authenticated?: boolean;
}) {
	if (!input.email) return { result: "allowed" as const, matchedRule: null };
	const address = normalizeCommentEmail(input.email);
	const domain = address.slice(address.lastIndexOf("@") + 1);
	const protectedRule = input.policy.protectedDomains.find((rule) =>
		matchesDomain(domain, rule),
	);
	const reserved =
		input.reservedEmail &&
		normalizeCommentEmail(input.reservedEmail) === address;
	if ((protectedRule || reserved) && !input.authenticated)
		return {
			result: "login_required" as const,
			matchedRule: protectedRule ?? { type: "email", value: address },
		};
	if (input.authenticated)
		return { result: "allowed" as const, matchedRule: null };
	const denied = input.policy.denied.find((rule) =>
		matchesRule(address, domain, rule),
	);
	if (denied) return { result: "denied" as const, matchedRule: denied };
	const allowed = input.policy.allowed.find((rule) =>
		matchesRule(address, domain, rule),
	);
	if (input.policy.mode === "allow_selected" && !allowed)
		return { result: "denied" as const, matchedRule: null };
	return { result: "allowed" as const, matchedRule: allowed ?? null };
}

export function assertEmailPolicy(
	input: Parameters<typeof evaluateEmailPolicy>[0],
) {
	const decision = evaluateEmailPolicy(input);
	if (
		!input.authenticated &&
		input.email &&
		input.reservedEmail &&
		normalizeCommentEmail(input.email) ===
			normalizeCommentEmail(input.reservedEmail)
	)
		throw new AppError(
			403,
			"VERIFIED_AUTHOR_EMAIL_RESERVED",
			"该邮箱需要登录后使用。",
		);
	if (decision.result === "login_required")
		throw new AppError(
			403,
			"COMMENT_EMAIL_LOGIN_REQUIRED",
			"该邮箱需要登录后使用。",
		);
	if (decision.result === "denied")
		throw new AppError(
			403,
			"COMMENT_EMAIL_NOT_ALLOWED",
			"该邮箱暂不支持，请更换邮箱。",
		);
	return decision;
}

export function isNumericComment(content: string): boolean {
	return /^[0-9０-９\s]+$/u.test(content) && /[0-9０-９]/u.test(content);
}
