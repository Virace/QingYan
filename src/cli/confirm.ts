import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function requireConfirmation(
	expected: string,
	message: string,
): Promise<void> {
	const rl = createInterface({ input, output });
	try {
		const answer = await rl.question(message);
		if (answer.trim() !== expected) {
			throw new Error("CONFIRMATION_REQUIRED");
		}
	} finally {
		rl.close();
	}
}
