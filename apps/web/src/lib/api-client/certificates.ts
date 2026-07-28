import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import type {
  ApiErrorResponse,
  ApiSuccess,
  ConfigurationProfileContract,
} from "@/lib/api-client/contracts"

const encodedFileSchema = z.object({
  name: z.string().min(1),
  type: z.string(),
  contentBase64: z.string().min(1),
})

export const uploadCertificateProfile = createServerFn({ method: "POST" })
  .validator(
    z.object({
      profileId: z.string().optional(),
      name: z.string().min(1),
      description: z.string(),
      purpose: z.enum(["CLIENT_IDENTITY", "TRUST_BUNDLE", "COMBINED"]),
      password: z.string(),
      keyPassword: z.string(),
      alias: z.string(),
      source: encodedFileSchema.optional(),
      privateKey: encodedFileSchema.optional(),
      caBundle: encodedFileSchema.optional(),
    })
  )
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; profile: ConfigurationProfileContract }
      | { ok: false; message: string }
    > => {
      const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
      const form = new FormData()
      form.set("name", data.name)
      form.set("description", data.description)
      form.set("purpose", data.purpose)
      form.set("password", data.password)
      form.set("keyPassword", data.keyPassword)
      form.set("alias", data.alias)
      for (const field of ["source", "privateKey", "caBundle"] as const) {
        const file = data[field]
        if (!file) continue
        const bytes = new Uint8Array(Buffer.from(file.contentBase64, "base64"))
        form.set(
          field,
          new Blob([bytes], { type: file.type || "application/octet-stream" }),
          file.name
        )
      }
      const suffix = data.profileId
        ? `/${encodeURIComponent(data.profileId)}/upload`
        : "/upload"
      try {
        const response = await fetch(
          `${baseURL}/api/v1/config/certificates${suffix}`,
          {
            method: data.profileId ? "PUT" : "POST",
            headers: { Accept: "application/json" },
            body: form,
            signal: AbortSignal.timeout(30000),
          }
        )
        if (!response.ok) {
          const failure = (await response.json()) as ApiErrorResponse
          return { ok: false, message: failure.error.message }
        }
        return {
          ok: true,
          profile: (
            (await response.json()) as ApiSuccess<ConfigurationProfileContract>
          ).data,
        }
      } catch {
        return {
          ok: false,
          message: "The certificate upload could not reach the Rhythm API.",
        }
      }
    }
  )
