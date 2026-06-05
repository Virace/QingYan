import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
	createPageRegistrySource,
	deletePageRegistrySource,
	listPageRegistrySources,
	type PageRegistrySource,
	type PageSourceMode,
	type PageSourceType,
	refreshPageRegistrySource,
	refreshPageRegistrySources,
} from "@/api/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { EmptyState, inputClass } from "./admin-ui";
import { useAdminConfirmDialog } from "./confirm-dialog";
import { ExternalLinkText } from "./external-link-text";
import {
	defaultTaskExecutionOptions,
	TaskExecutionOptionsFields,
	toTaskExecutionOptions,
} from "./task-execution-options";

function sourceTypeLabel(value: PageSourceType) {
	const labels: Record<PageSourceType, string> = {
		sitemap: "Sitemap",
		rss: "RSS",
		atom: "Atom",
	};
	return labels[value];
}

function sourceModeLabel(value: PageSourceMode) {
	return value === "append" ? "追加" : "替换";
}

export function PageSourceTaskPanel({ siteKey }: { siteKey: string }) {
	const queryClient = useQueryClient();
	const confirm = useAdminConfirmDialog();
	const [sourceType, setSourceType] = useState<PageSourceType>("sitemap");
	const [sourceUrl, setSourceUrl] = useState("");
	const [sourceMode, setSourceMode] = useState<PageSourceMode>("append");
	const [executionOptions, setExecutionOptions] = useState(
		defaultTaskExecutionOptions({ batchSize: "" }),
	);
	const sourcesQuery = useQuery({
		queryKey: ["admin", "page-registry", "sources", siteKey],
		queryFn: () => listPageRegistrySources({ siteKey }),
		enabled: Boolean(siteKey),
	});
	const invalidateSources = () => {
		void queryClient.invalidateQueries({
			queryKey: ["admin", "page-registry", "sources"],
		});
		void queryClient.invalidateQueries({ queryKey: ["admin", "task-runs"] });
	};
	const createSourceMutation = useMutation({
		mutationFn: createPageRegistrySource,
		meta: { successMessage: "页面来源已添加" },
		onSuccess: () => {
			setSourceUrl("");
			invalidateSources();
		},
	});
	const deleteSourceMutation = useMutation({
		mutationFn: deletePageRegistrySource,
		meta: { successMessage: "页面来源已删除" },
		onSuccess: invalidateSources,
	});
	const refreshSourceMutation = useMutation({
		mutationFn: refreshPageRegistrySource,
		meta: { suppressGlobalSuccessToast: true },
		onSuccess: (result) => {
			toast.success(`已创建任务运行：${result.run.id}`);
			invalidateSources();
		},
	});
	const refreshAllSourcesMutation = useMutation({
		mutationFn: refreshPageRegistrySources,
		meta: { suppressGlobalSuccessToast: true },
		onSuccess: (result) => {
			toast.success(`已创建任务运行：${result.run.id}`);
			invalidateSources();
		},
	});
	const mutationPending =
		createSourceMutation.isPending ||
		deleteSourceMutation.isPending ||
		refreshSourceMutation.isPending ||
		refreshAllSourcesMutation.isPending;

	const removeSource = async (source: PageRegistrySource) => {
		const confirmed = await confirm({
			title: "删除页面来源",
			description:
				"删除来源配置不会删除已经登记的页面、评论、点赞或访问数据，但后续不会再从该来源刷新页面。",
			confirmText: "删除来源",
			destructive: true,
		});
		if (!confirmed) {
			return;
		}
		deleteSourceMutation.mutate({ sourceId: source.id });
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">页面来源维护</CardTitle>
				<CardDescription>
					从 sitemap、RSS 或 Atom
					刷新页面登记；操作会创建维护任务，执行状态可在任务中心统一查看。
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-4">
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						variant="outline"
						disabled={!siteKey || mutationPending}
						onClick={() =>
							refreshAllSourcesMutation.mutate({
								siteKey,
								...toTaskExecutionOptions(executionOptions),
							})
						}
					>
						<RefreshCwIcon data-icon="inline-start" />
						刷新全部来源
					</Button>
				</div>
				<TaskExecutionOptionsFields
					value={executionOptions}
					onChange={setExecutionOptions}
					showBatchSize={false}
				/>
				<form
					className="grid gap-3 md:grid-cols-[140px_1fr_120px_auto]"
					onSubmit={(event) => {
						event.preventDefault();
						if (!siteKey || !sourceUrl.trim()) {
							return;
						}
						createSourceMutation.mutate({
							siteKey,
							sourceType,
							sourceUrl: sourceUrl.trim(),
							enabled: true,
							mode: sourceMode,
						});
					}}
				>
					<label className="grid gap-1 text-sm">
						<span className="text-muted-foreground">类型</span>
						<select
							className={inputClass}
							value={sourceType}
							onChange={(event) =>
								setSourceType(event.target.value as PageSourceType)
							}
						>
							<option value="sitemap">Sitemap</option>
							<option value="rss">RSS</option>
							<option value="atom">Atom</option>
						</select>
					</label>
					<label className="grid gap-1 text-sm" htmlFor="task-page-source-url">
						<span className="text-muted-foreground">URL</span>
						<Input
							id="task-page-source-url"
							placeholder="https://example.com/sitemap.xml"
							value={sourceUrl}
							onChange={(event) => setSourceUrl(event.target.value)}
						/>
					</label>
					<label className="grid gap-1 text-sm">
						<span className="text-muted-foreground">模式</span>
						<select
							className={inputClass}
							value={sourceMode}
							onChange={(event) =>
								setSourceMode(event.target.value as PageSourceMode)
							}
						>
							<option value="append">追加</option>
							<option value="replace">替换</option>
						</select>
					</label>
					<Button
						type="submit"
						className="self-end"
						disabled={!siteKey || mutationPending}
					>
						添加来源
					</Button>
				</form>
				<div className="grid gap-2">
					{sourcesQuery.data?.items.map((source) => (
						<div
							key={source.id}
							className="flex flex-col gap-2 rounded-md border p-3 md:flex-row md:items-start md:justify-between"
						>
							<div className="min-w-0">
								<div className="flex flex-wrap gap-2">
									<Badge variant="secondary">
										{sourceTypeLabel(source.sourceType)}
									</Badge>
									<Badge variant="outline">
										{sourceModeLabel(source.mode)}
									</Badge>
									{source.enabled ? (
										<Badge variant="outline">启用</Badge>
									) : (
										<Badge variant="secondary">停用</Badge>
									)}
								</div>
								<div className="mt-2 text-sm font-medium">
									<ExternalLinkText href={source.sourceUrl}>
										{source.sourceUrl}
									</ExternalLinkText>
								</div>
								<p className="text-xs text-muted-foreground">
									最近成功 {source.lastSuccessAt ?? "-"} / 最近错误{" "}
									{source.lastError ?? "-"}
								</p>
							</div>
							<div className="flex flex-wrap gap-2">
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={mutationPending}
									onClick={() =>
										refreshSourceMutation.mutate({
											sourceId: source.id,
											options: toTaskExecutionOptions(executionOptions),
										})
									}
								>
									刷新
								</Button>
								<Button
									type="button"
									size="sm"
									variant="destructive"
									disabled={mutationPending}
									onClick={() => void removeSource(source)}
								>
									删除
								</Button>
							</div>
						</div>
					))}
					{sourcesQuery.data?.items.length === 0 ? (
						<EmptyState text="暂无页面来源" />
					) : null}
				</div>
			</CardContent>
		</Card>
	);
}
