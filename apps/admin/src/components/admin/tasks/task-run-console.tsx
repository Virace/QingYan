import { useEffect, useRef } from "react";

import type { TaskRunLogLine } from "@/api/tasks";

function formatLogTime(value: string) {
	return new Date(value).toLocaleTimeString();
}

function lineClass(line: TaskRunLogLine) {
	if (line.level === "error" || line.stream === "stderr") {
		return "text-red-200";
	}
	if (line.level === "warn") {
		return "text-amber-200";
	}
	if (line.stream === "system") {
		return "text-zinc-300";
	}
	return "text-zinc-100";
}

export function TaskRunConsole({
	lines,
	loading,
	running,
}: {
	lines: TaskRunLogLine[];
	loading?: boolean;
	running?: boolean;
}) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const stickToBottomRef = useRef(true);

	useEffect(() => {
		const node = scrollRef.current;
		if (!node || !stickToBottomRef.current) {
			return;
		}
		node.scrollTop = node.scrollHeight;
	});

	return (
		<div
			ref={scrollRef}
			className="h-[28rem] overflow-auto rounded-md border bg-zinc-950 p-3 font-mono text-xs text-zinc-100"
			onScroll={(event) => {
				const node = event.currentTarget;
				const distanceFromBottom =
					node.scrollHeight - node.scrollTop - node.clientHeight;
				stickToBottomRef.current = distanceFromBottom < 48;
			}}
		>
			{lines.length ? (
				<div className="grid gap-1">
					{lines.map((line) => (
						<div
							key={line.id}
							className={`grid grid-cols-[auto_auto_1fr] gap-2 ${lineClass(line)}`}
						>
							<span className="text-zinc-500">
								{formatLogTime(line.createdAt)}
							</span>
							<span className="uppercase text-zinc-400">{line.stream}</span>
							<span className="break-words">{line.message}</span>
						</div>
					))}
				</div>
			) : (
				<div className="flex h-full items-center justify-center text-zinc-500">
					{loading ? "正在加载执行输出" : "暂无执行输出"}
				</div>
			)}
			{running ? (
				<div className="mt-2 text-zinc-500">等待新的执行输出...</div>
			) : null}
		</div>
	);
}
