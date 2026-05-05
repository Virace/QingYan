import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
	BanIcon,
	CheckIcon,
	DownloadIcon,
	FileSearchIcon,
	MapPinIcon,
	UploadIcon,
} from "lucide-react";

import {
	analyzeWordPressMigration,
	applyImportJob,
	convertWordPressJobToPlan,
	dryRunImportJob,
	type MigrationReportItem,
	type MigrationItemState,
	type WordPressAnalyzeResult,
} from "@/api/import-export";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

import { Field, inputClass, textareaClass } from "./admin-ui";
import {
	acceptByConfidence,
	acceptCandidate,
	formatMappingOverlay,
	hasBlockingUnresolvedItems,
	type MappingOverlayItem,
	mapToPage,
	skipItem,
} from "./wp-migration-model";

type QueueName = "needsAction" | "confirm" | "ready" | "skipped";

const stateLabels: Record<MigrationItemState, string> = {
	ready: "ready",
	needs_user_mapping: "needs_user_mapping",
	ambiguous: "ambiguous",
	unverified: "unverified",
	conflict: "conflict",
	skipped: "skipped",
};

function queueForItem(item: MigrationReportItem): QueueName {
	const confidence = item.target?.confidence ?? item.evidence.confidence;
	if (
		item.state === "needs_user_mapping" ||
		item.state === "ambiguous" ||
		item.state === "conflict" ||
		(item.state === "unverified" && confidence < 85)
	) {
		return "needsAction";
	}
	if (
		(item.state === "unverified" && confidence >= 70) ||
		(item.state === "ready" && confidence < 100)
	) {
		return "confirm";
	}
	if (item.state === "ready" && confidence >= 85) {
		return "ready";
	}
	return "skipped";
}

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

function summaryEntries(result: WordPressAnalyzeResult) {
	const { summary } = result.report;
	return [
		["总条目", summary.totalItems],
		["ready", summary.ready],
		["needs_user_mapping", summary.needsUserMapping],
		["ambiguous", summary.ambiguous],
		["unverified", summary.unverified],
		["conflict", summary.conflict],
		["skipped", summary.skipped],
		["评论", summary.totalComments],
		["最大深度", summary.maxCommentDepth],
		["警告", summary.warningCount],
	];
}

export function WordPressMigrationPage({ siteKey }: { siteKey: string }) {
	const [file, setFile] = useState<File | null>(null);
	const [sourceBasePath, setSourceBasePath] = useState("/");
	const [targetDistRoot, setTargetDistRoot] = useState("");
	const [pageKeyStrategy, setPageKeyStrategy] = useState(
		"path_without_leading_slash",
	);
	const [postPathTemplate, setPostPathTemplate] = useState("");
	const [pagePathTemplate, setPagePathTemplate] = useState("");
	const [mappingJson, setMappingJson] = useState("");
	const [mappingItems, setMappingItems] = useState<MappingOverlayItem[]>([]);
	const [existingStrategy, setExistingStrategy] = useState<
		"fail_on_existing" | "skip_existing"
	>("fail_on_existing");
	const [manualTargets, setManualTargets] = useState<
		Record<string, { pageKey: string; pageUrl: string }>
	>({});
	const analyzeMutation = useMutation({
		async mutationFn() {
			if (!file) {
				throw new Error("请选择 WXR XML 文件。");
			}
			const mapping =
				mappingItems.length > 0
					? formatMappingOverlay(
							siteKey,
							sourceBasePath.trim() || "/",
							mappingItems,
						)
					: mappingJson.trim()
						? (JSON.parse(mappingJson) as unknown)
						: undefined;
			return analyzeWordPressMigration({
				siteKey,
				fileName: file.name,
				file,
				sourceBasePath: sourceBasePath.trim() || undefined,
				targetDistRoot: targetDistRoot.trim() || undefined,
				pageKeyStrategy,
				postPathTemplate: postPathTemplate.trim() || undefined,
				pagePathTemplate: pagePathTemplate.trim() || undefined,
				mapping,
			});
		},
	});
	const planMutation = useMutation({
		mutationFn(jobId: string) {
			return convertWordPressJobToPlan(jobId);
		},
	});
	const dryRunMutation = useMutation({
		mutationFn(input: {
			jobId: string;
			existingStrategy: "fail_on_existing" | "skip_existing";
		}) {
			return dryRunImportJob(input.jobId, {
				existingStrategy: input.existingStrategy,
			});
		},
	});
	const applyMutation = useMutation({
		mutationFn(input: {
			jobId: string;
			existingStrategy: "fail_on_existing" | "skip_existing";
		}) {
			return applyImportJob(input.jobId, {
				existingStrategy: input.existingStrategy,
			});
		},
	});
	const result = analyzeMutation.data;
	const hasBlockingItems = result
		? hasBlockingUnresolvedItems(result.report.items)
		: true;
	const canApply =
		dryRunMutation.data?.job.status === "dry_run_passed" &&
		dryRunMutation.data.dryRun.summary.conflicts === 0 &&
		!applyMutation.data;
	const queues = useMemo(() => {
		const grouped: Record<QueueName, MigrationReportItem[]> = {
			needsAction: [],
			confirm: [],
			ready: [],
			skipped: [],
		};
		for (const item of result?.report.items ?? []) {
			grouped[queueForItem(item)].push(item);
		}
		return grouped;
	}, [result]);

	return (
		<div className="flex flex-col gap-4">
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">WordPress 评论迁移分析</CardTitle>
					<CardDescription>
						上传 WXR XML 生成迁移 report。当前步骤只分析，不写入数据库。
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<div className="grid gap-3 lg:grid-cols-3">
						<Field label="siteKey">
							<input className={inputClass} value={siteKey} readOnly />
						</Field>
						<Field label="WXR XML">
							<input
								className={inputClass}
								type="file"
								accept=".xml,text/xml,application/xml"
								onChange={(event) => {
									setFile(event.currentTarget.files?.[0] ?? null);
								}}
							/>
						</Field>
						<Field label="sourceBasePath">
							<input
								className={inputClass}
								value={sourceBasePath}
								onChange={(event) => setSourceBasePath(event.target.value)}
							/>
						</Field>
						<Field label="targetDistRoot">
							<input
								className={inputClass}
								value={targetDistRoot}
								onChange={(event) => setTargetDistRoot(event.target.value)}
								placeholder="可选，本机 dist 目录"
							/>
						</Field>
						<Field label="pageKeyStrategy">
							<select
								className={inputClass}
								value={pageKeyStrategy}
								onChange={(event) => setPageKeyStrategy(event.target.value)}
							>
								<option value="path_without_leading_slash">
									path_without_leading_slash
								</option>
								<option value="path_with_leading_slash">
									path_with_leading_slash
								</option>
								<option value="page_url_path">page_url_path</option>
								<option value="custom_template">custom_template</option>
								<option value="explicit_only">explicit_only</option>
							</select>
						</Field>
						<Field label="postPathTemplate">
							<input
								className={inputClass}
								value={postPathTemplate}
								onChange={(event) => setPostPathTemplate(event.target.value)}
								placeholder="%sourceRelativePath%"
							/>
						</Field>
						<Field label="pagePathTemplate">
							<input
								className={inputClass}
								value={pagePathTemplate}
								onChange={(event) => setPagePathTemplate(event.target.value)}
								placeholder="%sourceRelativePath%"
							/>
						</Field>
						<div className="lg:col-span-2">
							<Field label="mapping JSON">
								<textarea
									className={textareaClass}
									value={mappingJson}
									onChange={(event) => setMappingJson(event.target.value)}
									placeholder='{"items":[]}'
								/>
							</Field>
						</div>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							onClick={() => analyzeMutation.mutate()}
							disabled={analyzeMutation.isPending || !siteKey}
						>
							<FileSearchIcon data-icon="inline-start" />
							{analyzeMutation.isPending ? "分析中" : "分析 WXR"}
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={!result}
							onClick={() =>
								result
									? setMappingItems(
											acceptByConfidence(
												mappingItems,
												result.report.items,
												100,
											),
										)
									: undefined
							}
						>
							<CheckIcon data-icon="inline-start" />
							接受 100 分
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={!result}
							onClick={() =>
								result
									? setMappingItems(
											acceptByConfidence(mappingItems, result.report.items, 90),
										)
									: undefined
							}
						>
							<CheckIcon data-icon="inline-start" />
							{"接受 >= 90 分"}
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={!result}
							onClick={() =>
								result
									? downloadJson(
											`wordpress-report-${result.job.id}.json`,
											result.report,
										)
									: undefined
							}
						>
							<DownloadIcon data-icon="inline-start" />
							下载 report
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={!result}
							onClick={() =>
								result
									? downloadJson(
											`wordpress-mapping-${result.job.id}.json`,
											result.suggestedMapping,
										)
									: undefined
							}
						>
							<DownloadIcon data-icon="inline-start" />
							下载 mapping
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={mappingItems.length === 0}
							onClick={() =>
								downloadJson(
									"wordpress-mapping-overlay.json",
									formatMappingOverlay(
										siteKey,
										sourceBasePath.trim() || "/",
										mappingItems,
									),
								)
							}
						>
							<DownloadIcon data-icon="inline-start" />
							导出 overlay
						</Button>
					</div>
					{analyzeMutation.error ? (
						<Alert variant="destructive">
							<AlertTitle>分析失败</AlertTitle>
							<AlertDescription>
								{analyzeMutation.error instanceof Error
									? analyzeMutation.error.message
									: "请求失败。"}
							</AlertDescription>
						</Alert>
					) : null}
				</CardContent>
			</Card>

			{result ? (
				<>
					<Card>
						<CardHeader>
							<CardTitle className="text-lg">分析摘要</CardTitle>
							<CardDescription>
								任务 {result.job.id} / {result.report.source.fileName}
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
							{summaryEntries(result).map(([label, value]) => (
								<div key={label} className="rounded-md border p-3">
									<p className="text-xs text-muted-foreground">{label}</p>
									<p className="mt-1 text-xl font-semibold">{value}</p>
								</div>
							))}
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<CardTitle className="text-lg">处理队列</CardTitle>
							<CardDescription>
								当前 overlay {mappingItems.length} 项；修改后重新点击分析 WXR
								即可生成新 report。
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-3 md:grid-cols-5">
							<div className="rounded-md border p-3">
								<p className="text-xs text-muted-foreground">需要处理</p>
								<p className="mt-1 text-2xl font-semibold">
									{queues.needsAction.length}
								</p>
							</div>
							<div className="rounded-md border p-3">
								<p className="text-xs text-muted-foreground">建议确认</p>
								<p className="mt-1 text-2xl font-semibold">
									{queues.confirm.length}
								</p>
							</div>
							<div className="rounded-md border p-3">
								<p className="text-xs text-muted-foreground">可直接导入</p>
								<p className="mt-1 text-2xl font-semibold">
									{queues.ready.length}
								</p>
							</div>
							<div className="rounded-md border p-3">
								<p className="text-xs text-muted-foreground">跳过</p>
								<p className="mt-1 text-2xl font-semibold">
									{queues.skipped.length}
								</p>
							</div>
							<div className="rounded-md border p-3">
								<p className="text-xs text-muted-foreground">生成 plan</p>
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="mt-2"
									disabled={hasBlockingItems}
									onClick={() =>
										result ? planMutation.mutate(result.job.id) : undefined
									}
								>
									{planMutation.isPending
										? "生成中"
										: hasBlockingItems
											? "仍有阻塞项"
											: "生成 plan"}
								</Button>
							</div>
						</CardContent>
					</Card>
					{planMutation.data ? (
						<Card>
							<CardHeader>
								<CardTitle className="text-lg">Import Plan</CardTitle>
								<CardDescription>
									任务 {planMutation.data.job.id} 已生成导入计划。
								</CardDescription>
							</CardHeader>
							<CardContent className="flex flex-col gap-3">
								<div className="grid gap-3 md:grid-cols-4">
									{[
										["页面", planMutation.data.plan.summary.itemCount],
										["评论", planMutation.data.plan.summary.commentCount],
										[
											"最大深度",
											planMutation.data.plan.summary.maxCommentDepth,
										],
										["警告", planMutation.data.plan.summary.warningCount],
									].map(([label, value]) => (
										<div key={label} className="rounded-md border p-3">
											<p className="text-xs text-muted-foreground">{label}</p>
											<p className="mt-1 text-xl font-semibold">{value}</p>
										</div>
									))}
								</div>
								<div className="flex flex-wrap items-end gap-2">
									<Field label="existingStrategy">
										<select
											className={inputClass}
											value={existingStrategy}
											onChange={(event) =>
												setExistingStrategy(
													event.target.value as
														| "fail_on_existing"
														| "skip_existing",
												)
											}
										>
											<option value="fail_on_existing">fail_on_existing</option>
											<option value="skip_existing">skip_existing</option>
										</select>
									</Field>
									<Button
										type="button"
										variant="outline"
										disabled={dryRunMutation.isPending}
										onClick={() =>
											dryRunMutation.mutate({
												jobId: planMutation.data.job.id,
												existingStrategy,
											})
										}
									>
										<FileSearchIcon data-icon="inline-start" />
										{dryRunMutation.isPending ? "检查中" : "Dry-run"}
									</Button>
									<Button
										type="button"
										disabled={!canApply || applyMutation.isPending}
										onClick={() =>
											applyMutation.mutate({
												jobId: planMutation.data.job.id,
												existingStrategy,
											})
										}
									>
										<UploadIcon data-icon="inline-start" />
										{applyMutation.isPending ? "导入中" : "Apply"}
									</Button>
								</div>
								{applyMutation.error ? (
									<Alert variant="destructive">
										<AlertTitle>导入失败</AlertTitle>
										<AlertDescription>
											{applyMutation.error instanceof Error
												? applyMutation.error.message
												: "请求失败。"}
										</AlertDescription>
									</Alert>
								) : null}
							</CardContent>
						</Card>
					) : null}
					{dryRunMutation.data ? (
						<Card>
							<CardHeader>
								<CardTitle className="text-lg">Dry-run 结果</CardTitle>
								<CardDescription>
									状态 {dryRunMutation.data.job.status}
								</CardDescription>
							</CardHeader>
							<CardContent className="grid gap-3 md:grid-cols-3">
								{[
									[
										"创建页面线程",
										dryRunMutation.data.dryRun.summary.willCreatePageThreads,
									],
									[
										"复用页面线程",
										dryRunMutation.data.dryRun.summary.willReusePageThreads,
									],
									[
										"创建评论",
										dryRunMutation.data.dryRun.summary.willCreateComments,
									],
									[
										"跳过已有评论",
										dryRunMutation.data.dryRun.summary.willSkipExistingComments,
									],
									["冲突", dryRunMutation.data.dryRun.summary.conflicts],
									["警告", dryRunMutation.data.dryRun.summary.warnings],
								].map(([label, value]) => (
									<div key={label} className="rounded-md border p-3">
										<p className="text-xs text-muted-foreground">{label}</p>
										<p className="mt-1 text-xl font-semibold">{value}</p>
									</div>
								))}
							</CardContent>
						</Card>
					) : null}
					{applyMutation.data ? (
						<Card>
							<CardHeader>
								<CardTitle className="text-lg">Apply 结果</CardTitle>
								<CardDescription>
									任务 {applyMutation.data.job.id} 已写入。
								</CardDescription>
							</CardHeader>
							<CardContent className="grid gap-3 md:grid-cols-5">
								{[
									[
										"创建页面线程",
										applyMutation.data.apply.summary.createdPageThreads,
									],
									[
										"复用页面线程",
										applyMutation.data.apply.summary.reusedPageThreads,
									],
									[
										"创建评论",
										applyMutation.data.apply.summary.createdComments,
									],
									[
										"跳过已有评论",
										applyMutation.data.apply.summary.skippedExistingComments,
									],
									[
										"记录",
										applyMutation.data.apply.summary.importRecordsCreated,
									],
								].map(([label, value]) => (
									<div key={label} className="rounded-md border p-3">
										<p className="text-xs text-muted-foreground">{label}</p>
										<p className="mt-1 text-xl font-semibold">{value}</p>
									</div>
								))}
							</CardContent>
						</Card>
					) : null}
					<Card>
						<CardHeader>
							<CardTitle className="text-lg">Report Rows</CardTitle>
						</CardHeader>
						<CardContent className="overflow-x-auto">
							<table className="w-full min-w-[1280px] text-left text-sm">
								<thead>
									<tr className="border-b text-xs text-muted-foreground">
										<th className="p-2 font-medium">状态</th>
										<th className="p-2 font-medium">分数</th>
										<th className="p-2 font-medium">WP Post ID</th>
										<th className="p-2 font-medium">标题</th>
										<th className="p-2 font-medium">sourceRelativePath</th>
										<th className="p-2 font-medium">候选 pageKey</th>
										<th className="p-2 font-medium">评论</th>
										<th className="p-2 font-medium">深度</th>
										<th className="p-2 font-medium">警告</th>
										<th className="p-2 font-medium">处理</th>
									</tr>
								</thead>
								<tbody>
									{result.report.items.map((item) => {
										const manual = manualTargets[item.wpPostId] ?? {
											pageKey: "",
											pageUrl: "",
										};
										const overlayItem = mappingItems.find(
											(mappingItem) => mappingItem.wpPostId === item.wpPostId,
										);
										return (
											<tr key={item.wpPostId} className="border-b align-top">
												<td className="p-2">
													<Badge variant="secondary">
														{stateLabels[item.state]}
													</Badge>
													{overlayItem ? (
														<div className="mt-2">
															<Badge variant="outline">
																overlay: {overlayItem.decision}
															</Badge>
														</div>
													) : null}
												</td>
												<td className="p-2">
													{item.target?.confidence ?? item.evidence.confidence}
												</td>
												<td className="p-2">{item.wpPostId}</td>
												<td className="max-w-56 p-2">{item.title}</td>
												<td className="max-w-64 p-2">
													{item.sourceRelativePath}
												</td>
												<td className="max-w-64 p-2">
													{item.target?.pageKey ?? "-"}
												</td>
												<td className="p-2">
													{item.commentSummary.migratable}
												</td>
												<td className="p-2">{item.commentSummary.maxDepth}</td>
												<td className="max-w-72 p-2">
													{item.warnings.length > 0
														? item.warnings.join("; ")
														: "-"}
												</td>
												<td className="w-96 p-2">
													<div className="flex flex-col gap-2">
														<div className="flex flex-wrap gap-2">
															<Button
																type="button"
																variant="outline"
																size="sm"
																disabled={!item.target}
																onClick={() =>
																	setMappingItems(
																		acceptCandidate(mappingItems, item),
																	)
																}
															>
																<CheckIcon data-icon="inline-start" />
																接受
															</Button>
															<Button
																type="button"
																variant="outline"
																size="sm"
																onClick={() =>
																	setMappingItems(skipItem(mappingItems, item))
																}
															>
																<BanIcon data-icon="inline-start" />
																跳过
															</Button>
														</div>
														<div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
															<input
																className={inputClass}
																value={manual.pageKey}
																onChange={(event) =>
																	setManualTargets({
																		...manualTargets,
																		[item.wpPostId]: {
																			...manual,
																			pageKey: event.target.value,
																		},
																	})
																}
																placeholder="pageKey"
															/>
															<input
																className={inputClass}
																value={manual.pageUrl}
																onChange={(event) =>
																	setManualTargets({
																		...manualTargets,
																		[item.wpPostId]: {
																			...manual,
																			pageUrl: event.target.value,
																		},
																	})
																}
																placeholder="pageUrl"
															/>
															<Button
																type="button"
																variant="outline"
																size="sm"
																disabled={!manual.pageKey.trim()}
																onClick={() =>
																	setMappingItems(
																		mapToPage(mappingItems, item, {
																			pageKey: manual.pageKey.trim(),
																			pageUrl:
																				manual.pageUrl.trim() || undefined,
																		}),
																	)
																}
															>
																<MapPinIcon data-icon="inline-start" />
																映射
															</Button>
														</div>
													</div>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</CardContent>
					</Card>
				</>
			) : null}
		</div>
	);
}
