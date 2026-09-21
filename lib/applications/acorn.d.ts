// Next 15.2.8 includes this parser in its pinned production package. Parsing never executes code.
declare module "next/dist/compiled/acorn" {
  export function parse(source: string, options: { ecmaVersion: "latest"; sourceType: "script" }): unknown
}
