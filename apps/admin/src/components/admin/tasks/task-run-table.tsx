import { RotateCcwIcon, ScrollTextIcon, StopCircleIcon } from "lucide-react";

import type { TaskRunProjection, TaskTypeDefinition } from "@/api/tasks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { EmptyState } from "../shared/admin-ui";
import { formatAdminDateTime } from "../shared/time-format";
import { TaskStatusBadge, taskTypeLabel } from "./task-status-badge";

function durationLabel(run: TaskRunProjection): string {
	if (!run.startedAt || !run.finishedAt) {
		return "-";
	}
	const started = new Date(run.startedAt).getTime();
	const finished = new Date(run.finishedAt).getTime();
	if (!Number.isFinite(started) || !Number.isFinite(finished)) {
		return "-";
	}
	const seconds = Math.max(0, Math.round((finished - started) / 1000));
	return `${seconds}s`;
}

function reasonSummary(run: TaskRunProjection): string {
	if (run.blockReason) {
		return run.blockReason;
	}
	if (run.skipReason) {
		return run.skipReason;
	}
	if (
		run.error &&
		typeof run.error === "object" &&
		"code" in run.error &&
		typeof run.error.code === "string"
	) {
		return run.error.code;
	}
	return "-";
}

export function TaskRunTable({
	runs,
	definitions,
	busyRunId,
	onOpenDetail,
	onCancel,
	onRetry,
}: {
	runs: TaskRunProjection[];
	definitions: TaskTypeDefinition[];
	busyRunId?: string | null;
	onOpenDetail: (run: TaskRunProjection) => void;
	onCancel: (run: TaskRunProjection) => void;
	onRetry: (run: TaskRunProjection) => void;
}) {
	const labels = new Map(definitions.map((item) => [item.type, item.label]));

	if (runs.length === 0) {
		return <EmptyState text="暂无运行记录" />;
	}

	return (
		<div className="overflow-x-auto rounded-md border">
			<table className="w-full min-w-[1040px] text-sm">
				<thead className="bg-muted/50 text-xs text-muted-foreground">
					<tr className="border-b">
						<th className="px-3 py-2 text-left font-medium">类型</th>
						<th className="px-3 py-2 text-left font-medium">计划任务</th>
						<th className="px-3 py-2 text-left font-medium">触发</th>
						<th className="px-3 py-2 text-left font-medium">状态</th>
						<th className="px-3 py-2 text-left font-medium">站点</th>
						<th className="px-3 py-2 text-left font-medium">时间</th>
						<th className="px-3 py-2 text-left font-medium">尝试</th>
						<th className="px-3 py-2 text-left font-medium">原因</th>
						<th className="px-3 py-2 text-right font-medium">操作</th>
					</tr>
				</thead>
				<tbody>
					{runs.map((run) => {
						const busy = busyRunId === run.id;
						const isNotification = run.category === "notification";
						const typeLabel =
							run.workflow ?? labels.get(run.type) ?? taskTypeLabel(run.type);
						return (
							<tr key={run.id} className="border-b last:border-0">
								<td className="px-3 py-3 align-top">
									<div className="grid gap-1">
										<span className="font-medium">{typeLabel}</span>
										<span className="text-xs text-muted-foreground">
											{isNotification ? "邮件通知" : run.category}
										</span>
									</div>
								</td>
								<td className="px-3 py-3 align-top">
									<div className="grid gap-1">
										<span>
											{run.scheduledTaskNameSnapshot ??
												(isNotification ? "评论通知" : "-")}
										</span>
										<span className="text-xs text-muted-foreground">
											{isNotification
												? "邮件"
												: (run.scheduledTaskId ?? "临时运行")}
										</span>
									</div>
								</td>
								<td className="px-3 py-3 align-top">
									{isNotification ? "评论事件" : (run.trigger ?? "-")}
								</td>
								<td className="px-3 py-3 align-top">
									<TaskStatusBadge status={run.status} />
								</td>
								<td className="px-3 py-3 align-top">
									{run.siteKey ?? (run.siteId ? `#${run.siteId}` : "全局")}
								</td>
								<td className="px-3 py-3 align-top">
									<div className="grid gap-1 text-xs">
										<span>创建 {formatAdminDateTime(run.createdAt)}</span>
										<span>开始 {formatAdminDateTime(run.startedAt)}</span>
										<span>结束 {formatAdminDateTime(run.finishedAt)}</span>
										<span>耗时 {durationLabel(run)}</span>
									</div>
								</td>
								<td className="px-3 py-3 align-top">
									{run.attempts === undefined
										? "-"
										: `${run.attempts}/${run.maxAttempts}`}
								</td>
								<td className="px-3 py-3 align-top">
									<span className="line-clamp-2 max-w-[14rem] text-xs text-muted-foreground">
										{reasonSummary(run)}
									</span>
								</td>
								<td className="px-3 py-3 align-top">
									<div className="flex flex-wrap justify-end gap-2">
										<Button
											type="button"
											size="sm"
											variant="outline"
											disabled={busy}
											onClick={() => onOpenDetail(run)}
										>
											<ScrollTextIcon data-icon="inline-start" />
											详情
										</Button>
										<Button
											type="button"
											size="sm"
											variant="outline"
											disabled={
												!run.canViewLogs ||
												busy ||
												!["queued", "delayed", "running", "retrying"].includes(
													run.status,
												)
											}
											onClick={() => onCancel(run)}
										>
											<StopCircleIcon data-icon="inline-start" />
											取消
										</Button>
										<Button
											type="button"
											size="sm"
											variant="outline"
											disabled={
												!run.canViewLogs ||
												busy ||
												!["failed", "blocked", "cancelled"].includes(run.status)
											}
											onClick={() => onRetry(run)}
										>
											<RotateCcwIcon data-icon="inline-start" />
											重试
										</Button>
										{run.visibility === "run_summary" ? (
											<Badge variant="outline">摘要</Badge>
										) : null}
									</div>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
