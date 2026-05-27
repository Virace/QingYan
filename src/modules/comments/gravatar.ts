export interface GravatarUrlInput {
	enabled: boolean;
	emailHash?: string | null;
	baseUrl: string;
	size?: number;
	defaultImage?: GravatarDefaultImage;
	rating?: GravatarRating;
	forceDefault?: boolean;
}

export const gravatarDefaultImages = [
	"404",
	"mp",
	"identicon",
	"monsterid",
	"wavatar",
	"retro",
	"robohash",
	"blank",
] as const;

export const gravatarRatings = ["g", "pg", "r", "x"] as const;

export type GravatarDefaultImage = (typeof gravatarDefaultImages)[number];
export type GravatarRating = (typeof gravatarRatings)[number];

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
	const params = new URLSearchParams({
		s: String(input.size ?? 80),
		d: input.defaultImage ?? "404",
		r: input.rating ?? "g",
	});
	if (input.forceDefault) {
		params.set("f", "y");
	}
	return `${baseUrl}/${input.emailHash}?${params.toString()}`;
}
