// Bearer sessions carry these extra grants when present. The services check them against the effective configuration.
export const PLAYBOOK_RUN_PERMISSION = "playbook:run";
export const PLAYBOOK_COMMAND_PERMISSION = "command:execute";
export const PLAYBOOK_SERVER_READ_PERMISSION = "server:read" as const;
