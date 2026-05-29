export function getPathValue(source: unknown, path: string) {
	return path.split(".").reduce<unknown>((current, segment) => {
		if (!current || typeof current !== "object") {
			return undefined;
		}
		return (current as Record<string, unknown>)[segment];
	}, source);
}

export function setPathValue(
	target: Record<string, unknown>,
	path: string,
	value: unknown,
) {
	const segments = path.split(".");
	let cursor = target;
	for (const segment of segments.slice(0, -1)) {
		const next = cursor[segment];
		if (!next || typeof next !== "object" || Array.isArray(next)) {
			cursor[segment] = {};
		}
		cursor = cursor[segment] as Record<string, unknown>;
	}
	cursor[segments[segments.length - 1] ?? path] = value;
}
