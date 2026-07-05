import type { ServiceTemplate } from "./types";
import { STORAGE_SERVICE_TEMPLATES } from "./catalog-storage";
import { MEDIA_SERVICE_TEMPLATES } from "./catalog-media";
import { DEVTOOLS_SERVICE_TEMPLATES } from "./catalog-devtools";
import { NOTES_SERVICE_TEMPLATES } from "./catalog-notes";
import { NETWORK_SERVICE_TEMPLATES } from "./catalog-network";
import { BLOG_SERVICE_TEMPLATES } from "./catalog-blog";
import { OTHER_SERVICE_TEMPLATES } from "./catalog-other";

export const SERVICE_CATALOG: ServiceTemplate[] = [
	...STORAGE_SERVICE_TEMPLATES,
	...MEDIA_SERVICE_TEMPLATES,
	...DEVTOOLS_SERVICE_TEMPLATES,
	...NOTES_SERVICE_TEMPLATES,
	...NETWORK_SERVICE_TEMPLATES,
	...BLOG_SERVICE_TEMPLATES,
	...OTHER_SERVICE_TEMPLATES,
];
