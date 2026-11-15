import { randomUUID } from "node:crypto";
import { AppError } from "./errors";
import type { RateLimitRule } from "./rate-limit";

type QuotaBucket = { committed: number; resetAt: number; pending: Set<string> };
export type WriteQuotaRule = { key: string; rule: RateLimitRule };
export interface WriteQuotaLease {
	id: string;
	assertActive(): void;
	commit(): void;
	release(): void;
}

export class MemoryWriteQuotaStore {
	private readonly buckets = new Map<string, QuotaBucket>();
	private readonly leases = new Map<
		string,
		{ expiresAt: number; keys: string[] }
	>();

	public reserve(
		rules: WriteQuotaRule[],
		errorCode: string,
		now = Date.now(),
	): WriteQuotaLease {
		this.clearExpired(now);
		const checked = rules.map(({ key, rule }) => {
			const current = this.buckets.get(key);
			const bucket =
				current && current.resetAt > now
					? current
					: {
							committed: 0,
							resetAt: now + rule.windowSec * 1000,
							pending: new Set<string>(),
						};
			return {
				key,
				bucket,
				limit: rule.maxRequests ?? rule.maxFailures ?? Infinity,
			};
		});
		const full = checked.find(
			({ bucket, limit }) => bucket.committed + bucket.pending.size >= limit,
		);
		if (full)
			throw new AppError(429, errorCode, "提交过于频繁，请稍后再试。", {
				resetAt: full.bucket.resetAt,
				retryAfterSec: Math.max(
					1,
					Math.ceil((full.bucket.resetAt - now) / 1000),
				),
			});
		const id = randomUUID();
		for (const { key, bucket } of checked) {
			bucket.pending.add(id);
			this.buckets.set(key, bucket);
		}
		this.leases.set(id, {
			expiresAt: now + 120000,
			keys: checked.map(({ key }) => key),
		});
		let finished = false;
		const release = (commit: boolean) => {
			if (finished) return;
			finished = true;
			for (const { bucket } of checked)
				if (bucket.pending.delete(id) && commit) bucket.committed += 1;
			this.leases.delete(id);
		};
		return {
			id,
			assertActive: () => {
				if (finished || (this.leases.get(id)?.expiresAt ?? 0) <= Date.now())
					throw new AppError(429, errorCode, "本次操作已过期，请重新提交。", {
						retryAfterSec: 1,
					});
			},
			commit: () => release(true),
			release: () => release(false),
		};
	}

	public resetPrefix(prefix: string) {
		for (const [id, lease] of this.leases)
			if (lease.keys.some((key) => key.startsWith(prefix))) {
				for (const key of lease.keys) this.buckets.get(key)?.pending.delete(id);
				this.leases.delete(id);
			}
		for (const key of this.buckets.keys())
			if (key.startsWith(prefix)) this.buckets.delete(key);
	}
	public clearExpired(now = Date.now()) {
		for (const [id, lease] of this.leases)
			if (lease.expiresAt <= now) {
				for (const key of lease.keys) this.buckets.get(key)?.pending.delete(id);
				this.leases.delete(id);
			}
		for (const [key, bucket] of this.buckets)
			if (bucket.resetAt <= now && bucket.pending.size === 0)
				this.buckets.delete(key);
	}
}
