// `import x from "./file" with { type: "text" }` gives a string in Bun.
declare module "*.sql" {
  const text: string;
  export default text;
}
declare module "*.svg" {
  const text: string;
  export default text;
}
declare module "*.css" {
  const text: string;
  export default text;
}
