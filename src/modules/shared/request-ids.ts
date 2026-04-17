import { randomUUID } from "node:crypto";

export function resolveRequestId(existingId?: string): string {
	return existingId && existingId.length > 0
		? existingId
		: `req_${randomUUID()}`;
}
