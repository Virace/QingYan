import { randomUUID } from "node:crypto";

import { createCaptchaChallenge } from "../shared/captcha-challenge";

interface AdminLoginChallenge {
	answer: string;
	expiresAt: number;
	imageData: string;
	ip?: string;
}

export class AdminLoginChallengeStore {
	private readonly challenges = new Map<string, AdminLoginChallenge>();

	public constructor(private readonly ttlSec: number) {}

	private clearExpired(now = Date.now()): void {
		for (const [challengeId, challenge] of this.challenges.entries()) {
			if (challenge.expiresAt <= now) {
				this.challenges.delete(challengeId);
			}
		}
	}

	public create(ip?: string) {
		this.clearExpired();

		const challenge = createCaptchaChallenge();
		const challengeId = `admcap_${randomUUID().replaceAll("-", "")}`;
		const expiresAt = Date.now() + this.ttlSec * 1000;

		this.challenges.set(challengeId, {
			answer: challenge.answer,
			expiresAt,
			imageData: challenge.imageData,
			ip,
		});

		return {
			challengeId,
			expiresAt: new Date(expiresAt).toISOString(),
			imageData: challenge.imageData,
		};
	}

	public verify(input: {
		challengeId?: string;
		ip?: string;
		value?: string;
	}): "required" | "invalid" | "verified" {
		this.clearExpired();

		if (!input.challengeId || !input.value?.trim()) {
			return "required";
		}

		const challenge = this.challenges.get(input.challengeId);
		this.challenges.delete(input.challengeId);

		if (!challenge) {
			return "required";
		}

		if (challenge.ip && input.ip && challenge.ip !== input.ip) {
			return "invalid";
		}

		if (challenge.answer !== input.value.trim()) {
			return "invalid";
		}

		return "verified";
	}
}
