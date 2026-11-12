type Translate = (key: string, vars?: Record<string, string | number>) => string;

const TWO_WAY = /^Bidirectional OK: A→B (\d+) files \/ B→A (\d+) files; total (\d+) transferred, (\d+)s\b/;
const ONE_WAY = /^Success: (\d+) files, ([^,]+), (\d+)s$/;
const PARTIAL = /^Partial: forward completed \((\d+) files, ([^,]+), (\d+)s\); reverse failed: ([\s\S]+?)\.? Bidirectional sync is not transactional\.$/;
const RECLAIMED = /^Failed: reclaimed stale RUNNING after (\d+)m\b/;
const FAILED = /^Failed: ([\s\S]+)$/;

/**
 * A sync job's last result as the page shows it. The worker stores one English line ("Success: 12 files,
 * 3.4 MB, 8s"), whoever looks at it later; the report reads the same line by its shape, so the stored text
 * stays as it is and the sentence is made here. A line in none of these shapes — and the reason inside a
 * failure, which comes from rsync or SSH — is shown as stored.
 */
export function syncResultLabel(raw: string, t: Translate): string {
	const text = raw.trim();
	const twoWay = TWO_WAY.exec(text);
	if (twoWay) return t("filesPage.syncJobs.result.twoWay", { forward: twoWay[1]!, reverse: twoWay[2]!, total: twoWay[3]!, seconds: twoWay[4]! });
	const oneWay = ONE_WAY.exec(text);
	if (oneWay) return t("filesPage.syncJobs.result.oneWay", { files: oneWay[1]!, size: oneWay[2]!, seconds: oneWay[3]! });
	const partial = PARTIAL.exec(text);
	if (partial) return t("filesPage.syncJobs.result.partial", { files: partial[1]!, size: partial[2]!, seconds: partial[3]!, reason: partial[4]! });
	const reclaimed = RECLAIMED.exec(text);
	if (reclaimed) return t("filesPage.syncJobs.result.reclaimed", { minutes: reclaimed[1]! });
	const failed = FAILED.exec(text);
	if (failed) return t("filesPage.syncJobs.result.failed", { reason: failed[1]! });
	return raw;
}
