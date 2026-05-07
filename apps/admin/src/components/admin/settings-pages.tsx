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

export function SiteSettingsPage({ siteKey }: { siteKey?: string }) {
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
					: "站点设置加载失败。";
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
				<CardTitle className="text-lg">站点设置</CardTitle>
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
							保存站点设置
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}

function withoutEmptySecrets(
	settings: AdminSystemSettings,
): AdminSystemSettings {
	const next = structuredClone(settings);
	if (next.mail.smtp.password === "") {
		delete next.mail.smtp.password;
	}
	if (next.captcha.turnstile.secretKey === "") {
		delete next.captcha.turnstile.secretKey;
	}
	if (next.captcha.hcaptcha.secretKey === "") {
		delete next.captcha.hcaptcha.secretKey;
	}
	if (next.captcha.recaptcha.apiKey === "") {
		delete next.captcha.recaptcha.apiKey;
	}
	if (next.captcha.geetest.captchaKey === "") {
		delete next.captcha.geetest.captchaKey;
	}

	return next;
}

function secretPlaceholder(configured: boolean) {
	return configured ? "已配置，留空则保留" : "";
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
						mutation.mutate(withoutEmptySecrets(draft));
					}}
				>
					<Field label="日志等级">
						<select
							className={inputClass}
							value={draft.logging.level}
							onChange={(event) =>
								setDraft({
									...draft,
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
									...draft,
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
					<div className="flex flex-col gap-3 rounded-md border p-3 md:col-span-2">
						<p className="text-sm font-medium">头像 / Gravatar</p>
						<p className="text-sm text-muted-foreground">
							后端只返回 author.gravatarUrl，不托管、不代理、不缓存头像图片。
							图片缺失或加载失败时由前端继续显示名称首字母或文字 fallback。
						</p>
						<div className="grid gap-4 md:grid-cols-2">
							<Field label="启用 Gravatar">
								<select
									className={inputClass}
									value={String(draft.avatar.gravatar.enabled)}
									onChange={(event) =>
										setDraft({
											...draft,
											avatar: {
												gravatar: {
													...draft.avatar.gravatar,
													enabled: event.target.value === "true",
												},
											},
										})
									}
								>
									<option value="false">关闭</option>
									<option value="true">开启</option>
								</select>
							</Field>
							<Field label="Gravatar Base URL">
								<Input
									value={draft.avatar.gravatar.baseUrl}
									onChange={(event) =>
										setDraft({
											...draft,
											avatar: {
												gravatar: {
													...draft.avatar.gravatar,
													baseUrl: event.target.value,
												},
											},
										})
									}
								/>
								<span className="text-xs text-muted-foreground">
									国内部署可填写镜像地址，例如 https://cravatar.cn/avatar。
								</span>
							</Field>
						</div>
					</div>
					<div className="flex flex-col gap-3 rounded-md border p-3 md:col-span-2">
						<p className="text-sm font-medium">邮件通知</p>
						<div className="grid gap-4 md:grid-cols-2">
							<Field label="启用邮件通知">
								<select
									className={inputClass}
									value={String(draft.mail.enabled)}
									onChange={(event) =>
										setDraft({
											...draft,
											mail: {
												...draft.mail,
												enabled: event.target.value === "true",
											},
										})
									}
								>
									<option value="true">启用</option>
									<option value="false">关闭</option>
								</select>
							</Field>
							<Field label="SMTP Host">
								<Input
									value={draft.mail.smtp.host}
									onChange={(event) =>
										setDraft({
											...draft,
											mail: {
												...draft.mail,
												smtp: {
													...draft.mail.smtp,
													host: event.target.value,
												},
											},
										})
									}
								/>
							</Field>
							<Field label="SMTP Port">
								<Input
									type="number"
									min={1}
									value={draft.mail.smtp.port}
									onChange={(event) =>
										setDraft({
											...draft,
											mail: {
												...draft.mail,
												smtp: {
													...draft.mail.smtp,
													port: Number(event.target.value),
												},
											},
										})
									}
								/>
							</Field>
							<Field label="SMTP 加密连接 Secure">
								<select
									className={inputClass}
									value={String(draft.mail.smtp.secure)}
									onChange={(event) =>
										setDraft({
											...draft,
											mail: {
												...draft.mail,
												smtp: {
													...draft.mail.smtp,
													secure: event.target.value === "true",
												},
											},
										})
									}
								>
									<option value="true">启用</option>
									<option value="false">关闭</option>
								</select>
							</Field>
							<Field label="SMTP 用户名">
								<Input
									value={draft.mail.smtp.username}
									onChange={(event) =>
										setDraft({
											...draft,
											mail: {
												...draft.mail,
												smtp: {
													...draft.mail.smtp,
													username: event.target.value,
												},
											},
										})
									}
								/>
							</Field>
							<Field label="发件人">
								<Input
									value={draft.mail.smtp.from}
									onChange={(event) =>
										setDraft({
											...draft,
											mail: {
												...draft.mail,
												smtp: {
													...draft.mail.smtp,
													from: event.target.value,
												},
											},
										})
									}
								/>
							</Field>
							<Field label="SMTP 密码">
								<Input
									type="password"
									autoComplete="new-password"
									placeholder={secretPlaceholder(
										draft.mail.smtp.passwordConfigured,
									)}
									value={draft.mail.smtp.password ?? ""}
									onChange={(event) =>
										setDraft({
											...draft,
											mail: {
												...draft.mail,
												smtp: {
													...draft.mail.smtp,
													password: event.target.value,
												},
											},
										})
									}
								/>
							</Field>
						</div>
					</div>
					<div className="flex flex-col gap-3 rounded-md border p-3 md:col-span-2">
						<p className="text-sm font-medium">验证码服务</p>
						<div className="grid gap-4 md:grid-cols-2">
							<Field label="验证码类型 Provider">
								<select
									className={inputClass}
									value={draft.captcha.provider}
									onChange={(event) =>
										setDraft({
											...draft,
											captcha: {
												...draft.captcha,
												provider: event.target
													.value as AdminSystemSettings["captcha"]["provider"],
											},
										})
									}
								>
									<option value="image">内置图片 image</option>
									<option value="turnstile">Cloudflare Turnstile</option>
									<option value="hcaptcha">hCaptcha</option>
									<option value="recaptcha">Google reCAPTCHA</option>
									<option value="geetest">极验 GeeTest</option>
								</select>
							</Field>
						</div>
						{draft.captcha.provider === "image" ? (
							<div className="grid gap-4 rounded-md border p-3 md:grid-cols-2">
								<p className="text-sm font-medium md:col-span-2">
									内置图片验证码
								</p>
								<Field label="图片宽度">
									<Input
										type="number"
										min={1}
										value={draft.captcha.image.width}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													image: {
														...draft.captcha.image,
														width: Number(event.target.value),
													},
												},
											})
										}
									/>
								</Field>
								<Field label="图片高度">
									<Input
										type="number"
										min={1}
										value={draft.captcha.image.height}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													image: {
														...draft.captcha.image,
														height: Number(event.target.value),
													},
												},
											})
										}
									/>
								</Field>
								<Field label="图片 TTL 秒">
									<Input
										type="number"
										min={1}
										value={draft.captcha.image.ttlSec}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													image: {
														...draft.captcha.image,
														ttlSec: Number(event.target.value),
													},
												},
											})
										}
									/>
								</Field>
							</div>
						) : null}
						{draft.captcha.provider === "turnstile" ? (
							<div className="grid gap-4 rounded-md border p-3 md:grid-cols-2">
								<p className="text-sm font-medium md:col-span-2">
									Cloudflare Turnstile
								</p>
								<Field label="Turnstile Site Key">
									<Input
										value={draft.captcha.turnstile.siteKey}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													turnstile: {
														...draft.captcha.turnstile,
														siteKey: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
								<Field label="Turnstile Secret Key">
									<Input
										type="password"
										placeholder={secretPlaceholder(
											draft.captcha.turnstile.secretKeyConfigured,
										)}
										value={draft.captcha.turnstile.secretKey ?? ""}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													turnstile: {
														...draft.captcha.turnstile,
														secretKey: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
								<Field label="Turnstile Action">
									<Input
										value={draft.captcha.turnstile.expectedAction}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													turnstile: {
														...draft.captcha.turnstile,
														expectedAction: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
								<Field label="Turnstile Hostname">
									<Input
										value={draft.captcha.turnstile.expectedHostname ?? ""}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													turnstile: {
														...draft.captcha.turnstile,
														expectedHostname: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
							</div>
						) : null}
						{draft.captcha.provider === "hcaptcha" ? (
							<div className="grid gap-4 rounded-md border p-3 md:grid-cols-2">
								<p className="text-sm font-medium md:col-span-2">hCaptcha</p>
								<Field label="hCaptcha Site Key">
									<Input
										value={draft.captcha.hcaptcha.siteKey}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													hcaptcha: {
														...draft.captcha.hcaptcha,
														siteKey: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
								<Field label="hCaptcha Secret Key">
									<Input
										type="password"
										placeholder={secretPlaceholder(
											draft.captcha.hcaptcha.secretKeyConfigured,
										)}
										value={draft.captcha.hcaptcha.secretKey ?? ""}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													hcaptcha: {
														...draft.captcha.hcaptcha,
														secretKey: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
								<Field label="hCaptcha Hostname">
									<Input
										value={draft.captcha.hcaptcha.expectedHostname ?? ""}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													hcaptcha: {
														...draft.captcha.hcaptcha,
														expectedHostname: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
							</div>
						) : null}
						{draft.captcha.provider === "recaptcha" ? (
							<div className="grid gap-4 rounded-md border p-3 md:grid-cols-2">
								<p className="text-sm font-medium md:col-span-2">
									Google reCAPTCHA
								</p>
								<Field label="reCAPTCHA Variant">
									<select
										className={inputClass}
										value={draft.captcha.recaptcha.variant}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													recaptcha: {
														...draft.captcha.recaptcha,
														variant: event.target
															.value as AdminSystemSettings["captcha"]["recaptcha"]["variant"],
													},
												},
											})
										}
									>
										<option value="score_based">score_based</option>
										<option value="policy_based_challenge">
											policy_based_challenge
										</option>
									</select>
								</Field>
								<Field label="reCAPTCHA Project ID">
									<Input
										value={draft.captcha.recaptcha.projectId}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													recaptcha: {
														...draft.captcha.recaptcha,
														projectId: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
								<Field label="reCAPTCHA Site Key">
									<Input
										value={draft.captcha.recaptcha.siteKey}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													recaptcha: {
														...draft.captcha.recaptcha,
														siteKey: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
								<Field label="reCAPTCHA API Key">
									<Input
										type="password"
										placeholder={secretPlaceholder(
											draft.captcha.recaptcha.apiKeyConfigured,
										)}
										value={draft.captcha.recaptcha.apiKey ?? ""}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													recaptcha: {
														...draft.captcha.recaptcha,
														apiKey: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
								<Field label="reCAPTCHA Action">
									<Input
										value={draft.captcha.recaptcha.expectedAction}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													recaptcha: {
														...draft.captcha.recaptcha,
														expectedAction: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
								<Field label="reCAPTCHA Hostname">
									<Input
										value={draft.captcha.recaptcha.expectedHostname ?? ""}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													recaptcha: {
														...draft.captcha.recaptcha,
														expectedHostname: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
								<Field label="reCAPTCHA 最低分数 Min Score">
									<Input
										type="number"
										min={0}
										max={1}
										step={0.01}
										value={draft.captcha.recaptcha.minScore}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													recaptcha: {
														...draft.captcha.recaptcha,
														minScore: Number(event.target.value),
													},
												},
											})
										}
									/>
								</Field>
							</div>
						) : null}
						{draft.captcha.provider === "geetest" ? (
							<div className="grid gap-4 rounded-md border p-3 md:grid-cols-2">
								<p className="text-sm font-medium md:col-span-2">GeeTest</p>
								<Field label="GeeTest Captcha ID">
									<Input
										value={draft.captcha.geetest.captchaId}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													geetest: {
														...draft.captcha.geetest,
														captchaId: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
								<Field label="GeeTest Captcha Key">
									<Input
										type="password"
										placeholder={secretPlaceholder(
											draft.captcha.geetest.captchaKeyConfigured,
										)}
										value={draft.captcha.geetest.captchaKey ?? ""}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													geetest: {
														...draft.captcha.geetest,
														captchaKey: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
								<Field label="GeeTest API Server">
									<Input
										value={draft.captcha.geetest.apiServer}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													geetest: {
														...draft.captcha.geetest,
														apiServer: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
							</div>
						) : null}
					</div>
					<div className="flex flex-col gap-3 rounded-md border p-3 md:col-span-2">
						<p className="text-sm font-medium">IP 数据库</p>
						<div className="grid gap-4 md:grid-cols-2">
							<Field label="IP 地域解析">
								<select
									className={inputClass}
									value={String(draft.ipRegion.enabled)}
									onChange={(event) =>
										setDraft({
											...draft,
											ipRegion: {
												...draft.ipRegion,
												enabled: event.target.value === "true",
											},
										})
									}
								>
									<option value="true">启用</option>
									<option value="false">关闭</option>
								</select>
							</Field>
							<Field label="缓存策略">
								<select
									className={inputClass}
									value={draft.ipRegion.cachePolicy}
									onChange={(event) =>
										setDraft({
											...draft,
											ipRegion: {
												...draft.ipRegion,
												cachePolicy: event.target.value as
													| "file"
													| "vectorIndex"
													| "content",
											},
										})
									}
								>
									<option value="file">file</option>
									<option value="vectorIndex">vectorIndex</option>
									<option value="content">content</option>
								</select>
							</Field>
							<Field label="默认地域精度">
								<select
									className={inputClass}
									value={draft.ipRegion.precision}
									onChange={(event) =>
										setDraft({
											...draft,
											ipRegion: {
												...draft.ipRegion,
												precision: event.target.value as
													| "country"
													| "province"
													| "city",
											},
										})
									}
								>
									<option value="country">国家</option>
									<option value="province">省份</option>
									<option value="city">城市</option>
								</select>
							</Field>
							<Field label="每月自动更新">
								<select
									className={inputClass}
									value={String(draft.ipRegion.autoUpdate.enabled)}
									onChange={(event) =>
										setDraft({
											...draft,
											ipRegion: {
												...draft.ipRegion,
												autoUpdate: {
													...draft.ipRegion.autoUpdate,
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
							<Field label="IPv4 数据库路径">
								<Input
									value={draft.ipRegion.ipv4.dbPath}
									onChange={(event) =>
										setDraft({
											...draft,
											ipRegion: {
												...draft.ipRegion,
												ipv4: {
													...draft.ipRegion.ipv4,
													dbPath: event.target.value,
												},
											},
										})
									}
								/>
							</Field>
							<Field label="IPv6 数据库路径">
								<Input
									value={draft.ipRegion.ipv6.dbPath}
									onChange={(event) =>
										setDraft({
											...draft,
											ipRegion: {
												...draft.ipRegion,
												ipv6: {
													...draft.ipRegion.ipv6,
													dbPath: event.target.value,
												},
											},
										})
									}
								/>
							</Field>
							<Field label="IPv4 下载源">
								<textarea
									className={textareaClass}
									value={draft.ipRegion.ipv4.sources.join("\n")}
									onChange={(event) =>
										setDraft({
											...draft,
											ipRegion: {
												...draft.ipRegion,
												ipv4: {
													...draft.ipRegion.ipv4,
													sources: event.target.value
														.split(/\r?\n/)
														.map((value) => value.trim())
														.filter(Boolean),
												},
											},
										})
									}
								/>
							</Field>
							<Field label="IPv6 下载源">
								<textarea
									className={textareaClass}
									value={draft.ipRegion.ipv6.sources.join("\n")}
									onChange={(event) =>
										setDraft({
											...draft,
											ipRegion: {
												...draft.ipRegion,
												ipv6: {
													...draft.ipRegion.ipv6,
													sources: event.target.value
														.split(/\r?\n/)
														.map((value) => value.trim())
														.filter(Boolean),
												},
											},
										})
									}
								/>
							</Field>
						</div>
					</div>
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
