import { createHash } from "node:crypto";

export function renderCommentHtml(raw: string): string {
	return `<p>${raw
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")}</p>`;
}

export function hashCommentEmail(email?: string): string | undefined {
	if (!email) {
		return undefined;
	}

	return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}
