import { AppError } from "./errors";

export function buildErrorResponse(error: unknown, requestId?: string) {
	if (error instanceof AppError) {
		return {
			statusCode: error.statusCode,
			body: {
				error: {
					code: error.code,
					message: error.message,
					requestId,
					details: error.details ?? null,
				},
			},
		};
	}
	return {
		statusCode: 500,
		body: {
			error: {
				code: "INTERNAL_ERROR",
				message: "服务器内部错误。",
				requestId,
				details: null,
			},
		},
	};
}
