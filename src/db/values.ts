import { createHash } from "node:crypto";

export function toSafeInteger(value: string | number | bigint): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number)) {
		throw new RangeError(
			"Database integer exceeds the JavaScript safe integer range",
		);
	}
	return number;
}

/** 保留微秒部分，避免经 Date 往返把数据库时间截断到毫秒。 */
export function toUtcTimestamp(value: string): string {
	const match =
		/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(
			value,
		);
	if (!match) throw new TypeError("Invalid database timestamp");
	const fraction = match[3] ?? "";
	let zone = match[4] ?? "Z";
	if (/^[+-]\d{2}$/.test(zone)) zone += ":00";
	const date = new Date(`${match[1]}T${match[2]}${zone}`);
	if (!Number.isFinite(date.getTime()))
		throw new TypeError("Invalid database timestamp");
	const precision = fraction.length > 3 ? 6 : 3;
	return `${date.toISOString().slice(0, 19)}.${fraction.padEnd(precision, "0")}Z`;
}

export function hashKey(value: string): Buffer {
	return createHash("sha256").update(value, "utf8").digest();
}

export function canonicalJson(value: unknown): string {
	function canonicalize(input: unknown): unknown {
		if (Array.isArray(input)) return input.map(canonicalize);
		if (input !== null && typeof input === "object") {
			return Object.fromEntries(
				Object.keys(input)
					.sort()
					.map((key) => [
						key,
						canonicalize((input as Record<string, unknown>)[key]),
					]),
			);
		}
		return input;
	}
	const json = JSON.stringify(canonicalize(value));
	if (json === undefined) throw new TypeError("Value is not JSON");
	return json;
}

export function hashJson(value: unknown): Buffer {
	return hashKey(canonicalJson(value));
}

export function advisoryLockKey(namespace: string, key: string): string {
	return hashKey(`${namespace}\0${key}`).readBigInt64BE().toString();
}
