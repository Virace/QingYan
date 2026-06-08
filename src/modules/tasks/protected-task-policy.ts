export interface ProtectedTaskPolicy {
	kind: string;
	managedBy: string;
	lockedDelete?: boolean;
	lockedDisable?: boolean;
	lockedOwnerTransfer?: boolean;
	lockedType?: boolean;
	lockedSite?: boolean;
	lockedPayloadPaths?: string[];
	editablePayloadPaths?: string[];
	editableFields?: string[];
}

export type ProtectedTaskOperation =
	| "delete"
	| "disable"
	| "transfer_owner"
	| "update";

const DEFAULT_PROTECTED_REASON =
	"该任务由系统托管，用于维持系统不变量，当前操作受保护。";

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

export function parseProtectedTaskPolicy(
	value: unknown,
): ProtectedTaskPolicy | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.kind !== "string" || typeof record.managedBy !== "string") {
		return null;
	}
	return {
		kind: record.kind,
		managedBy: record.managedBy,
		lockedDelete: record.lockedDelete === true,
		lockedDisable: record.lockedDisable === true,
		lockedOwnerTransfer: record.lockedOwnerTransfer === true,
		lockedType: record.lockedType === true,
		lockedSite: record.lockedSite === true,
		lockedPayloadPaths: isStringArray(record.lockedPayloadPaths)
			? record.lockedPayloadPaths
			: [],
		editablePayloadPaths: isStringArray(record.editablePayloadPaths)
			? record.editablePayloadPaths
			: [],
		editableFields: isStringArray(record.editableFields)
			? record.editableFields
			: [],
	};
}

export function protectedTaskReason(
	policy: ProtectedTaskPolicy | null,
): string {
	if (!policy) {
		return "";
	}
	if (policy.kind === "authoritative_page_source_refresh") {
		return "页面来源权威模式需要保持 sitemap 刷新任务可执行。";
	}
	return DEFAULT_PROTECTED_REASON;
}

export function protectedOperationReason(
	policy: ProtectedTaskPolicy | null,
	operation: ProtectedTaskOperation,
): string {
	const reason = protectedTaskReason(policy);
	if (!reason) {
		return "";
	}
	switch (operation) {
		case "delete":
			return `${reason}不能删除。`;
		case "disable":
			return `${reason}不能停用。`;
		case "transfer_owner":
			return `${reason}不能转移 owner。`;
		case "update":
			return `${reason}部分字段不能修改。`;
	}
}

export function readPath(source: unknown, path: string): unknown {
	return path.split(".").reduce<unknown>((current, segment) => {
		if (!current || typeof current !== "object") {
			return undefined;
		}
		return (current as Record<string, unknown>)[segment];
	}, source);
}

export function setPath(
	source: Record<string, unknown>,
	path: string,
	value: unknown,
): Record<string, unknown> {
	const clone = structuredClone(source);
	const segments = path.split(".");
	let current: Record<string, unknown> = clone;
	for (const segment of segments.slice(0, -1)) {
		const next = current[segment];
		if (!next || typeof next !== "object" || Array.isArray(next)) {
			current[segment] = {};
		}
		current = current[segment] as Record<string, unknown>;
	}
	current[segments[segments.length - 1] ?? path] = value;
	return clone;
}

export function isJsonEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
