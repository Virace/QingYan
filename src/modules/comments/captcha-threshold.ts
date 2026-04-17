export function requiresCaptchaForAttempt(
	completedActions: number,
	thresholdMaxActions: number,
): boolean {
	return completedActions + 1 >= thresholdMaxActions;
}
