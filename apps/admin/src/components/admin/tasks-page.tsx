import { useMutation, useQuery } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";

import {
	createPageTitleRefreshTask,
	listTasks,
	type MaintenanceJob,
} from "@/api/ops";
import { refreshPageRegistrySources } from "@/api/admin";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

import { EmptyState } from "./admin-ui";

function taskLabel(type: MaintenanceJob["type"]) {
	const labels: Record<MaintenanceJob["type"], string> = {
		ip_region_update: "IP 库更新",
		comment_ip_refresh: "评论 IP 刷新",
		page_source_refresh: "页面来源刷新",
		page_metadata_refresh: "页面 Title 刷新",
	};
	return labels[type];
}

function statusLabel(status: MaintenanceJob["status"]) {
	const labels: Record<MaintenanceJob["status"], string> = {
		queued: "等待中",
		delayed: "延迟中",
		running: "运行中",
		retrying: "等待重试",
		succeeded: "已完成",
		failed: "失败",
		cancelled: "已取消",
	};
	return labels[status];
}

function JsonBlock({ value }: { value: unknown }) {
	if (!value) {
		return null;
	}
	return (
		<pre className="mt-2 max-h-40 overflow-auto rounded-md bg-muted/40 p-2 text-xs">
			{JSON.stringify(value, null, 2)}
		</pre>
	);
}

export function TasksPage({ siteKey }: { siteKey: string }) {
	const tasksQuery = useQuery({
		queryKey: ["admin", "tasks", siteKey],
		queryFn: () => listTasks({ siteKey, limit: 30 }),
		refetchInterval: (query) =>
			query.state.data?.items.some((job) =>
				["queued", "delayed", "running", "retrying"].includes(job.status),
			)
				? 2000
				: false,
	});
	const refreshSourcesMutation = useMutation({
		mutationFn: refreshPageRegistrySources,
		onSuccess: () => void tasksQuery.refetch(),
	});
	const refreshMissingTitleMutation = useMutation({
		mutationFn: createPageTitleRefreshTask,
		onSuccess: () => void tasksQuery.refetch(),
	});
	const activeTasks =
		tasksQuery.data?.items.filter((job) =>
			["queued", "delayed", "running", "retrying"].includes(job.status),
		) ?? [];

	return (
		<div className="flex flex-col gap-4">
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">任务中心</CardTitle>
					<CardDescription>
						集中查看页面来源、Title 刷新、评论 IP 和 IP 库维护任务。
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-wrap gap-2">
					<Button
						type="button"
						variant="outline"
						disabled={!siteKey || refreshSourcesMutation.isPending}
						onClick={() => refreshSourcesMutation.mutate({ siteKey })}
					>
						<RefreshCwIcon data-icon="inline-start" />
						刷新当前站点来源
					</Button>
					<Button
						type="button"
						variant="outline"
						disabled={!siteKey || refreshMissingTitleMutation.isPending}
						onClick={() =>
							refreshMissingTitleMutation.mutate({
								siteKey,
								onlyMissingTitle: true,
							})
						}
					>
						<RefreshCwIcon data-icon="inline-start" />
						刷新缺失 Title
					</Button>
					<Button
						type="button"
						variant="outline"
						disabled={tasksQuery.isFetching}
						onClick={() => void tasksQuery.refetch()}
					>
						<RefreshCwIcon data-icon="inline-start" />
						刷新任务
					</Button>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="text-lg">当前任务</CardTitle>
					<CardDescription>等待、重试和运行中的维护任务。</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3">
					{activeTasks.map((job) => (
						<div key={job.id} className="rounded-md border p-3 text-sm">
							<p className="font-medium">
								{taskLabel(job.type)} / {statusLabel(job.status)}
							</p>
							<p className="mt-1 text-xs text-muted-foreground">
								{job.id} / {job.updatedAt}
							</p>
							<JsonBlock value={job.progress} />
						</div>
					))}
					{activeTasks.length === 0 ? <EmptyState text="暂无当前任务" /> : null}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="text-lg">最近任务</CardTitle>
					<CardDescription>最近创建或更新的维护任务。</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3">
					{tasksQuery.data?.items.map((job) => (
						<div key={job.id} className="rounded-md border p-3 text-sm">
							<div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
								<p className="font-medium">
									{taskLabel(job.type)} / {statusLabel(job.status)}
								</p>
								<p className="text-xs text-muted-foreground">{job.updatedAt}</p>
							</div>
							<p className="mt-1 break-all text-xs text-muted-foreground">
								{job.id}
							</p>
							<JsonBlock value={job.progress} />
							<JsonBlock value={job.result} />
							<JsonBlock value={job.error} />
						</div>
					))}
					{tasksQuery.data?.items.length === 0 ? (
						<EmptyState text="暂无任务" />
					) : null}
				</CardContent>
			</Card>
		</div>
	);
}
