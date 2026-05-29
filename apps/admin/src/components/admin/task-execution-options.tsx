import type { TaskExecutionOptions } from "@/api/ops";
import { Input } from "@/components/ui/input";

import { inputClass } from "./admin-ui";

export interface TaskExecutionOptionsValue {
	executionMode: "async";
	batchSize: string;
	timeoutMs: string;
	maxBytes: string;
	maxAttempts: string;
	retryDelaySec: string;
	runAfter: string;
}

export function defaultTaskExecutionOptions(
	input: Partial<TaskExecutionOptionsValue> = {},
): TaskExecutionOptionsValue {
	return {
		executionMode: "async",
		batchSize: "500",
		timeoutMs: "10000",
		maxBytes: "2097152",
		maxAttempts: "2",
		retryDelaySec: "30",
		runAfter: "",
		...input,
	};
}

function optionalNumber(value: string) {
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}
	const parsed = Number(trimmed);
	return Number.isFinite(parsed) ? parsed : undefined;
}

export function toTaskExecutionOptions(
	value: TaskExecutionOptionsValue,
): TaskExecutionOptions {
	return {
		executionMode: value.executionMode,
		batchSize: optionalNumber(value.batchSize),
		timeoutMs: optionalNumber(value.timeoutMs),
		maxBytes: optionalNumber(value.maxBytes),
		maxAttempts: optionalNumber(value.maxAttempts),
		retryDelaySec: optionalNumber(value.retryDelaySec),
		runAfter: value.runAfter.trim()
			? new Date(value.runAfter).toISOString()
			: null,
	};
}

export function TaskExecutionOptionsFields({
	value,
	onChange,
	showBatchSize = true,
	showMaxBytes = true,
}: {
	value: TaskExecutionOptionsValue;
	onChange: (value: TaskExecutionOptionsValue) => void;
	showBatchSize?: boolean;
	showMaxBytes?: boolean;
}) {
	const update = (patch: Partial<TaskExecutionOptionsValue>) =>
		onChange({ ...value, ...patch });

	return (
		<div className="grid gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-3">
			<label className="grid gap-1 text-sm">
				<span className="text-muted-foreground">执行方式</span>
				<select
					className={inputClass}
					value={value.executionMode}
					onChange={(event) =>
						update({ executionMode: event.target.value as "async" })
					}
				>
					<option value="async">异步任务</option>
				</select>
			</label>
			{showBatchSize ? (
				<label className="grid gap-1 text-sm">
					<span className="text-muted-foreground">单批数量</span>
					<Input
						type="number"
						min={1}
						value={value.batchSize}
						onChange={(event) => update({ batchSize: event.target.value })}
					/>
				</label>
			) : null}
			<label className="grid gap-1 text-sm">
				<span className="text-muted-foreground">超时 ms</span>
				<Input
					type="number"
					min={1000}
					value={value.timeoutMs}
					onChange={(event) => update({ timeoutMs: event.target.value })}
				/>
			</label>
			{showMaxBytes ? (
				<label className="grid gap-1 text-sm">
					<span className="text-muted-foreground">最大字节</span>
					<Input
						type="number"
						min={65536}
						value={value.maxBytes}
						onChange={(event) => update({ maxBytes: event.target.value })}
					/>
				</label>
			) : null}
			<label className="grid gap-1 text-sm">
				<span className="text-muted-foreground">最大尝试</span>
				<Input
					type="number"
					min={1}
					max={10}
					value={value.maxAttempts}
					onChange={(event) => update({ maxAttempts: event.target.value })}
				/>
			</label>
			<label className="grid gap-1 text-sm">
				<span className="text-muted-foreground">重试间隔秒</span>
				<Input
					type="number"
					min={0}
					value={value.retryDelaySec}
					onChange={(event) => update({ retryDelaySec: event.target.value })}
				/>
			</label>
			<label className="grid gap-1 text-sm">
				<span className="text-muted-foreground">延迟到</span>
				<Input
					type="datetime-local"
					value={value.runAfter}
					onChange={(event) => update({ runAfter: event.target.value })}
				/>
			</label>
		</div>
	);
}
