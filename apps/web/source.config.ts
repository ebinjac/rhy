import { defineDocs, frontmatterSchema } from "fumadocs-mdx/config"
import { z } from "zod"

const documentationFrontmatter = frontmatterSchema.extend({
  audience: z
    .array(
      z.enum([
        "application-engineer",
        "sre-operator",
        "release-engineer",
        "platform-administrator",
        "security-administrator",
      ])
    )
    .min(1),
  status: z.enum(["stable", "preview", "deprecated"]),
  since: z.string().min(1),
  lastReviewed: z.iso.date(),
  owners: z.array(z.string().min(1)).min(1),
  prerequisites: z.array(z.string()).optional(),
  related: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
})

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: documentationFrontmatter,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
})
