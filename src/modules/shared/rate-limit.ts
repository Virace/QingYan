export interface RateLimitRule {
	windowSec: number;
	maxRequests?: number;
	maxFailures?: number;
	autoBlacklistSec?: number;
}

export interface RateLimitSnapshot {
	key: string;
	count: number;
	limit: number | null;
	remaining: number | null;
	resetAt: number;
}

interface RateLimitBucket {
	count: number;
	resetAt: number;
}

function resolveLimit(rule: RateLimitRule): number | null {
	return rule.maxRequests ?? rule.maxFailures ?? null;
}

export class MemoryRateLimitStore {
	private readonly buckets = new Map<string, RateLimitBucket>();

	public peek(
		key: string,
		rule: RateLimitRule,
		now = Date.now(),
	): RateLimitSnapshot {
		const windowMs = rule.windowSec * 1000;
		const limit = resolveLimit(rule);
		const bucket = this.buckets.get(key);

		if (!bucket || bucket.resetAt <= now) {
			return {
				key,
				count: 0,
				limit,
				remaining: limit,
				resetAt: now + windowMs,
			};
		}

		return {
			key,
			count: bucket.count,
			limit,
			remaining: limit === null ? null : Math.max(limit - bucket.count, 0),
			resetAt: bucket.resetAt,
		};
	}

	public consume(
		key: string,
		rule: RateLimitRule,
		now = Date.now(),
		increment = 1,
	): RateLimitSnapshot {
		const snapshot = this.peek(key, rule, now);
		const limit = snapshot.limit;

		if (limit !== null && snapshot.count + increment > limit) {
			const error = new Error("RATE_LIMIT_EXCEEDED");
			(error as Error & { resetAt: number }).resetAt = snapshot.resetAt;
			throw error;
		}

		this.buckets.set(key, {
			count: snapshot.count + increment,
			resetAt: snapshot.resetAt,
		});

		return this.peek(key, rule, now);
	}

	public clearExpired(now = Date.now()): void {
		for (const [key, bucket] of this.buckets.entries()) {
			if (bucket.resetAt <= now) {
				this.buckets.delete(key);
			}
		}
	}
}
