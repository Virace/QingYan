import {
	type CommentInputLimitsSettings,
	mergeCommentInputLimits,
} from "./site-settings-defaults";
import { type ValidationFieldError, ValidationFailedError } from "./errors";

export type CommentInputLimitFields = {
	pageKey?: string;
	pageTitle?: string;
	authorName?: string;
	authorWebsite?: string;
	contentRaw?: string;
};

function collectTooBigField(
	fields: ValidationFieldError[],
	path: string,
	value: string | undefined,
	maxLength: number,
) {
	if (value === undefined || value.length <= maxLength) {
		return;
	}

	fields.push({
		path,
		code: "too_big",
		expected: `length <= ${maxLength}`,
		received: `length ${value.length}`,
		message: `${path} 长度不能超过 ${maxLength} 个字符。`,
	});
}

export function collectCommentInputLimitErrors(
	input: CommentInputLimitFields,
	limits: CommentInputLimitsSettings,
): ValidationFieldError[] {
	const fields: ValidationFieldError[] = [];

	collectTooBigField(fields, "pageKey", input.pageKey, limits.pageKeyMaxLength);
	collectTooBigField(
		fields,
		"pageTitle",
		input.pageTitle,
		limits.pageTitleMaxLength,
	);
	collectTooBigField(
		fields,
		"author.name",
		input.authorName,
		limits.authorNameMaxLength,
	);
	collectTooBigField(
		fields,
		"author.website",
		input.authorWebsite,
		limits.authorWebsiteMaxLength,
	);
	collectTooBigField(
		fields,
		"content.raw",
		input.contentRaw,
		limits.contentMaxLength,
	);

	return fields;
}

export function assertCommentInputLimits(
	input: CommentInputLimitFields,
	settings?: string | Partial<CommentInputLimitsSettings> | null,
) {
	const fields = collectCommentInputLimitErrors(
		input,
		mergeCommentInputLimits(settings),
	);

	if (fields.length > 0) {
		throw new ValidationFailedError(fields);
	}
}
