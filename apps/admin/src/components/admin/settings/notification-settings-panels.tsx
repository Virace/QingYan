import { Dialog } from "@radix-ui/themes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
	getNotificationChainTest,
	getNotificationDiagnostics,
	listNotificationTemplates,
	type NotificationChannel,
	type NotificationChannelConfig,
	type NotificationTemplate,
	type NotificationTemplateFormat,
	previewNotificationTemplate,
	type RenderedNotificationTemplate,
	restoreNotificationTemplateDefault,
	startNotificationChainTest,
	testNotificationTemplate,
	updateNotificationTemplate,
} from "@/api/admin";
import { adminUiErrorMessage } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	notificationChannelConfigLabel,
	notificationChannelLabels,
	notificationChannelTargetSummary,
} from "../content/notification-ui-model";
import {
	BooleanField,
	EmptyState,
	Field,
	inputClass,
	SettingsSection,
	textareaClass,
} from "../shared/admin-ui";
import { useAdminConfirmDialog } from "../shared/confirm-dialog";
import {
	diagnosticFlowRows,
	notificationChainTestBlockers,
	notificationChainTestPollInterval,
	notificationStatusBadge,
	summarizeNotificationChainTest,
} from "./notification-diagnostics-model";
import { buildSettingsErrorModel } from "./settings-error-model";
import {
	configStringValue,
	SettingsSaveError,
	secretPlaceholder,
	secretStringValue,
} from "./settings-shared";

function NotificationChannelConfigEditor({
	config,
	onChange,
	onRemove,
}: {
	config: NotificationChannelConfig;
	onChange: (config: NotificationChannelConfig) => void;
	onRemove?: () => void;
}) {
	const readOnly = config.type === "email";

	return (
		<div className="grid gap-3 rounded-md border bg-background p-3">
			<div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
				<div>
					<p className="font-medium">
						{notificationChannelConfigLabel(config)}
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<BooleanField
						label="启用"
						checked={config.enabled}
						onCheckedChange={(enabled) => onChange({ ...config, enabled })}
					/>
					{onRemove ? (
						<Button
							type="button"
							size="sm"
							variant="destructive"
							onClick={onRemove}
						>
							删除
						</Button>
					) : null}
				</div>
			</div>
			<div className="grid gap-3 md:grid-cols-2">
				<Field label="名称">
					<Input
						value={config.name}
						disabled={readOnly}
						onChange={(event) =>
							onChange({ ...config, name: event.target.value })
						}
					/>
				</Field>
				<Field label="说明">
					<Input
						value={config.description ?? ""}
						disabled={readOnly}
						onChange={(event) =>
							onChange({
								...config,
								description: event.target.value.trim() || null,
							})
						}
					/>
				</Field>
				{config.type === "webhook" ? (
					<>
						<Field label="Webhook URL">
							<Input
								value={configStringValue(config, "url")}
								onChange={(event) =>
									onChange({
										...config,
										config: {
											...config.config,
											url: event.target.value,
										},
									})
								}
							/>
						</Field>
						<Field label="Webhook Secret">
							<Input
								type="password"
								autoComplete="new-password"
								placeholder={secretPlaceholder(
									Boolean(config.secretConfigured),
								)}
								value={secretStringValue(config, "secret")}
								onChange={(event) =>
									onChange({
										...config,
										secretConfig: {
											...(config.secretConfig ?? {}),
											secret: event.target.value,
										},
									})
								}
							/>
						</Field>
					</>
				) : null}
				{config.type === "wxpusher" ? (
					<>
						<Field label="WxPusher API URL">
							<Input
								value={configStringValue(config, "apiUrl")}
								onChange={(event) =>
									onChange({
										...config,
										config: {
											...config.config,
											apiUrl: event.target.value,
										},
									})
								}
							/>
						</Field>
						<Field label="WxPusher App Token">
							<Input
								type="password"
								autoComplete="new-password"
								placeholder={secretPlaceholder(
									Boolean(config.secretConfigured),
								)}
								value={secretStringValue(config, "appToken")}
								onChange={(event) =>
									onChange({
										...config,
										secretConfig: {
											...(config.secretConfig ?? {}),
											appToken: event.target.value,
										},
									})
								}
							/>
						</Field>
						<Field label="接收目标摘要">
							<Input
								value={configStringValue(config, "targetSummary")}
								onChange={(event) =>
									onChange({
										...config,
										config: {
											...config.config,
											targetSummary: event.target.value,
										},
									})
								}
							/>
						</Field>
					</>
				) : null}
			</div>
		</div>
	);
}

export function NotificationChannelTestDialog({
	open,
	config,
	defaultRecipient,
	onOpenChange,
	onTest,
	pending,
}: {
	open: boolean;
	config: NotificationChannelConfig;
	defaultRecipient?: string;
	onOpenChange: (open: boolean) => void;
	onTest: (input: { channelConfigId: string; recipient?: string }) => void;
	pending: boolean;
}) {
	const [recipient, setRecipient] = useState(defaultRecipient ?? "");

	useEffect(() => {
		if (open) {
			setRecipient(defaultRecipient ?? "");
		}
	}, [defaultRecipient, open]);

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Content maxWidth="520px">
				<Dialog.Title>测试通知通道</Dialog.Title>
				<Dialog.Description size="2">
					发送一条真实测试通知，结果可在任务中心查看。
				</Dialog.Description>
				<div className="mt-4 grid gap-3">
					<div className="rounded-md border bg-muted/30 p-3 text-sm">
						<p className="font-medium">
							{notificationChannelConfigLabel(config)}
						</p>
						<p className="text-xs text-muted-foreground">
							{notificationChannelTargetSummary(config)}
						</p>
					</div>
					<Field label="测试收件人 / 目标">
						<Input
							value={recipient}
							placeholder="留空使用当前管理员邮箱或通道默认目标"
							onChange={(event) => setRecipient(event.target.value)}
						/>
					</Field>
					<div className="flex justify-end gap-2">
						<Dialog.Close>
							<Button type="button" variant="outline">
								取消
							</Button>
						</Dialog.Close>
						<Button
							type="button"
							disabled={pending}
							onClick={() =>
								onTest({
									channelConfigId: config.id,
									recipient: recipient.trim() || undefined,
								})
							}
						>
							发送测试通知
						</Button>
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Root>
	);
}

export function MailTestPanel({
	testable,
	reason,
	onOpen,
}: {
	testable: boolean;
	reason: string;
	onOpen: () => void;
}) {
	return (
		<div className="rounded-md border bg-background p-3">
			<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
				<div>
					<p className="font-medium">邮件测试</p>
					<p className="text-sm text-muted-foreground">
						发送一封真实测试邮件，结果可在任务中心查看。
					</p>
					{reason ? (
						<p className="mt-1 text-xs text-muted-foreground">{reason}</p>
					) : null}
				</div>
				<Button
					type="button"
					variant="outline"
					disabled={!testable}
					onClick={onOpen}
				>
					测试邮件
				</Button>
			</div>
		</div>
	);
}

export function NotificationChannelConfigList({
	configs,
	onAdd,
	onEdit,
	onRemove,
	onTest,
}: {
	configs: NotificationChannelConfig[];
	onAdd: (type: Exclude<NotificationChannel, "email">) => void;
	onEdit: (config: NotificationChannelConfig) => void;
	onRemove: (config: NotificationChannelConfig) => void;
	onTest: (config: NotificationChannelConfig) => void;
}) {
	return (
		<div className="grid gap-3">
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="outline"
					onClick={() => onAdd("webhook")}
				>
					添加 Webhook
				</Button>
				<Button
					type="button"
					variant="outline"
					onClick={() => onAdd("wxpusher")}
				>
					添加 WxPusher
				</Button>
			</div>
			<div className="overflow-x-auto rounded-md border bg-background">
				<table className="w-full text-left text-sm">
					<thead className="bg-muted/60">
						<tr>
							<th className="p-3">名称</th>
							<th className="p-3">类型</th>
							<th className="p-3">状态</th>
							<th className="p-3">目标</th>
							<th className="p-3">密钥</th>
							<th className="p-3">操作</th>
						</tr>
					</thead>
					<tbody>
						{configs.map((config) => (
							<tr key={config.id} className="border-t">
								<td className="p-3">
									<p className="font-medium">{config.name}</p>
								</td>
								<td className="p-3">
									{notificationChannelLabels[config.type]}
								</td>
								<td className="p-3">
									<Badge variant={config.enabled ? "secondary" : "outline"}>
										{config.enabled ? "启用" : "停用"}
									</Badge>
								</td>
								<td className="p-3">
									{notificationChannelTargetSummary(config)}
								</td>
								<td className="p-3">
									{config.type === "email"
										? "使用 SMTP"
										: config.secretConfigured
											? "已配置"
											: "未配置"}
								</td>
								<td className="p-3">
									<div className="flex flex-wrap gap-2">
										{config.type === "email" ? null : (
											<Button
												type="button"
												size="sm"
												variant="outline"
												onClick={() => onEdit(config)}
											>
												编辑
											</Button>
										)}
										{config.type === "email" ? (
											<span className="text-xs text-muted-foreground">
												到邮件页签测试
											</span>
										) : (
											<Button
												type="button"
												size="sm"
												variant="outline"
												disabled={!config.enabled}
												onClick={() => onTest(config)}
											>
												测试
											</Button>
										)}
										{config.type === "email" ? null : (
											<Button
												type="button"
												size="sm"
												variant="destructive"
												onClick={() => onRemove(config)}
											>
												删除
											</Button>
										)}
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

export function NotificationChannelConfigDialog({
	open,
	draft,
	mode,
	onOpenChange,
	onDraftChange,
	onSubmit,
}: {
	open: boolean;
	draft: NotificationChannelConfig | null;
	mode: "create" | "edit";
	onOpenChange: (open: boolean) => void;
	onDraftChange: (draft: NotificationChannelConfig) => void;
	onSubmit: () => void;
}) {
	if (!draft) {
		return null;
	}
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Content maxWidth="680px">
				<Dialog.Title>
					{mode === "create" ? "添加通知渠道" : "编辑通知渠道"}
				</Dialog.Title>
				<Dialog.Description size="2">
					确认后才写回渠道列表；密钥字段留空时保留已有配置。
				</Dialog.Description>
				<div className="mt-4 grid gap-3">
					<NotificationChannelConfigEditor
						config={draft}
						onChange={onDraftChange}
					/>
					<div className="flex justify-end gap-2">
						<Dialog.Close>
							<Button type="button" variant="outline">
								取消
							</Button>
						</Dialog.Close>
						<Button type="button" onClick={onSubmit}>
							确认
						</Button>
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Root>
	);
}

type NotificationTemplateDraft = {
	format: NotificationTemplateFormat;
	subjectTemplate: string;
	bodyTemplate: string;
};

function notificationTemplateDraftFrom(
	template: NotificationTemplate,
): NotificationTemplateDraft {
	return {
		format: template.format,
		subjectTemplate: template.subjectTemplate ?? "",
		bodyTemplate: template.bodyTemplate,
	};
}

function notificationTemplateOptionLabel(template: NotificationTemplate) {
	return `${template.channelLabel} / ${template.formatLabel}`;
}

function notificationTemplateResultSummary(result: {
	taskId: string;
	deliveryId: string;
	channel: NotificationChannel;
	recipient: string;
}) {
	return `测试通知已交给${
		notificationChannelLabels[result.channel]
	}发送，接收目标：${result.recipient}。可在任务中心查看结果。`;
}

function NotificationTemplatePreview({
	format,
	preview,
}: {
	format: NotificationTemplateFormat;
	preview: RenderedNotificationTemplate | null;
}) {
	if (!preview) {
		return <EmptyState text="尚未生成预览" />;
	}
	if (format === "html") {
		return (
			<div className="grid gap-2 rounded-md border p-3 text-sm">
				<p className="font-medium">HTML 预览</p>
				{preview.subject ? (
					<p className="text-muted-foreground">主题：{preview.subject}</p>
				) : null}
				<iframe
					title="通知模板 HTML 预览"
					sandbox=""
					srcDoc={preview.body}
					className="h-56 w-full rounded border bg-background"
				/>
			</div>
		);
	}
	if (format === "json") {
		let formatted = preview.body;
		let error: string | null = null;
		try {
			formatted = JSON.stringify(JSON.parse(preview.body), null, 2);
		} catch {
			error = "内容不是合法 JSON。";
		}
		return (
			<div className="grid gap-2 rounded-md border p-3 text-sm">
				<p className="font-medium">JSON 预览</p>
				{error ? (
					<p className="text-xs font-medium text-destructive">
						JSON 格式化失败：{error}
					</p>
				) : null}
				<pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2">
					{formatted}
				</pre>
			</div>
		);
	}
	return (
		<div className="grid gap-2 rounded-md border p-3 text-sm">
			<p className="font-medium">文本预览</p>
			{preview.subject ? (
				<p className="text-muted-foreground">主题：{preview.subject}</p>
			) : null}
			<pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2">
				{preview.body}
			</pre>
		</div>
	);
}

function NotificationTemplateTestDialog({
	open,
	template,
	recipient,
	onRecipientChange,
	onOpenChange,
	onSubmit,
	pending,
}: {
	open: boolean;
	template: NotificationTemplate | null;
	recipient: string;
	onRecipientChange: (recipient: string) => void;
	onOpenChange: (open: boolean) => void;
	onSubmit: () => void;
	pending: boolean;
}) {
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Content maxWidth="520px">
				<Dialog.Title>测试发送模板</Dialog.Title>
				<Dialog.Description size="2">
					发送一条真实测试通知，结果可在任务中心查看。
				</Dialog.Description>
				<div className="mt-4 grid gap-3">
					{template ? (
						<div className="rounded-md border bg-muted/30 p-3 text-sm">
							<p className="font-medium">{template.name}</p>
							<p className="text-xs text-muted-foreground">
								{notificationTemplateOptionLabel(template)}
							</p>
						</div>
					) : null}
					<Field label="测试收件人 / 目标">
						<Input
							value={recipient}
							placeholder="留空使用当前管理员邮箱"
							onChange={(event) => onRecipientChange(event.target.value)}
						/>
					</Field>
					<div className="flex justify-end gap-2">
						<Dialog.Close>
							<Button type="button" variant="outline">
								取消
							</Button>
						</Dialog.Close>
						<Button
							type="button"
							disabled={!template || pending}
							onClick={onSubmit}
						>
							发送测试通知
						</Button>
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Root>
	);
}

export function NotificationTemplatesPanel() {
	const queryClient = useQueryClient();
	const confirm = useAdminConfirmDialog();
	const query = useQuery({
		queryKey: ["admin", "notification-templates"],
		queryFn: listNotificationTemplates,
	});
	const templates = query.data?.templates ?? [];
	const events = Array.from(
		templates
			.reduce((byEvent, template) => {
				if (!byEvent.has(template.eventType)) {
					byEvent.set(template.eventType, []);
				}
				byEvent.get(template.eventType)?.push(template);
				return byEvent;
			}, new Map<string, NotificationTemplate[]>())
			.entries(),
	).map(([eventType, eventTemplates]) => ({
		eventType,
		eventLabel: eventTemplates[0]?.eventLabel ?? eventType,
		eventDescription: eventTemplates[0]?.eventDescription ?? eventType,
		triggerDescription: eventTemplates[0]?.triggerDescription ?? eventType,
		recipientType: eventTemplates[0]?.recipientType ?? "通知接收人",
		templates: eventTemplates,
	}));
	const [selectedEventType, setSelectedEventType] = useState("");
	const [selectedTemplateKey, setSelectedTemplateKey] = useState("");
	const [drafts, setDrafts] = useState<
		Record<string, NotificationTemplateDraft>
	>({});
	const [recipient, setRecipient] = useState("");
	const [testOpen, setTestOpen] = useState(false);
	const [preview, setPreview] = useState<RenderedNotificationTemplate | null>(
		null,
	);
	const selectedEvent =
		events.find((event) => event.eventType === selectedEventType) ?? events[0];
	const selectedTemplate =
		templates.find((template) => template.key === selectedTemplateKey) ??
		selectedEvent?.templates[0] ??
		null;
	const draft = selectedTemplate
		? (drafts[selectedTemplate.key] ??
			notificationTemplateDraftFrom(selectedTemplate))
		: null;
	const isDirty =
		Boolean(selectedTemplate && draft) &&
		(draft?.format !== selectedTemplate?.format ||
			draft?.subjectTemplate !== (selectedTemplate?.subjectTemplate ?? "") ||
			draft?.bodyTemplate !== selectedTemplate?.bodyTemplate);

	useEffect(() => {
		if (!selectedEventType && events[0]) {
			setSelectedEventType(events[0].eventType);
		}
	}, [events, selectedEventType]);

	useEffect(() => {
		if (
			selectedEvent &&
			(!selectedTemplateKey ||
				!selectedEvent.templates.some(
					(template) => template.key === selectedTemplateKey,
				))
		) {
			setSelectedTemplateKey(selectedEvent.templates[0]?.key ?? "");
			setPreview(null);
		}
	}, [selectedEvent, selectedTemplateKey]);

	const updateDraft = (
		template: NotificationTemplate,
		patch: Partial<NotificationTemplateDraft>,
	) => {
		setDrafts((current) => ({
			...current,
			[template.key]: {
				...(current[template.key] ?? notificationTemplateDraftFrom(template)),
				...patch,
			},
		}));
		setPreview(null);
	};
	const updateMutation = useMutation({
		mutationFn: (input: {
			templateKey: string;
			format: NotificationTemplateFormat;
			subjectTemplate: string | null;
			bodyTemplate: string;
		}) =>
			updateNotificationTemplate(input.templateKey, {
				format: input.format,
				subjectTemplate: input.subjectTemplate,
				bodyTemplate: input.bodyTemplate,
			}),
		onSuccess: ({ template }) => {
			setDrafts((current) => ({
				...current,
				[template.key]: notificationTemplateDraftFrom(template),
			}));
			setSelectedEventType(template.eventType);
			setSelectedTemplateKey(template.key);
			void queryClient.invalidateQueries({
				queryKey: ["admin", "notification-templates"],
			});
		},
	});
	const previewMutation = useMutation({
		mutationFn: (input: {
			templateKey: string;
			format: NotificationTemplateFormat;
			subjectTemplate: string | null;
			bodyTemplate: string;
		}) => previewNotificationTemplate(input.templateKey, input),
		onSuccess: ({ rendered }) => setPreview(rendered),
	});
	const restoreMutation = useMutation({
		mutationFn: restoreNotificationTemplateDefault,
		onSuccess: ({ template }) => {
			setDrafts((current) => ({
				...current,
				[template.key]: notificationTemplateDraftFrom(template),
			}));
			setSelectedEventType(template.eventType);
			setSelectedTemplateKey(template.key);
			setPreview(null);
			void queryClient.invalidateQueries({
				queryKey: ["admin", "notification-templates"],
			});
		},
	});
	const testMutation = useMutation({
		mutationFn: (input: { templateKey: string; recipient?: string }) =>
			testNotificationTemplate(input.templateKey, {
				recipient: input.recipient,
			}),
		onSuccess: ({ preview: rendered }) => {
			setPreview(rendered);
			setTestOpen(false);
		},
	});
	const currentPayload =
		selectedTemplate && draft
			? {
					templateKey: selectedTemplate.key,
					format: draft.format,
					subjectTemplate: selectedTemplate.supportsSubject
						? draft.subjectTemplate.trim() || null
						: null,
					bodyTemplate: draft.bodyTemplate,
				}
			: null;
	const restoreCurrentTemplate = async () => {
		if (!selectedTemplate) {
			return;
		}
		const confirmed = await confirm({
			title: "恢复默认模板",
			description: "确认恢复当前模板为默认内容？这个操作只影响当前模板。",
			confirmText: "恢复默认",
			destructive: true,
		});
		if (confirmed) {
			restoreMutation.mutate(selectedTemplate.key);
		}
	};
	const previewError = buildSettingsErrorModel(
		previewMutation.error,
		"模板预览失败。",
	);
	const updateError = buildSettingsErrorModel(
		updateMutation.error,
		"模板保存失败。",
	);
	const restoreError = buildSettingsErrorModel(
		restoreMutation.error,
		"恢复默认模板失败。",
	);
	const testError = buildSettingsErrorModel(
		testMutation.error,
		"模板测试发送失败。",
	);

	return (
		<SettingsSection
			title="模板管理"
			description="按通知类型和内容格式编辑模板；保存前可先预览或发送测试通知。"
		>
			<div className="grid gap-4">
				<SettingsSaveError model={previewError} fallback="模板预览失败" />
				<SettingsSaveError model={updateError} fallback="模板保存失败" />
				<SettingsSaveError model={restoreError} fallback="恢复默认模板失败" />
				<SettingsSaveError model={testError} fallback="模板测试发送失败" />
				{templates.length === 0 ? (
					<EmptyState text={query.isLoading ? "模板加载中" : "暂无通知模板"} />
				) : null}
				{selectedEvent && selectedTemplate && draft ? (
					<>
						<div className="grid gap-3 lg:grid-cols-[minmax(220px,280px)_minmax(260px,1fr)]">
							<div className="grid gap-3 rounded-md border bg-background p-3">
								<Field label="通知事件">
									<select
										className={inputClass}
										value={selectedEvent.eventType}
										onChange={(event) => {
											const nextEvent = events.find(
												(item) => item.eventType === event.target.value,
											);
											setSelectedEventType(event.target.value);
											setSelectedTemplateKey(
												nextEvent?.templates[0]?.key ?? "",
											);
											setPreview(null);
										}}
									>
										{events.map((event) => (
											<option key={event.eventType} value={event.eventType}>
												{event.eventLabel}
											</option>
										))}
									</select>
								</Field>
								<Field label="通道 / 格式">
									<select
										className={inputClass}
										value={selectedTemplate.key}
										onChange={(event) => {
											setSelectedTemplateKey(event.target.value);
											setPreview(null);
										}}
									>
										{selectedEvent.templates.map((template) => (
											<option key={template.key} value={template.key}>
												{notificationTemplateOptionLabel(template)}
											</option>
										))}
									</select>
								</Field>
								<div className="rounded-md border bg-muted/30 p-3 text-sm leading-6 text-muted-foreground">
									<p className="font-medium text-foreground">
										{selectedEvent.eventLabel}
									</p>
									<p>{selectedEvent.eventDescription}</p>
									<p>{selectedEvent.triggerDescription}</p>
									<p>接收人：{selectedEvent.recipientType}</p>
								</div>
								<div className="flex flex-wrap gap-2">
									<Badge
										variant={
											selectedTemplate.isCustomized ? "secondary" : "outline"
										}
									>
										{selectedTemplate.isCustomized ? "已自定义" : "默认"}
									</Badge>
									{isDirty ? <Badge variant="outline">未保存</Badge> : null}
								</div>
							</div>
							<div className="grid gap-3 rounded-md border bg-background p-3">
								<div>
									<p className="font-medium">{selectedTemplate.name}</p>
									<p className="text-sm leading-6 text-muted-foreground">
										{selectedTemplate.description}
									</p>
								</div>
								<div className="grid gap-3 md:grid-cols-2">
									<Field label="格式">
										<select
											className={inputClass}
											value={draft.format}
											onChange={(event) =>
												updateDraft(selectedTemplate, {
													format: event.target
														.value as NotificationTemplateFormat,
												})
											}
										>
											<option value="text">纯文本</option>
											<option value="html">HTML</option>
											<option value="json">JSON</option>
										</select>
									</Field>
									<Field label="当前通道">
										<Input
											value={selectedTemplate.channelLabel}
											readOnly
											aria-readonly="true"
										/>
									</Field>
								</div>
								{selectedTemplate.supportsSubject ? (
									<Field label="主题模板">
										<Input
											value={draft.subjectTemplate}
											onChange={(event) =>
												updateDraft(selectedTemplate, {
													subjectTemplate: event.target.value,
												})
											}
										/>
									</Field>
								) : (
									<div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
										当前模板格式不使用主题字段。
									</div>
								)}
								<Field label="正文模板">
									<textarea
										className={`${textareaClass} min-h-48 font-mono`}
										value={draft.bodyTemplate}
										onChange={(event) =>
											updateDraft(selectedTemplate, {
												bodyTemplate: event.target.value,
											})
										}
									/>
								</Field>
								<div className="flex flex-wrap gap-2">
									<Button
										type="button"
										variant="outline"
										disabled={!currentPayload || previewMutation.isPending}
										onClick={() =>
											currentPayload && previewMutation.mutate(currentPayload)
										}
									>
										刷新预览
									</Button>
									<Button
										type="button"
										variant="outline"
										disabled={!currentPayload || updateMutation.isPending}
										onClick={() =>
											currentPayload && updateMutation.mutate(currentPayload)
										}
									>
										保存
									</Button>
									<Button
										type="button"
										variant="outline"
										disabled={!selectedTemplate || restoreMutation.isPending}
										onClick={() => void restoreCurrentTemplate()}
									>
										恢复默认
									</Button>
									<Button
										type="button"
										variant="outline"
										disabled={!selectedTemplate || testMutation.isPending}
										onClick={() => setTestOpen(true)}
									>
										测试发送
									</Button>
								</div>
							</div>
						</div>
						<div className="grid gap-3 lg:grid-cols-[minmax(220px,320px)_1fr]">
							<div className="grid gap-2 rounded-md border bg-background p-3 text-sm">
								<p className="font-medium">可用占位符</p>
								{selectedTemplate.placeholders.map((placeholder) => (
									<div key={placeholder.path} className="rounded border p-2">
										<code className="text-xs">{`{{${placeholder.path}}}`}</code>
										<p className="mt-1 font-medium">{placeholder.label}</p>
										<p className="text-xs text-muted-foreground">
											{placeholder.description}
										</p>
										{draft.format === "json" && placeholder.jsonSupported ? (
											<code className="mt-1 block text-xs text-muted-foreground">
												{`{{json ${placeholder.path}}}`}
											</code>
										) : null}
									</div>
								))}
							</div>
							<NotificationTemplatePreview
								format={draft.format}
								preview={preview}
							/>
						</div>
						{testMutation.data ? (
							<div className="rounded-md border bg-background p-3 text-sm text-muted-foreground">
								{notificationTemplateResultSummary(testMutation.data)}
							</div>
						) : null}
						<NotificationTemplateTestDialog
							open={testOpen}
							template={selectedTemplate}
							recipient={recipient}
							onRecipientChange={setRecipient}
							onOpenChange={setTestOpen}
							onSubmit={() =>
								selectedTemplate &&
								testMutation.mutate({
									templateKey: selectedTemplate.key,
									recipient: recipient.trim() || undefined,
								})
							}
							pending={testMutation.isPending}
						/>
					</>
				) : null}
			</div>
		</SettingsSection>
	);
}

export function NotificationDiagnosticsPanel({
	siteKey,
	defaultCommentStatus,
	hasUnsavedNotificationChanges,
}: {
	siteKey: string;
	defaultCommentStatus: "pending" | "approved";
	hasUnsavedNotificationChanges: boolean;
}) {
	const [testDialogOpen, setTestDialogOpen] = useState(false);
	const [commenterEmail, setCommenterEmail] = useState("");
	const [runId, setRunId] = useState<string | null>(null);
	const diagnosticsQuery = useQuery({
		queryKey: ["admin", "notification-diagnostics", siteKey],
		queryFn: () => getNotificationDiagnostics(siteKey),
		enabled: Boolean(siteKey),
	});
	const startMutation = useMutation({
		mutationFn: () =>
			startNotificationChainTest(siteKey, commenterEmail.trim()),
		meta: { suppressGlobalToast: true },
		onSuccess: (result) => {
			setRunId(result.runId);
			setTestDialogOpen(false);
			toast.success("测试邮件已开始发送");
		},
		onError: (error) => {
			toast.error(adminUiErrorMessage(error, "测试邮件发送失败。"));
		},
	});
	const resultQuery = useQuery({
		queryKey: ["admin", "notification-chain-test", siteKey, runId],
		queryFn: () => getNotificationChainTest(siteKey, runId ?? ""),
		enabled: Boolean(siteKey && runId),
		refetchInterval: (query) =>
			notificationChainTestPollInterval(query.state.data?.status),
	});

	const diagnosticRows = diagnosticsQuery.data
		? diagnosticFlowRows(diagnosticsQuery.data)
		: [];
	const selectedBlockers = diagnosticsQuery.data
		? notificationChainTestBlockers(diagnosticsQuery.data, defaultCommentStatus)
		: [];
	const testSummary = resultQuery.data
		? summarizeNotificationChainTest(resultQuery.data)
		: null;
	const resultIsActive =
		Boolean(runId) &&
		(!resultQuery.data ||
			notificationChainTestPollInterval(resultQuery.data.status) !== false);
	const testDisabledReason = hasUnsavedNotificationChanges
		? "通知设置有未保存改动，请先保存后再测试。"
		: diagnosticsQuery.isPending
			? "正在读取已保存的通知设置。"
			: diagnosticsQuery.isError
				? "检查结果读取失败，请刷新后重试。"
				: selectedBlockers.length > 0
					? "请先完成上方“发送前检查”中的设置，再发送测试邮件。"
					: resultIsActive
						? "当前已有邮件测试正在进行。"
						: "";

	return (
		<SettingsSection
			title="评论邮件检查与测试"
			description="检查当前站点已保存的通知设置，并告诉你需要完成哪些操作。"
		>
			<div className="grid min-w-0 gap-4">
				<div className="min-w-0 rounded-md border bg-background p-4">
					<div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-start md:justify-between">
						<div className="min-w-0">
							<div className="flex min-w-0 flex-wrap items-center gap-2">
								<p className="font-medium">发送前检查</p>
								{diagnosticsQuery.data ? (
									<Badge
										className="shrink-0 whitespace-nowrap"
										variant={
											notificationStatusBadge(diagnosticsQuery.data.overall)
												.variant
										}
									>
										{
											notificationStatusBadge(diagnosticsQuery.data.overall)
												.label
										}
									</Badge>
								) : null}
							</div>
							<p className="mt-1 max-w-[70ch] text-sm leading-6 text-muted-foreground">
								根据已保存的设置，检查三种评论邮件是否可以发送。
							</p>
						</div>
						<Button
							type="button"
							className="shrink-0"
							variant="outline"
							disabled={diagnosticsQuery.isFetching}
							onClick={() => void diagnosticsQuery.refetch()}
						>
							{diagnosticsQuery.isFetching ? "检查中" : "重新检查"}
						</Button>
					</div>

					{diagnosticsQuery.isPending ? (
						<p className="mt-4 text-sm text-muted-foreground">正在检查……</p>
					) : null}
					{diagnosticsQuery.isError ? (
						<p className="mt-4 break-words text-sm text-destructive [overflow-wrap:anywhere]">
							{adminUiErrorMessage(
								diagnosticsQuery.error,
								"通知设置检查失败。",
							)}
						</p>
					) : null}
					{diagnosticsQuery.data ? (
						<div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-3">
							{diagnosticRows.map((row) => (
								<div
									key={row.key}
									className="grid min-w-0 content-start gap-3 rounded-md border p-3 text-sm"
								>
									<div className="flex min-w-0 items-start justify-between gap-3">
										<div className="min-w-0">
											<p className="font-medium leading-5">{row.title}</p>
											<p className="mt-1 text-xs leading-5 text-muted-foreground">
												{row.description}
											</p>
										</div>
										<Badge
											className="shrink-0 whitespace-nowrap"
											variant={row.badge.variant}
										>
											{row.badge.label}
										</Badge>
									</div>
									<p className="min-w-0 break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
										{row.recipients.length > 0
											? `接收人：${row.recipients.join("；")}`
											: row.recipientEmptyText}
									</p>
									{row.blockerMessages.length > 0 ? (
										<div className="min-w-0 text-xs leading-5 text-destructive">
											<p className="font-medium">需要完成</p>
											<ul className="mt-1 grid list-disc gap-1 pl-4">
												{row.blockerMessages.map((message) => (
													<li
														key={message}
														className="min-w-0 break-words [overflow-wrap:anywhere]"
													>
														{message}
													</li>
												))}
											</ul>
										</div>
									) : null}
									{row.warningMessages.length > 0 ? (
										<div className="min-w-0 text-xs leading-5 text-amber-700 dark:text-amber-300">
											<p className="font-medium">说明</p>
											<ul className="mt-1 grid list-disc gap-1 pl-4">
												{row.warningMessages.map((message) => (
													<li
														key={message}
														className="min-w-0 break-words [overflow-wrap:anywhere]"
													>
														{message}
													</li>
												))}
											</ul>
										</div>
									) : null}
								</div>
							))}
						</div>
					) : null}
				</div>

				<div className="min-w-0 rounded-md border bg-background p-4">
					<div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-start md:justify-between">
						<div className="min-w-0">
							<p className="font-medium">发送测试邮件</p>
							<p className="mt-1 max-w-[70ch] text-sm leading-6 text-muted-foreground">
								先向站点人员发送评论通知，再向你填写的邮箱发送回复提醒。
							</p>
							{testDisabledReason ? (
								<p className="mt-2 max-w-[70ch] break-words text-xs leading-5 text-destructive [overflow-wrap:anywhere]">
									{testDisabledReason}
								</p>
							) : null}
						</div>
						<Button
							type="button"
							className="shrink-0"
							disabled={Boolean(testDisabledReason) || startMutation.isPending}
							onClick={() => setTestDialogOpen(true)}
						>
							开始邮件测试
						</Button>
					</div>

					{runId && !resultQuery.data && !resultQuery.isError ? (
						<p className="mt-4 text-sm text-muted-foreground">
							测试邮件正在发送，请稍候……
						</p>
					) : null}
					{resultQuery.isError ? (
						<div className="mt-4 flex min-w-0 flex-wrap items-center gap-3 text-sm">
							<p className="min-w-0 break-words text-destructive [overflow-wrap:anywhere]">
								{adminUiErrorMessage(
									resultQuery.error,
									"邮件测试结果读取失败。",
								)}
							</p>
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={() => void resultQuery.refetch()}
							>
								重新读取
							</Button>
						</div>
					) : null}
					{testSummary ? (
						<div className="mt-4 grid min-w-0 gap-3" aria-live="polite">
							<div className="flex min-w-0 flex-wrap items-center gap-2">
								<Badge
									className="shrink-0 whitespace-nowrap"
									variant={testSummary.badge.variant}
								>
									{testSummary.badge.label}
								</Badge>
								<p className="min-w-0 break-words text-sm leading-6 [overflow-wrap:anywhere]">
									{testSummary.summary}
								</p>
							</div>
							<div className="grid min-w-0 gap-3 lg:grid-cols-2">
								{testSummary.legs.map((leg) => (
									<div key={leg.key} className="min-w-0 rounded-md border p-3">
										<div className="flex min-w-0 items-start justify-between gap-3">
											<p className="min-w-0 font-medium leading-5">
												{leg.title}
											</p>
											<Badge
												className="shrink-0 whitespace-nowrap"
												variant={leg.badge.variant}
											>
												{leg.badge.label}
											</Badge>
										</div>
										<p className="mt-2 text-xs text-muted-foreground">
											已交给邮件服务商：{leg.sentCount} 封
										</p>
										{leg.deliveries.length > 0 ? (
											<details className="mt-3 min-w-0 text-xs">
												<summary className="cursor-pointer font-medium">
													查看收件人状态
												</summary>
												<div className="mt-2 grid min-w-0 gap-2 text-muted-foreground">
													{leg.deliveries.map((delivery, index) => (
														<div
															key={[leg.key, delivery.recipient, index].join(
																":",
															)}
															className="grid min-w-0 gap-1 rounded border p-2"
														>
															<p className="break-words font-medium text-foreground [overflow-wrap:anywhere]">
																{delivery.recipient}
															</p>
															<p>{delivery.statusLabel}</p>
															{delivery.errorMessage ? (
																<p className="break-words text-destructive [overflow-wrap:anywhere]">
																	{delivery.errorMessage}
																</p>
															) : null}
														</div>
													))}
												</div>
											</details>
										) : null}
									</div>
								))}
							</div>
						</div>
					) : null}
				</div>
			</div>

			<Dialog.Root open={testDialogOpen} onOpenChange={setTestDialogOpen}>
				<Dialog.Content maxWidth="560px">
					<Dialog.Title>发送评论邮件测试</Dialog.Title>
					<Dialog.Description size="2">
						系统会使用当前站点已保存的设置，先向站点人员发送评论通知，再向下方邮箱发送回复提醒。
					</Dialog.Description>
					<div className="mt-4 grid gap-4">
						<div className="rounded-md border bg-muted/30 p-3 text-sm">
							<p className="font-medium">发送范围</p>
							<p className="mt-1 leading-6 text-muted-foreground">
								如果当前站点配置了多名邮件接收人，站点人员可能会收到多封测试邮件。
							</p>
						</div>
						<Field
							label="接收回复提醒的邮箱"
							description="第二封测试邮件会发送到这个邮箱。"
						>
							<Input
								type="email"
								value={commenterEmail}
								placeholder="reader@example.com"
								onChange={(event) => setCommenterEmail(event.target.value)}
							/>
						</Field>
						{startMutation.isError ? (
							<p className="break-words text-sm text-destructive [overflow-wrap:anywhere]">
								{adminUiErrorMessage(startMutation.error, "测试邮件发送失败。")}
							</p>
						) : null}
						<div className="flex justify-end gap-2">
							<Dialog.Close>
								<Button type="button" variant="outline">
									取消
								</Button>
							</Dialog.Close>
							<Button
								type="button"
								disabled={!commenterEmail.trim() || startMutation.isPending}
								onClick={() => startMutation.mutate()}
							>
								{startMutation.isPending ? "发送中" : "发送测试邮件"}
							</Button>
						</div>
					</div>
				</Dialog.Content>
			</Dialog.Root>
		</SettingsSection>
	);
}
