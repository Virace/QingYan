import { AppError } from "./errors";

export function buildErrorResponse(error: unknown, requestId?: string) {
	if (error instanceof AppError) {
		const fields =
			error.code === "VALIDATION_FAILED" && Array.isArray(error.details?.fields)
				? { fields: error.details.fields }
				: {};
		const details =
			error.details && error.code !== "VALIDATION_FAILED"
				? { details: error.details }
				: {};
		return {
			statusCode: error.statusCode,
			body: {
				error: {
					code: error.code,
					message: error.message,
					requestId,
					...fields,
					...details,
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
			},
		},
	};
}
