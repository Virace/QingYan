import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

function hashValue(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function createSessionToken(): string {
	return `as_${randomUUID().replaceAll("-", "")}`;
}

export function createCsrfToken(): string {
	return `csrf_${randomUUID().replaceAll("-", "")}`;
}

export function hashSessionToken(token: string): string {
	return hashValue(token);
}

export function hashCsrfToken(token: string): string {
	return hashValue(token);
}

export function verifyAdminToken(
	rawToken: string,
	configuredTokenHash: string,
): boolean {
	if (configuredTokenHash.startsWith("sha256:")) {
		const expected = Buffer.from(
			configuredTokenHash.slice("sha256:".length),
			"hex",
		);
		const actual = Buffer.from(hashValue(rawToken), "hex");
		return (
			expected.length === actual.length && timingSafeEqual(expected, actual)
		);
	}

	return configuredTokenHash === rawToken;
}
