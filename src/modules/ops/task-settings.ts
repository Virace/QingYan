import type { MaintenanceJobType } from "./maintenance-job-repository";

export interface TaskQueueSettings {
	maxConcurrentTotal: number;
	maxConcurrentByType: Partial<Record<MaintenanceJobType, number>>;
	defaultRetry: {
		maxAttempts: number;
		retryDelaySec: number;
	};
	pageTitleRefresh: {
		batchSize: number;
		timeoutMs: number;
		maxBytes: number;
	};
}

export const defaultTaskQueueSettings: TaskQueueSettings = {
	maxConcurrentTotal: 2,
	maxConcurrentByType: {
		page_metadata_refresh: 2,
		page_source_refresh: 1,
		comment_ip_refresh: 1,
		ip_region_update: 1,
	},
	defaultRetry: {
		maxAttempts: 2,
		retryDelaySec: 30,
	},
	pageTitleRefresh: {
		batchSize: 50,
		timeoutMs: 8_000,
		maxBytes: 512 * 1024,
	},
};
