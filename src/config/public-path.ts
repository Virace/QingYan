export const DEFAULT_PUBLIC_PATH = "/qingyan";

function publicPathError(reason: string): Error {
	return new Error(`server.publicPath ${reason}`);
}

function assertSafePathInput(value: string, fieldName: string): void {
	if (
		Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code < 0x20 || code === 0x7f;
		})
	) {
		throw publicPathError(`${fieldName} must not contain control characters.`);
	}
	if (value.includes("\\") || value.includes("?") || value.includes("#")) {
		throw publicPathError(
			`${fieldName} must be a URL path without query or hash.`,
		);
	}
	if (value.includes("%")) {
		throw publicPathError(`${fieldName} must not contain encoded characters.`);
	}
}

function normalizePathSegments(value: string, fieldName: string): string[] {
	assertSafePathInput(value, fieldName);
	const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
	if (/^\/+$/.test(withLeadingSlash)) {
		throw publicPathError(`${fieldName} must be a non-root path.`);
	}
	if (withLeadingSlash.includes("//")) {
		throw publicPathError(`${fieldName} must not contain empty segments.`);
	}
	const trimmed = withLeadingSlash.replace(/\/+$/u, "");
	const segments = trimmed.split("/").slice(1);
	if (
		segments.length === 0 ||
		segments.some((segment) => segment === "." || segment === "..")
	) {
		throw publicPathError(`${fieldName} must not contain dot segments.`);
	}
	return segments;
}

export function normalizePublicPath(input: string | undefined): string {
	const trimmedInput = (input ?? "").trim();
	if (trimmedInput === "") {
		return DEFAULT_PUBLIC_PATH;
	}
	return `/${normalizePathSegments(trimmedInput, "value").join("/")}`;
}

function normalizeRoutePath(routePath: string): string[] {
	const trimmedRoutePath = routePath.trim();
	if (trimmedRoutePath === "" || trimmedRoutePath === "/") {
		return [];
	}
	return normalizePathSegments(trimmedRoutePath, "routePath");
}

export function joinPublicPath(publicPath: string, routePath: string): string {
	const publicSegments = normalizePathSegments(publicPath, "value");
	const routeSegments = normalizeRoutePath(routePath);
	return `/${[...publicSegments, ...routeSegments].join("/")}`;
}

export function stripPublicPath(
	publicPath: string,
	requestPath: string,
): string | null {
	const normalizedPublicPath = normalizePublicPath(publicPath);
	if (requestPath === normalizedPublicPath) {
		return "/";
	}
	if (requestPath.startsWith(`${normalizedPublicPath}/`)) {
		return requestPath.slice(normalizedPublicPath.length);
	}
	return null;
}

export function buildPublicUrl(
	publicBaseUrl: string,
	publicPath: string,
	routePath: string,
): string {
	const base = publicBaseUrl.replace(/\/+$/u, "");
	return `${base}${joinPublicPath(publicPath, routePath)}`;
}

export function qingyanCookiePath(publicPath: string): string {
	return normalizePublicPath(publicPath);
}
