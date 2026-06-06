import type { CommentStatus } from "../../../api/admin";

export type CommentActionId =
	| "approve"
	| "pending"
	| "spam"
	| "trash"
	| "restore"
	| "delete";

export interface CommentActionDefinition {
	id: CommentActionId;
	label: string;
	tone?: "default" | "success" | "danger" | "warning";
}

export function commentActionsForStatus(
	status: CommentStatus,
): CommentActionDefinition[] {
	if (status === "pending") {
		return [
			{ id: "approve", label: "批准", tone: "success" },
			{ id: "spam", label: "标记为垃圾", tone: "danger" },
			{ id: "trash", label: "移入回收站", tone: "danger" },
		];
	}

	if (status === "approved") {
		return [
			{ id: "pending", label: "设为待审", tone: "warning" },
			{ id: "spam", label: "标记为垃圾", tone: "danger" },
			{ id: "trash", label: "移入回收站", tone: "danger" },
		];
	}

	if (status === "spam") {
		return [
			{ id: "approve", label: "批准", tone: "success" },
			{ id: "pending", label: "设为待审", tone: "warning" },
			{ id: "trash", label: "移入回收站", tone: "danger" },
		];
	}

	return [
		{ id: "restore", label: "恢复", tone: "success" },
		{ id: "delete", label: "永久删除", tone: "danger" },
	];
}
