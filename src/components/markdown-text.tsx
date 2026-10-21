import { MARKDOWN_COMPACT_CLASS, renderMarkdown } from "@/lib/markdown/render-markdown";
import { cn } from "@/lib/ui/cn";

/**
 * Markdown written in the console (announcements and similar notes).
 * renderMarkdown escapes the whole source before it adds its own
 * whitelisted tags and safe links, so the result renders the same on the
 * server and in the browser without a DOM sanitizer.
 */
export function MarkdownText({ source, className }: { source: string; className?: string }) {
	return <div data-markdown className={cn(MARKDOWN_COMPACT_CLASS, className)} dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }} />;
}
