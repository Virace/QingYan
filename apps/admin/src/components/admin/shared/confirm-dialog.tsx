import {
	createContext,
	useCallback,
	useContext,
	useRef,
	useState,
} from "react";
import { AlertDialog, Button, Flex } from "@radix-ui/themes";

type ConfirmOptions = {
	title: string;
	description: string;
	confirmText?: string;
	cancelText?: string;
	destructive?: boolean;
};

type PendingConfirm = ConfirmOptions & {
	resolve: (confirmed: boolean) => void;
};

const AdminConfirmDialogContext = createContext<
	((options: ConfirmOptions) => Promise<boolean>) | null
>(null);

export function AdminConfirmDialogProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(
		null,
	);
	const pendingRef = useRef<PendingConfirm | null>(null);

	const closeConfirm = useCallback((confirmed: boolean) => {
		const current = pendingRef.current;
		pendingRef.current = null;
		setPendingConfirm(null);
		current?.resolve(confirmed);
	}, []);

	const confirm = useCallback((options: ConfirmOptions) => {
		return new Promise<boolean>((resolve) => {
			pendingRef.current?.resolve(false);
			const nextConfirm = { ...options, resolve };
			pendingRef.current = nextConfirm;
			setPendingConfirm(nextConfirm);
		});
	}, []);

	return (
		<AdminConfirmDialogContext.Provider value={confirm}>
			{children}
			<AlertDialog.Root
				open={pendingConfirm !== null}
				onOpenChange={(open) => {
					if (!open) {
						closeConfirm(false);
					}
				}}
			>
				<AlertDialog.Content maxWidth="440px">
					<AlertDialog.Title>{pendingConfirm?.title}</AlertDialog.Title>
					<AlertDialog.Description size="2">
						{pendingConfirm?.description}
					</AlertDialog.Description>
					<Flex gap="3" mt="4" justify="end">
						<AlertDialog.Cancel>
							<Button variant="soft" color="gray">
								{pendingConfirm?.cancelText ?? "取消"}
							</Button>
						</AlertDialog.Cancel>
						<AlertDialog.Action>
							<Button
								variant="solid"
								color={pendingConfirm?.destructive ? "red" : undefined}
								onClick={() => closeConfirm(true)}
							>
								{pendingConfirm?.confirmText ?? "确认"}
							</Button>
						</AlertDialog.Action>
					</Flex>
				</AlertDialog.Content>
			</AlertDialog.Root>
		</AdminConfirmDialogContext.Provider>
	);
}

export function useAdminConfirmDialog() {
	const confirm = useContext(AdminConfirmDialogContext);
	if (!confirm) {
		throw new Error("useAdminConfirmDialog must be used within its provider.");
	}
	return confirm;
}
