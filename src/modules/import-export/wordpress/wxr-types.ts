export interface WxrChannelMetadata {
	title?: string;
	link?: string;
	baseSiteUrl?: string;
	baseBlogUrl?: string;
	version?: string;
}

export interface WxrComment {
	commentId: string;
	parentId: string | null;
	approved: string;
	type: string;
	authorName: string;
	authorEmail?: string;
	authorUrl?: string;
	authorIp?: string;
	userAgent?: string;
	date?: string;
	dateGmt?: string;
	content: string;
}

export interface WxrItem {
	wpPostId: string;
	postType: "post" | "page";
	title: string;
	link: string;
	postName: string;
	postDate?: string;
	postDateGmt?: string;
	categories: string[];
	comments: WxrComment[];
}

export interface WxrDocument {
	metadata: WxrChannelMetadata;
	items: WxrItem[];
}
