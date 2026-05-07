export interface GravatarUrlInput {
	enabled: boolean;
	emailHash?: string | null;
	baseUrl: string;
}

export function normalizeGravatarBaseUrl(baseUrl: string): string {
	let parsed: URL;
	try {
		parsed = new URL(baseUrl);
	} catch {
		throw new Error("Invalid Gravatar base URL");
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("Gravatar base URL must use http or https");
	}

	const normalized = parsed.toString().replace(/\/+$/u, "");
	if (!normalized) {
		throw new Error("Invalid Gravatar base URL");
	}

	return normalized;
}

export function buildGravatarUrl(input: GravatarUrlInput): string | undefined {
	if (!input.enabled || !input.emailHash) {
		return undefined;
	}

	const baseUrl = normalizeGravatarBaseUrl(input.baseUrl);
	return `${baseUrl}/${input.emailHash}?s=80&d=404&r=g`;
}
