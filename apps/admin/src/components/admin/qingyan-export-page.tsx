import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { DownloadIcon } from "lucide-react";

import { exportQingYanData } from "@/api/import-export";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

function downloadJson(fileName: string, payload: unknown) {
	const blob = new Blob([JSON.stringify(payload, null, 2)], {
		type: "application/json",
	});
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = fileName;
	anchor.click();
	URL.revokeObjectURL(url);
}

export function QingYanExportPage({ siteKey }: { siteKey: string }) {
	const [include, setInclude] = useState({
		runtimeSettings: true,
		pageThreads: true,
		comments: true,
		visitors: true,
		voteRecords: true,
		pageFeedbackRecords: true,
		blacklistRules: true,
	});
	const exportMutation = useMutation({
		mutationFn() {
			return exportQingYanData({ siteKey, include });
		},
		onSuccess(payload) {
			const date = new Date().toISOString().slice(0, 10);
			downloadJson(`qingyan-${siteKey}-${date}.json`, payload);
		},
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">QingYan JSON 导出</CardTitle>
				<CardDescription>导出 site-scoped qingyan.export.v1。</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
					{Object.entries(include).map(([key, value]) => (
						<label key={key} className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={value}
								onChange={(event) =>
									setInclude({
										...include,
										[key]: event.target.checked,
									})
								}
							/>
							{key}
						</label>
					))}
				</div>
				<div>
					<Button
						type="button"
						onClick={() => exportMutation.mutate()}
						disabled={exportMutation.isPending || !siteKey}
					>
						<DownloadIcon data-icon="inline-start" />
						{exportMutation.isPending ? "导出中" : "导出 JSON"}
					</Button>
				</div>
				{exportMutation.data ? (
					<div className="grid gap-3 md:grid-cols-4">
						{[
							["页面", exportMutation.data.data.pageThreads.length],
							["访客", exportMutation.data.data.visitors.length],
							["评论", exportMutation.data.data.comments.length],
							["黑名单", exportMutation.data.data.blacklistRules.length],
						].map(([label, value]) => (
							<div key={label} className="rounded-md border p-3">
								<p className="text-xs text-muted-foreground">{label}</p>
								<p className="mt-1 text-xl font-semibold">{value}</p>
							</div>
						))}
					</div>
				) : null}
				{exportMutation.error ? (
					<Alert variant="destructive">
						<AlertTitle>导出失败</AlertTitle>
						<AlertDescription>
							{exportMutation.error instanceof Error
								? exportMutation.error.message
								: "请求失败。"}
						</AlertDescription>
					</Alert>
				) : null}
			</CardContent>
		</Card>
	);
}
