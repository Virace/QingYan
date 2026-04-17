import { randomInt, randomUUID } from "node:crypto";

interface AdminLoginChallenge {
	answer: string;
	expiresAt: number;
	imageData: string;
	ip?: string;
}

function createSvgDataUrl(answer: string): string {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60" viewBox="0 0 160 60"><rect width="160" height="60" rx="8" fill="#f6f1e7"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="28" font-family="monospace" fill="#1f2937">${answer}</text></svg>`;
	return `data:image/svg+xml;base64,${Buffer.from(svg, "utf-8").toString("base64")}`;
}

function createChallengeAnswer(): string {
	return `${randomInt(1000, 9999)}`;
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

		const answer = createChallengeAnswer();
		const challengeId = `admcap_${randomUUID().replaceAll("-", "")}`;
		const expiresAt = Date.now() + this.ttlSec * 1000;
		const imageData = createSvgDataUrl(answer);

		this.challenges.set(challengeId, {
			answer,
			expiresAt,
			imageData,
			ip,
		});

		return {
			challengeId,
			expiresAt: new Date(expiresAt).toISOString(),
			imageData,
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
