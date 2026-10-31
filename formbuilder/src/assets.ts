/**
 * Pages, styles, the dashboard script and SQL migrations, embedded as strings by
 * `bun run embed` so the deployed function reads nothing from disk.
 */
export { ASSETS, MIGRATIONS } from "./generated/assets.ts";
