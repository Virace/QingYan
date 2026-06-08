import type { z } from "zod";

import type { ValidationFieldError } from "../shared/errors";

function readPathValue(source: unknown, path: PropertyKey[]) {
	let value = source;
	for (const segment of path) {
		if (value === null || typeof value !== "object") {
			return undefined;
		}
		value = (value as Record<PropertyKey, unknown>)[segment];
	}
	return value;
}

function describeReceived(value: unknown): string {
	if (value === null) {
		return "null";
	}
	if (Array.isArray(value)) {
		return "array";
	}
	return typeof value;
}

export function toValidationFields(
	issues: z.core.$ZodIssue[],
	source: unknown,
): ValidationFieldError[] {
	return issues.map((issue) => {
		const path = issue.path.join(".");
		const expected = "expected" in issue ? String(issue.expected) : undefined;
		return {
			path,
			code: issue.code,
			expected,
			received: describeReceived(readPathValue(source, issue.path)),
			message:
				issue.code === "invalid_type" && expected === "boolean"
					? "必须是 JSON boolean，不能使用 0/1。"
					: issue.message,
		};
	});
}
