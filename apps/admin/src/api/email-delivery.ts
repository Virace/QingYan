export type CommentEmailDeliveryState =
	| "accepted"
	| "failed"
	| "processing"
	| "not_sent"
	| "unknown";

export type CommentEmailFlow = "site_staff_comment" | "commenter_reply";

export type CommentEmailDeliveryPhase =
	| "queued"
	| "delayed"
	| "sending"
	| "retrying"
	| "accepted"
	| "failed"
	| "not_sent"
	| "incomplete";

export type CommentEmailDecisionReason =
	| "system_email_unavailable"
	| "site_backend_notifications_disabled"
	| "site_commenter_email_disabled"
	| "comment_event_not_applicable"
	| "no_email_recipients"
	| "recipient_email_disabled"
	| "recipient_email_paused"
	| "comment_not_approved_reply"
	| "commenter_not_visitor"
	| "commenter_email_unavailable"
	| "commenter_not_subscribed"
	| "commenter_unsubscribed"
	| "same_recipient"
	| "email_reputation_suppressed"
	| "source_excluded"
	| "planning_failed"
	| "delivery_missing";

export type CommentEmailDeliveryErrorKind =
	| "config"
	| "temporary"
	| "recipient_permanent"
	| "provider_auth"
	| "template";

export interface CommentEmailDeliverySummary {
	state: CommentEmailDeliveryState;
	deliveryCount: number;
	acceptedCount: number;
	failedCount: number;
	processingCount: number;
	notSentDecisionCount: number;
	lastUpdatedAt: string | null;
}

export interface CommentEmailDeliveryItem {
	kind: "delivery" | "decision" | "incomplete";
	channel: "email";
	flow: CommentEmailFlow;
	state: Exclude<CommentEmailDeliveryState, "unknown">;
	phase: CommentEmailDeliveryPhase;
	recipient: {
		label: string;
		address: string;
	} | null;
	attemptCount: number;
	maxAttempts: number;
	acceptedAt: string | null;
	updatedAt: string;
	reasonCode: CommentEmailDecisionReason | null;
	errorKind: CommentEmailDeliveryErrorKind | null;
	message: string | null;
}

export interface CommentEmailDeliveryGroup {
	flow: CommentEmailFlow;
	label: string;
	state: Exclude<CommentEmailDeliveryState, "unknown">;
	items: CommentEmailDeliveryItem[];
}

export interface CommentEmailDeliveryStatus {
	commentId: string;
	summary: CommentEmailDeliverySummary;
	groups: CommentEmailDeliveryGroup[];
	canViewTaskRecords: boolean;
}
