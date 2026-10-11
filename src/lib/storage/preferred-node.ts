/**
 * Which storage node a surface should start on when the user has not picked
 * one. Node lists arrive newest first, and the newest node is often the one
 * that was just added for a server that has not connected yet; starting an
 * upload or a share there only produces a timeout. Client-safe.
 */
export type PreferredNodeCandidate = {
	id: string;
	isDefault?: boolean | null;
	healthStatus?: string | null;
};

export function isUsableStorageNode(node: Pick<PreferredNodeCandidate, "healthStatus">): boolean {
	return node.healthStatus !== "UNHEALTHY";
}

export function pickPreferredStorageNode<T extends PreferredNodeCandidate>(nodes: readonly T[]): T | undefined {
	return nodes.find((node) => node.isDefault && isUsableStorageNode(node))
		?? nodes.find(isUsableStorageNode)
		?? nodes[0];
}
