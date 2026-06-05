import { useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";

import {
	fetchOpsStatus,
	fetchServiceControlStatus,
	fetchUpdateCheck,
	fetchUpdatePlan,
	fetchUpgradeDryRun,
	restartService,
	type UpdateCheckState,
	type UpdatePlan,
} from "@/api/ops";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

import { EmptyState } from "../shared/admin-ui";

function StateText({ state }: { state?: string }) {
	if (state === "normal_current") {
		return <span className="font-medium text-emerald-700">当前版本</span>;
	}
	if (state === "upgrade_required") {
		return <span className="font-medium text-amber-700">需要升级</span>;
	}
	if (state === "recovery_required" || state === "broken_config") {
		return <span className="font-medium text-destructive">需要人工处理</span>;
	}
	return <span className="font-medium text-muted-foreground">未知</span>;
}

function UpdateCheckStateText({ state }: { state: UpdateCheckState }) {
	const label = {
		not_checked: "尚未检查",
		no_release: "尚未发布 Release",
		current: "当前已是最新版本",
		update_available: "发现新版本",
		unsupported_release: "Release 不符合自动更新规则",
		check_failed: "检查失败",
	}[state];
	const className =
		state === "update_available"
			? "font-medium text-amber-700"
			: state === "check_failed" || state === "unsupported_release"
				? "font-medium text-destructive"
				: state === "current"
					? "font-medium text-emerald-700"
					: "font-medium";
	return <span className={className}>{label}</span>;
}

function ServiceStateText({ state }: { state?: string }) {
	if (state === "running") {
		return <span className="font-medium text-emerald-700">运行中</span>;
	}
	if (state === "stopped") {
		return <span className="font-medium text-amber-700">已停止</span>;
	}
	return <span className="font-medium text-muted-foreground">未知</span>;
}

function CommandList({ commands }: { commands: string[] }) {
	return (
		<div className="rounded-md border bg-muted/40 p-3">
			{commands.map((command) => (
				<code key={command} className="block text-xs leading-6">
					{command}
				</code>
			))}
		</div>
	);
}

function UpdatePlanPanel({ plan }: { plan?: UpdatePlan }) {
	if (!plan) {
		return null;
	}

	return (
		<div className="grid gap-3">
			<h3 className="text-sm font-semibold">更新执行计划</h3>
			<div className="rounded-md border p-3">
				<p className="text-xs text-muted-foreground">执行入口</p>
				<p className="mt-1 text-sm font-medium">{plan.executor}</p>
			</div>
			<div className="rounded-md border p-3">
				<p className="text-xs text-muted-foreground">预计不可用时间</p>
				<p className="mt-1 text-sm font-medium">
					{plan.estimatedRestartSeconds.min}-{plan.estimatedRestartSeconds.max}{" "}
					秒
				</p>
			</div>
			<div className="rounded-md border p-3">
				<p className="text-xs text-muted-foreground">执行步骤</p>
				<ol className="mt-2 grid gap-1 text-sm">
					{plan.steps.map((step, index) => (
						<li key={step}>
							{index + 1}. {step}
						</li>
					))}
				</ol>
			</div>
		</div>
	);
}

export function OpsPage() {
	const restartConfirmId = useId();
	const [restartConfirm, setRestartConfirm] = useState("");
	const statusQuery = useQuery({
		queryKey: ["admin", "ops", "status"],
		queryFn: fetchOpsStatus,
	});
	const serviceControlQuery = useQuery({
		queryKey: ["admin", "ops", "service-control"],
		queryFn: fetchServiceControlStatus,
	});
	const updatePlanMutation = useMutation({
		mutationFn: fetchUpdatePlan,
	});
	const updateCheckMutation = useMutation({
		mutationFn: fetchUpdateCheck,
	});
	const upgradeDryRunMutation = useMutation({
		mutationFn: fetchUpgradeDryRun,
	});
	const restartMutation = useMutation({
		mutationFn: restartService,
		onSuccess: () => {
			setRestartConfirm("");
			void serviceControlQuery.refetch();
		},
	});
	const status = statusQuery.data;
	const serviceControl = serviceControlQuery.data;
	const updatePlan = updatePlanMutation.data;
	const updateCheck = updateCheckMutation.data ?? status?.update.check;
	return (
		<div className="flex flex-col gap-4">
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">运维</CardTitle>
					<CardDescription>
						查看程序版本、数据升级状态、整站备份格式和更新执行入口。
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3 md:grid-cols-4">
					{status ? (
						<>
							<div className="rounded-md border p-3">
								<p className="text-xs text-muted-foreground">当前版本</p>
								<p className="mt-1 text-sm font-medium">
									{status.version.current}
								</p>
							</div>
							<div className="rounded-md border p-3">
								<p className="text-xs text-muted-foreground">数据升级</p>
								<p className="mt-1 text-sm">
									<StateText state={status.upgrade.state} />
								</p>
							</div>
							<div className="rounded-md border p-3">
								<p className="text-xs text-muted-foreground">整站备份</p>
								<p className="mt-1 text-sm font-medium">
									{status.backup.format} / {status.backup.provider}
								</p>
							</div>
							<div className="rounded-md border p-3">
								<p className="text-xs text-muted-foreground">更新入口</p>
								<p className="mt-1 text-sm font-medium">
									{status.update.entry}
								</p>
							</div>
						</>
					) : null}
					{statusQuery.isLoading ? <EmptyState text="加载中" /> : null}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="text-lg">程序更新</CardTitle>
					<CardDescription>
						程序更新由系统服务动作或外部 shell 脚本执行，更新脚本会调用 qyctl
						upgrade 完成数据升级。
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3">
					<p className="text-sm text-muted-foreground">
						{status?.update.description ?? "程序更新入口尚未加载。"}
					</p>
					<div className="grid gap-3 rounded-md border p-3">
						<h3 className="text-sm font-semibold">更新检测</h3>
						<div className="grid gap-3 md:grid-cols-3">
							<div>
								<p className="text-xs text-muted-foreground">当前版本</p>
								<p className="mt-1 text-sm font-medium">
									{updateCheck?.currentVersion ?? "加载中"}
								</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">更新源</p>
								<p className="mt-1 text-sm font-medium">
									{updateCheck
										? `GitHub Release / ${updateCheck.source.owner}/${updateCheck.source.repo}`
										: "加载中"}
								</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">状态</p>
								<p className="mt-1 text-sm">
									{updateCheck ? (
										<UpdateCheckStateText state={updateCheck.state} />
									) : (
										"加载中"
									)}
								</p>
							</div>
						</div>
						{updateCheck?.latestVersion ? (
							<p className="text-sm">最新版本：{updateCheck.latestVersion}</p>
						) : null}
						<p className="text-sm text-muted-foreground">
							{updateCheck?.message ?? "尚未载入更新检测状态。"}
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							variant="outline"
							onClick={() => updateCheckMutation.mutate()}
							disabled={updateCheckMutation.isPending}
						>
							<RefreshCwIcon data-icon="inline-start" />
							检查更新
						</Button>
						<Button
							type="button"
							variant="outline"
							onClick={() => updatePlanMutation.mutate()}
							disabled={updatePlanMutation.isPending}
						>
							<RefreshCwIcon data-icon="inline-start" />
							查看更新计划
						</Button>
						<Button
							type="button"
							variant="outline"
							onClick={() => upgradeDryRunMutation.mutate()}
							disabled={upgradeDryRunMutation.isPending}
						>
							数据升级预检
						</Button>
					</div>
					<UpdatePlanPanel plan={updatePlan} />
					{upgradeDryRunMutation.data ? (
						<div className="grid gap-2">
							<h3 className="text-sm font-semibold">数据库升级检查</h3>
							<pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
								{JSON.stringify(upgradeDryRunMutation.data, null, 2)}
							</pre>
						</div>
					) : null}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="text-lg">服务控制</CardTitle>
					<CardDescription>
						服务重启只在后端启用系统服务控制后可用；请求会写入审计日志。
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4">
					<div className="grid gap-3 md:grid-cols-3">
						<div className="rounded-md border p-3">
							<p className="text-xs text-muted-foreground">控制模式</p>
							<p className="mt-1 text-sm font-medium">
								{serviceControl?.mode ?? "加载中"}
							</p>
						</div>
						<div className="rounded-md border p-3">
							<p className="text-xs text-muted-foreground">服务单元</p>
							<p className="mt-1 text-sm font-medium">
								{serviceControl?.unit ?? "-"}
							</p>
						</div>
						<div className="rounded-md border p-3">
							<p className="text-xs text-muted-foreground">服务状态</p>
							<p className="mt-1 text-sm">
								<ServiceStateText state={serviceControl?.state} />
							</p>
						</div>
					</div>
					<div className="grid gap-3 md:grid-cols-[1fr_auto]">
						<label className="grid gap-1 text-sm" htmlFor={restartConfirmId}>
							<span className="text-muted-foreground">重启确认</span>
							<Input
								id={restartConfirmId}
								value={restartConfirm}
								placeholder={serviceControl?.restart.confirmation}
								disabled={!serviceControl?.enabled || restartMutation.isPending}
								onChange={(event) => setRestartConfirm(event.target.value)}
							/>
						</label>
						<Button
							type="button"
							variant="destructive"
							className="self-end"
							disabled={
								!serviceControl?.enabled ||
								restartMutation.isPending ||
								restartConfirm !== serviceControl.restart.confirmation
							}
							onClick={() =>
								restartMutation.mutate({ confirm: restartConfirm })
							}
						>
							重启服务
						</Button>
					</div>
					{serviceControl?.enabled ? null : (
						<p className="text-xs text-muted-foreground">
							当前未启用服务控制。后端设置 QINGYAN_ADMIN_SERVICE_CONTROL=systemd
							后，管理员可在此执行重启。
						</p>
					)}
					{restartMutation.isError ? (
						<p className="text-xs text-destructive">服务重启请求失败。</p>
					) : null}
					{restartMutation.isSuccess ? (
						<p className="text-xs text-emerald-700">服务重启请求已提交。</p>
					) : null}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="text-lg">启动检查</CardTitle>
					<CardDescription>
						更新期间后端会短暂不可用；若 30-60
						秒后仍未恢复，可从这些命令开始检查。
					</CardDescription>
				</CardHeader>
				<CardContent>
					<CommandList commands={status?.recovery.manualCommands ?? []} />
				</CardContent>
			</Card>
		</div>
	);
}
