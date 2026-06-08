import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PaginationControls({
	limit,
	pageIndex,
	totalCount,
	itemCount,
	setLimit,
	setPageIndex,
}: {
	limit: number;
	pageIndex: number;
	totalCount: number;
	itemCount: number;
	setLimit: (value: number) => void;
	setPageIndex: (value: number) => void;
}) {
	const limitInputId = useId();
	const pageCount = Math.max(1, Math.ceil(totalCount / limit));
	const canPrevious = pageIndex > 0;
	const canNext = pageIndex + 1 < pageCount;

	return (
		<div className="flex flex-col gap-2 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
			<p>
				共 {totalCount} 条，当前显示 {itemCount} 条，第 {pageIndex + 1} /{" "}
				{pageCount} 页。
			</p>
			<div className="flex flex-wrap items-center gap-2">
				<label className="flex items-center gap-2" htmlFor={limitInputId}>
					<span>每页</span>
					<Input
						id={limitInputId}
						type="number"
						min={1}
						max={100}
						className="h-8 w-20"
						value={limit}
						onChange={(event) => setLimit(Number(event.target.value) || 20)}
					/>
				</label>
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={!canPrevious}
					onClick={() => setPageIndex(pageIndex - 1)}
				>
					上一页
				</Button>
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={!canNext}
					onClick={() => setPageIndex(pageIndex + 1)}
				>
					下一页
				</Button>
			</div>
		</div>
	);
}
