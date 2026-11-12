type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** The notes the server writes when it keeps a version by itself (stored in English, whoever is signed in). */
const SYSTEM_NOTES: Record<string, string> = {
	"Before text editor save": "fileVersionHistory.note.beforeEdit",
	"Before single-shot upload overwrite": "fileVersionHistory.note.beforeUpload",
	"Before resumable upload overwrite": "fileVersionHistory.note.beforeUpload",
};

/**
 * A version's note as the page shows it: a note the system wrote in the page's language, a note a person
 * typed as it was typed.
 */
export function versionNoteLabel(note: string, t: Translate): string {
	const restore = /^Before restore to v(\d+)$/.exec(note);
	if (restore) return t("fileVersionHistory.note.beforeRestore", { n: restore[1]! });
	const key = SYSTEM_NOTES[note];
	return key ? t(key) : note;
}
