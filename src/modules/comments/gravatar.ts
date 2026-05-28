import { createHash } from "node:crypto";

export const externalAvatarHashAlgorithms = ["sha256", "md5"] as const;

export type ExternalAvatarHashAlgorithm =
	(typeof externalAvatarHashAlgorithms)[number];

export interface ExternalAvatarUrlInput {
	enabled: boolean;
	email?: string | null;
	baseUrl: string;
	hashAlgorithm: ExternalAvatarHashAlgorithm;
	query: string;
}

export function normalizeExternalAvatarBaseUrl(baseUrl: string): string {
	let parsed: URL;
	try {
		parsed = new URL(baseUrl);
	} catch {
		throw new Error("Invalid external avatar base URL");
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("External avatar base URL must use http or https");
	}

	const normalized = parsed.toString().replace(/\/+$/u, "");
	if (!normalized) {
		throw new Error("Invalid external avatar base URL");
	}

	return normalized;
}

export function validateExternalAvatarQuery(query: string): string {
	const trimmed = query.trim();
	if (trimmed.startsWith("?")) {
		throw new Error("External avatar query must not start with ?");
	}
	if (trimmed.includes("#")) {
		throw new Error("External avatar query must not include #");
	}
	if (/\s/u.test(trimmed)) {
		throw new Error("External avatar query must not include whitespace");
	}

	return trimmed;
}

function hashAvatarEmail(
	email: string,
	algorithm: ExternalAvatarHashAlgorithm,
): string {
	return createHash(algorithm).update(email.trim().toLowerCase()).digest("hex");
}

export function buildExternalAvatarUrl(
	input: ExternalAvatarUrlInput,
): string | undefined {
	if (!input.enabled || !input.email) {
		return undefined;
	}

	const baseUrl = normalizeExternalAvatarBaseUrl(input.baseUrl);
	const hash = hashAvatarEmail(input.email, input.hashAlgorithm);
	const query = validateExternalAvatarQuery(input.query);
	return query ? `${baseUrl}/${hash}?${query}` : `${baseUrl}/${hash}`;
}
