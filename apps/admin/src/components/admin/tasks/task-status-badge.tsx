import { Badge } from "@/components/ui/badge";

import type { TaskRunStatus } from "@/api/tasks";

const statusLabels: Record<TaskRunStatus, string> = {
	queued: "排队",
	delayed: "延迟",
	running: "运行中",
	retrying: "重试中",
	succeeded: "成功",
	failed: "失败",
	skipped: "跳过",
	blocked: "阻塞",
	suppressed: "抑制",
	cancelled: "取消",
};

export const taskTypeLabels: Record<string, string> = {
	page_source_refresh: "页面来源刷新",
	page_metadata_refresh: "页面 Title 刷新",
	comment_ip_refresh: "评论 IP 刷新",
	ip_region_update: "IP 库更新",
};

export const scheduleKindLabels: Record<string, string> = {
	manual_only: "手动",
	once: "一次",
	interval: "间隔",
	daily: "每日",
	weekly: "每周",
	monthly: "每月",
	cron: "Cron",
};

export function taskTypeLabel(type: string): string {
	return taskTypeLabels[type] ?? type;
}

export function statusLabel(status?: TaskRunStatus | null): string {
	return status ? statusLabels[status] : "未运行";
}

export function TaskStatusBadge({
	status,
	enabled,
}: {
	status?: TaskRunStatus | null;
	enabled?: boolean;
}) {
	if (enabled === false && !status) {
		return <Badge variant="outline">停用</Badge>;
	}
	switch (status) {
		case "succeeded":
			return <Badge variant="secondary">{statusLabels[status]}</Badge>;
		case "failed":
		case "blocked":
			return <Badge variant="destructive">{statusLabels[status]}</Badge>;
		case "running":
		case "retrying":
		case "queued":
		case "delayed":
			return <Badge variant="default">{statusLabels[status]}</Badge>;
		case "skipped":
		case "suppressed":
		case "cancelled":
			return <Badge variant="outline">{statusLabels[status]}</Badge>;
		default:
			return <Badge variant="outline">未运行</Badge>;
	}
}
