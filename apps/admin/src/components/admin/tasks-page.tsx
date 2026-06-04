import { useMemo, useState } from "react";
import { Tabs } from "@radix-ui/themes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { getSettings } from "@/api/admin";
import {
	cancelTaskRun,
	createScheduledTask,
	deleteScheduledTask,
	disableScheduledTask,
	enableScheduledTask,
	getTaskRun,
	listDeletedTaskSnapshots,
	listScheduledTasks,
	listTaskAudit,
	listTaskDefinitions,
	listTaskRuns,
	retryTaskRun,
	runScheduledTask,
	updateScheduledTask,
	type ScheduledTaskProjection,
	type ScheduledTaskWriteInput,
	type TaskAuditItem,
	type TaskRunProjection,
	type TaskRunStatus,
} from "@/api/tasks";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import { PaginationControls } from "./admin-pagination";
import { EmptyState, inputClass } from "./admin-ui";
import { useAdminConfirmDialog } from "./confirm-dialog";
import { TaskDefinitionTable } from "./task-definition-table";
import { TaskEditorDialog } from "./task-editor-dialog";
import { TaskRunDetailDialog } from "./task-run-detail-dialog";
import { TaskRunTable } from "./task-run-table";
import { taskTypeLabel } from "./task-status-badge";

const defaultPageSize = 20;

const taskStatuses: Array<[TaskRunStatus | "", string]> = [
	["", "全部状态"],
	["queued", "排队"],
	["delayed", "延迟"],
	["running", "运行中"],
	["retrying", "重试中"],
	["succeeded", "成功"],
	["failed", "失败"],
	["skipped", "跳过"],
	["blocked", "阻塞"],
	["suppressed", "抑制"],
	["cancelled", "取消"],
];

function errorMessage(error: unknown, fallback: string): string {
	if (error instanceof ApiError) {
		return error.message;
	}
	if (error instanceof Error) {
		return error.message;
	}
	return fallback;
}

function includesText(value: unknown, search: string): boolean {
	if (!search) {
		return true;
	}
	return String(value ?? "")
		.toLowerCase()
		.includes(search);
}

function paginate<T>(items: T[], page: number, pageSize: number): T[] {
	return items.slice(page * pageSize, page * pageSize + pageSize);
}

export function TasksPage({ siteKey }: { siteKey: string }) {
	const queryClient = useQueryClient();
	const confirm = useAdminConfirmDialog();
	const [activeTab, setActiveTab] = useState("scheduled");
	const [definitionTypeFilter, setDefinitionTypeFilter] = useState("");
	const [definitionStatusFilter, setDefinitionStatusFilter] = useState<
		TaskRunStatus | ""
	>("");
	const [definitionScopeFilter, setDefinitionScopeFilter] = useState("");
	const [definitionVisibilityFilter, setDefinitionVisibilityFilter] =
		useState("");
	const [definitionSearch, setDefinitionSearch] = useState("");
	const [definitionPage, setDefinitionPage] = useState(0);
	const [definitionPageSize, setDefinitionPageSize] = useState(defaultPageSize);
	const [runTypeFilter, setRunTypeFilter] = useState("");
	const [runStatusFilter, setRunStatusFilter] = useState<TaskRunStatus | "">(
		"",
	);
	const [runSiteFilter, setRunSiteFilter] = useState("");
	const [runSearch, setRunSearch] = useState("");
	const [runPage, setRunPage] = useState(0);
	const [runPageSize, setRunPageSize] = useState(defaultPageSize);
	const [auditSearch, setAuditSearch] = useState("");
	const [auditPage, setAuditPage] = useState(0);
	const [auditPageSize, setAuditPageSize] = useState(defaultPageSize);
	const [editingTask, setEditingTask] =
		useState<ScheduledTaskProjection | null>(null);
	const [editorOpen, setEditorOpen] = useState(false);
	const [selectedRun, setSelectedRun] = useState<TaskRunProjection | null>(
		null,
	);
	const [highlightTaskId, setHighlightTaskId] = useState<string | null>(null);

	const definitionsQuery = useQuery({
		queryKey: ["admin", "task-definitions"],
		queryFn: listTaskDefinitions,
	});
	const scheduledQuery = useQuery({
		queryKey: ["admin", "scheduled-tasks"],
		queryFn: listScheduledTasks,
		refetchInterval: 5000,
	});
	const runsQuery = useQuery({
		queryKey: ["admin", "task-runs"],
		queryFn: listTaskRuns,
		refetchInterval: (query) =>
			query.state.data?.items.some((run) =>
				["queued", "delayed", "running", "retrying"].includes(run.status),
			)
				? 2000
				: false,
	});
	const settingsQuery = useQuery({
		queryKey: ["admin", "settings", siteKey],
		queryFn: () => getSettings(siteKey),
	});
	const auditQuery = useQuery({
		queryKey: ["admin", "task-audit"],
		queryFn: listTaskAudit,
	});
	const deletedSnapshotsQuery = useQuery({
		queryKey: ["admin", "task-deleted-snapshots"],
		queryFn: listDeletedTaskSnapshots,
	});

	const invalidateTaskQueries = () => {
		void queryClient.invalidateQueries({
			queryKey: ["admin", "scheduled-tasks"],
		});
		void queryClient.invalidateQueries({ queryKey: ["admin", "task-runs"] });
		void queryClient.invalidateQueries({ queryKey: ["admin", "task-audit"] });
		void queryClient.invalidateQueries({
			queryKey: ["admin", "task-deleted-snapshots"],
		});
	};

	const createMutation = useMutation({
		mutationFn: createScheduledTask,
		onSuccess(task) {
			toast.success("计划任务已创建");
			setEditorOpen(false);
			setEditingTask(null);
			setActiveTab("scheduled");
			setHighlightTaskId(task.id);
			setDefinitionPage(0);
			invalidateTaskQueries();
		},
		onError(error) {
			toast.error(errorMessage(error, "创建任务失败"));
		},
	});
	const updateMutation = useMutation({
		mutationFn: ({
			id,
			input,
		}: {
			id: string;
			input: ScheduledTaskWriteInput;
		}) => updateScheduledTask(id, input),
		onSuccess(task) {
			toast.success("计划任务已保存");
			setEditorOpen(false);
			setEditingTask(null);
			setHighlightTaskId(task.id);
			invalidateTaskQueries();
		},
		onError(error) {
			toast.error(errorMessage(error, "保存任务失败"));
		},
	});
	const runMutation = useMutation({
		mutationFn: runScheduledTask,
		onSuccess(run) {
			toast.success("任务已加入运行记录");
			setActiveTab("runs");
			setSelectedRun(run);
			invalidateTaskQueries();
		},
		onError(error) {
			toast.error(errorMessage(error, "立即运行失败"));
		},
	});
	const enableMutation = useMutation({
		mutationFn: enableScheduledTask,
		onSuccess() {
			toast.success("任务已启用");
			invalidateTaskQueries();
		},
		onError(error) {
			toast.error(errorMessage(error, "启用任务失败"));
		},
	});
	const disableMutation = useMutation({
		mutationFn: (id: string) => disableScheduledTask(id),
		onSuccess() {
			toast.success("任务已停用");
			invalidateTaskQueries();
		},
		onError(error) {
			toast.error(errorMessage(error, "停用任务失败"));
		},
	});
	const deleteMutation = useMutation({
		mutationFn: (id: string) => deleteScheduledTask(id),
		onSuccess() {
			toast.success("任务已删除，并保留删除快照");
			invalidateTaskQueries();
		},
		onError(error) {
			toast.error(errorMessage(error, "删除任务失败"));
		},
	});
	const cancelMutation = useMutation({
		mutationFn: cancelTaskRun,
		onSuccess() {
			toast.success("运行已取消");
			invalidateTaskQueries();
		},
		onError(error) {
			toast.error(errorMessage(error, "取消运行失败"));
		},
	});
	const retryMutation = useMutation({
		mutationFn: retryTaskRun,
		onSuccess() {
			toast.success("运行已标记为重试");
			invalidateTaskQueries();
		},
		onError(error) {
			toast.error(errorMessage(error, "重试运行失败"));
		},
	});

	const definitions = definitionsQuery.data?.items ?? [];
	const scheduledTasks = scheduledQuery.data?.items ?? [];
	const taskRuns = runsQuery.data?.items ?? [];
	const auditItems = auditQuery.data?.items ?? [];
	const deletedSnapshots = deletedSnapshotsQuery.data?.items ?? [];

	const filteredScheduledTasks = useMemo(() => {
		const search = definitionSearch.trim().toLowerCase();
		return scheduledTasks.filter((task) => {
			if (definitionTypeFilter && task.type !== definitionTypeFilter) {
				return false;
			}
			if (
				definitionStatusFilter &&
				task.lastStatus !== definitionStatusFilter
			) {
				return false;
			}
			if (definitionScopeFilter && task.scopeKind !== definitionScopeFilter) {
				return false;
			}
			if (
				definitionVisibilityFilter === "owned" &&
				task.visibility !== "definition"
			) {
				return false;
			}
			if (
				definitionVisibilityFilter === "summary" &&
				task.visibility !== "summary"
			) {
				return false;
			}
			return (
				includesText(task.name, search) ||
				includesText(task.description, search) ||
				includesText(task.type, search) ||
				includesText(task.ownerUserId, search)
			);
		});
	}, [
		definitionScopeFilter,
		definitionSearch,
		definitionStatusFilter,
		definitionTypeFilter,
		definitionVisibilityFilter,
		scheduledTasks,
	]);

	const filteredRuns = useMemo(() => {
		const search = runSearch.trim().toLowerCase();
		return taskRuns.filter((run) => {
			if (runTypeFilter && run.type !== runTypeFilter) {
				return false;
			}
			if (runStatusFilter && run.status !== runStatusFilter) {
				return false;
			}
			if (runSiteFilter === "current" && run.siteKey !== siteKey) {
				return false;
			}
			if (runSiteFilter === "global" && run.siteKey !== null) {
				return false;
			}
			return (
				includesText(run.scheduledTaskNameSnapshot, search) ||
				includesText(run.type, search) ||
				includesText(run.id, search) ||
				includesText(run.skipReason, search) ||
				includesText(run.blockReason, search)
			);
		});
	}, [
		runSearch,
		runSiteFilter,
		runStatusFilter,
		runTypeFilter,
		siteKey,
		taskRuns,
	]);
	const filteredAuditItems = useMemo(() => {
		const search = auditSearch.trim().toLowerCase();
		return auditItems.filter((item) =>
			[
				item.action,
				item.actorType,
				item.actorId,
				item.targetType,
				item.targetId,
				item.taskType,
				item.siteKey,
				item.runId,
				item.scheduledTaskId,
			].some((value) => includesText(value, search)),
		);
	}, [auditItems, auditSearch]);

	const pagedScheduledTasks = paginate(
		filteredScheduledTasks,
		definitionPage,
		definitionPageSize,
	);
	const pagedRuns = paginate(filteredRuns, runPage, runPageSize);
	const pagedAuditItems = paginate(
		filteredAuditItems,
		auditPage,
		auditPageSize,
	);
	const busyTaskId =
		runMutation.variables ??
		enableMutation.variables ??
		disableMutation.variables ??
		deleteMutation.variables ??
		null;
	const busyRunId = cancelMutation.variables ?? retryMutation.variables ?? null;

	const openCreateDialog = () => {
		setEditingTask(null);
		setEditorOpen(true);
	};
	const openEditDialog = (task: ScheduledTaskProjection) => {
		setEditingTask(task);
		setEditorOpen(true);
	};
	const submitEditor = (input: ScheduledTaskWriteInput) => {
		if (editingTask) {
			updateMutation.mutate({ id: editingTask.id, input });
			return;
		}
		createMutation.mutate(input);
	};
	const deleteTask = async (task: ScheduledTaskProjection) => {
		const confirmed = await confirm({
			title: "删除计划任务",
			description: `确认删除 ${task.name}？系统会保留删除快照和历史运行记录。`,
			confirmText: "删除任务",
			destructive: true,
		});
		if (confirmed) {
			deleteMutation.mutate(task.id);
		}
	};
	const disableTask = async (task: ScheduledTaskProjection) => {
		const confirmed = await confirm({
			title: "停用计划任务",
			description: `确认停用 ${task.name}？已创建的运行记录不会被删除。`,
			confirmText: "停用任务",
		});
		if (confirmed) {
			disableMutation.mutate(task.id);
		}
	};
	const cancelRun = async (run: TaskRunProjection) => {
		const confirmed = await confirm({
			title: "取消运行",
			description: `确认取消运行 ${run.id}？正在执行的任务会被标记为取消。`,
			confirmText: "取消运行",
			destructive: true,
		});
		if (confirmed) {
			cancelMutation.mutate(run.id);
		}
	};
	const retryRun = async (run: TaskRunProjection) => {
		const confirmed = await confirm({
			title: "重试运行",
			description: `确认把 ${run.id} 标记为重试？`,
			confirmText: "重试运行",
		});
		if (confirmed) {
			retryMutation.mutate(run.id);
		}
	};
	const viewTaskRuns = (task: ScheduledTaskProjection) => {
		setRunTypeFilter(task.type);
		setRunSearch(task.name);
		setRunPage(0);
		setActiveTab("runs");
	};
	const resetDefinitionFilters = () => {
		setDefinitionTypeFilter("");
		setDefinitionStatusFilter("");
		setDefinitionScopeFilter("");
		setDefinitionVisibilityFilter("");
		setDefinitionSearch("");
		setDefinitionPage(0);
	};
	const resetRunFilters = () => {
		setRunTypeFilter("");
		setRunStatusFilter("");
		setRunSiteFilter("");
		setRunSearch("");
		setRunPage(0);
	};
	const resetAuditFilters = () => {
		setAuditSearch("");
		setAuditPage(0);
	};
	const openAuditRun = async (runId: string) => {
		try {
			const run = await getTaskRun(runId);
			setSelectedRun(run);
		} catch (error) {
			toast.error(errorMessage(error, "无法打开运行详情"));
		}
	};

	return (
		<div className="flex flex-col gap-4">
			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<CardTitle className="text-lg">任务中心</CardTitle>
							<CardDescription>
								管理内置计划任务、运行记录和任务类型模板。
							</CardDescription>
						</div>
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								variant="outline"
								disabled={scheduledQuery.isFetching || runsQuery.isFetching}
								onClick={invalidateTaskQueries}
							>
								<RefreshCwIcon data-icon="inline-start" />
								刷新
							</Button>
							<Button
								type="button"
								disabled={definitions.length === 0}
								onClick={openCreateDialog}
							>
								<PlusIcon data-icon="inline-start" />
								添加任务
							</Button>
						</div>
					</div>
				</CardHeader>
			</Card>

			<Tabs.Root value={activeTab} onValueChange={setActiveTab}>
				<Tabs.List>
					<Tabs.Trigger value="scheduled">定时任务</Tabs.Trigger>
					<Tabs.Trigger value="runs">运行记录</Tabs.Trigger>
					<Tabs.Trigger value="audit">审计</Tabs.Trigger>
					<Tabs.Trigger value="templates">模板</Tabs.Trigger>
				</Tabs.List>
				<div className="pt-4">
					<Tabs.Content value="scheduled">
						<Card>
							<CardHeader>
								<CardTitle className="text-lg">定时任务</CardTitle>
								<CardDescription>
									任务定义、启停状态、下一次运行和最近运行结果分开呈现。
								</CardDescription>
							</CardHeader>
							<CardContent className="grid gap-3">
								<div className="grid gap-3 md:grid-cols-[1fr_12rem_12rem_12rem_12rem_auto]">
									<label className="grid gap-1 text-sm">
										<span className="text-muted-foreground">搜索</span>
										<input
											className={inputClass}
											value={definitionSearch}
											placeholder="名称、描述、类型或 owner"
											onChange={(event) => {
												setDefinitionSearch(event.target.value);
												setDefinitionPage(0);
											}}
										/>
									</label>
									<label className="grid gap-1 text-sm">
										<span className="text-muted-foreground">类型</span>
										<select
											className={inputClass}
											value={definitionTypeFilter}
											onChange={(event) => {
												setDefinitionTypeFilter(event.target.value);
												setDefinitionPage(0);
											}}
										>
											<option value="">全部类型</option>
											{definitions.map((definition) => (
												<option key={definition.type} value={definition.type}>
													{definition.label}
												</option>
											))}
										</select>
									</label>
									<label className="grid gap-1 text-sm">
										<span className="text-muted-foreground">最近状态</span>
										<select
											className={inputClass}
											value={definitionStatusFilter}
											onChange={(event) => {
												setDefinitionStatusFilter(
													event.target.value as TaskRunStatus | "",
												);
												setDefinitionPage(0);
											}}
										>
											{taskStatuses.map(([value, label]) => (
												<option key={value} value={value}>
													{label}
												</option>
											))}
										</select>
									</label>
									<label className="grid gap-1 text-sm">
										<span className="text-muted-foreground">范围</span>
										<select
											className={inputClass}
											value={definitionScopeFilter}
											onChange={(event) => {
												setDefinitionScopeFilter(event.target.value);
												setDefinitionPage(0);
											}}
										>
											<option value="">全部范围</option>
											<option value="global">全局</option>
											<option value="site">站点</option>
										</select>
									</label>
									<label className="grid gap-1 text-sm">
										<span className="text-muted-foreground">可见性</span>
										<select
											className={inputClass}
											value={definitionVisibilityFilter}
											onChange={(event) => {
												setDefinitionVisibilityFilter(event.target.value);
												setDefinitionPage(0);
											}}
										>
											<option value="">全部</option>
											<option value="owned">可管理</option>
											<option value="summary">摘要</option>
										</select>
									</label>
									<div className="flex items-end">
										<Button
											type="button"
											variant="outline"
											onClick={resetDefinitionFilters}
										>
											重置
										</Button>
									</div>
								</div>
								<PaginationControls
									limit={definitionPageSize}
									pageIndex={definitionPage}
									totalCount={filteredScheduledTasks.length}
									itemCount={pagedScheduledTasks.length}
									setLimit={(value) => {
										setDefinitionPageSize(value);
										setDefinitionPage(0);
									}}
									setPageIndex={setDefinitionPage}
								/>
								<TaskDefinitionTable
									tasks={pagedScheduledTasks}
									definitions={definitions}
									busyTaskId={busyTaskId}
									highlightTaskId={highlightTaskId}
									onEdit={openEditDialog}
									onRun={(task) => runMutation.mutate(task.id)}
									onEnable={(task) => enableMutation.mutate(task.id)}
									onDisable={(task) => void disableTask(task)}
									onDelete={(task) => void deleteTask(task)}
									onViewRuns={viewTaskRuns}
								/>
							</CardContent>
						</Card>
					</Tabs.Content>

					<Tabs.Content value="runs">
						<Card>
							<CardHeader>
								<CardTitle className="text-lg">运行记录</CardTitle>
								<CardDescription>
									运行状态、触发来源、时间线和详情日志按权限分层展示。
								</CardDescription>
							</CardHeader>
							<CardContent className="grid gap-3">
								<div className="grid gap-3 md:grid-cols-[1fr_12rem_12rem_12rem_auto]">
									<label className="grid gap-1 text-sm">
										<span className="text-muted-foreground">搜索</span>
										<input
											className={inputClass}
											value={runSearch}
											placeholder="任务名、运行 ID 或原因"
											onChange={(event) => {
												setRunSearch(event.target.value);
												setRunPage(0);
											}}
										/>
									</label>
									<label className="grid gap-1 text-sm">
										<span className="text-muted-foreground">类型</span>
										<select
											className={inputClass}
											value={runTypeFilter}
											onChange={(event) => {
												setRunTypeFilter(event.target.value);
												setRunPage(0);
											}}
										>
											<option value="">全部类型</option>
											{definitions.map((definition) => (
												<option key={definition.type} value={definition.type}>
													{definition.label}
												</option>
											))}
										</select>
									</label>
									<label className="grid gap-1 text-sm">
										<span className="text-muted-foreground">状态</span>
										<select
											className={inputClass}
											value={runStatusFilter}
											onChange={(event) => {
												setRunStatusFilter(
													event.target.value as TaskRunStatus | "",
												);
												setRunPage(0);
											}}
										>
											{taskStatuses.map(([value, label]) => (
												<option key={value} value={value}>
													{label}
												</option>
											))}
										</select>
									</label>
									<label className="grid gap-1 text-sm">
										<span className="text-muted-foreground">站点</span>
										<select
											className={inputClass}
											value={runSiteFilter}
											onChange={(event) => {
												setRunSiteFilter(event.target.value);
												setRunPage(0);
											}}
										>
											<option value="">全部</option>
											<option value="current">当前站点</option>
											<option value="global">全局</option>
										</select>
									</label>
									<div className="flex items-end">
										<Button
											type="button"
											variant="outline"
											onClick={resetRunFilters}
										>
											重置
										</Button>
									</div>
								</div>
								<PaginationControls
									limit={runPageSize}
									pageIndex={runPage}
									totalCount={filteredRuns.length}
									itemCount={pagedRuns.length}
									setLimit={(value) => {
										setRunPageSize(value);
										setRunPage(0);
									}}
									setPageIndex={setRunPage}
								/>
								<TaskRunTable
									runs={pagedRuns}
									definitions={definitions}
									busyRunId={busyRunId}
									onOpenDetail={setSelectedRun}
									onCancel={(run) => void cancelRun(run)}
									onRetry={(run) => void retryRun(run)}
								/>
							</CardContent>
						</Card>
					</Tabs.Content>

					<Tabs.Content value="audit">
						<Card>
							<CardHeader>
								<CardTitle className="text-lg">任务审计</CardTitle>
								<CardDescription>
									只展示任务动作摘要和删除快照，不展示执行输入、输出、错误详情或事件日志。
								</CardDescription>
							</CardHeader>
							<CardContent className="grid gap-4">
								<div className="grid gap-3 md:grid-cols-[1fr_auto]">
									<label className="grid gap-1 text-sm">
										<span className="text-muted-foreground">搜索</span>
										<input
											className={inputClass}
											value={auditSearch}
											placeholder="动作、actor、任务类型或运行 ID"
											onChange={(event) => {
												setAuditSearch(event.target.value);
												setAuditPage(0);
											}}
										/>
									</label>
									<div className="flex items-end">
										<Button
											type="button"
											variant="outline"
											onClick={resetAuditFilters}
										>
											重置
										</Button>
									</div>
								</div>
								<PaginationControls
									limit={auditPageSize}
									pageIndex={auditPage}
									totalCount={filteredAuditItems.length}
									itemCount={pagedAuditItems.length}
									setLimit={(value) => {
										setAuditPageSize(value);
										setAuditPage(0);
									}}
									setPageIndex={setAuditPage}
								/>
								<TaskAuditTable
									items={pagedAuditItems}
									onOpenRun={(runId) => void openAuditRun(runId)}
								/>
								<div className="grid gap-3">
									<div className="flex items-center justify-between gap-3">
										<h3 className="text-sm font-semibold">删除快照</h3>
										<Badge variant="outline">{deletedSnapshots.length}</Badge>
									</div>
									{deletedSnapshots.length === 0 ? (
										<EmptyState text="暂无删除快照，或当前账号无权查看。" />
									) : (
										<div className="overflow-x-auto rounded-md border">
											<table className="w-full min-w-[760px] text-sm">
												<thead className="bg-muted/50 text-xs text-muted-foreground">
													<tr className="border-b">
														<th className="px-3 py-2 text-left font-medium">
															任务
														</th>
														<th className="px-3 py-2 text-left font-medium">
															类型
														</th>
														<th className="px-3 py-2 text-left font-medium">
															最近状态
														</th>
														<th className="px-3 py-2 text-left font-medium">
															删除人
														</th>
														<th className="px-3 py-2 text-left font-medium">
															删除时间
														</th>
													</tr>
												</thead>
												<tbody>
													{deletedSnapshots.map((snapshot) => (
														<tr
															key={snapshot.id}
															className="border-b last:border-0"
														>
															<td className="px-3 py-3 align-top">
																<div className="grid gap-1">
																	<span className="font-medium">
																		{snapshot.snapshot.name}
																	</span>
																	<span className="text-xs text-muted-foreground">
																		{snapshot.scheduledTaskId}
																	</span>
																</div>
															</td>
															<td className="px-3 py-3 align-top">
																{taskTypeLabel(snapshot.snapshot.type)}
															</td>
															<td className="px-3 py-3 align-top">
																{snapshot.lastStatus ?? "-"}
															</td>
															<td className="px-3 py-3 align-top">
																{snapshot.deletedByUserId ?? "-"}
															</td>
															<td className="px-3 py-3 align-top">
																{new Date(snapshot.deletedAt).toLocaleString()}
															</td>
														</tr>
													))}
												</tbody>
											</table>
										</div>
									)}
								</div>
							</CardContent>
						</Card>
					</Tabs.Content>

					<Tabs.Content value="templates">
						<Card>
							<CardHeader>
								<CardTitle className="text-lg">任务类型模板</CardTitle>
								<CardDescription>
									后端内置任务类型、复用入口和调度能力只读展示。
								</CardDescription>
							</CardHeader>
							<CardContent className="grid gap-3">
								{definitions.length === 0 ? (
									<EmptyState text="暂无任务类型" />
								) : (
									<div className="overflow-x-auto rounded-md border">
										<table className="w-full min-w-[860px] text-sm">
											<thead className="bg-muted/50 text-xs text-muted-foreground">
												<tr className="border-b">
													<th className="px-3 py-2 text-left font-medium">
														类型
													</th>
													<th className="px-3 py-2 text-left font-medium">
														范围
													</th>
													<th className="px-3 py-2 text-left font-medium">
														调度
													</th>
													<th className="px-3 py-2 text-left font-medium">
														复用入口
													</th>
												</tr>
											</thead>
											<tbody>
												{definitions.map((definition) => (
													<tr
														key={definition.type}
														className="border-b last:border-0"
													>
														<td className="px-3 py-3 align-top">
															<div className="grid gap-1">
																<div className="flex flex-wrap items-center gap-2">
																	<span className="font-medium">
																		{definition.label ||
																			taskTypeLabel(definition.type)}
																	</span>
																	{definition.dangerous ? (
																		<Badge variant="destructive">高风险</Badge>
																	) : (
																		<Badge variant="outline">内置</Badge>
																	)}
																</div>
																<p className="text-xs text-muted-foreground">
																	{definition.type}
																</p>
																<p className="max-w-[26rem] text-xs text-muted-foreground">
																	{definition.description}
																</p>
															</div>
														</td>
														<td className="px-3 py-3 align-top">
															{definition.scope}
														</td>
														<td className="px-3 py-3 align-top">
															<div className="flex flex-wrap gap-1">
																{definition.schedule.manual ? (
																	<Badge variant="outline">手动</Badge>
																) : null}
																{definition.schedule.cron ? (
																	<Badge variant="outline">Cron</Badge>
																) : null}
																{definition.schedule.presets.map((preset) => (
																	<Badge key={preset} variant="outline">
																		{preset}
																	</Badge>
																))}
															</div>
														</td>
														<td className="px-3 py-3 align-top">
															<div className="grid gap-1 text-xs">
																<span>{definition.reuse.service}</span>
																<span>{definition.reuse.method}</span>
																<span className="text-muted-foreground">
																	{definition.reuse.file}
																</span>
															</div>
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								)}
							</CardContent>
						</Card>
					</Tabs.Content>
				</div>
			</Tabs.Root>

			<TaskEditorDialog
				open={editorOpen}
				mode={editingTask ? "edit" : "create"}
				task={editingTask}
				definitions={definitions}
				siteKey={siteKey}
				notificationChannelConfigs={
					settingsQuery.data?.notifications.channelConfigs ?? []
				}
				notificationRecipients={
					settingsQuery.data?.notifications.recipients ?? []
				}
				isSaving={createMutation.isPending || updateMutation.isPending}
				saveError={createMutation.error ?? updateMutation.error}
				onOpenChange={(open) => {
					setEditorOpen(open);
					if (!open) {
						setEditingTask(null);
						createMutation.reset();
						updateMutation.reset();
					}
				}}
				onSubmit={submitEditor}
			/>
			<TaskRunDetailDialog
				open={selectedRun !== null}
				run={selectedRun}
				onOpenChange={(open) => {
					if (!open) {
						setSelectedRun(null);
					}
				}}
			/>
		</div>
	);
}

function TaskAuditTable({
	items,
	onOpenRun,
}: {
	items: TaskAuditItem[];
	onOpenRun: (runId: string) => void;
}) {
	if (items.length === 0) {
		return <EmptyState text="暂无任务审计记录" />;
	}

	return (
		<div className="overflow-x-auto rounded-md border">
			<table className="w-full min-w-[900px] text-sm">
				<thead className="bg-muted/50 text-xs text-muted-foreground">
					<tr className="border-b">
						<th className="px-3 py-2 text-left font-medium">时间</th>
						<th className="px-3 py-2 text-left font-medium">Actor</th>
						<th className="px-3 py-2 text-left font-medium">动作</th>
						<th className="px-3 py-2 text-left font-medium">任务</th>
						<th className="px-3 py-2 text-left font-medium">任务类型</th>
						<th className="px-3 py-2 text-left font-medium">站点</th>
						<th className="px-3 py-2 text-left font-medium">目标</th>
						<th className="px-3 py-2 text-left font-medium">运行</th>
					</tr>
				</thead>
				<tbody>
					{items.map((item) => (
						<tr key={item.id} className="border-b last:border-0">
							<td className="px-3 py-3 align-top">
								{new Date(item.createdAt).toLocaleString()}
							</td>
							<td className="px-3 py-3 align-top">
								<div className="grid gap-1">
									<span>{item.actorType}</span>
									<span className="text-xs text-muted-foreground">
										{item.actorId ?? "-"}
									</span>
								</div>
							</td>
							<td className="px-3 py-3 align-top">{item.action}</td>
							<td className="px-3 py-3 align-top">
								{typeof item.taskName === "string" ? item.taskName : "-"}
							</td>
							<td className="px-3 py-3 align-top">
								{typeof item.taskType === "string"
									? taskTypeLabel(item.taskType)
									: "-"}
							</td>
							<td className="px-3 py-3 align-top">
								{typeof item.siteKey === "string" ? item.siteKey : "-"}
							</td>
							<td className="px-3 py-3 align-top">
								<div className="grid gap-1">
									<span>{item.targetType}</span>
									<span className="text-xs text-muted-foreground">
										{typeof item.scheduledTaskId === "string"
											? item.scheduledTaskId
											: item.targetId || "-"}
									</span>
								</div>
							</td>
							<td className="px-3 py-3 align-top">
								{typeof item.runId === "string" ? (
									<div className="grid gap-1">
										<Button
											type="button"
											variant="ghost"
											className="h-auto justify-start px-0 py-0 text-left font-mono text-xs"
											onClick={() => onOpenRun(item.runId as string)}
										>
											{item.runId}
										</Button>
										<span className="text-xs text-muted-foreground">
											{typeof item.runStatus === "string"
												? item.runStatus
												: "-"}
										</span>
										{typeof item.requestId === "string" ? (
											<span className="text-xs text-muted-foreground">
												{item.requestId}
											</span>
										) : null}
									</div>
								) : (
									"-"
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
