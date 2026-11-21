import path from "node:path/posix";

export function isInsideRoot(candidate: string, root: string, windows: boolean) {
	const normalize = (value: string) => {
		// Windows OpenSSH accepts /C:/... and can return C:/... from realpath.
		const portable = windows ? value.replace(/\\/g, "/") : value;
		const absolute = windows && /^[a-z]:\//i.test(portable) ? `/${portable}` : portable;
		return path.normalize(absolute).replace(/\/+$/, "") || "/";
	};
	const normalizedRoot = normalize(root);
	const normalizedCandidate = normalize(candidate);
	// Relative paths execute from the remote login directory, which need not
	// equal the allowed root. Only absolute paths have unambiguous containment.
	if (!normalizedCandidate.startsWith("/")) return false;
	return normalizedCandidate === normalizedRoot ||
		normalizedCandidate.startsWith(normalizedRoot === "/" ? "/" : `${normalizedRoot}/`);
}
