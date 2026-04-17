import type { FastifyRequest } from "fastify";

export interface VisitorIdentity {
	key: string;
	source: "cookie" | "header";
}

export function resolveVisitorIdentity(
	request: FastifyRequest,
): VisitorIdentity | undefined {
	const cookieVisitor = request.cookies.qingyan_visitor;
	if (typeof cookieVisitor === "string" && cookieVisitor.length > 0) {
		return {
			key: cookieVisitor,
			source: "cookie",
		};
	}

	const headerVisitor = request.headers["x-qingyan-visitor"];
	if (typeof headerVisitor === "string" && headerVisitor.length > 0) {
		return {
			key: headerVisitor,
			source: "header",
		};
	}

	return undefined;
}
