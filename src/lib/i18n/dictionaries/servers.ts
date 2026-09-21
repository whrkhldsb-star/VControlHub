import { zh as remoteDesktopZh, en as remoteDesktopEn } from "./remote-desktop";
import { zh as zhEntries } from "./servers-zh";
import { en as enEntries } from "./servers-en";

export const zh: Record<string, string> = {
	...zhEntries,
	...remoteDesktopZh,
};

export const en: Record<string, string> = {
	...enEntries,
	...remoteDesktopEn,
};
