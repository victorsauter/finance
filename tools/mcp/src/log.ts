/** Diagnostics go to stderr: stdout carries the MCP protocol only. */
export function log(message: string) {
  process.stderr.write(`[finance-mcp] ${message}\n`)
}
