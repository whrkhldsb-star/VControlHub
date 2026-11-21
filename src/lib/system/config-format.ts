export const EXPORT_SCHEMA_VERSION = 1;

/** Maximum size of an import request, including both the file and its options. */
export const CONFIG_IMPORT_MAX_BODY_BYTES = 32 * 1024 * 1024;

/** Reserve room for the importer's JSON wrapper and its boolean options. */
export const CONFIG_MAX_FILE_BYTES = CONFIG_IMPORT_MAX_BODY_BYTES - 1024;
