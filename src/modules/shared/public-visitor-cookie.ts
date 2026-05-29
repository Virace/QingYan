import type { FastifyReply } from "fastify";

export const publicVisitorCookieName = "qingyan_visitor";

export function setPublicVisitorCookie(input: {
	reply: FastifyReply;
	visitorKey?: string | null;
	path: string;
}) {
	if (!input.visitorKey) {
		return;
	}
	input.reply.setCookie(publicVisitorCookieName, input.visitorKey, {
		path: input.path,
		sameSite: "lax",
		httpOnly: true,
	});
}
