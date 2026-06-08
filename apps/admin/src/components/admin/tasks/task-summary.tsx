import type { AdminTaskCenterItem } from "@/api/ops";
import { Badge } from "@/components/ui/badge";

import { summarizeTask } from "./task-summary-model";

export function TaskSummary({ job }: { job: AdminTaskCenterItem }) {
	const summary = summarizeTask(job);

	return (
		<div className="rounded-md border p-3 text-sm">
			<div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
				<div>
					<p className="font-medium">{summary.title}</p>
					<p className="mt-1 break-all text-xs text-muted-foreground">
						{summary.description}
					</p>
				</div>
				<Badge variant={job.status === "failed" ? "destructive" : "secondary"}>
					{job.status}
				</Badge>
			</div>

			<div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
				{summary.metrics.map((metric) => (
					<div key={metric.label} className="rounded-md bg-muted/40 px-2 py-1">
						<p className="text-xs text-muted-foreground">{metric.label}</p>
						<p className="font-medium">{metric.value}</p>
					</div>
				))}
			</div>

			{summary.errors.length > 0 ? (
				<div className="mt-3 space-y-1 text-xs text-destructive">
					{summary.errors.map((error) => (
						<p key={`${error.label}:${error.message}`}>
							{error.label}: {error.message}
						</p>
					))}
				</div>
			) : null}

			{summary.rawSections.length > 0 ? (
				<details className="mt-3">
					<summary className="cursor-pointer text-xs text-muted-foreground">
						查看原始数据
					</summary>
					<div className="mt-2 space-y-2">
						{summary.rawSections.map((section) => (
							<div key={section.label}>
								<p className="mb-1 text-xs font-medium text-muted-foreground">
									{section.label}
								</p>
								<pre className="max-h-48 overflow-auto rounded-md bg-muted/40 p-2 text-xs">
									{JSON.stringify(section.value, null, 2)}
								</pre>
							</div>
						))}
					</div>
				</details>
			) : null}
		</div>
	);
}
