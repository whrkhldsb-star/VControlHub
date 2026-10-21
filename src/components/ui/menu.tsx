"use client";

/**
 * Menu — a button that opens a short list of actions or links.
 *
 *   <Menu label="更多" trigger="更多" align="end">
 *     <MenuItem href="/files/search" description="跨节点搜索文件">搜索</MenuItem>
 *     <MenuItem icon={<IconPencil />} onSelect={rename}>重命名</MenuItem>
 *     <MenuSeparator />
 *     <MenuItem danger onSelect={remove}>删除</MenuItem>
 *   </Menu>
 *
 * Outside click and Escape close it (focus returns to the trigger), arrow
 * keys / Home / End move between items, and choosing an item closes it.
 * The look lives in globals.css (`[data-popover]`, `[data-menu-item]`), so
 * menus, the account menu and the notification panel stay identical.
 */
import Link from "next/link";
import { createPortal } from "react-dom";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	type RefObject,
} from "react";

import { cn } from "@/lib/ui/cn";
import { ActionButton, type ActionButtonVariant, type ButtonSize } from "../action-button";
import { IconChevronDown } from "../nav-icons";

/**
 * Close a floating panel on outside pointer-down or Escape. Clicks inside a
 * modal opened from the panel (rendered in a body portal) do not count as
 * outside, and Escape is left to that modal.
 */
export function useDismiss({
	open,
	onDismiss,
	refs,
}: {
	open: boolean;
	onDismiss: (reason: "outside" | "escape") => void;
	refs: Array<RefObject<HTMLElement | null>>;
}) {
	const latest = useRef({ onDismiss, refs });
	useEffect(() => {
		latest.current = { onDismiss, refs };
	});

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (target instanceof Element && target.closest("[data-modal-overlay]")) return;
			if (latest.current.refs.some((ref) => ref.current?.contains(target))) return;
			latest.current.onDismiss("outside");
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (document.querySelector("[data-modal-overlay]")) return;
			latest.current.onDismiss("escape");
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);
}

const MenuContext = createContext<{ close: () => void } | null>(null);

function menuItems(panel: HTMLElement | null) {
	return panel
		? Array.from(panel.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])'))
		: [];
}

export function Menu({
	label,
	trigger,
	children,
	align = "start",
	variant = "secondary",
	size = "sm",
	caret = true,
	className,
	panelClassName,
}: {
	/** Accessible name of the menu (and of an icon-only trigger). */
	label: string;
	/** Trigger content: text and/or an icon. */
	trigger: ReactNode;
	children: ReactNode;
	/** Which edge of the trigger the panel lines up with. */
	align?: "start" | "end";
	variant?: ActionButtonVariant;
	size?: ButtonSize;
	caret?: boolean;
	className?: string;
	/** Width and other layout overrides for the panel. */
	panelClassName?: string;
}) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const menuId = useId();

	const close = useCallback((restoreFocus = false) => {
		setOpen(false);
		if (restoreFocus) triggerRef.current?.focus();
	}, []);

	useDismiss({ open, refs: [rootRef], onDismiss: (reason) => close(reason === "escape") });

	useEffect(() => {
		if (open) menuItems(panelRef.current)[0]?.focus();
	}, [open]);

	const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		const items = menuItems(panelRef.current);
		if (items.length === 0) return;
		const index = items.indexOf(document.activeElement as HTMLElement);
		const focusAt = (next: number) => items[(next + items.length) % items.length]?.focus();
		if (event.key === "ArrowDown") focusAt(index + 1);
		else if (event.key === "ArrowUp") focusAt(index - 1);
		else if (event.key === "Home") focusAt(0);
		else if (event.key === "End") focusAt(items.length - 1);
		else if (event.key === "Tab") {
			setOpen(false);
			return;
		} else return;
		event.preventDefault();
	};

	return (
		<div ref={rootRef} className={cn("relative inline-flex", className)}>
			<ActionButton
				ref={triggerRef}
				variant={variant}
				size={size}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? menuId : undefined}
				aria-label={typeof trigger === "string" ? undefined : label}
				onClick={() => setOpen((value) => !value)}
				onKeyDown={(event) => {
					if (event.key === "ArrowDown" && !open) {
						event.preventDefault();
						setOpen(true);
					}
				}}
				iconRight={caret ? <IconChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} /> : undefined}
			>
				{trigger}
			</ActionButton>
			{open ? (
				<div
					ref={panelRef}
					id={menuId}
					role="menu"
					aria-label={label}
					data-popover
					onKeyDown={onPanelKeyDown}
					className={cn("absolute top-full mt-1.5", align === "end" ? "right-0" : "left-0", panelClassName)}
				>
					<MenuContext.Provider value={{ close: () => close(true) }}>{children}</MenuContext.Provider>
				</div>
			) : null}
		</div>
	);
}

/** Where an anchored menu opens: under an element, or at a pointer position. */
export type MenuAnchor = HTMLElement | { x: number; y: number };

const VIEWPORT_MARGIN = 8;

/**
 * A menu opened by code rather than by its own trigger: a context menu at the
 * pointer, or the actions of a row's "more" button. It renders in a body
 * portal with fixed positioning, so a scrolling or clipped container never
 * cuts it off, and it flips above or left when the viewport is short. Items
 * are the same `MenuItem`s as `Menu`; choosing one, Escape, an outside
 * click, scrolling or resizing closes it.
 */
export function AnchoredMenu({
	anchor,
	onClose,
	label,
	children,
	panelClassName,
}: {
	/** The menu is open while an anchor is set. */
	anchor: MenuAnchor | null;
	/** `restoreFocus` is true when focus should return to the trigger. */
	onClose: (restoreFocus: boolean) => void;
	label: string;
	children: ReactNode;
	panelClassName?: string;
}) {
	const panelRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLElement | null>(null);
	const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
	const open = anchor !== null;
	useLayoutEffect(() => {
		triggerRef.current = anchor instanceof HTMLElement ? anchor : null;
	}, [anchor]);

	const close = useCallback((restoreFocus: boolean) => {
		onClose(restoreFocus);
		if (restoreFocus) triggerRef.current?.focus();
	}, [onClose]);

	useDismiss({ open, refs: [panelRef, triggerRef], onDismiss: (reason) => close(reason === "escape") });

	useLayoutEffect(() => {
		if (!anchor || !panelRef.current) {
			setPosition(null);
			return;
		}
		const panel = panelRef.current.getBoundingClientRect();
		const box = anchor instanceof HTMLElement
			? anchor.getBoundingClientRect()
			: { top: anchor.y, bottom: anchor.y, left: anchor.x, right: anchor.x };
		const fitsBelow = box.bottom + 4 + panel.height <= window.innerHeight - VIEWPORT_MARGIN;
		const top = fitsBelow
			? box.bottom + 4
			: Math.max(VIEWPORT_MARGIN, box.top - 4 - panel.height);
		// Buttons line the menu up with their right edge; a pointer opens to its right.
		const preferredLeft = anchor instanceof HTMLElement ? box.right - panel.width : box.left;
		const left = Math.min(
			Math.max(VIEWPORT_MARGIN, preferredLeft),
			window.innerWidth - VIEWPORT_MARGIN - panel.width,
		);
		setPosition({ top, left: Math.max(VIEWPORT_MARGIN, left) });
	}, [anchor]);

	useEffect(() => {
		if (!open) return;
		menuItems(panelRef.current)[0]?.focus({ preventScroll: true });
		const dismiss = () => close(false);
		window.addEventListener("resize", dismiss);
		// Scrolling inside the menu itself keeps it; any other scroll closes it.
		const onScroll = (event: Event) => {
			if (event.target instanceof Node && panelRef.current?.contains(event.target)) return;
			dismiss();
		};
		window.addEventListener("scroll", onScroll, true);
		return () => {
			window.removeEventListener("resize", dismiss);
			window.removeEventListener("scroll", onScroll, true);
		};
	}, [open, close]);

	if (!open || typeof document === "undefined") return null;
	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		const items = menuItems(panelRef.current);
		if (items.length === 0) return;
		const index = items.indexOf(document.activeElement as HTMLElement);
		const focusAt = (next: number) => items[(next + items.length) % items.length]?.focus();
		if (event.key === "ArrowDown") focusAt(index + 1);
		else if (event.key === "ArrowUp") focusAt(index - 1);
		else if (event.key === "Home") focusAt(0);
		else if (event.key === "End") focusAt(items.length - 1);
		else if (event.key === "Tab") {
			close(false);
			return;
		} else return;
		event.preventDefault();
	};
	return createPortal(
		<div
			ref={panelRef}
			role="menu"
			aria-label={label}
			data-popover
			onKeyDown={onKeyDown}
			onContextMenu={(event) => event.preventDefault()}
			style={{
				position: "fixed",
				top: position?.top ?? 0,
				left: position?.left ?? 0,
				visibility: position ? "visible" : "hidden",
				maxHeight: `calc(100dvh - ${VIEWPORT_MARGIN * 2}px)`,
			}}
			className={cn("overflow-y-auto", panelClassName)}
		>
			<MenuContext.Provider value={{ close: () => close(true) }}>{children}</MenuContext.Provider>
		</div>,
		document.body,
	);
}

type MenuItemProps = {
	children: ReactNode;
	icon?: ReactNode;
	/** Second line of muted helper text. */
	description?: ReactNode;
	/** Right-aligned hint such as a keyboard shortcut. */
	hint?: ReactNode;
	danger?: boolean;
	disabled?: boolean;
	className?: string;
} & ({ href: string; onSelect?: () => void } | { href?: undefined; onSelect: () => void });

export function MenuItem({ children, icon, description, hint, danger, disabled, className, href, onSelect }: MenuItemProps) {
	const menu = useContext(MenuContext);
	const content = (
		<>
			{icon}
			<span className="min-w-0 flex-1">
				<span className={cn("block truncate", description ? "font-medium text-[var(--text-primary)]" : undefined)}>{children}</span>
				{description ? <span data-menu-description className="block">{description}</span> : null}
			</span>
			{hint ? <span className="ml-auto shrink-0 text-xs text-[var(--text-muted)]">{hint}</span> : null}
		</>
	);
	const shared = {
		role: "menuitem" as const,
		"data-menu-item": "",
		"data-danger": danger ? "" : undefined,
		"aria-disabled": disabled || undefined,
		tabIndex: -1,
		className,
	};
	if (href !== undefined) {
		return (
			<Link
				href={href}
				{...shared}
				onClick={() => {
					onSelect?.();
					menu?.close();
				}}
			>
				{content}
			</Link>
		);
	}
	return (
		<button
			type="button"
			{...shared}
			disabled={disabled}
			onClick={() => {
				onSelect?.();
				menu?.close();
			}}
		>
			{content}
		</button>
	);
}

export function MenuSeparator() {
	return <div role="separator" data-menu-separator />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
	return <div data-menu-label>{children}</div>;
}
