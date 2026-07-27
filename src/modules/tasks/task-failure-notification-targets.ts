const userRecipientPrefix = "user:";

export function taskFailureRecipientId(userId: number) {
	return `${userRecipientPrefix}${userId}`;
}

export function parseTaskFailureRecipientUserId(value: string): number | null {
	if (!value.startsWith(userRecipientPrefix)) {
		return null;
	}
	const userId = Number(value.slice(userRecipientPrefix.length));
	return Number.isInteger(userId) && userId > 0 ? userId : null;
}
