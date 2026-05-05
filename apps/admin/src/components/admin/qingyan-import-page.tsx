import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FileSearchIcon, UploadIcon } from "lucide-react";

import {
	applyQingYanImportJob,
	dryRunQingYanImport,
} from "@/api/import-export";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

import { Field, inputClass } from "./admin-ui";

export function QingYanImportPage({ siteKey }: { siteKey: string }) {
	const [file, setFile] = useState<File | null>(null);
	const [existingStrategy, setExistingStrategy] = useState<
		"fail_on_existing" | "skip_existing"
	>("fail_on_existing");
	const dryRunMutation = useMutation({
		async mutationFn() {
			if (!file) {
				throw new Error("请选择 QingYan JSON 文件。");
			}
			return dryRunQingYanImport({
				siteKey,
				fileName: file.name,
				payload: JSON.parse(await file.text()) as unknown,
				existingStrategy,
			});
		},
	});
	const applyMutation = useMutation({
		mutationFn(jobId: string) {
			return applyQingYanImportJob(jobId, { existingStrategy });
		},
	});
	const canApply =
		dryRunMutation.data?.job.status === "dry_run_passed" &&
		dryRunMutation.data.dryRun.summary.conflicts === 0 &&
		!applyMutation.data;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">QingYan JSON 导入</CardTitle>
				<CardDescription>
					导入 qingyan.export.v1，先 dry-run，再 apply。
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<div className="grid gap-3 md:grid-cols-3">
					<Field label="siteKey">
						<input className={inputClass} value={siteKey} readOnly />
					</Field>
					<Field label="JSON 文件">
						<input
							className={inputClass}
							type="file"
							accept="application/json,.json"
							onChange={(event) =>
								setFile(event.currentTarget.files?.[0] ?? null)
							}
						/>
					</Field>
					<Field label="existingStrategy">
						<select
							className={inputClass}
							value={existingStrategy}
							onChange={(event) =>
								setExistingStrategy(
									event.target.value as "fail_on_existing" | "skip_existing",
								)
							}
						>
							<option value="fail_on_existing">fail_on_existing</option>
							<option value="skip_existing">skip_existing</option>
						</select>
					</Field>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						variant="outline"
						onClick={() => dryRunMutation.mutate()}
						disabled={dryRunMutation.isPending || !siteKey}
					>
						<FileSearchIcon data-icon="inline-start" />
						{dryRunMutation.isPending ? "检查中" : "Dry-run"}
					</Button>
					<Button
						type="button"
						disabled={!canApply || applyMutation.isPending}
						onClick={() =>
							dryRunMutation.data
								? applyMutation.mutate(dryRunMutation.data.job.id)
								: undefined
						}
					>
						<UploadIcon data-icon="inline-start" />
						{applyMutation.isPending ? "导入中" : "Apply"}
					</Button>
				</div>
				{dryRunMutation.data ? (
					<div className="grid gap-3 md:grid-cols-3">
						{[
							[
								"创建页面",
								dryRunMutation.data.dryRun.summary.willCreatePageThreads,
							],
							[
								"复用页面",
								dryRunMutation.data.dryRun.summary.willReusePageThreads,
							],
							[
								"创建访客",
								dryRunMutation.data.dryRun.summary.willCreateVisitors,
							],
							[
								"创建评论",
								dryRunMutation.data.dryRun.summary.willCreateComments,
							],
							[
								"跳过评论",
								dryRunMutation.data.dryRun.summary.willSkipExistingComments,
							],
							["冲突", dryRunMutation.data.dryRun.summary.conflicts],
						].map(([label, value]) => (
							<div key={label} className="rounded-md border p-3">
								<p className="text-xs text-muted-foreground">{label}</p>
								<p className="mt-1 text-xl font-semibold">{value}</p>
							</div>
						))}
					</div>
				) : null}
				{applyMutation.data ? (
					<div className="grid gap-3 md:grid-cols-4">
						{[
							["页面", applyMutation.data.apply.summary.createdPageThreads],
							["访客", applyMutation.data.apply.summary.createdVisitors],
							["评论", applyMutation.data.apply.summary.createdComments],
							["记录", applyMutation.data.apply.summary.importRecordsCreated],
						].map(([label, value]) => (
							<div key={label} className="rounded-md border p-3">
								<p className="text-xs text-muted-foreground">{label}</p>
								<p className="mt-1 text-xl font-semibold">{value}</p>
							</div>
						))}
					</div>
				) : null}
				{dryRunMutation.error || applyMutation.error ? (
					<Alert variant="destructive">
						<AlertTitle>导入失败</AlertTitle>
						<AlertDescription>
							{(dryRunMutation.error ?? applyMutation.error) instanceof Error
								? (dryRunMutation.error ?? applyMutation.error)?.message
								: "请求失败。"}
						</AlertDescription>
					</Alert>
				) : null}
			</CardContent>
		</Card>
	);
}
