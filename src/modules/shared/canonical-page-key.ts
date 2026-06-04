export function deriveCanonicalPageKeyFromPathname(pathname: string): string {
	const normalizedPathname = pathname || "/";
	return normalizedPathname.startsWith("/")
		? normalizedPathname
		: `/${normalizedPathname}`;
}

export function deriveCanonicalPageKeyFromUrl(value: string | URL): string {
	const parsed = typeof value === "string" ? new URL(value) : value;
	return deriveCanonicalPageKeyFromPathname(parsed.pathname);
}
