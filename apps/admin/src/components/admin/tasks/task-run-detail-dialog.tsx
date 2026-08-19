import { Dialog } from "@radix-ui/themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
	getTaskRun,
	listTaskRunLogs,
	type TaskRunLogLine,
	type TaskRunProjection,
} from "@/api/tasks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { EmptyState } from "../shared/admin-ui";
import { EmailDeliveryItems } from "../shared/email-delivery-items";
import { formatAdminDateTime } from "../shared/time-format";
import { TaskRunConsole } from "./task-run-console";
import { TaskStatusBadge, taskTypeLabel } from "./task-status-badge";

function JsonBlock({ title, value }: { title: string; value: unknown }) {
	if (value === undefined || value === null) {
		return null;
	}
	return (
		<details className="rounded-md border bg-muted/20 p-3">
			<summary className="cursor-pointer text-sm font-semibold">
				{title}
			</summary>
			<pre className="mt-2 max-h-56 overflow-auto rounded-md border bg-background/80 p-3 text-xs leading-5">
				{JSON.stringify(value, null, 2)}
			</pre>
		</details>
	);
}

const runningStatuses = new Set(["queued", "delayed", "running", "retrying"]);

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
		refetchInterval: (query) =>
			query.state.data && runningStatuses.has(query.state.data.status)
				? 1500
				: false,
		refetchIntervalInBackground: false,
	});
	const detail = runQuery.data ?? run;
	const [logLines, setLogLines] = useState<TaskRunLogLine[]>([]);
	const [afterSequence, setAfterSequence] = useState<number | undefined>();
	const previousRunIdRef = useRef<string | null>(null);
	const isRunning = detail ? runningStatuses.has(detail.status) : false;
	const logQuery = useQuery({
		queryKey: ["admin", "task-run-logs", run?.id, afterSequence ?? 0],
		queryFn: () =>
			listTaskRunLogs(run?.id ?? "", {
				afterSequence,
				limit: 200,
			}),
		enabled: open && Boolean(run?.id) && Boolean(run?.canViewLogs),
		refetchInterval: isRunning ? 1500 : false,
	});
	const canViewDetail = detail?.visibility === "run_detail";
	const canViewLogs = Boolean(detail?.canViewLogs);

	useEffect(() => {
		const runId = run?.id ?? null;
		if (previousRunIdRef.current === runId) {
			return;
		}
		previousRunIdRef.current = runId;
		setLogLines([]);
		setAfterSequence(undefined);
	});

	useEffect(() => {
		const data = logQuery.data;
		if (!data) {
			return;
		}
		setLogLines((current) => {
			const seen = new Set(current.map((line) => line.sequence));
			const next = data.items.filter((line) => !seen.has(line.sequence));
			if (next.length === 0) {
				return current;
			}
			return [...current, ...next].sort(
				(left, right) => left.sequence - right.sequence,
			);
		});
		setAfterSequence((current) =>
			data.nextSequence > (current ?? 0) ? data.nextSequence : current,
		);
	}, [logQuery.data]);

	const title = useMemo(() => {
		if (!detail) {
			return "加载运行记录。";
		}
		return (
			detail.scheduledTaskNameSnapshot ??
			detail.workflow ??
			taskTypeLabel(detail.type)
		);
	}, [detail]);

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Content maxWidth="900px">
				<Dialog.Title>运行详情</Dialog.Title>
				<Dialog.Description size="2">{title}</Dialog.Description>
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
								<p className="mt-1 text-sm">
									{detail.category === "notification"
										? "评论事件"
										: (detail.trigger ?? "-")}
								</p>
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
								{detail.deliveries ? (
									<section className="grid gap-2">
										<div className="flex items-center justify-between gap-2">
											<h3 className="text-sm font-semibold">投递结果</h3>
											<Badge variant="outline">
												{detail.workflow ?? "邮件通知"}
											</Badge>
										</div>
										{detail.deliveries.length > 0 ? (
											<EmailDeliveryItems items={detail.deliveries} />
										) : (
											<EmptyState text="这次通知没有生成实际邮件投递。" />
										)}
									</section>
								) : null}
								<section className="grid gap-2">
									<h3 className="text-sm font-semibold">执行输出</h3>
									{canViewLogs ? (
										<TaskRunConsole
											lines={logLines}
											loading={logQuery.isLoading}
											running={isRunning}
										/>
									) : (
										<EmptyState text="当前账号不能查看执行输出" />
									)}
								</section>
								<JsonBlock title="输入" value={detail.input} />
								<JsonBlock title="进度" value={detail.progress} />
								<JsonBlock title="结果" value={detail.result} />
								<JsonBlock title="错误" value={detail.error} />
								<JsonBlock title="触发快照" value={detail.triggerSnapshot} />
							</>
						) : (
							<div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
								当前账号只能查看该运行记录摘要，输入、输出、错误和执行日志已隐藏。
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
