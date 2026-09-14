# VControlHub i18n Coverage Report

> Generated: 2026-09-14T04:56:46.952Z | Files: 433 | Strings: 1 | Coverage: **0%** (0/1)

This report cross-references hardcoded Chinese strings in `src/app/**/*.tsx` and `src/components/**/*.tsx` against the values in `src/lib/i18n/translations.ts`. A string is **covered** when its exact value already exists in the `zh` translation map; **missing** strings are candidates for new translation keys.

Strings inside `data-i18n-skip` regions, in `<script>` tags, or in JSX expressions (`{...}`) are not audited.

## Module coverage (lowest first)

| Module | Strings | Covered | Missing | Coverage |
|---|---|---|---|---|
| `src/app/servers` | 1 | 0 | 1 | 0% |

## Top missing strings (frequency-sorted)

Each row is a Chinese string that appears in source but has no matching key in `translations.ts`. Add the string as a `zh` value, then optionally provide an `en` value, then reference it via `t("<key>")`.

| String | Count | First 3 occurrences |
|---|---|---|
| ,
  },
);

type ServerOverviewCardProps =  ;

export function ServerOverviewCard( : ServerOverviewCardProps)   = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const closeDialog = useCallback(() =>  , []);
  const openDialog = useCallback(() =>  , []);
  const   = useServerDiagnostics(server.id, server.enabled);
  const directLabel = server.directGateway?.statusLabel ?? t("serverOverviewCard.websiteRelay");
  const detailsId = `server-details-$ `;

  useEffect(() =>  , []);

  // Status badge reflects the latest live probe outcome instead of the static
  // "启用 · 待探测" placeholder. This is what the user expects after clicking
  // "运行实时探测" — they want to see the chip change to 在线/离线/检测中.
  let listHealthLabel: string;
  let listHealthToneClass: string;
  let listHealthDescription: string;
  if (!server.enabled)   else if (diagnosticRun.status === "loading")   else if (diagnosticRun.status === "success")   · $ `.trim();
    listHealthToneClass =
      "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)] light:border-[var(--success-border)]";
    listHealthDescription =
      diagnosticRun.summary
        ? t("serverOverviewCard.lastProbeSuccessWithSummary",  )
        : t("serverOverviewCard.lastProbeSuccess",  );
  } else if (diagnosticRun.status === "error")  );
  } else  

  return ( | 1 | `src/app/servers/server-overview-card.tsx:21` (text) |

## Files with missing translations (most gaps first)

### `src/app/servers/server-overview-card.tsx` — 1/1 missing (0%)

- L21 text ",
  },
);

type ServerOverviewCardProps =  ;

export function ServerOverviewCard( : ServerOverviewCardProps)   = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const closeDialog = useCallback(() =>  , []);
  const openDialog = useCallback(() =>  , []);
  const   = useServerDiagnostics(server.id, server.enabled);
  const directLabel = server.directGateway?.statusLabel ?? t("serverOverviewCard.websiteRelay");
  const detailsId = `server-details-$ `;

  useEffect(() =>  , []);

  // Status badge reflects the latest live probe outcome instead of the static
  // "启用 · 待探测" placeholder. This is what the user expects after clicking
  // "运行实时探测" — they want to see the chip change to 在线/离线/检测中.
  let listHealthLabel: string;
  let listHealthToneClass: string;
  let listHealthDescription: string;
  if (!server.enabled)   else if (diagnosticRun.status === "loading")   else if (diagnosticRun.status === "success")   · $ `.trim();
    listHealthToneClass =
      "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)] light:border-[var(--success-border)]";
    listHealthDescription =
      diagnosticRun.summary
        ? t("serverOverviewCard.lastProbeSuccessWithSummary",  )
        : t("serverOverviewCard.lastProbeSuccess",  );
  } else if (diagnosticRun.status === "error")  );
  } else  

  return ("
