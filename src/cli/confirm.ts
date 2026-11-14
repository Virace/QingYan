import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

export async function requireConfirmation(
	expected: string,
	message: string,
): Promise<void> {
	const confirmationPrompt = createInterface({ input, output });
	try {
		const answer = await confirmationPrompt.question(message);
		if (answer.trim() !== expected) {
			throw new Error("CONFIRMATION_REQUIRED");
		}
	} finally {
		confirmationPrompt.close();
	}
}
