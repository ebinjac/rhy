import type { docsSource } from "./source"

export async function getLlmText(
  page: (typeof docsSource)["$inferPage"]
): Promise<string> {
  const processed = await page.data.getText("processed")
  return `# ${page.data.title}

Source: ${page.url}
Status: ${page.data.status}
Last reviewed: ${page.data.lastReviewed}

${processed}`
}
