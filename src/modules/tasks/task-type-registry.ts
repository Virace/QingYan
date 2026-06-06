import type { z } from "zod";

import type { AdminPermission } from "../admin/permissions";
import type { TaskRunCategory } from "./types";
import type { TaskRunnerContext } from "./task-runner-context";

export type TaskScopeKind = "global" | "site" | "multi_site" | "page";

export interface TaskTypePermissions {
	read: AdminPermission;
	create: AdminPermission;
	run: AdminPermission;
	update: AdminPermission;
	delete: AdminPermission;
}

export interface TaskTypeScheduleCapabilities {
	manual: boolean;
	presets: string[];
	cron: boolean;
	condition: boolean;
}

export interface TaskTypeReuseMetadata {
	service: string;
	method: string;
	file: string;
}

export interface TaskTypeDefinition<TPayload = unknown> {
	type: string;
	label: string;
	description: string;
	category: TaskRunCategory;
	scope: TaskScopeKind;
	permissions: TaskTypePermissions;
	payloadSchema: z.ZodType<TPayload>;
	defaultPayload: TPayload;
	defaultPolicy: {
		maxAttempts: number;
		retryDelaySec: number;
		timeoutMs?: number;
		maxBytes?: number;
		concurrencyKey?: string;
	};
	schedule: TaskTypeScheduleCapabilities;
	dangerous?: boolean;
	precondition?: (
		payload: TPayload,
		context: TaskRunnerContext,
	) => Promise<"ok" | "skipped" | "blocked"> | "ok" | "skipped" | "blocked";
	run: (payload: TPayload, context: TaskRunnerContext) => Promise<unknown>;
	summary?: (payload: TPayload) => unknown;
	reuse: TaskTypeReuseMetadata;
}

export type AnyTaskTypeDefinition = Omit<
	TaskTypeDefinition<unknown>,
	"payloadSchema" | "defaultPayload" | "precondition" | "run" | "summary"
> & {
	payloadSchema: z.ZodType;
	defaultPayload: unknown;
	precondition?: (
		payload: unknown,
		context: TaskRunnerContext,
	) => Promise<"ok" | "skipped" | "blocked"> | "ok" | "skipped" | "blocked";
	run: (payload: unknown, context: TaskRunnerContext) => Promise<unknown>;
	summary?: (payload: unknown) => unknown;
};

export class TaskTypeRegistry {
	private readonly definitions = new Map<string, AnyTaskTypeDefinition>();

	public constructor(definitions: AnyTaskTypeDefinition[] = []) {
		for (const definition of definitions) {
			this.register(definition);
		}
	}

	public register<TPayload>(definition: TaskTypeDefinition<TPayload>): void {
		if (this.definitions.has(definition.type)) {
			throw new Error(`Duplicate task type: ${definition.type}`);
		}
		const erased: AnyTaskTypeDefinition = {
			...definition,
			payloadSchema: definition.payloadSchema as z.ZodType,
			defaultPayload: definition.defaultPayload,
			precondition: definition.precondition
				? (payload, context) =>
						definition.precondition?.(payload as TPayload, context) ?? "ok"
				: undefined,
			run: (payload, context) => definition.run(payload as TPayload, context),
			summary: definition.summary
				? (payload) => definition.summary?.(payload as TPayload)
				: undefined,
		};
		this.definitions.set(definition.type, erased);
	}

	public list(): AnyTaskTypeDefinition[] {
		return Array.from(this.definitions.values());
	}

	public get(type: string): AnyTaskTypeDefinition | null {
		return this.definitions.get(type) ?? null;
	}

	public getRequired(type: string): AnyTaskTypeDefinition {
		const definition = this.get(type);
		if (!definition) {
			throw new Error(`Unknown task type: ${type}`);
		}
		return definition;
	}

	public validatePayload(type: string, payload: unknown): unknown {
		const definition = this.getRequired(type);
		const parsed = definition.payloadSchema.safeParse(payload);
		if (!parsed.success) {
			throw new Error(`Invalid task payload: ${parsed.error.message}`);
		}
		return parsed.data;
	}
}
