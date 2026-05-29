import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import {
	createCommentIpRefreshJob,
	createIpRegionUpdateJob,
	fetchIpRegionMaintenanceStatus,
	type IpVersion,
} from "@/api/ops";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

import { inputClass } from "./admin-ui";
import { ExternalLinkText } from "./external-link-text";
import {
	defaultTaskExecutionOptions,
	TaskExecutionOptionsFields,
	toTaskExecutionOptions,
} from "./task-execution-options";

type CommentIpRefreshScope = "missing" | "failed" | "stale" | "all";
type IpVersionSelection = "all" | IpVersion;
type SiteSelection = "current" | "all";

function shortHash(hash?: string | null) {
	return hash ? `${hash.slice(0, 10)}...` : "-";
}

function selectedIpVersions(selection: IpVersionSelection): IpVersion[] {
	return selection === "all" ? ["v4", "v6"] : [selection];
}

export function IpMaintenanceTaskPanel({ siteKey }: { siteKey: string }) {
	const queryClient = useQueryClient();
	const [refreshScope, setRefreshScope] =
		useState<CommentIpRefreshScope>("missing");
	const [refreshIpVersion, setRefreshIpVersion] =
		useState<IpVersionSelection>("all");
	const [refreshSite, setRefreshSite] = useState<SiteSelection>("current");
	const [executionOptions, setExecutionOptions] = useState(
		defaultTaskExecutionOptions({
			batchSize: "500",
			maxBytes: "",
			timeoutMs: "",
		}),
	);
	const ipRegionQuery = useQuery({
		queryKey: ["admin", "ops", "ip-region"],
		queryFn: fetchIpRegionMaintenanceStatus,
		refetchInterval: (query) =>
			query.state.data?.recentJobs.some((job) =>
				["queued", "delayed", "running", "retrying"].includes(job.status),
			)
				? 2000
				: false,
	});
	const invalidate = () => {
		void ipRegionQuery.refetch();
		void queryClient.invalidateQueries({ queryKey: ["admin", "tasks"] });
	};
	const ipRegionUpdateMutation = useMutation({
		mutationFn: createIpRegionUpdateJob,
		onSuccess: invalidate,
	});
	const commentIpRefreshMutation = useMutation({
		mutationFn: createCommentIpRefreshJob,
		onSuccess: invalidate,
	});
	const activeJob = ipRegionQuery.data?.recentJobs.find((job) =>
		["queued", "delayed", "running", "retrying"].includes(job.status),
	);
	const refreshDisabled =
		commentIpRefreshMutation.isPending ||
		Boolean(activeJob) ||
		!ipRegionQuery.data?.databases.length ||
		(refreshSite === "current" && !siteKey);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">IP 地域与评论地址维护</CardTitle>
				<CardDescription>
					检查 IP 库更新，并刷新评论 IP
					派生信息；操作会创建维护任务，执行状态可在任务中心统一查看。
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-4">
				<div className="grid gap-3 md:grid-cols-3">
					{(["v4", "v6"] as const).map((version) => {
						const state = ipRegionQuery.data?.databases.find(
							(item) => item.ipVersion === version,
						);
						return (
							<div key={version} className="rounded-md border p-3">
								<p className="text-xs text-muted-foreground">
									{version === "v4" ? "IPv4" : "IPv6"}
								</p>
								<p className="mt-1 text-sm font-medium">
									{state ? "已激活" : "未激活"}
								</p>
								<p className="mt-1 truncate text-xs text-muted-foreground">
									Hash {shortHash(state?.fileHash)}
								</p>
								<p className="truncate text-xs text-muted-foreground">
									{state?.filePath ?? "-"}
								</p>
								{state?.sourceUrl ? (
									<ExternalLinkText
										href={state.sourceUrl}
										className="mt-1 text-xs"
									>
										{state.sourceUrl}
									</ExternalLinkText>
								) : null}
							</div>
						);
					})}
					<div className="rounded-md border p-3">
						<p className="text-xs text-muted-foreground">评论地址</p>
						<p className="mt-1 text-sm font-medium">
							{ipRegionQuery.data?.commentMetadata.totalWithIp ?? "-"} 条有 IP
						</p>
						<p className="text-xs text-muted-foreground">
							缺失 {ipRegionQuery.data?.commentMetadata.missingLocation ?? "-"}{" "}
							/ 失败 {ipRegionQuery.data?.commentMetadata.failedLocation ?? "-"}
						</p>
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						variant="outline"
						disabled={ipRegionUpdateMutation.isPending || Boolean(activeJob)}
						onClick={() =>
							ipRegionUpdateMutation.mutate({
								ipVersions: ["v4"],
								...toTaskExecutionOptions(executionOptions),
							})
						}
					>
						<RefreshCwIcon data-icon="inline-start" />
						检查 IPv4
					</Button>
					<Button
						type="button"
						variant="outline"
						disabled={ipRegionUpdateMutation.isPending || Boolean(activeJob)}
						onClick={() =>
							ipRegionUpdateMutation.mutate({
								ipVersions: ["v6"],
								...toTaskExecutionOptions(executionOptions),
							})
						}
					>
						<RefreshCwIcon data-icon="inline-start" />
						检查 IPv6
					</Button>
					<Button
						type="button"
						variant="outline"
						disabled={ipRegionUpdateMutation.isPending || Boolean(activeJob)}
						onClick={() =>
							ipRegionUpdateMutation.mutate({
								ipVersions: ["v4", "v6"],
								...toTaskExecutionOptions(executionOptions),
							})
						}
					>
						<RefreshCwIcon data-icon="inline-start" />
						检查全部
					</Button>
				</div>
				<TaskExecutionOptionsFields
					value={executionOptions}
					onChange={setExecutionOptions}
					showMaxBytes={false}
				/>
				<div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
					<label className="grid gap-1 text-sm">
						<span className="text-muted-foreground">刷新范围</span>
						<select
							className={inputClass}
							value={refreshScope}
							onChange={(event) =>
								setRefreshScope(event.target.value as CommentIpRefreshScope)
							}
						>
							<option value="missing">缺失地址</option>
							<option value="failed">失败地址</option>
							<option value="stale">过期地址</option>
							<option value="all">全部地址</option>
						</select>
					</label>
					<label className="grid gap-1 text-sm">
						<span className="text-muted-foreground">IP 版本</span>
						<select
							className={inputClass}
							value={refreshIpVersion}
							onChange={(event) =>
								setRefreshIpVersion(event.target.value as IpVersionSelection)
							}
						>
							<option value="all">全部</option>
							<option value="v4">IPv4</option>
							<option value="v6">IPv6</option>
						</select>
					</label>
					<label className="grid gap-1 text-sm">
						<span className="text-muted-foreground">站点范围</span>
						<select
							className={inputClass}
							value={refreshSite}
							onChange={(event) =>
								setRefreshSite(event.target.value as SiteSelection)
							}
						>
							<option value="current">当前站点</option>
							<option value="all">全部站点</option>
						</select>
					</label>
					<Button
						type="button"
						className="self-end"
						disabled={refreshDisabled}
						onClick={() =>
							commentIpRefreshMutation.mutate({
								scope: refreshScope,
								ipVersions: selectedIpVersions(refreshIpVersion),
								siteKey: refreshSite === "current" ? siteKey : undefined,
								...toTaskExecutionOptions(executionOptions),
							})
						}
					>
						刷新评论 IP 信息
					</Button>
				</div>
				{activeJob ? (
					<p className="text-xs text-muted-foreground">
						当前有维护任务运行或等待：{activeJob.type} / {activeJob.status}
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}
