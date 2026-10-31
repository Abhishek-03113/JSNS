/**
 * Everything the server serves or runs from disk is imported as text here, so the bundled
 * function (Vercel) carries it and nothing is read from the filesystem at runtime.
 */
import dashboardHtmlText from "./web/dashboard.html" with { type: "text" };
// @ts-ignore: TypeScript reads this as a module; with type "text" Bun gives its source as a string.
import dashboardTsText from "./web/dashboard.ts" with { type: "text" };
import favicon from "./web/favicon.svg" with { type: "text" };
import loginHtmlText from "./web/login.html" with { type: "text" };
import styles from "./web/styles.css" with { type: "text" };
import m001 from "../migrations/001_init.sql" with { type: "text" };
import m002 from "../migrations/002_short_url.sql" with { type: "text" };

// TypeScript types .html imports as HTML bundles; with type "text" they are strings.
const dashboardHtml = dashboardHtmlText as unknown as string;
const loginHtml = loginHtmlText as unknown as string;
const dashboardTs = dashboardTsText as unknown as string;

/** Add new migration files here, in order. */
export const MIGRATIONS: { name: string; sql: string }[] = [
  { name: "001_init.sql", sql: m001 },
  { name: "002_short_url.sql", sql: m002 },
];

/** The dashboard script has no imports, so transpiling it is all the bundling it needs. */
const dashboardJs = new Bun.Transpiler({ loader: "ts", target: "browser", minifyWhitespace: true }).transformSync(dashboardTs);

export const ASSETS: Record<string, { body: string; type: string }> = {
  "dashboard.html": { body: dashboardHtml, type: "text/html; charset=utf-8" },
  "login.html": { body: loginHtml, type: "text/html; charset=utf-8" },
  "styles.css": { body: styles, type: "text/css; charset=utf-8" },
  "favicon.svg": { body: favicon, type: "image/svg+xml" },
  "dashboard.js": { body: dashboardJs, type: "text/javascript; charset=utf-8" },
};
