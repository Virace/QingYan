import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";

import {
	getImportJob,
	listImportJobs,
	type ImportJobBackup,
	type ImportJobListItem,
} from "@/api/import-export";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

import { Field, inputClass } from "../shared/admin-ui";
import { formatAdminDateTime } from "../shared/time-format";

function formatSummary(value: unknown) {
	if (!value || typeof value !== "object") {
		return "-";
	}
	return JSON.stringify(value, null, 2);
}

function backupLabel(backup: ImportJobBackup | null) {
	return backup ? `${backup.engine} / ${backup.strategy}` : "未生成";
}

function statusVariant(status: string) {
	if (status === "applied") {
		return "default" as const;
	}
	if (status.includes("failed")) {
		return "destructive" as const;
	}
	return "secondary" as const;
}

function BackupPanel({ backup }: { backup: ImportJobBackup | null }) {
	if (!backup) {
		return <p className="text-sm text-muted-foreground">未生成数据库备份。</p>;
	}

	return (
		<div className="space-y-3 text-sm">
			<div className="grid gap-3 md:grid-cols-2">
				<div>
					<p className="text-xs text-muted-foreground">引擎</p>
					<p className="font-medium">{backup.engine}</p>
				</div>
				<div>
					<p className="text-xs text-muted-foreground">策略</p>
					<p className="font-medium">{backup.strategy}</p>
				</div>
				<div>
					<p className="text-xs text-muted-foreground">创建时间</p>
					<p className="font-medium">{formatAdminDateTime(backup.createdAt)}</p>
				</div>
				<div>
					<p className="text-xs text-muted-foreground">备份目录</p>
					<p className="break-all font-medium">{backup.backupDirectory}</p>
				</div>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full min-w-[720px] text-left text-xs">
					<thead>
						<tr className="border-b text-muted-foreground">
							<th className="p-2 font-medium">文件</th>
							<th className="p-2 font-medium">状态</th>
							<th className="p-2 font-medium">备份路径</th>
							<th className="p-2 font-medium">大小</th>
						</tr>
					</thead>
					<tbody>
						{backup.files.map((file) => (
							<tr key={`${file.role}-${file.path}`} className="border-b">
								<td className="p-2">{file.role}</td>
								<td className="p-2">{file.present ? "present" : "absent"}</td>
								<td className="break-all p-2">{file.backupPath ?? "-"}</td>
								<td className="p-2">{file.size ?? "-"}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function JobDetail({ job }: { job: ImportJobListItem }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">任务详情</CardTitle>
				<CardDescription>{job.id}</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<div className="grid gap-3 md:grid-cols-4">
					<div>
						<p className="text-xs text-muted-foreground">状态</p>
						<Badge variant={statusVariant(job.status)}>{job.status}</Badge>
					</div>
					<div>
						<p className="text-xs text-muted-foreground">来源</p>
						<p className="font-medium">{job.sourceType}</p>
					</div>
					<div>
						<p className="text-xs text-muted-foreground">文件</p>
						<p className="break-all font-medium">{job.sourceFileName}</p>
					</div>
					<div>
						<p className="text-xs text-muted-foreground">应用时间</p>
						<p className="font-medium">{formatAdminDateTime(job.appliedAt)}</p>
					</div>
				</div>
				<div>
					<p className="mb-2 text-sm font-medium">数据库备份</p>
					<BackupPanel backup={job.backup} />
				</div>
				<div className="grid gap-3 md:grid-cols-2">
					<div>
						<p className="mb-2 text-sm font-medium">摘要</p>
						<pre className="max-h-80 overflow-auto rounded-md border bg-muted/30 p-3 text-xs">
							{formatSummary(job.summary)}
						</pre>
					</div>
					<div>
						<p className="mb-2 text-sm font-medium">错误</p>
						<pre className="max-h-80 overflow-auto rounded-md border bg-muted/30 p-3 text-xs">
							{formatSummary(job.error)}
						</pre>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

export function ImportJobsPage({ siteKey }: { siteKey: string }) {
	const [status, setStatus] = useState("");
	const [sourceType, setSourceType] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const jobsQuery = useQuery({
		queryKey: ["admin", "import-jobs", siteKey, status, sourceType],
		queryFn: () =>
			listImportJobs({
				siteKey,
				status: status || undefined,
				sourceType: sourceType || undefined,
				limit: 50,
			}),
	});
	const detailQuery = useQuery({
		queryKey: ["admin", "import-job", selectedId],
		queryFn: () => getImportJob(selectedId ?? ""),
		enabled: Boolean(selectedId),
	});
	const selectedJob = detailQuery.data?.job;

	return (
		<div className="flex flex-col gap-4">
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">导入任务记录</CardTitle>
					<CardDescription>
						查看导入任务状态、结果摘要和导入前数据库备份。
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
						<Field label="状态">
							<select
								className={inputClass}
								value={status}
								onChange={(event) => setStatus(event.target.value)}
							>
								<option value="">全部</option>
								<option value="analyzed">analyzed</option>
								<option value="planned">planned</option>
								<option value="dry_run_passed">dry_run_passed</option>
								<option value="dry_run_failed">dry_run_failed</option>
								<option value="applied">applied</option>
								<option value="apply_failed">apply_failed</option>
							</select>
						</Field>
						<Field label="来源">
							<select
								className={inputClass}
								value={sourceType}
								onChange={(event) => setSourceType(event.target.value)}
							>
								<option value="">全部</option>
								<option value="wordpress-wxr">wordpress-wxr</option>
								<option value="qingyan-export">qingyan-export</option>
							</select>
						</Field>
						<div className="flex items-end">
							<Button
								type="button"
								variant="outline"
								onClick={() => jobsQuery.refetch()}
								disabled={jobsQuery.isFetching}
							>
								<RefreshCwIcon data-icon="inline-start" />
								{jobsQuery.isFetching ? "刷新中" : "刷新"}
							</Button>
						</div>
					</div>
					<div className="overflow-x-auto">
						<table className="w-full min-w-[1040px] text-left text-sm">
							<thead>
								<tr className="border-b text-xs text-muted-foreground">
									<th className="p-2 font-medium">状态</th>
									<th className="p-2 font-medium">来源</th>
									<th className="p-2 font-medium">文件</th>
									<th className="p-2 font-medium">备份</th>
									<th className="p-2 font-medium">创建</th>
									<th className="p-2 font-medium">更新</th>
									<th className="p-2 font-medium">应用</th>
									<th className="p-2 font-medium">操作</th>
								</tr>
							</thead>
							<tbody>
								{jobsQuery.data?.items.map((job) => (
									<tr key={job.id} className="border-b align-top">
										<td className="p-2">
											<Badge variant={statusVariant(job.status)}>
												{job.status}
											</Badge>
										</td>
										<td className="p-2">{job.sourceType}</td>
										<td className="max-w-72 break-all p-2">
											{job.sourceFileName}
										</td>
										<td className="p-2">{backupLabel(job.backup)}</td>
										<td className="p-2">
											{formatAdminDateTime(job.createdAt)}
										</td>
										<td className="p-2">
											{formatAdminDateTime(job.updatedAt)}
										</td>
										<td className="p-2">
											{formatAdminDateTime(job.appliedAt)}
										</td>
										<td className="p-2">
											<Button
												type="button"
												variant={
													selectedId === job.id ? "secondary" : "outline"
												}
												size="sm"
												onClick={() => setSelectedId(job.id)}
											>
												查看
											</Button>
										</td>
									</tr>
								))}
								{jobsQuery.data?.items.length === 0 ? (
									<tr>
										<td
											className="p-4 text-center text-sm text-muted-foreground"
											colSpan={8}
										>
											暂无导入任务。
										</td>
									</tr>
								) : null}
							</tbody>
						</table>
					</div>
				</CardContent>
			</Card>
			{selectedJob ? <JobDetail job={selectedJob} /> : null}
		</div>
	);
}
