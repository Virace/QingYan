import { useMutation, useQuery } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import {
	createPageTitleRefreshTask,
	listTasks,
	prioritizeTask,
	runTaskNow,
	type MaintenanceJobStatus,
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

import { PaginationControls } from "./admin-pagination";
import { EmptyState } from "./admin-ui";
import { inputClass } from "./admin-ui";
import { IpMaintenanceTaskPanel } from "./ip-maintenance-task-panel";
import { PageSourceTaskPanel } from "./page-source-task-panel";
import {
	defaultTaskExecutionOptions,
	TaskExecutionOptionsFields,
	toTaskExecutionOptions,
} from "./task-execution-options";
import { TaskSummary } from "./task-summary";

const taskTypes = [
	["", "全部类型"],
	["page_source_refresh", "页面来源刷新"],
	["page_metadata_refresh", "页面 Title 刷新"],
	["comment_ip_refresh", "评论 IP 刷新"],
	["ip_region_update", "IP 库更新"],
] as const;

const taskStatuses: Array<[MaintenanceJobStatus | "", string]> = [
	["", "全部状态"],
	["queued", "排队"],
	["delayed", "延迟"],
	["running", "运行中"],
	["retrying", "等待重试"],
	["succeeded", "成功"],
	["failed", "失败"],
	["cancelled", "取消"],
];

const defaultPageSize = 20;

export function TasksPage({ siteKey }: { siteKey: string }) {
	const [typeFilter, setTypeFilter] = useState("");
	const [statusFilter, setStatusFilter] = useState<MaintenanceJobStatus | "">(
		"",
	);
	const [page, setPage] = useState(0);
	const [pageSize, setPageSize] = useState(defaultPageSize);
	const [executionOptions, setExecutionOptions] = useState(
		defaultTaskExecutionOptions({
			batchSize: "50",
			timeoutMs: "8000",
			maxBytes: "524288",
		}),
	);
	const tasksQuery = useQuery({
		queryKey: [
			"admin",
			"tasks",
			siteKey,
			typeFilter,
			statusFilter,
			page,
			pageSize,
		],
		queryFn: () =>
			listTasks({
				siteKey,
				type: typeFilter || undefined,
				status: statusFilter || undefined,
				limit: pageSize,
				offset: page * pageSize,
			}),
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
	const runNowMutation = useMutation({
		mutationFn: runTaskNow,
		onSuccess: () => void tasksQuery.refetch(),
	});
	const prioritizeMutation = useMutation({
		mutationFn: prioritizeTask,
		onSuccess: () => void tasksQuery.refetch(),
	});
	const activeTasks =
		tasksQuery.data?.items.filter((job) =>
			["queued", "delayed", "running", "retrying"].includes(job.status),
		) ?? [];
	const totalCount = tasksQuery.data?.totalCount ?? 0;
	const updateTypeFilter = (value: string) => {
		setTypeFilter(value);
		setPage(0);
	};
	const updateStatusFilter = (value: MaintenanceJobStatus | "") => {
		setStatusFilter(value);
		setPage(0);
	};
	const updatePageSize = (value: number) => {
		setPageSize(value);
		setPage(0);
	};

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
						onClick={() =>
							refreshSourcesMutation.mutate({
								siteKey,
								...toTaskExecutionOptions(executionOptions),
							})
						}
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
								...toTaskExecutionOptions(executionOptions),
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

			<TaskExecutionOptionsFields
				value={executionOptions}
				onChange={setExecutionOptions}
			/>

			<PageSourceTaskPanel siteKey={siteKey} />

			<IpMaintenanceTaskPanel siteKey={siteKey} />

			<Card>
				<CardHeader>
					<CardTitle className="text-lg">当前任务</CardTitle>
					<CardDescription>等待、重试和运行中的维护任务。</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3">
					{activeTasks.map((job) => (
						<div key={job.id} className="grid gap-2">
							<TaskSummary job={job} />
							{job.source === "maintenance" &&
							["queued", "delayed", "retrying"].includes(job.status) ? (
								<div className="flex flex-wrap gap-2">
									<Button
										type="button"
										size="sm"
										variant="outline"
										disabled={runNowMutation.isPending}
										onClick={() => runNowMutation.mutate(job.id)}
									>
										立即执行
									</Button>
									<Button
										type="button"
										size="sm"
										variant="outline"
										disabled={prioritizeMutation.isPending}
										onClick={() => prioritizeMutation.mutate(job.id)}
									>
										提高优先级
									</Button>
									{job.queueState.waitingReason ===
									"concurrency_key_blocked" ? (
										<p className="self-center text-xs text-muted-foreground">
											提高优先级不会绕过同一互斥键的运行限制。
										</p>
									) : null}
								</div>
							) : null}
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
					<div className="grid gap-3 md:grid-cols-2">
						<label className="grid gap-1 text-sm">
							<span className="text-muted-foreground">类型</span>
							<select
								className={inputClass}
								value={typeFilter}
								onChange={(event) => updateTypeFilter(event.target.value)}
							>
								{taskTypes.map(([value, label]) => (
									<option key={value} value={value}>
										{label}
									</option>
								))}
							</select>
						</label>
						<label className="grid gap-1 text-sm">
							<span className="text-muted-foreground">状态</span>
							<select
								className={inputClass}
								value={statusFilter}
								onChange={(event) =>
									updateStatusFilter(
										event.target.value as MaintenanceJobStatus | "",
									)
								}
							>
								{taskStatuses.map(([value, label]) => (
									<option key={value} value={value}>
										{label}
									</option>
								))}
							</select>
						</label>
					</div>
					<PaginationControls
						limit={pageSize}
						pageIndex={page}
						totalCount={totalCount}
						itemCount={tasksQuery.data?.items.length ?? 0}
						setLimit={updatePageSize}
						setPageIndex={setPage}
					/>
					{tasksQuery.data?.items.map((job) => (
						<TaskSummary key={job.id} job={job} />
					))}
					{tasksQuery.data?.items.length === 0 ? (
						<EmptyState text="暂无任务" />
					) : null}
				</CardContent>
			</Card>
		</div>
	);
}
