import {
	EditIcon,
	HistoryIcon,
	PlayIcon,
	PowerIcon,
	PowerOffIcon,
	Trash2Icon,
} from "lucide-react";

import type { ScheduledTaskProjection, TaskTypeDefinition } from "@/api/tasks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { EmptyState } from "../shared/admin-ui";
import { formatAdminDateTime } from "../shared/time-format";
import {
	scheduleKindLabels,
	TaskStatusBadge,
	taskTypeLabel,
} from "./task-status-badge";

function scheduleSummary(task: ScheduledTaskProjection): string {
	if (task.scheduleKind === "cron") {
		return task.cronExpression ? `Cron ${task.cronExpression}` : "Cron";
	}
	if (task.schedulePreset) {
		return `${scheduleKindLabels[task.scheduleKind] ?? task.scheduleKind} / ${task.schedulePreset}`;
	}
	return scheduleKindLabels[task.scheduleKind] ?? task.scheduleKind;
}

function scopeSummary(task: ScheduledTaskProjection): string {
	if (task.scopeKind === "global") {
		return "全局";
	}
	if (task.scopeKind === "site") {
		return task.siteId ? `站点 #${task.siteId}` : "站点";
	}
	return task.scopeKind;
}

export function TaskDefinitionTable({
	tasks,
	definitions,
	busyTaskId,
	highlightTaskId,
	onEdit,
	onRun,
	onEnable,
	onDisable,
	onDelete,
	onViewRuns,
}: {
	tasks: ScheduledTaskProjection[];
	definitions: TaskTypeDefinition[];
	busyTaskId?: string | null;
	highlightTaskId?: string | null;
	onEdit: (task: ScheduledTaskProjection) => void;
	onRun: (task: ScheduledTaskProjection) => void;
	onEnable: (task: ScheduledTaskProjection) => void;
	onDisable: (task: ScheduledTaskProjection) => void;
	onDelete: (task: ScheduledTaskProjection) => void;
	onViewRuns: (task: ScheduledTaskProjection) => void;
}) {
	const labels = new Map(definitions.map((item) => [item.type, item.label]));

	if (tasks.length === 0) {
		return <EmptyState text="暂无计划任务" />;
	}

	return (
		<div className="overflow-x-auto rounded-md border">
			<table className="w-full min-w-[1080px] text-sm">
				<thead className="bg-muted/50 text-xs text-muted-foreground">
					<tr className="border-b">
						<th className="px-3 py-2 text-left font-medium">任务</th>
						<th className="px-3 py-2 text-left font-medium">范围</th>
						<th className="px-3 py-2 text-left font-medium">调度</th>
						<th className="px-3 py-2 text-left font-medium">下次运行</th>
						<th className="px-3 py-2 text-left font-medium">最近状态</th>
						<th className="px-3 py-2 text-left font-medium">Owner</th>
						<th className="px-3 py-2 text-right font-medium">操作</th>
					</tr>
				</thead>
				<tbody>
					{tasks.map((task) => {
						const busy = busyTaskId === task.id;
						return (
							<tr
								key={task.id}
								className={
									task.id === highlightTaskId
										? "border-b bg-primary/5"
										: "border-b last:border-0"
								}
							>
								<td className="px-3 py-3 align-top">
									<div className="grid gap-1">
										<div className="flex flex-wrap items-center gap-2">
											<span className="font-medium">{task.name}</span>
											<Badge variant={task.enabled ? "secondary" : "outline"}>
												{task.enabled ? "启用" : "停用"}
											</Badge>
											{task.systemManaged ? (
												<Badge variant="outline">系统托管</Badge>
											) : null}
											{task.visibility === "summary" ? (
												<Badge variant="outline">摘要</Badge>
											) : null}
										</div>
										<p className="text-xs text-muted-foreground">
											{labels.get(task.type) ?? taskTypeLabel(task.type)}
										</p>
										{task.description ? (
											<p className="max-w-[22rem] truncate text-xs text-muted-foreground">
												{task.description}
											</p>
										) : null}
										{task.protectedReason ? (
											<p className="max-w-[24rem] truncate text-xs text-muted-foreground">
												{task.protectedReason}
											</p>
										) : null}
									</div>
								</td>
								<td className="px-3 py-3 align-top">{scopeSummary(task)}</td>
								<td className="px-3 py-3 align-top">{scheduleSummary(task)}</td>
								<td className="px-3 py-3 align-top">
									{formatAdminDateTime(task.nextRunAt)}
								</td>
								<td className="px-3 py-3 align-top">
									<div className="grid gap-1">
										<TaskStatusBadge
											status={task.lastStatus}
											enabled={task.enabled}
										/>
										<span className="text-xs text-muted-foreground">
											{formatAdminDateTime(task.lastRunAt)}
										</span>
									</div>
								</td>
								<td className="px-3 py-3 align-top">
									<div className="grid gap-1 text-xs">
										<span>
											{task.ownerDisplayName ?? `#${task.ownerUserId}`}
										</span>
										<span className="text-muted-foreground">
											更新 #{task.updatedByUserId ?? "-"}
										</span>
									</div>
								</td>
								<td className="px-3 py-3 align-top">
									<div className="flex flex-wrap justify-end gap-2">
										<Button
											type="button"
											size="sm"
											variant="outline"
											disabled={!task.canRun || busy}
											onClick={() => onRun(task)}
											aria-label="立即运行"
										>
											<PlayIcon data-icon="inline-start" />
											运行
										</Button>
										<Button
											type="button"
											size="sm"
											variant="outline"
											disabled={busy}
											onClick={() => onViewRuns(task)}
											aria-label="查看运行记录"
										>
											<HistoryIcon data-icon="inline-start" />
											记录
										</Button>
										<Button
											type="button"
											size="sm"
											variant="outline"
											disabled={!task.canManage || busy}
											onClick={() => onEdit(task)}
											aria-label="编辑任务"
										>
											<EditIcon data-icon="inline-start" />
											编辑
										</Button>
										<Button
											type="button"
											size="sm"
											variant="outline"
											disabled={!task.canManage || !task.canDisable || busy}
											onClick={() =>
												task.enabled ? onDisable(task) : onEnable(task)
											}
											aria-label={task.enabled ? "停用任务" : "启用任务"}
										>
											{task.enabled ? (
												<PowerOffIcon data-icon="inline-start" />
											) : (
												<PowerIcon data-icon="inline-start" />
											)}
											{task.enabled ? "停用" : "启用"}
										</Button>
										<Button
											type="button"
											size="sm"
											variant="destructive"
											disabled={!task.canManage || !task.canDelete || busy}
											onClick={() => onDelete(task)}
											aria-label="删除任务"
										>
											<Trash2Icon data-icon="inline-start" />
											删除
										</Button>
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
