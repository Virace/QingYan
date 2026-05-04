import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
	createBlacklist,
	deleteBlacklist,
	getSettings,
	getSystemSettings,
	listBlacklist,
	type AdminSettings,
	type AdminSystemSettings,
	updateSettings,
	updateSystemSettings,
} from "@/api/admin";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { EmptyState, Field, inputClass, textareaClass } from "./admin-ui";

export function BlacklistPage({ siteKey }: { siteKey?: string }) {
	const queryClient = useQueryClient();
	const [targetValue, setTargetValue] = useState("");
	const [reason, setReason] = useState("");
	const [targetType, setTargetType] = useState<"ip" | "email" | "visitor">(
		"email",
	);
	const [matchMode, setMatchMode] = useState<"exact" | "cidr" | "wildcard">(
		"exact",
	);
	const [scope, setScope] = useState<"post" | "all">("post");
	const query = useQuery({
		queryKey: ["admin", "blacklist", siteKey],
		queryFn: () => listBlacklist(siteKey),
	});
	const createMutation = useMutation({
		mutationFn: createBlacklist,
		onSuccess() {
			setTargetValue("");
			setReason("");
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
	});
	const deleteMutation = useMutation({
		mutationFn: deleteBlacklist,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});

	return (
		<div className="grid gap-4 lg:grid-cols-[360px_1fr]">
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">新增黑名单</CardTitle>
				</CardHeader>
				<CardContent>
					<form
						className="flex flex-col gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							if (!targetValue.trim()) {
								return;
							}
							createMutation.mutate({
								siteKey,
								targetType,
								matchMode,
								scope,
								targetValue,
								reason: reason || undefined,
							});
						}}
					>
						<Field label="目标类型">
							<select
								className={inputClass}
								value={targetType}
								onChange={(event) =>
									setTargetType(event.target.value as typeof targetType)
								}
							>
								<option value="email">邮箱</option>
								<option value="visitor">访客</option>
								<option value="ip">IP</option>
							</select>
						</Field>
						<Field label="匹配模式">
							<select
								className={inputClass}
								value={matchMode}
								onChange={(event) =>
									setMatchMode(event.target.value as typeof matchMode)
								}
							>
								<option value="exact">精确</option>
								<option value="wildcard">通配</option>
								<option value="cidr">CIDR</option>
							</select>
						</Field>
						<Field label="作用域">
							<select
								className={inputClass}
								value={scope}
								onChange={(event) =>
									setScope(event.target.value as typeof scope)
								}
							>
								<option value="post">当前页面</option>
								<option value="all">全局</option>
							</select>
						</Field>
						<Field label="目标值">
							<Input
								value={targetValue}
								onChange={(event) => setTargetValue(event.target.value)}
							/>
						</Field>
						<Field label="原因">
							<Input
								value={reason}
								onChange={(event) => setReason(event.target.value)}
							/>
						</Field>
						<Button type="submit" disabled={createMutation.isPending}>
							新增规则
						</Button>
					</form>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">黑名单规则</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-3">
					{query.data?.items.map((rule) => (
						<div key={rule.id} className="rounded-md border p-3">
							<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
								<div>
									<p className="font-medium">{rule.targetValue}</p>
									<p className="text-xs text-muted-foreground">
										{rule.targetType} / {rule.matchMode} / {rule.scope}
									</p>
								</div>
								<Button
									type="button"
									size="sm"
									variant="destructive"
									onClick={() => deleteMutation.mutate(rule.id)}
								>
									删除
								</Button>
							</div>
						</div>
					))}
					{query.data?.items.length === 0 ? (
						<EmptyState text="暂无黑名单规则" />
					) : null}
				</CardContent>
			</Card>
		</div>
	);
}

export function RuntimeSettingsPage({ siteKey }: { siteKey?: string }) {
	const queryClient = useQueryClient();
	const resolvedSiteKey = siteKey ?? "";
	const query = useQuery({
		queryKey: ["admin", "settings", resolvedSiteKey],
		queryFn: () => getSettings(resolvedSiteKey),
		enabled: Boolean(resolvedSiteKey),
	});
	const [draft, setDraft] = useState<AdminSettings | null>(null);
	const mutation = useMutation({
		mutationFn: (input: AdminSettings) => updateSettings(input.siteKey, input),
		onSuccess: (settings) => {
			setDraft(settings);
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
	});

	useEffect(() => {
		if (query.data) {
			setDraft(query.data);
		}
	}, [query.data]);

	if (!draft) {
		if (!resolvedSiteKey) {
			return <EmptyState text="请选择站点" />;
		}
		if (query.isError) {
			const error = query.error;
			const message =
				error instanceof ApiError
					? `${error.message}${error.code ? ` (${error.code})` : ""}`
					: "运行时设置加载失败。";
			return <EmptyState text={message} />;
		}
		return <EmptyState text="加载中" />;
	}

	const commentRequire = draft.comments.identity.require ?? [];
	const updateRequire = (
		field: "nickname" | "email" | "website",
		checked: boolean,
	) => {
		const nextRequire = checked
			? Array.from(new Set([...commentRequire, field]))
			: commentRequire.filter((value) => value !== field);
		setDraft({
			...draft,
			comments: {
				...draft.comments,
				identity: {
					...draft.comments.identity,
					require: nextRequire,
				},
			},
		});
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">运行时设置</CardTitle>
				<CardDescription>{draft.siteKey}</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="grid gap-4 md:grid-cols-2"
					onSubmit={(event) => {
						event.preventDefault();
						mutation.mutate(draft);
					}}
				>
					<Field label="评论开关">
						<select
							className={inputClass}
							value={String(draft.comments.enabled)}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										enabled: event.target.value === "true",
									},
								})
							}
						>
							<option value="true">启用</option>
							<option value="false">关闭</option>
						</select>
					</Field>
					<Field label="默认状态">
						<select
							className={inputClass}
							value={draft.comments.defaultStatus}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										defaultStatus: event.target.value as "pending" | "approved",
									},
								})
							}
						>
							<option value="pending">待审</option>
							<option value="approved">直接通过</option>
						</select>
					</Field>
					<Field label="验证码模式">
						<select
							className={inputClass}
							value={draft.comments.captcha.mode}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										captcha: {
											...draft.comments.captcha,
											mode: event.target.value as
												| "never"
												| "always"
												| "threshold",
										},
									},
								})
							}
						>
							<option value="never">从不</option>
							<option value="always">总是</option>
							<option value="threshold">阈值</option>
						</select>
					</Field>
					<Field label="阈值动作次数">
						<Input
							type="number"
							min={1}
							value={draft.comments.captcha.thresholdMaxActions}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										captcha: {
											...draft.comments.captcha,
											thresholdMaxActions: Number(event.target.value),
										},
									},
								})
							}
						/>
					</Field>
					<Field label="阈值窗口（秒）">
						<Input
							type="number"
							min={1}
							value={draft.comments.captcha.thresholdWindowSec}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										captcha: {
											...draft.comments.captcha,
											thresholdWindowSec: Number(event.target.value),
										},
									},
								})
							}
						/>
					</Field>
					<Field label="评论最大深度">
						<Input
							type="number"
							min={1}
							value={draft.comments.maxDepth}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										maxDepth: Number(event.target.value),
									},
								})
							}
						/>
					</Field>
					<Field label="根评论分页">
						<Input
							type="number"
							min={1}
							value={draft.comments.rootLimit}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										rootLimit: Number(event.target.value),
									},
								})
							}
						/>
					</Field>
					<Field label="允许作者站点">
						<select
							className={inputClass}
							value={String(draft.comments.allowWebsite)}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										allowWebsite: event.target.value === "true",
									},
								})
							}
						>
							<option value="true">允许</option>
							<option value="false">关闭</option>
						</select>
					</Field>
					<div className="flex flex-col gap-2 rounded-md border p-3 md:col-span-2">
						<p className="text-sm font-medium">评论身份必填项</p>
						<div className="grid gap-2 md:grid-cols-3">
							{(["nickname", "email", "website"] as const).map((field) => (
								<label
									key={field}
									className="flex items-center justify-between rounded-md border p-3 text-sm"
								>
									<span>
										{field === "nickname"
											? "昵称"
											: field === "email"
												? "邮箱"
												: "站点"}
									</span>
									<input
										type="checkbox"
										checked={commentRequire.includes(field)}
										disabled={
											field === "website" && !draft.comments.allowWebsite
										}
										onChange={(event) =>
											updateRequire(field, event.target.checked)
										}
									/>
								</label>
							))}
						</div>
					</div>
					<Field label="滥用防护">
						<select
							className={inputClass}
							value={String(draft.comments.abuseGuard.enabled)}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										abuseGuard: {
											...draft.comments.abuseGuard,
											enabled: event.target.value === "true",
										},
									},
								})
							}
						>
							<option value="true">启用</option>
							<option value="false">关闭</option>
						</select>
					</Field>
					<Field label="滥用窗口（秒）">
						<Input
							type="number"
							min={1}
							value={draft.comments.abuseGuard.windowSec}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										abuseGuard: {
											...draft.comments.abuseGuard,
											windowSec: Number(event.target.value),
										},
									},
								})
							}
						/>
					</Field>
					<Field label="窗口内最大写入">
						<Input
							type="number"
							min={1}
							value={draft.comments.abuseGuard.maxWriteActions}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										abuseGuard: {
											...draft.comments.abuseGuard,
											maxWriteActions: Number(event.target.value),
										},
									},
								})
							}
						/>
					</Field>
					<Field label="自动拉黑">
						<select
							className={inputClass}
							value={String(draft.comments.abuseGuard.autoBlacklist.enabled)}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										abuseGuard: {
											...draft.comments.abuseGuard,
											autoBlacklist: {
												...draft.comments.abuseGuard.autoBlacklist,
												enabled: event.target.value === "true",
											},
										},
									},
								})
							}
						>
							<option value="true">启用</option>
							<option value="false">关闭</option>
						</select>
					</Field>
					<Field label="自动拉黑作用域">
						<select
							className={inputClass}
							value={draft.comments.abuseGuard.autoBlacklist.scope}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										abuseGuard: {
											...draft.comments.abuseGuard,
											autoBlacklist: {
												...draft.comments.abuseGuard.autoBlacklist,
												scope: event.target.value as "post" | "all",
											},
										},
									},
								})
							}
						>
							<option value="post">当前页面</option>
							<option value="all">全局</option>
						</select>
					</Field>
					<Field label="自动拉黑 TTL（秒）">
						<Input
							type="number"
							min={1}
							value={draft.comments.abuseGuard.autoBlacklist.ttlSec}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										abuseGuard: {
											...draft.comments.abuseGuard,
											autoBlacklist: {
												...draft.comments.abuseGuard.autoBlacklist,
												ttlSec: Number(event.target.value),
											},
										},
									},
								})
							}
						/>
					</Field>
					<div className="flex flex-col gap-3 rounded-md border p-3 md:col-span-2">
						<p className="text-sm font-medium">请求元数据</p>
						<div className="grid gap-4 md:grid-cols-2">
							<Field label="记录 IP">
								<select
									className={inputClass}
									value={String(draft.comments.metadata.collectIp)}
									onChange={(event) =>
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												metadata: {
													...draft.comments.metadata,
													collectIp: event.target.value === "true",
												},
											},
										})
									}
								>
									<option value="true">启用</option>
									<option value="false">关闭</option>
								</select>
							</Field>
							<Field label="记录 User-Agent">
								<select
									className={inputClass}
									value={String(draft.comments.metadata.collectUserAgent)}
									onChange={(event) =>
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												metadata: {
													...draft.comments.metadata,
													collectUserAgent: event.target.value === "true",
												},
											},
										})
									}
								>
									<option value="true">启用</option>
									<option value="false">关闭</option>
								</select>
							</Field>
							<Field label="IP 地域解析">
								<select
									className={inputClass}
									value={String(draft.comments.metadata.ipRegion.enabled)}
									onChange={(event) =>
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												metadata: {
													...draft.comments.metadata,
													ipRegion: {
														...draft.comments.metadata.ipRegion,
														enabled: event.target.value === "true",
													},
												},
											},
										})
									}
								>
									<option value="true">启用</option>
									<option value="false">关闭</option>
								</select>
							</Field>
							<Field label="地域精度">
								<select
									className={inputClass}
									value={draft.comments.metadata.ipRegion.precision}
									onChange={(event) =>
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												metadata: {
													...draft.comments.metadata,
													ipRegion: {
														...draft.comments.metadata.ipRegion,
														precision: event.target.value as
															| "country"
															| "province"
															| "city",
													},
												},
											},
										})
									}
								>
									<option value="country">国家</option>
									<option value="province">省份</option>
									<option value="city">城市</option>
								</select>
							</Field>
							<Field label="地域缓存策略">
								<select
									className={inputClass}
									value={draft.comments.metadata.ipRegion.cachePolicy}
									onChange={(event) =>
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												metadata: {
													...draft.comments.metadata,
													ipRegion: {
														...draft.comments.metadata.ipRegion,
														cachePolicy: event.target.value as
															| "file"
															| "vectorIndex"
															| "content",
													},
												},
											},
										})
									}
								>
									<option value="file">file</option>
									<option value="vectorIndex">vectorIndex</option>
									<option value="content">content</option>
								</select>
							</Field>
							<Field label="地域库自动更新">
								<select
									className={inputClass}
									value={String(
										draft.comments.metadata.ipRegion.autoUpdate.enabled,
									)}
									onChange={(event) =>
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												metadata: {
													...draft.comments.metadata,
													ipRegion: {
														...draft.comments.metadata.ipRegion,
														autoUpdate: {
															...draft.comments.metadata.ipRegion.autoUpdate,
															enabled: event.target.value === "true",
														},
													},
												},
											},
										})
									}
								>
									<option value="true">启用</option>
									<option value="false">关闭</option>
								</select>
							</Field>
							<Field label="IPv4 数据库路径">
								<Input
									value={draft.comments.metadata.ipRegion.ipv4.dbPath}
									onChange={(event) =>
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												metadata: {
													...draft.comments.metadata,
													ipRegion: {
														...draft.comments.metadata.ipRegion,
														ipv4: {
															...draft.comments.metadata.ipRegion.ipv4,
															dbPath: event.target.value,
														},
													},
												},
											},
										})
									}
								/>
							</Field>
							<Field label="IPv4 下载源">
								<textarea
									className={textareaClass}
									value={draft.comments.metadata.ipRegion.ipv4.sources.join(
										"\n",
									)}
									onChange={(event) =>
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												metadata: {
													...draft.comments.metadata,
													ipRegion: {
														...draft.comments.metadata.ipRegion,
														ipv4: {
															...draft.comments.metadata.ipRegion.ipv4,
															sources: event.target.value
																.split(/\r?\n/)
																.map((value) => value.trim())
																.filter(Boolean),
														},
													},
												},
											},
										})
									}
								/>
							</Field>
							<Field label="IPv6 数据库路径">
								<Input
									value={draft.comments.metadata.ipRegion.ipv6.dbPath}
									onChange={(event) =>
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												metadata: {
													...draft.comments.metadata,
													ipRegion: {
														...draft.comments.metadata.ipRegion,
														ipv6: {
															...draft.comments.metadata.ipRegion.ipv6,
															dbPath: event.target.value,
														},
													},
												},
											},
										})
									}
								/>
							</Field>
							<Field label="IPv6 下载源">
								<textarea
									className={textareaClass}
									value={draft.comments.metadata.ipRegion.ipv6.sources.join(
										"\n",
									)}
									onChange={(event) =>
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												metadata: {
													...draft.comments.metadata,
													ipRegion: {
														...draft.comments.metadata.ipRegion,
														ipv6: {
															...draft.comments.metadata.ipRegion.ipv6,
															sources: event.target.value
																.split(/\r?\n/)
																.map((value) => value.trim())
																.filter(Boolean),
														},
													},
												},
											},
										})
									}
								/>
							</Field>
							<Field label="设备解析">
								<select
									className={inputClass}
									value={String(draft.comments.metadata.device.enabled)}
									onChange={(event) =>
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												metadata: {
													...draft.comments.metadata,
													device: {
														...draft.comments.metadata.device,
														enabled: event.target.value === "true",
													},
												},
											},
										})
									}
								>
									<option value="true">启用</option>
									<option value="false">关闭</option>
								</select>
							</Field>
							<Field label="前台显示设备信息">
								<select
									className={inputClass}
									value={String(draft.comments.metadata.device.display.enabled)}
									onChange={(event) =>
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												metadata: {
													...draft.comments.metadata,
													device: {
														...draft.comments.metadata.device,
														display: {
															...draft.comments.metadata.device.display,
															enabled: event.target.value === "true",
														},
													},
												},
											},
										})
									}
								>
									<option value="true">启用</option>
									<option value="false">关闭</option>
								</select>
							</Field>
						</div>
					</div>
					<Field label="页面点赞">
						<select
							className={inputClass}
							value={String(draft.pageFeedback.allowLike)}
							onChange={(event) =>
								setDraft({
									...draft,
									pageFeedback: {
										allowLike: event.target.value === "true",
									},
								})
							}
						>
							<option value="true">允许</option>
							<option value="false">关闭</option>
						</select>
					</Field>
					<Field label="邮件通知">
						<select
							className={inputClass}
							value={String(draft.notifications.emailEnabled)}
							onChange={(event) =>
								setDraft({
									...draft,
									notifications: {
										emailEnabled: event.target.value === "true",
									},
								})
							}
						>
							<option value="true">启用</option>
							<option value="false">关闭</option>
						</select>
					</Field>
					<div className="md:col-span-2">
						<Button type="submit" disabled={mutation.isPending}>
							保存运行时设置
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}

export function SystemSettingsPage() {
	const queryClient = useQueryClient();
	const query = useQuery({
		queryKey: ["admin", "system-settings"],
		queryFn: getSystemSettings,
	});
	const [draft, setDraft] = useState<AdminSystemSettings | null>(null);
	const mutation = useMutation({
		mutationFn: updateSystemSettings,
		onSuccess: (settings) => {
			setDraft(settings);
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
	});

	useEffect(() => {
		if (query.data) {
			setDraft(query.data);
		}
	}, [query.data]);

	if (!draft) {
		return <EmptyState text="加载中" />;
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">系统设置</CardTitle>
				<CardDescription>全局日志级别与保留策略。</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="grid gap-4 md:grid-cols-2"
					onSubmit={(event) => {
						event.preventDefault();
						mutation.mutate(draft);
					}}
				>
					<Field label="日志等级">
						<select
							className={inputClass}
							value={draft.logging.level}
							onChange={(event) =>
								setDraft({
									logging: {
										...draft.logging,
										level: event.target
											.value as AdminSystemSettings["logging"]["level"],
									},
								})
							}
						>
							<option value="error">error</option>
							<option value="warn">warn</option>
							<option value="info">info</option>
							<option value="debug">debug</option>
						</select>
					</Field>
					<Field label="保留天数">
						<Input
							type="number"
							min={1}
							max={3650}
							value={draft.logging.retentionDays}
							onChange={(event) =>
								setDraft({
									logging: {
										...draft.logging,
										retentionDays: Number(event.target.value),
									},
								})
							}
						/>
					</Field>
					<Field label="日志目录">
						<Input value={draft.logging.directory} readOnly />
					</Field>
					<div className="md:col-span-2">
						<Button type="submit" disabled={mutation.isPending}>
							保存系统设置
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}
