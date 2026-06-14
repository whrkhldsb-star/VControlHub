/**
 * Server service barrel.
 *
 * The 985-line god-file that lived here was decomposed into cohesive
 * sub-modules in R19. The public API surface (functions + types) is
 * preserved verbatim through re-exports so call-sites in src/app/api/
 * and src/app/{servers,storage,files} keep working.
 *
 *   service-internals.ts       shared types + helpers (enrich, revalidate,
 *                              duplicate-check, ssh-preflight)
 *   service-ssh-keys.ts        re-export of ./ssh-keys (TR-038 R1)
 *   service-direct-gateway.ts  install / uninstall / load helpers
 *   service-profiles.ts        server-profile CRUD (create/update/list/
 *                              delete/toggle)
 *   service.ts                 barrel re-export (this file)
 */

// Public re-exports (one source of truth — these are the call-sites'
// `import { ... } from "@/lib/server/service"` symbols).
export {
  listSshKeys,
  createSshKey,
} from "./service-ssh-keys";

export {
  setServerDirectGatewayEnabled,
} from "./service-direct-gateway";

export {
  createServerProfile,
  updateServerProfile,
  toggleServerEnabled,
  deleteServerProfile,
  listServerProfiles,
} from "./service-profiles";

// Re-export shared types so call-sites that imported them from
// "@/lib/server/service" (e.g. ServerWithRelations, ServerProfileRow) still
// resolve through the same module path.
export type {
  ExistingServerForDuplicateCheck,
  NormalizedServerInput,
  ServerCommandTargetRow,
  ServerProfileRow,
  ServerWithRelations,
} from "./service-internals";
