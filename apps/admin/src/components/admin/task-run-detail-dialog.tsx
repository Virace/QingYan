import { Dialog } from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";

import {
	getTaskRun,
	listTaskRunEvents,
	type TaskRunProjection,
} from "@/api/tasks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { EmptyState } from "./admin-ui";
import { formatAdminDateTime } from "./time-format";
import { TaskStatusBadge, taskTypeLabel } from "./task-status-badge";

function JsonBlock({ title, value }: { title: string; value: unknown }) {
	if (value === undefined || value === null) {
		return null;
	}
	return (
		<section className="grid gap-2">
			<h3 className="text-sm font-semibold">{title}</h3>
			<pre className="max-h-56 overflow-auto rounded-md border bg-muted/30 p-3 text-xs leading-5">
				{JSON.stringify(value, null, 2)}
			</pre>
		</section>
	);
}

export function TaskRunDetailDialog({
	open,
	run,
	onOpenChange,
}: {
	open: boolean;
	run: TaskRunProjection | null;
	onOpenChange: (open: boolean) => void;
}) {
	const runQuery = useQuery({
		queryKey: ["admin", "task-run", run?.id],
		queryFn: () => getTaskRun(run?.id ?? ""),
		enabled: open && Boolean(run?.id),
	});
	const eventQuery = useQuery({
		queryKey: ["admin", "task-run-events", run?.id],
		queryFn: () => listTaskRunEvents(run?.id ?? ""),
		enabled: open && Boolean(run?.id) && Boolean(run?.canViewLogs),
	});
	const detail = runQuery.data ?? run;
	const canViewDetail = detail?.visibility === "run_detail";

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Content maxWidth="900px">
				<Dialog.Title>运行详情</Dialog.Title>
				<Dialog.Description size="2">
					{detail
						? `${taskTypeLabel(detail.type)} / ${detail.scheduledTaskNameSnapshot ?? detail.id}`
						: "加载运行记录。"}
				</Dialog.Description>
				{detail ? (
					<div className="mt-4 grid gap-4">
						<div className="grid gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-4">
							<div>
								<p className="text-xs text-muted-foreground">状态</p>
								<div className="mt-1">
									<TaskStatusBadge status={detail.status} />
								</div>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">触发</p>
								<p className="mt-1 text-sm">{detail.trigger ?? "-"}</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">站点</p>
								<p className="mt-1 text-sm">{detail.siteKey ?? "全局"}</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">可见性</p>
								<Badge className="mt-1" variant="outline">
									{detail.visibility === "run_detail" ? "详情" : "摘要"}
								</Badge>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">创建</p>
								<p className="mt-1 text-sm">
									{formatAdminDateTime(detail.createdAt)}
								</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">开始</p>
								<p className="mt-1 text-sm">
									{formatAdminDateTime(detail.startedAt)}
								</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">结束</p>
								<p className="mt-1 text-sm">
									{formatAdminDateTime(detail.finishedAt)}
								</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">尝试</p>
								<p className="mt-1 text-sm">
									{detail.attempts === undefined
										? "-"
										: `${detail.attempts}/${detail.maxAttempts}`}
								</p>
							</div>
						</div>

						{canViewDetail ? (
							<>
								<JsonBlock title="输入" value={detail.input} />
								<JsonBlock title="进度" value={detail.progress} />
								<JsonBlock title="结果" value={detail.result} />
								<JsonBlock title="错误" value={detail.error} />
								<JsonBlock title="触发快照" value={detail.triggerSnapshot} />
								<section className="grid gap-2">
									<h3 className="text-sm font-semibold">事件日志</h3>
									{eventQuery.data?.items.length ? (
										<div className="overflow-x-auto rounded-md border">
											<table className="w-full min-w-[720px] text-sm">
												<thead className="bg-muted/50 text-xs text-muted-foreground">
													<tr className="border-b">
														<th className="px-3 py-2 text-left font-medium">
															时间
														</th>
														<th className="px-3 py-2 text-left font-medium">
															级别
														</th>
														<th className="px-3 py-2 text-left font-medium">
															事件
														</th>
														<th className="px-3 py-2 text-left font-medium">
															消息
														</th>
														<th className="px-3 py-2 text-left font-medium">
															数据
														</th>
													</tr>
												</thead>
												<tbody>
													{eventQuery.data.items.map((event) => (
														<tr
															key={event.id}
															className="border-b last:border-0"
														>
															<td className="px-3 py-2 align-top">
																{formatAdminDateTime(event.createdAt)}
															</td>
															<td className="px-3 py-2 align-top">
																{event.level}
															</td>
															<td className="px-3 py-2 align-top">
																{event.eventType}
															</td>
															<td className="px-3 py-2 align-top">
																{event.message}
															</td>
															<td className="px-3 py-2 align-top">
																<pre className="max-w-[20rem] overflow-auto text-xs">
																	{JSON.stringify(event.data, null, 2)}
																</pre>
															</td>
														</tr>
													))}
												</tbody>
											</table>
										</div>
									) : (
										<EmptyState
											text={eventQuery.isLoading ? "正在加载日志" : "暂无日志"}
										/>
									)}
								</section>
							</>
						) : (
							<div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
								当前账号只能查看该运行记录摘要，输入、输出、错误和事件日志已隐藏。
							</div>
						)}
						<div className="flex justify-end">
							<Dialog.Close>
								<Button type="button" variant="outline">
									关闭
								</Button>
							</Dialog.Close>
						</div>
					</div>
				) : (
					<EmptyState text="正在加载运行详情" />
				)}
			</Dialog.Content>
		</Dialog.Root>
	);
}
