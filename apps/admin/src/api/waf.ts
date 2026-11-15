import { requestJson } from "./client";

export interface WafSyncItem {
	id: string;
	ip: string;
	localState: "active" | "released" | "expired";
	expiresAt: string;
	wafState: "unknown" | "present" | "absent" | "conflict";
	syncState: "pending" | "synced" | "failed" | "conflict";
	reasonCode: string | null;
	lastSyncedAt: string | null;
	lastAttemptAt: string | null;
	suspended: boolean;
	updatedAt: string;
}
export interface WafSyncPage {
	items: WafSyncItem[];
	totalCount: number;
	limit: number;
	offset: number;
	configured: boolean;
	paused: boolean;
	evidence: { lastPollAt: string | null; gapReason: string | null } | null;
	capabilities: { retry: boolean; release: boolean };
}

export function listWafSync(siteKey: string, limit: number, offset: number) {
	return requestJson<WafSyncPage>(
		`/api/admin/waf?${new URLSearchParams({ siteKey, limit: String(limit), offset: String(offset) })}`,
	);
}
export function actOnWafSync(
	id: string,
	action: "release" | "retry" | "resume",
	reason?: string,
) {
	return requestJson<{
		accepted: boolean;
		panelSync: "pending" | "paused" | "review_required";
	}>(`/api/admin/waf/${encodeURIComponent(id)}/${action}`, {
		method: "POST",
		body: JSON.stringify({ reason }),
	});
}
