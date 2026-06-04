import { useEffect, useMemo, useState } from "react";
import { Dialog } from "@radix-ui/themes";

import type {
	NotificationChannelConfig,
	SiteNotificationRecipient,
} from "@/api/admin";
import type {
	ScheduledTaskProjection,
	ScheduledTaskWriteInput,
	TaskScheduleKind,
	TaskTriggerInput,
	TaskTypeDefinition,
} from "@/api/tasks";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Field, inputClass, textareaClass } from "./admin-ui";
import { formatDateTimeLocalValue } from "./time-format";
import { TaskTypePayloadForm } from "./task-type-forms";
import { scheduleKindLabels } from "./task-status-badge";

const scheduleKinds: TaskScheduleKind[] = [
	"manual_only",
	"once",
	"interval",
	"daily",
	"weekly",
	"monthly",
	"cron",
];

interface TaskDraft extends ScheduledTaskWriteInput {
	type: string;
}

function fieldError(error: unknown, path: string): string | undefined {
	if (!(error instanceof ApiError)) {
		return undefined;
	}
	return error.fields.find((item) => item.path === path)?.message;
}

function localDateTimeFromIso(value?: string | null): string {
	if (!value) {
		return "";
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return "";
	}
	return formatDateTimeLocalValue(date);
}

function isoFromLocalDateTime(value: string): string | undefined {
	if (!value) {
		return undefined;
	}
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function optionalNumber(value: string): number | undefined {
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}
	const parsed = Number(trimmed);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function toggleStringValue(values: string[], value: string, checked: boolean) {
	if (checked) {
		return values.includes(value) ? values : [...values, value];
	}
	return values.filter((item) => item !== value);
}

function initialPayload(definition: TaskTypeDefinition, siteKey: string) {
	const payload = { ...definition.defaultPayload };
	if (definition.scope === "site" && !payload.siteKey) {
		payload.siteKey = siteKey;
	}
	return payload;
}

function initialDraft(
	definitions: TaskTypeDefinition[],
	siteKey: string,
	task?: ScheduledTaskProjection | null,
): TaskDraft {
	const fallbackDefinition = definitions[0];
	const type = task?.type ?? fallbackDefinition?.type ?? "";
	const definition =
		definitions.find((item) => item.type === type) ?? fallbackDefinition;
	const scopeKind = task?.scopeKind ?? definition?.scope ?? "global";
	return {
		name: task?.name ?? "",
		description: task?.description ?? "",
		type,
		siteKey:
			scopeKind === "site"
				? task?.payload?.siteKey
					? String(task.payload.siteKey)
					: siteKey
				: null,
		scopeKind,
		scope:
			task?.scope && typeof task.scope === "object"
				? (task.scope as Record<string, unknown>)
				: scopeKind === "site"
					? { siteKey }
					: {},
		enabled: task?.enabled ?? false,
		scheduleKind: task?.scheduleKind ?? "manual_only",
		schedulePreset: task?.schedulePreset ?? null,
		cronExpression: task?.cronExpression ?? null,
		timezone: task?.timezone ?? null,
		payload:
			task?.payload ??
			(definition
				? initialPayload(definition, siteKey)
				: ({} as Record<string, unknown>)),
		policy: task?.policy ?? definition?.defaultPolicy ?? { maxAttempts: 1 },
		trigger: task?.trigger ?? {},
		retentionCount: task?.retentionCount ?? 5,
	};
}

function schedulePreview(draft: TaskDraft): string {
	switch (draft.scheduleKind) {
		case "manual_only":
			return "仅手动触发，不自动排期。";
		case "once":
			return draft.trigger.runAt
				? `一次运行：${new Date(draft.trigger.runAt).toLocaleString()}`
				: "请选择一次运行时间。";
		case "interval":
			return draft.schedulePreset
				? `按预设间隔运行：${draft.schedulePreset}`
				: `每 ${draft.trigger.everyMinutes ?? "-"} 分钟运行。`;
		case "daily":
			return `每日 ${draft.trigger.time ?? "09:00"} 运行。`;
		case "weekly":
			return `每周 ${draft.trigger.dayOfWeek ?? 1} 的 ${draft.trigger.time ?? "09:00"} 运行。`;
		case "monthly":
			return `每月 ${draft.trigger.dayOfMonth ?? 1} 日 ${draft.trigger.time ?? "09:00"} 运行。`;
		case "cron":
			return draft.cronExpression
				? `五字段 Cron：${draft.cronExpression}`
				: "请输入五字段 Cron 表达式。";
	}
}

export function TaskEditorDialog({
	open,
	mode,
	task,
	definitions,
	siteKey,
	notificationChannelConfigs,
	notificationRecipients,
	isSaving,
	saveError,
	onOpenChange,
	onSubmit,
}: {
	open: boolean;
	mode: "create" | "edit";
	task?: ScheduledTaskProjection | null;
	definitions: TaskTypeDefinition[];
	siteKey: string;
	notificationChannelConfigs: NotificationChannelConfig[];
	notificationRecipients: SiteNotificationRecipient[];
	isSaving: boolean;
	saveError: unknown;
	onOpenChange: (open: boolean) => void;
	onSubmit: (input: ScheduledTaskWriteInput) => void;
}) {
	const [draft, setDraft] = useState<TaskDraft>(() =>
		initialDraft(definitions, siteKey, task),
	);

	useEffect(() => {
		if (open) {
			setDraft(initialDraft(definitions, siteKey, task));
		}
	}, [definitions, open, siteKey, task]);

	const selectedDefinition = useMemo(
		() => definitions.find((item) => item.type === draft.type) ?? null,
		[definitions, draft.type],
	);
	const enabledChannelConfigs = useMemo(
		() => notificationChannelConfigs.filter((config) => config.enabled),
		[notificationChannelConfigs],
	);
	const enabledRecipients = useMemo(
		() =>
			notificationRecipients.filter(
				(recipient) => recipient.enabled && recipient.id,
			),
		[notificationRecipients],
	);
	const failureNotification = draft.policy.failureNotification ?? {
		enabled: false,
		channelConfigIds: [],
		recipientIds: [],
	};
	const isProtected = Boolean(task?.protection);
	const lockedType = Boolean(task?.protection?.lockedType);
	const lockedSite = Boolean(task?.protection?.lockedSite);
	const lockedDisable = Boolean(task?.protection?.lockedDisable);

	const updateDraft = (patch: Partial<TaskDraft>) => {
		setDraft((current) => ({ ...current, ...patch }));
	};
	const updateTrigger = (patch: Partial<TaskTriggerInput>) => {
		setDraft((current) => ({
			...current,
			trigger: { ...current.trigger, ...patch },
		}));
	};
	const updateFailureNotification = (
		patch: Partial<NonNullable<TaskDraft["policy"]["failureNotification"]>>,
	) => {
		setDraft((current) => ({
			...current,
			policy: {
				...current.policy,
				failureNotification: {
					enabled: false,
					channelConfigIds: [],
					recipientIds: [],
					...current.policy.failureNotification,
					...patch,
				},
			},
		}));
	};
	const changeType = (type: string) => {
		const definition = definitions.find((item) => item.type === type);
		if (!definition) {
			updateDraft({ type });
			return;
		}
		updateDraft({
			type,
			scopeKind: definition.scope,
			siteKey: definition.scope === "site" ? siteKey : null,
			scope: definition.scope === "site" ? { siteKey } : {},
			enabled: false,
			payload: initialPayload(definition, siteKey),
			policy: definition.defaultPolicy,
		});
	};

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Content maxWidth="880px">
				<Dialog.Title>
					{mode === "create" ? "添加计划任务" : "编辑计划任务"}
				</Dialog.Title>
				<Dialog.Description size="2">
					{isProtected
						? (task?.protectedReason ??
							"该任务由系统托管，只有白名单字段可编辑。")
						: "选择内置任务类型，填写专属参数和调度策略。原始 JSON 不作为主要编辑入口。"}
				</Dialog.Description>
				<form
					className="mt-4 grid gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						onSubmit(draft);
					}}
				>
					<section className="grid gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-2">
						<h3 className="text-sm font-semibold md:col-span-2">1. 任务类型</h3>
						<Field label="类型" error={fieldError(saveError, "type")}>
							<select
								className={inputClass}
								value={draft.type}
								disabled={mode === "edit" || lockedType}
								onChange={(event) => changeType(event.target.value)}
							>
								{definitions.map((definition) => (
									<option key={definition.type} value={definition.type}>
										{definition.label}
									</option>
								))}
							</select>
						</Field>
						<div className="rounded-md border bg-background p-3 text-sm leading-6 text-muted-foreground">
							{selectedDefinition?.description ?? "暂无任务类型说明。"}
						</div>
					</section>

					<section className="grid gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-2">
						<h3 className="text-sm font-semibold md:col-span-2">
							2. 名称与范围
						</h3>
						<Field label="名称" error={fieldError(saveError, "name")}>
							<Input
								value={draft.name}
								onChange={(event) => updateDraft({ name: event.target.value })}
							/>
						</Field>
						<Field label="范围">
							<select
								className={inputClass}
								value={draft.scopeKind}
								disabled={lockedSite}
								onChange={(event) =>
									updateDraft({
										scopeKind: event.target.value,
										siteKey: event.target.value === "site" ? siteKey : null,
										scope: event.target.value === "site" ? { siteKey } : {},
									})
								}
							>
								<option value="global">全局</option>
								<option value="site">当前站点</option>
							</select>
						</Field>
						<Field label="描述">
							<textarea
								className={textareaClass}
								value={draft.description ?? ""}
								onChange={(event) =>
									updateDraft({ description: event.target.value })
								}
							/>
						</Field>
						<Field label="启用状态">
							<select
								className={inputClass}
								value={draft.enabled ? "enabled" : "disabled"}
								disabled={draft.enabled && lockedDisable}
								onChange={(event) =>
									updateDraft({ enabled: event.target.value === "enabled" })
								}
							>
								<option value="disabled">保存为停用</option>
								<option value="enabled">保存后启用</option>
							</select>
						</Field>
					</section>

					<section className="grid gap-3 rounded-md border bg-muted/20 p-3">
						<h3 className="text-sm font-semibold">3. 任务参数</h3>
						<TaskTypePayloadForm
							definition={selectedDefinition}
							payload={draft.payload}
							siteKey={siteKey}
							onChange={(payload) =>
								updateDraft({
									payload,
									siteKey:
										draft.scopeKind === "site" &&
										typeof payload.siteKey === "string"
											? payload.siteKey
											: draft.siteKey,
									scope:
										draft.scopeKind === "site" &&
										typeof payload.siteKey === "string"
											? { siteKey: payload.siteKey }
											: draft.scope,
								})
							}
						/>
						{fieldError(saveError, "payload.siteKey") ? (
							<p className="text-xs font-medium text-destructive">
								{fieldError(saveError, "payload.siteKey")}
							</p>
						) : null}
					</section>

					<section className="grid gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-3">
						<h3 className="text-sm font-semibold md:col-span-3">4. 调度</h3>
						<Field label="调度类型">
							<select
								className={inputClass}
								value={draft.scheduleKind}
								onChange={(event) =>
									updateDraft({
										scheduleKind: event.target.value as TaskScheduleKind,
										schedulePreset: null,
										cronExpression: null,
										trigger: {},
									})
								}
							>
								{scheduleKinds.map((kind) => (
									<option key={kind} value={kind}>
										{scheduleKindLabels[kind]}
									</option>
								))}
							</select>
						</Field>
						{draft.scheduleKind === "once" ? (
							<Field label="运行时间">
								<Input
									type="datetime-local"
									value={localDateTimeFromIso(draft.trigger.runAt)}
									onChange={(event) =>
										updateTrigger({
											runAt: isoFromLocalDateTime(event.target.value),
										})
									}
								/>
							</Field>
						) : null}
						{draft.scheduleKind === "interval" ? (
							<>
								<Field label="预设">
									<select
										className={inputClass}
										value={draft.schedulePreset ?? ""}
										onChange={(event) =>
											updateDraft({
												schedulePreset: event.target.value || null,
											})
										}
									>
										<option value="">自定义分钟数</option>
										<option value="hourly">每小时</option>
										<option value="every_2_hours">每 2 小时</option>
									</select>
								</Field>
								<Field
									label="间隔分钟"
									error={fieldError(saveError, "trigger.everyMinutes")}
								>
									<Input
										type="number"
										min={5}
										value={draft.trigger.everyMinutes ?? ""}
										disabled={Boolean(draft.schedulePreset)}
										onChange={(event) =>
											updateTrigger({
												everyMinutes: optionalNumber(event.target.value),
											})
										}
									/>
								</Field>
							</>
						) : null}
						{["daily", "weekly", "monthly"].includes(draft.scheduleKind) ? (
							<Field label="UTC 时间">
								<Input
									type="time"
									value={draft.trigger.time ?? "09:00"}
									onChange={(event) =>
										updateTrigger({ time: event.target.value })
									}
								/>
							</Field>
						) : null}
						{draft.scheduleKind === "weekly" ? (
							<Field label="星期">
								<Input
									type="number"
									min={0}
									max={6}
									value={draft.trigger.dayOfWeek ?? 1}
									onChange={(event) =>
										updateTrigger({
											dayOfWeek: optionalNumber(event.target.value),
										})
									}
								/>
							</Field>
						) : null}
						{draft.scheduleKind === "monthly" ? (
							<Field label="日期">
								<Input
									type="number"
									min={1}
									max={31}
									value={draft.trigger.dayOfMonth ?? 1}
									onChange={(event) =>
										updateTrigger({
											dayOfMonth: optionalNumber(event.target.value),
										})
									}
								/>
							</Field>
						) : null}
						{draft.scheduleKind === "cron" ? (
							<Field label="Cron 表达式">
								<Input
									value={draft.cronExpression ?? ""}
									placeholder="*/15 * * * *"
									onChange={(event) =>
										updateDraft({ cronExpression: event.target.value })
									}
								/>
							</Field>
						) : null}
						<div className="rounded-md border bg-background p-3 text-sm text-muted-foreground md:col-span-3">
							{schedulePreview(draft)}
						</div>
					</section>

					<section className="grid gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-3">
						<h3 className="text-sm font-semibold md:col-span-3">5. 高级策略</h3>
						<Field label="最大尝试">
							<Input
								type="number"
								min={1}
								value={draft.policy.maxAttempts ?? 1}
								onChange={(event) =>
									updateDraft({
										policy: {
											...draft.policy,
											maxAttempts: optionalNumber(event.target.value),
										},
									})
								}
							/>
						</Field>
						<Field label="重试延迟秒">
							<Input
								type="number"
								min={0}
								value={draft.policy.retryDelaySec ?? 0}
								onChange={(event) =>
									updateDraft({
										policy: {
											...draft.policy,
											retryDelaySec: optionalNumber(event.target.value),
										},
									})
								}
							/>
						</Field>
						<Field label="保留运行数">
							<Input
								type="number"
								min={0}
								max={30}
								value={draft.retentionCount}
								onChange={(event) =>
									updateDraft({
										retentionCount: optionalNumber(event.target.value) ?? 5,
									})
								}
							/>
						</Field>
						<Field label="并发键">
							<Input
								value={draft.policy.concurrencyKey ?? ""}
								placeholder="留空使用默认任务范围锁"
								onChange={(event) =>
									updateDraft({
										policy: {
											...draft.policy,
											concurrencyKey: event.target.value.trim() || undefined,
										},
									})
								}
							/>
						</Field>
						<div className="grid gap-3 rounded-md border bg-background p-3 md:col-span-3">
							<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
								<div className="grid gap-1">
									<h4 className="text-sm font-semibold">失败通知</h4>
									<p className="text-xs leading-5 text-muted-foreground">
										默认关闭。开启后仅使用已配置的站点通知接收人和系统通知通道。
									</p>
								</div>
								<label className="flex items-center gap-2 text-sm">
									<input
										type="checkbox"
										checked={failureNotification.enabled}
										disabled={draft.scopeKind !== "site"}
										onChange={(event) =>
											updateFailureNotification({
												enabled: event.target.checked,
												channelConfigIds:
													failureNotification.channelConfigIds.length > 0
														? failureNotification.channelConfigIds
														: enabledChannelConfigs
																.slice(0, 1)
																.map((config) => config.id),
												recipientIds:
													failureNotification.recipientIds.length > 0
														? failureNotification.recipientIds
														: enabledRecipients
																.slice(0, 1)
																.flatMap((recipient) =>
																	recipient.id ? [recipient.id] : [],
																),
											})
										}
									/>
									<span>{failureNotification.enabled ? "开启" : "关闭"}</span>
								</label>
							</div>
							{draft.scopeKind !== "site" ? (
								<p className="text-xs text-muted-foreground">
									失败通知只支持站点范围任务。
								</p>
							) : failureNotification.enabled ? (
								<div className="grid gap-3 md:grid-cols-2">
									<div className="grid gap-2">
										<span className="text-xs font-semibold text-muted-foreground">
											通知通道
										</span>
										{enabledChannelConfigs.length === 0 ? (
											<p className="rounded-md border p-3 text-xs text-muted-foreground">
												暂无启用的通知通道。
											</p>
										) : (
											<div className="grid gap-2">
												{enabledChannelConfigs.map((config) => (
													<label
														key={config.id}
														className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
													>
														<span>
															{config.name}
															<span className="ml-2 text-xs text-muted-foreground">
																{config.id}
															</span>
														</span>
														<input
															type="checkbox"
															checked={failureNotification.channelConfigIds.includes(
																config.id,
															)}
															onChange={(event) =>
																updateFailureNotification({
																	channelConfigIds: toggleStringValue(
																		failureNotification.channelConfigIds,
																		config.id,
																		event.target.checked,
																	),
																})
															}
														/>
													</label>
												))}
											</div>
										)}
									</div>
									<div className="grid gap-2">
										<span className="text-xs font-semibold text-muted-foreground">
											接收人
										</span>
										{enabledRecipients.length === 0 ? (
											<p className="rounded-md border p-3 text-xs text-muted-foreground">
												当前站点暂无启用的通知接收人。
											</p>
										) : (
											<div className="grid gap-2">
												{enabledRecipients.map((recipient) => (
													<label
														key={recipient.id}
														className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
													>
														<span>
															{recipient.displayName || recipient.username}
															<span className="ml-2 text-xs text-muted-foreground">
																{recipient.email}
															</span>
														</span>
														<input
															type="checkbox"
															checked={
																recipient.id
																	? failureNotification.recipientIds.includes(
																			recipient.id,
																		)
																	: false
															}
															onChange={(event) =>
																recipient.id
																	? updateFailureNotification({
																			recipientIds: toggleStringValue(
																				failureNotification.recipientIds,
																				recipient.id,
																				event.target.checked,
																			),
																		})
																	: undefined
															}
														/>
													</label>
												))}
											</div>
										)}
									</div>
								</div>
							) : null}
							{fieldError(
								saveError,
								"policy.failureNotification.channelConfigIds",
							) ? (
								<p className="text-xs font-medium text-destructive">
									{fieldError(
										saveError,
										"policy.failureNotification.channelConfigIds",
									)}
								</p>
							) : null}
							{fieldError(
								saveError,
								"policy.failureNotification.recipientIds",
							) ? (
								<p className="text-xs font-medium text-destructive">
									{fieldError(
										saveError,
										"policy.failureNotification.recipientIds",
									)}
								</p>
							) : null}
						</div>
					</section>

					{saveError instanceof ApiError ? (
						<div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
							<p>{saveError.message}</p>
							{saveError.fields.length > 0 ? (
								<ul className="mt-2 list-disc pl-5">
									{saveError.fields.map((item) => (
										<li key={`${item.path}:${item.message}`}>
											{item.path}: {item.message}
										</li>
									))}
								</ul>
							) : null}
						</div>
					) : null}

					<div className="flex justify-end gap-2">
						<Dialog.Close>
							<Button type="button" variant="outline" disabled={isSaving}>
								取消
							</Button>
						</Dialog.Close>
						<Button type="submit" disabled={isSaving || !draft.type}>
							{isSaving ? "保存中" : "保存"}
						</Button>
					</div>
				</form>
			</Dialog.Content>
		</Dialog.Root>
	);
}
