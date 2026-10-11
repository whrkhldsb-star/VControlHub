/**
 * Browser event fired after the customer list changes (create, delete,
 * restore). The sidebar switcher loads the list once on mount and keeps it
 * across `router.refresh()`, so it listens for this to stay current.
 */
export const CUSTOMERS_CHANGED_EVENT = "vch:customers-changed";

export function notifyCustomersChanged() {
	window.dispatchEvent(new Event(CUSTOMERS_CHANGED_EVENT));
}
