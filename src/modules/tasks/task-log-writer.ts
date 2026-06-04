import type {
	TaskEventLogRepository,
	TaskLogLevel,
	TaskLogStream,
} from "./task-event-log-repository";

export interface TaskLogWriter {
	stdout(message: string, data?: unknown): Promise<void>;
	stderr(message: string, data?: unknown): Promise<void>;
	system(message: string, data?: unknown): Promise<void>;
	info(message: string, data?: unknown): Promise<void>;
	warn(message: string, data?: unknown): Promise<void>;
	error(message: string, data?: unknown): Promise<void>;
	debug(message: string, data?: unknown): Promise<void>;
	write(input: {
		stream?: TaskLogStream;
		level?: TaskLogLevel;
		message: string;
		eventType?: string;
		data?: unknown;
		visibleToSiteAdmin?: boolean;
	}): Promise<void>;
}

export function createTaskLogWriter(input: {
	taskRunId: string;
	eventLogs: TaskEventLogRepository;
}): TaskLogWriter {
	async function write(line: {
		stream?: TaskLogStream;
		level?: TaskLogLevel;
		message: string;
		eventType?: string;
		data?: unknown;
		visibleToSiteAdmin?: boolean;
	}): Promise<void> {
		await input.eventLogs.appendLogLine({
			taskRunId: input.taskRunId,
			stream: line.stream ?? "system",
			level: line.level,
			message: line.message,
			eventType: line.eventType,
			data: line.data,
			visibleToSiteAdmin: line.visibleToSiteAdmin,
		});
	}

	return {
		write,
		stdout: (message, data) => write({ stream: "stdout", message, data }),
		stderr: (message, data) =>
			write({ stream: "stderr", level: "warn", message, data }),
		system: (message, data) => write({ stream: "system", message, data }),
		info: (message, data) =>
			write({ stream: "system", level: "info", message, data }),
		warn: (message, data) =>
			write({ stream: "stderr", level: "warn", message, data }),
		error: (message, data) =>
			write({ stream: "stderr", level: "error", message, data }),
		debug: (message, data) =>
			write({ stream: "system", level: "debug", message, data }),
	};
}
