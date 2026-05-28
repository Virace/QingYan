export function formatAdminCommentTime(value: string): string {
	const timestamp = new Date(value);
	if (Number.isNaN(timestamp.getTime())) {
		return value;
	}

	return timestamp.toISOString().slice(0, 16).replace("T", " ");
}
