function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Object.prototype.toString.call(value) === "[object Object]";
}

function shouldRedactKey(key: string): boolean {
	const normalized = key.toLowerCase();
	return (
		normalized.includes("authorization") ||
		normalized.includes("token") ||
		normalized.includes("cookie") ||
		normalized.includes("session") ||
		normalized.includes("captcha") ||
		normalized.includes("password") ||
		normalized.includes("secret")
	);
}

function sanitizeValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeValue(item));
	}

	if (!isPlainObject(value)) {
		return value;
	}

	return sanitizeLogData(value);
}

export function sanitizeLogData(
	input: Record<string, unknown>,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(input).map(([key, value]) => [
			key,
			shouldRedactKey(key) ? "[REDACTED]" : sanitizeValue(value),
		]),
	);
}
