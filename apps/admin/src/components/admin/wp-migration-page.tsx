import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
	BanIcon,
	CheckIcon,
	DatabaseIcon,
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
import type { AdminSiteSummary } from "@/api/session";
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
	acceptImportableItems,
	acceptByConfidence,
	acceptCandidate,
	formatMappingOverlay,
	hasBlockingUnresolvedItems,
	lowConfidenceImportableItems,
	type MappingOverlayItem,
	mapToPage,
	skipItem,
} from "./wp-migration-model";

type QueueName = "needsAction" | "confirm" | "ready" | "skipped";

const stateLabels: Record<MigrationItemState, string> = {
	ready: "可导入",
	needs_user_mapping: "需要手动映射",
	ambiguous: "候选不明确",
	unverified: "待确认",
	conflict: "冲突",
	skipped: "已跳过",
};

const pageKeyStrategyOptions = [
	{
		value: "path_without_leading_slash",
		label: "使用路径作为页面 Key（去掉开头斜杠）",
	},
	{
		value: "path_with_leading_slash",
		label: "使用路径作为页面 Key（保留开头斜杠）",
	},
	{ value: "page_url_path", label: "使用页面 URL 路径" },
	{ value: "custom_template", label: "使用下方路径模板" },
	{ value: "explicit_only", label: "只使用手动映射" },
] as const;

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
		["可导入", summary.ready],
		["需要手动映射", summary.needsUserMapping],
		["候选不明确", summary.ambiguous],
		["待确认", summary.unverified],
		["冲突", summary.conflict],
		["已跳过", summary.skipped],
		["评论", summary.totalComments],
		["最大深度", summary.maxCommentDepth],
		["警告", summary.warningCount],
	];
}

function confirmLowConfidence(items: MigrationReportItem[]) {
	const lowConfidenceItems = lowConfidenceImportableItems(items, 90);
	if (lowConfidenceItems.length === 0) {
		return true;
	}
	return window.confirm(
		`有 ${lowConfidenceItems.length} 个候选匹配分数低于 90 分。低分候选可能把评论导入到错误页面，继续前请确认报告行中的标题、路径和目标页面 Key。是否继续接受？`,
	);
}

function TargetSiteSummary({ site }: { site: AdminSiteSummary }) {
	const origin = site.allowedOrigins[0] ?? "未配置前端 Origin";
	return (
		<div className="sticky top-0 z-10 rounded-md border bg-background/95 p-3 shadow-sm backdrop-blur">
			<div className="flex flex-wrap items-center gap-2">
				<Badge variant="secondary">目标站点</Badge>
				<span className="font-medium">{site.name}</span>
				<span className="text-sm text-muted-foreground">{site.siteKey}</span>
				<span className="text-sm text-muted-foreground">{origin}</span>
			</div>
			<p className="mt-2 text-xs text-muted-foreground">
				WordPress
				评论会导入到这里显示的站点。切换右上角站点后，当前页面的分析、计划和导入结果会被清空。
			</p>
		</div>
	);
}

export function WordPressMigrationPage({ site }: { site: AdminSiteSummary }) {
	const siteKey = site.siteKey;
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
	function buildAnalyzeMapping(items: MappingOverlayItem[]) {
		if (items.length > 0) {
			return formatMappingOverlay(siteKey, sourceBasePath.trim() || "/", items);
		}
		return mappingJson.trim()
			? (JSON.parse(mappingJson) as unknown)
			: undefined;
	}
	const analyzeMutation = useMutation({
		async mutationFn(input?: { mappingItems?: MappingOverlayItem[] }) {
			if (!file) {
				throw new Error("请选择 WXR XML 文件。");
			}
			const nextMappingItems = input?.mappingItems ?? mappingItems;
			return analyzeWordPressMigration({
				siteKey,
				fileName: file.name,
				file,
				sourceBasePath: sourceBasePath.trim() || undefined,
				targetDistRoot: targetDistRoot.trim() || undefined,
				pageKeyStrategy,
				postPathTemplate: postPathTemplate.trim() || undefined,
				pagePathTemplate: pagePathTemplate.trim() || undefined,
				mapping: buildAnalyzeMapping(nextMappingItems),
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
	const acceptAndImportMutation = useMutation({
		async mutationFn() {
			if (!result) {
				throw new Error("请先分析 WXR。");
			}
			if (!confirmLowConfidence(result.report.items)) {
				throw new Error("已取消接受和导入。");
			}
			const accepted = acceptImportableItems(mappingItems, result.report.items);
			setMappingItems(accepted);
			const refreshed = await analyzeMutation.mutateAsync({
				mappingItems: accepted,
			});
			if (hasBlockingUnresolvedItems(refreshed.report.items)) {
				throw new Error("仍有未解决或低可信映射，不能导入数据库。");
			}
			const plan = await planMutation.mutateAsync(refreshed.job.id);
			const dryRun = await dryRunMutation.mutateAsync({
				jobId: plan.job.id,
				existingStrategy,
			});
			if (
				dryRun.job.status !== "dry_run_passed" ||
				dryRun.dryRun.summary.conflicts > 0
			) {
				throw new Error("写入前检查仍存在冲突，不能导入数据库。");
			}
			return applyMutation.mutateAsync({
				jobId: plan.job.id,
				existingStrategy,
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
	const planError: unknown = planMutation.error;
	const dryRunError: unknown = dryRunMutation.error;
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
	function acceptAndReanalyze(nextItems: MappingOverlayItem[]) {
		setMappingItems(nextItems);
		analyzeMutation.mutate({ mappingItems: nextItems });
	}

	return (
		<div className="flex flex-col gap-4">
			<TargetSiteSummary site={site} />
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">WordPress 评论迁移</CardTitle>
					<CardDescription>
						上传 WordPress WXR XML，先分析和确认映射，再 dry-run，最后导入评论。
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<div className="grid gap-3 lg:grid-cols-3">
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
						<Field label="WordPress 源路径前缀">
							<input
								className={inputClass}
								value={sourceBasePath}
								onChange={(event) => setSourceBasePath(event.target.value)}
							/>
						</Field>
						<Field label="静态站点来源">
							<input
								className={inputClass}
								value={targetDistRoot}
								onChange={(event) => setTargetDistRoot(event.target.value)}
								placeholder="可选，本机静态目录、sitemap URL 或 RSS/Atom URL"
							/>
						</Field>
						<Field label="页面 Key 策略">
							<select
								className={inputClass}
								value={pageKeyStrategy}
								onChange={(event) => setPageKeyStrategy(event.target.value)}
							>
								{pageKeyStrategyOptions.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</Field>
						<Field label="文章路径模板">
							<input
								className={inputClass}
								value={postPathTemplate}
								onChange={(event) => setPostPathTemplate(event.target.value)}
								placeholder="留空则使用默认文章路径"
							/>
						</Field>
						<Field label="页面路径模板">
							<input
								className={inputClass}
								value={pagePathTemplate}
								onChange={(event) => setPagePathTemplate(event.target.value)}
								placeholder="留空则使用默认页面路径"
							/>
						</Field>
						<div className="lg:col-span-2">
							<Field label="手动映射 JSON">
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
							onClick={() => analyzeMutation.mutate({})}
							disabled={analyzeMutation.isPending || !siteKey}
						>
							<FileSearchIcon data-icon="inline-start" />
							{analyzeMutation.isPending ? "分析中" : "分析 WXR"}
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={!result || analyzeMutation.isPending}
							onClick={() => {
								if (!result || !confirmLowConfidence(result.report.items)) {
									return;
								}
								acceptAndReanalyze(
									acceptImportableItems(mappingItems, result.report.items),
								);
							}}
						>
							<CheckIcon data-icon="inline-start" />
							接受全部可映射项
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={!result}
							onClick={() =>
								result
									? acceptAndReanalyze(
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
									? acceptAndReanalyze(
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
							下载分析报告
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
							下载映射建议
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
							导出映射覆盖
						</Button>
						<Button
							type="button"
							disabled={
								!result ||
								acceptAndImportMutation.isPending ||
								analyzeMutation.isPending ||
								planMutation.isPending ||
								dryRunMutation.isPending ||
								applyMutation.isPending
							}
							onClick={() => acceptAndImportMutation.mutate()}
						>
							<DatabaseIcon data-icon="inline-start" />
							{acceptAndImportMutation.isPending
								? "正在接受并导入"
								: `接受全部并导入 ${site.name}`}
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
					{acceptAndImportMutation.error ? (
						<Alert variant="destructive">
							<AlertTitle>接受或导入失败</AlertTitle>
							<AlertDescription>
								{acceptAndImportMutation.error instanceof Error
									? acceptAndImportMutation.error.message
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
								当前手动确认 {mappingItems.length}{" "}
								项；修改后会重新分析并生成新的分析结果。
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
								<p className="text-xs text-muted-foreground">生成导入计划</p>
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
											: "生成导入计划"}
								</Button>
							</div>
						</CardContent>
					</Card>
					{planMutation.data ? (
						<Card>
							<CardHeader>
								<CardTitle className="text-lg">导入计划</CardTitle>
								<CardDescription>
									目标站点 {site.name} / {site.siteKey}，任务{" "}
									{planMutation.data.job.id} 已生成导入计划。
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
									<Field label="已有数据处理方式">
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
											<option value="fail_on_existing">
												遇到已有评论时报错
											</option>
											<option value="skip_existing">跳过已有评论</option>
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
										{dryRunMutation.isPending ? "检查中" : "写入前检查"}
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
										{applyMutation.isPending ? "导入中" : `导入到 ${site.name}`}
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
								{planError ? (
									<Alert variant="destructive">
										<AlertTitle>生成计划失败</AlertTitle>
										<AlertDescription>
											{planError instanceof Error
												? planError.message
												: "请求失败。"}
										</AlertDescription>
									</Alert>
								) : null}
								{dryRunError ? (
									<Alert variant="destructive">
										<AlertTitle>写入前检查失败</AlertTitle>
										<AlertDescription>
											{dryRunError instanceof Error
												? dryRunError.message
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
								<CardTitle className="text-lg">写入前检查结果</CardTitle>
								<CardDescription>
									状态{" "}
									{dryRunMutation.data.job.status === "dry_run_passed"
										? "通过"
										: "失败"}
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
								<CardTitle className="text-lg">导入结果</CardTitle>
								<CardDescription>
									任务 {applyMutation.data.job.id} 已写入 {site.name}。
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
							<CardTitle className="text-lg">报告行</CardTitle>
						</CardHeader>
						<CardContent className="overflow-x-auto">
							<table className="w-full min-w-[1280px] text-left text-sm">
								<thead>
									<tr className="border-b text-xs text-muted-foreground">
										<th className="p-2 font-medium">状态</th>
										<th className="p-2 font-medium">分数</th>
										<th className="p-2 font-medium">WordPress 文章 ID</th>
										<th className="p-2 font-medium">标题</th>
										<th className="p-2 font-medium">源相对路径</th>
										<th className="p-2 font-medium">候选页面 Key</th>
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
																已确认:{" "}
																{overlayItem.decision === "map"
																	? "导入"
																	: "跳过"}
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
																placeholder="页面 Key"
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
																placeholder="页面 URL"
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
