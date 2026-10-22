/**
 * In-app navigation that does not go through a link click (keyboard
 * shortcuts, global search). A form with unsaved changes can intercept it,
 * as it does a link: the event is cancelled and the form asks first.
 */
export const NAVIGATION_REQUEST_EVENT = "vcontrolhub:navigation-request";

export type NavigationRequestDetail = { href: string };

/** Navigate unless a guarded form takes over (it then navigates itself once the user agrees). */
export function requestNavigation(href: string, navigate: (href: string) => void) {
	const allowed = window.dispatchEvent(
		new CustomEvent<NavigationRequestDetail>(NAVIGATION_REQUEST_EVENT, { cancelable: true, detail: { href } }),
	);
	if (allowed) navigate(href);
}
