import {
	adminUiErrorMessage,
	ApiError,
	type ApiFieldError,
} from "@/api/client";

export type SettingsFieldErrors = Record<string, ApiFieldError[]>;

export type SettingsErrorModel = {
	message: string;
	requestId?: string;
	code?: string;
	fields: ApiFieldError[];
	fieldsByPath: SettingsFieldErrors;
	raw: unknown;
};

function fieldErrorsByPath(fields: ApiFieldError[]): SettingsFieldErrors {
	return fields.reduce<SettingsFieldErrors>((result, field) => {
		result[field.path] = [...(result[field.path] ?? []), field];
		return result;
	}, {});
}

export function buildSettingsErrorModel(
	error: unknown,
	fallback: string,
): SettingsErrorModel | null {
	if (!error) {
		return null;
	}
	if (error instanceof ApiError) {
		return {
			message: adminUiErrorMessage(error, fallback),
			requestId: error.requestId,
			code: error.code,
			fields: error.fields,
			fieldsByPath: fieldErrorsByPath(error.fields),
			raw: error.payload,
		};
	}
	if (error instanceof Error) {
		return {
			message: adminUiErrorMessage(error, fallback),
			fields: [],
			fieldsByPath: {},
			raw: error,
		};
	}
	if (typeof error === "string") {
		return {
			message: adminUiErrorMessage(error, fallback),
			fields: [],
			fieldsByPath: {},
			raw: error,
		};
	}
	return {
		message: fallback,
		fields: [],
		fieldsByPath: {},
		raw: error,
	};
}

export function firstFieldError(
	model: SettingsErrorModel | null,
	path: string,
): string | undefined {
	return model?.fieldsByPath[path]?.[0]?.message;
}
