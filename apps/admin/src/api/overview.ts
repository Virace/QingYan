import { requestJson } from "./client";

export interface AdminOverview {
	console: {
		path: string;
	};
	runtime: {
		devMode: boolean;
	};
	stats: {
		siteCount: number;
		pageCount: number;
		commentCount: number;
		pendingCommentCount: number;
		commenterCount: number;
		visitorCount: number;
		blacklistRuleCount: number;
	};
	logging: {
		level: string;
		retentionDays: number;
		directory: string;
	};
}

export function fetchAdminOverview() {
	return requestJson<AdminOverview>("/api/admin/overview");
}
