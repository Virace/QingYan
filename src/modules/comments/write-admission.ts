import { eq } from "drizzle-orm";
import type { DatabaseExecutor } from "../../db/client";
import { siteSettings } from "../../db/schema";
import type { RateLimitRule } from "../shared/rate-limit";
import {
	MemoryWriteQuotaStore,
	type WriteQuotaLease,
	type WriteQuotaRule,
} from "../shared/write-quota";
import { readAbusePolicy } from "./abuse-policy";
import { AbuseRepository } from "./abuse-repository";

export type PublicWriteAction = "comment_create" | "comment_vote" | "page_like";
export type WriteAdmissionInput = {
	siteId: number;
	siteKey: string;
	ip?: string;
	subject: string;
	action: PublicWriteAction;
	rule: RateLimitRule;
	settings: typeof siteSettings.$inferSelect | undefined;
};

export class WriteAdmissionService {
	private readonly quotas = new MemoryWriteQuotaStore();
	private readonly violations = new Map<
		string,
		{ count: number; resetAt: number }
	>();
	private readonly subjectsByIp = new Map<string, Map<string, number>>();
	private readonly prunedAt = new Map<number, number>();
	public constructor(
		private readonly db: DatabaseExecutor,
		private readonly isIpAllowlisted: (
			siteKey: string,
			ip: string,
			tx?: DatabaseExecutor,
			subject?: { visitorKey?: string; email?: string },
		) => Promise<boolean>,
	) {}

	public reserve(input: WriteAdmissionInput): WriteQuotaLease {
		const now = Date.now();
		const policy = readAbusePolicy(input.settings?.abusePolicyJson);
		const prefix = `write:${input.siteKey}:`;
		const rules: WriteQuotaRule[] = [
			{
				key: `${prefix}subject:${input.subject}:${input.action}`,
				rule: input.rule,
			},
		];
		if (input.action === "comment_create")
			rules.push({
				key: `${prefix}subject:${input.subject}:burst`,
				rule: {
					windowSec: policy.burstWindowSec,
					maxRequests: policy.commentBurstMax,
				},
			});
		if (input.ip) {
			rules.push({
				key: `${prefix}ip:${input.ip}:${input.action}`,
				rule: {
					windowSec: input.rule.windowSec,
					maxRequests:
						input.action === "comment_create"
							? policy.commentIpMax
							: (input.rule.maxRequests ?? 30) * policy.ipActionMultiplier,
				},
			});
			if (input.action === "comment_create")
				rules.push({
					key: `${prefix}ip:${input.ip}:burst`,
					rule: {
						windowSec: policy.burstWindowSec,
						maxRequests: policy.ipBurstMax,
					},
				});
			if (input.settings?.abuseGuardEnabled ?? true)
				rules.push({
					key: `${prefix}ip:${input.ip}:all`,
					rule: {
						windowSec: input.settings?.abuseGuardWindowSec ?? 600,
						maxRequests: input.settings?.abuseGuardMaxWriteActions ?? 100,
					},
				});
		}
		if (input.ip)
			this.remember(
				input.siteKey,
				input.ip,
				input.subject,
				Math.max(
					3600,
					input.rule.windowSec,
					input.settings?.abuseGuardWindowSec ?? 600,
				),
				now,
			);
		return this.quotas.reserve(
			rules,
			input.action === "comment_create"
				? "COMMENT_RATE_LIMITED"
				: input.action === "page_like"
					? "PAGE_FEEDBACK_RATE_LIMITED"
					: "VOTE_RATE_LIMITED",
		);
	}
	public remember(
		siteKey: string,
		ip: string,
		subject: string,
		lifetimeSec = 3600,
		now = Date.now(),
	) {
		for (const [key, subjects] of this.subjectsByIp) {
			for (const [subjectId, expiresAt] of subjects)
				if (expiresAt <= now) subjects.delete(subjectId);
			if (!subjects.size) this.subjectsByIp.delete(key);
		}
		const key = `${siteKey}:${ip}`;
		const subjects = this.subjectsByIp.get(key) ?? new Map<string, number>();
		subjects.set(
			subject,
			Math.max(subjects.get(subject) ?? 0, now + lifetimeSec * 1000),
		);
		this.subjectsByIp.set(key, subjects);
	}
	public async prune(siteId: number, now = Date.now()) {
		if (now - (this.prunedAt.get(siteId) ?? 0) < 86400000) return;
		const [settings] = await this.db
			.select()
			.from(siteSettings)
			.where(eq(siteSettings.siteId, siteId))
			.limit(1);
		await new AbuseRepository(this.db).pruneExpired(
			siteId,
			readAbusePolicy(settings?.abusePolicyJson),
			now,
		);
		this.prunedAt.set(siteId, now);
	}

	public async recordViolation(input: {
		siteId: number;
		siteKey: string;
		ip?: string;
		reason: string;
		visitorKey?: string;
		email?: string;
		now?: number;
	}) {
		if (!input.ip) return;
		const now = input.now ?? Date.now();
		await this.prune(input.siteId, now);
		for (const [key, summary] of this.violations)
			if (summary.resetAt <= now) this.violations.delete(key);
		const [settings] = await this.db
			.select()
			.from(siteSettings)
			.where(eq(siteSettings.siteId, input.siteId))
			.limit(1);
		if (
			!settings?.abuseGuardEnabled ||
			!settings.autoBlacklistEnabled ||
			(await this.isIpAllowlisted(input.siteKey, input.ip, undefined, input))
		)
			return;
		const policy = readAbusePolicy(settings.abusePolicyJson);
		const key = `${input.siteKey}:${input.ip}:${input.reason}`;
		const summary = this.violations.get(key) ?? {
			count: 0,
			resetAt: now + policy.violationWindowSec * 1000,
		};
		summary.count = Math.min(summary.count + 1, policy.violationThreshold);
		this.violations.set(key, summary);
		if (summary.count < policy.violationThreshold) return;
		await new AbuseRepository(this.db).createPenalty({
			...input,
			violationObservedAt: now,
			ip: input.ip,
			scope: settings.autoBlacklistScope as "post" | "all",
			policy,
			count: summary.count,
		});
	}

	public async assertCommitAllowed(
		tx: DatabaseExecutor,
		input: {
			siteId: number;
			siteKey: string;
			ip?: string;
			visitorKey?: string;
			email?: string;
		},
	) {
		if (
			input.ip &&
			(await this.isIpAllowlisted(input.siteKey, input.ip, tx, input))
		)
			return;
		await new AbuseRepository(tx).assertAllowed(input.siteId, input.ip);
	}

	public reset(siteKey: string, ip: string) {
		const subjects = [
			...(this.subjectsByIp.get(`${siteKey}:${ip}`)?.keys() ?? []),
		];
		this.quotas.resetPrefix(`write:${siteKey}:ip:${ip}:`);
		for (const subject of this.subjectsByIp.get(`${siteKey}:${ip}`)?.keys() ??
			[])
			this.quotas.resetPrefix(`write:${siteKey}:subject:${subject}:`);
		this.subjectsByIp.delete(`${siteKey}:${ip}`);
		for (const key of this.violations.keys())
			if (key.startsWith(`${siteKey}:${ip}:`)) this.violations.delete(key);
		return subjects;
	}
}
