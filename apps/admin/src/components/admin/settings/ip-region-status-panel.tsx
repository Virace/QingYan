import { useQuery } from "@tanstack/react-query";

import { fetchIpRegionMaintenanceStatus } from "@/api/ops";

import { SettingsSection } from "../shared/admin-ui";
import { ExternalLinkText } from "../shared/external-link-text";
import { formatAdminDateTime } from "../shared/time-format";

export function IpRegionStatusPanel() {
	const query = useQuery({
		queryKey: ["admin", "ops", "ip-region"],
		queryFn: fetchIpRegionMaintenanceStatus,
		refetchInterval: (state) =>
			state.state.data?.recentJobs.some((job) =>
				["queued", "delayed", "running", "retrying"].includes(job.status),
			)
				? 2000
				: false,
	});

	return (
		<SettingsSection
			title="当前状态与最近检查"
			description="IP 库检查与评论地址刷新在任务中心执行，结果和执行日志保存在任务记录中。"
		>
			{query.isError ? (
				<p className="text-xs text-destructive">
					无法读取当前 IP 库状态，请刷新页面后重试。
				</p>
			) : null}
			<div className="grid gap-3 md:grid-cols-3">
				{(["v4", "v6"] as const).map((version) => {
					const state = query.data?.databases.find(
						(database) => database.ipVersion === version,
					);
					const active = Boolean(
						state?.filePath && state.fileHash && state.activatedAt,
					);
					return (
						<div
							key={version}
							className="min-w-0 rounded-md border bg-background p-3"
						>
							<p className="text-xs text-muted-foreground">
								{version === "v4" ? "IPv4" : "IPv6"}
							</p>
							<p className="mt-1 text-sm font-medium">
								{query.isLoading
									? "正在读取"
									: query.isError
										? "状态暂不可用"
										: active
											? "已激活"
											: "未激活"}
							</p>
							{active ? (
								<>
									<p className="mt-1 text-xs text-muted-foreground">
										激活于 {formatAdminDateTime(state?.activatedAt)}
									</p>
									<p
										className="mt-1 truncate text-xs text-muted-foreground"
										title={state?.fileHash ?? undefined}
									>
										Hash {state?.fileHash?.slice(0, 10)}…
									</p>
									<p
										className="truncate text-xs text-muted-foreground"
										title={state?.filePath ?? undefined}
									>
										{state?.filePath}
									</p>
								</>
							) : null}
							{state?.sourceUrl ? (
								<ExternalLinkText
									href={state.sourceUrl}
									className="mt-1 text-xs"
								>
									{state.sourceUrl}
								</ExternalLinkText>
							) : null}
							<p className="mt-2 text-xs text-muted-foreground">
								最近检查：
								{state?.lastCheckedAt
									? formatAdminDateTime(state.lastCheckedAt)
									: "尚未检查"}
							</p>
							{state?.lastCheckStatus ? (
								<p
									className={`mt-1 break-words text-xs ${state.lastCheckStatus === "failed" ? "text-destructive" : "text-muted-foreground"}`}
								>
									{state.lastCheckStatus === "success"
										? "更新成功"
										: state.lastCheckStatus === "failed"
											? "检查失败"
											: state.lastCheckReason === "ip_region_disabled"
												? "IP 地域功能已关闭"
												: state.lastCheckReason === "unchanged"
													? "当前已是最新版本"
													: "本次未更新"}
									{state.lastCheckError
										? "。请检查本页下载来源与配置，保存后在任务中心重试；详细原因可查看任务记录或服务日志。"
										: ""}
								</p>
							) : null}
						</div>
					);
				})}
				<div className="min-w-0 rounded-md border bg-background p-3">
					<p className="text-xs text-muted-foreground">评论地址</p>
					<p className="mt-1 text-sm font-medium">
						{query.data?.commentMetadata.totalWithIp ?? "-"} 条有 IP
					</p>
					<p className="mt-1 text-xs text-muted-foreground">
						缺失 {query.data?.commentMetadata.missingLocation ?? "-"} / 失败{" "}
						{query.data?.commentMetadata.failedLocation ?? "-"}
					</p>
				</div>
			</div>
		</SettingsSection>
	);
}
