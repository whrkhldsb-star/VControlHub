/**
 * Parse / build human + structured sync run reports for the UI panel.
 */
export type SyncLegReport = {
  direction: "forward" | "reverse" | "one-way";
  transferredFiles: number;
  totalFiles: number;
  totalSize: number;
};

export type SyncRunReport = {
  mode: "mirror" | "bidirectional";
  legs: SyncLegReport[];
  transferredFiles: number;
  durationSec: number;
  notes: string[];
  raw: string;
};

const BI_RE =
  /Bidirectional OK:\s*A→B\s+(\d+)\s+files\s*\/\s*B→A\s+(\d+)\s+files;\s*total\s+(\d+)\s+transferred,\s*(\d+)s/i;
const ONE_RE = /Success:\s*(\d+)\s+files,\s*([^,]+),\s*(\d+)s/i;
const FAIL_RE = /Failed:\s*(.+)/i;

export function parseSyncResultMessage(raw: string | null | undefined): SyncRunReport | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  const bi = text.match(BI_RE);
  if (bi) {
    const fwd = Number(bi[1]);
    const rev = Number(bi[2]);
    const total = Number(bi[3]);
    const sec = Number(bi[4]);
    return {
      mode: "bidirectional",
      legs: [
        {
          direction: "forward",
          transferredFiles: fwd,
          totalFiles: fwd,
          totalSize: 0,
        },
        {
          direction: "reverse",
          transferredFiles: rev,
          totalFiles: rev,
          totalSize: 0,
        },
      ],
      transferredFiles: total,
      durationSec: sec,
      notes: [
        "newer-wins (rsync --update)",
        "no automatic orphan delete on either side",
        "same path on both sides with concurrent edits may keep both versions by mtime",
      ],
      raw: text,
    };
  }

  const one = text.match(ONE_RE);
  if (one) {
    return {
      mode: "mirror",
      legs: [
        {
          direction: "one-way",
          transferredFiles: Number(one[1]),
          totalFiles: Number(one[1]),
          totalSize: 0,
        },
      ],
      transferredFiles: Number(one[1]),
      durationSec: Number(one[3]),
      notes: ["one-way source → target"],
      raw: text,
    };
  }

  const fail = text.match(FAIL_RE);
  if (fail) {
    return {
      mode: "mirror",
      legs: [],
      transferredFiles: 0,
      durationSec: 0,
      notes: [`error: ${fail[1]!.slice(0, 300)}`],
      raw: text,
    };
  }

  return {
    mode: "mirror",
    legs: [],
    transferredFiles: 0,
    durationSec: 0,
    notes: [text.slice(0, 400)],
    raw: text,
  };
}

export type SyncLogRow = {
  id: string;
  status: string;
  filesScanned: number;
  filesTransferred: number;
  filesDeleted: number;
  bytesTransferred: string;
  durationMs: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
};

export function buildSyncReportView(input: {
  syncType: string;
  lastSyncResult: string | null;
  logs: SyncLogRow[];
}) {
  const parsed = parseSyncResultMessage(input.lastSyncResult);
  const latest = input.logs[0] ?? null;
  return {
    syncType: input.syncType,
    summary: parsed,
    latestLog: latest,
    history: input.logs.slice(0, 10),
    conflictHints:
      input.syncType.toUpperCase() === "BIDIRECTIONAL"
        ? [
            "Bidirectional uses mtime newer-wins; concurrent edits of the same file keep the newer copy only.",
            "Deletes are never propagated automatically — remove files on both sides manually if needed.",
            "If both sides change the same file offline, the later mtime wins after the next two-leg run.",
          ]
        : [],
  };
}
