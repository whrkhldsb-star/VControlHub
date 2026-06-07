import Link from "next/link";

export type MediaFilterState = {
	type?: "image" | "video" | "audio";
	favorite?: boolean;
	q?: string;
	tag?: string;
};

export function mediaHref(input: MediaFilterState) {
	const params = new URLSearchParams();
	if (input.type) params.set("type", input.type);
	if (input.favorite) params.set("favorite", "1");
	if (input.q) params.set("q", input.q);
	if (input.tag) params.set("tag", input.tag);
	const query = params.toString();
	return query ? `/media?${query}` : "/media";
}

function withoutEmpty(input: MediaFilterState): MediaFilterState {
	return {
		type: input.type,
		favorite: input.favorite || undefined,
		q: input.q?.trim() || undefined,
		tag: input.tag?.trim() || undefined,
	};
}

export function toggleTypeHref(current: MediaFilterState, type: "image" | "video" | "audio") {
	const next = withoutEmpty(current);
	return mediaHref({ ...next, type: next.type === type ? undefined : type });
}

export function toggleFavoriteHref(current: MediaFilterState) {
	const next = withoutEmpty(current);
	return mediaHref({ ...next, favorite: next.favorite ? undefined : true });
}

export function toggleTagHref(current: MediaFilterState, tag: string) {
	const next = withoutEmpty(current);
	return mediaHref({ ...next, tag: next.tag === tag ? undefined : tag });
}

export function FilterLink({
	href,
	active,
	className,
	activeClassName,
	inactiveClassName,
	children,
	title,
}: {
	href: string;
	active: boolean;
	className?: string;
	activeClassName: string;
	inactiveClassName: string;
	children: React.ReactNode;
	title?: string;
}) {
	return (
		<Link
			href={href}
			aria-pressed={active}
			title={title}
			className={`${className ?? ""} ${active ? activeClassName : inactiveClassName}`.trim()}
		>
			{children}
		</Link>
	);
}
