export type DeploymentExportManifest = {
  appName?: string;
  domain?: string;
  generatedAt?: string;
  dangerousEnvFlags?: string[];
};

export type DeploymentExportFileMap = Record<string, string>;

export type DeploymentExportResponse = {
  export?: {
    id?: string;
    name?: string;
    manifest?: DeploymentExportManifest;
    files?: DeploymentExportFileMap;
  };
};

export const EMPTY_EXPORT_FILES: DeploymentExportFileMap = {};

export type TreeNode = {
  name: string;
  fullPath: string;
  isFile: boolean;
  children: TreeNode[];
};

export function normalizeDomain(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeAppName(value: string) {
  return value.trim().toLowerCase();
}

export function buildFileTree(files: DeploymentExportFileMap): TreeNode[] {
  const root: TreeNode = { name: "", fullPath: "", isFile: false, children: [] };
  const sorted = Object.entries(files).sort(([a], [b]) => a.localeCompare(b));
  for (const [rawName] of sorted) {
    const segments = rawName.replace(/^\/+/, "").split("/").filter(Boolean);
    if (segments.length === 0) continue;
    let cursor = root;
    let running = "";
    segments.forEach((segment, index) => {
      running = running ? `${running}/${segment}` : segment;
      const isFile = index === segments.length - 1;
      let next = cursor.children.find((child) => child.name === segment);
      if (!next) {
        next = { name: segment, fullPath: running, isFile, children: [] };
        cursor.children.push(next);
      } else if (isFile) {
        next.isFile = true;
      }
      cursor = next;
    });
  }
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(root.children);
  return root.children;
}

export async function copyTextToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // fall through
    }
  }
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  textarea.remove();
  return ok;
}

export function downloadTextFile(filename: string, content: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function nodeKey(node: TreeNode) {
  return node.fullPath || node.name;
}
