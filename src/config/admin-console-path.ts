const RESERVED_ADMIN_PATHS = new Set([
	"/api",
	"/api/admin",
	"/api/comments",
	"/api/dev",
	"/comments",
	"/docs",
	"/healthz",
	"/openapi.json",
	"/openapi.yaml",
]);

const ADMIN_PATH_PATTERN = /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

export function isReservedAdminPath(pathname: string): boolean {
	if (RESERVED_ADMIN_PATHS.has(pathname)) {
		return true;
	}

	return [...RESERVED_ADMIN_PATHS].some((reserved) =>
		pathname.startsWith(`${reserved}/`),
	);
}

export function validateAdminConsolePath(pathname: string): string | null {
	if (pathname === "/") {
		return "admin.console.path cannot be root path";
	}
	if (!pathname.startsWith("/")) {
		return "admin.console.path must start with /";
	}
	if (pathname.endsWith("/")) {
		return "admin.console.path must not end with /";
	}
	if (!ADMIN_PATH_PATTERN.test(pathname)) {
		return "admin.console.path only supports safe path segments";
	}
	if (isReservedAdminPath(pathname)) {
		return "admin.console.path conflicts with a reserved system route";
	}

	return null;
}

export function assertAdminConsolePath(pathname: string): void {
	const error = validateAdminConsolePath(pathname);
	if (error) {
		throw new Error(error);
	}
}
