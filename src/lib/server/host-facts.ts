/**
 * Host facts: what a node is (architecture, kernel, OS, CPU model,
 * virtualization) and how busy it is beyond CPU and memory (process and
 * socket counts). Collected by the same script as the metrics — over SSH, or
 * by an Agent installed after this section existed — as `key=value` lines
 * after a `===SYS===` marker. Older Agents omit the section; every fact is
 * then null and nothing is shown for it.
 *
 * All values come from the remote host and may be shown to anonymous
 * visitors, so they are reduced to one line of limited, printable text and
 * numbers are range-checked.
 */
export type HostFacts = {
	arch: string | null;
	kernel: string | null;
	os: string | null;
	cpuModel: string | null;
	/** systemd-detect-virt's answer ("kvm", "lxc", "none" for bare metal…). */
	virtualization: string | null;
	processes: number | null;
	tcpConnections: number | null;
	udpConnections: number | null;
};

/**
 * POSIX sh, BusyBox-compatible; each line fails soft to an empty value.
 * Socket counts are rows of /proc/net/{tcp,udp}{,6} minus their headers.
 */
export const HOST_FACTS_SCRIPT = [
	`echo "===SYS==="`,
	`echo "arch=$(uname -m 2>/dev/null)"`,
	`echo "kernel=$(uname -r 2>/dev/null)"`,
	`echo "os=$( (. /etc/os-release 2>/dev/null && echo "\${PRETTY_NAME:-$NAME $VERSION_ID}") 2>/dev/null)"`,
	// x86 names the CPU in /proc/cpuinfo; ARM servers often do not, lscpu does.
	`echo "cpu=$( (awk -F: '/^(model name|Hardware|cpu model)[[:space:]]*:/{sub(/^[ \\t]+/,"",$2); print $2; exit}' /proc/cpuinfo; lscpu 2>/dev/null | awk -F: '/^Model name[[:space:]]*:/{sub(/^[ \\t]+/,"",$2); print $2; exit}') 2>/dev/null | grep -m1 .)"`,
	`echo "virt=$(systemd-detect-virt 2>/dev/null)"`,
	`echo "procs=$(ls /proc 2>/dev/null | grep -c '^[0-9][0-9]*$')"`,
	`echo "tcp=$(cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | grep -vc 'local_address')"`,
	`echo "udp=$(cat /proc/net/udp /proc/net/udp6 2>/dev/null | grep -vc 'local_address')"`,
].join("; ");

/** One printable line, at most `max` characters; null when nothing is left. */
function text(value: string | undefined, max: number): string | null {
	if (!value) return null;
	const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
	return cleaned ? cleaned.slice(0, max) : null;
}

function token(value: string | undefined, pattern: RegExp, max: number): string | null {
	const cleaned = text(value, max);
	return cleaned && pattern.test(cleaned) ? cleaned : null;
}

function count(value: string | undefined, max: number): number | null {
	if (!value || !/^\d+$/.test(value.trim())) return null;
	const parsed = Number(value.trim());
	return Number.isSafeInteger(parsed) && parsed <= max ? parsed : null;
}

/** Parse the lines after `===SYS===`; undefined when the section is absent. */
export function parseHostFacts(lines: string[]): HostFacts | undefined {
	if (lines.length === 0) return undefined;
	const values = new Map<string, string>();
	for (const line of lines) {
		const match = /^([a-z]+)=(.*)$/.exec(line.trim());
		if (match && !values.has(match[1]!)) values.set(match[1]!, match[2]!);
	}
	if (values.size === 0) return undefined;
	return {
		arch: token(values.get("arch"), /^[A-Za-z0-9_.-]+$/, 32),
		kernel: token(values.get("kernel"), /^[A-Za-z0-9_.+~-]+$/, 64),
		os: text(values.get("os"), 96),
		cpuModel: text(values.get("cpu"), 96),
		virtualization: token(values.get("virt")?.toLowerCase(), /^[a-z0-9_-]+$/, 32),
		processes: count(values.get("procs"), 10_000_000),
		tcpConnections: count(values.get("tcp"), 100_000_000),
		udpConnections: count(values.get("udp"), 100_000_000),
	};
}
