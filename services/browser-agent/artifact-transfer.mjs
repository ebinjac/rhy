const maximumArtifactBytes = 10 * 1024 * 1024
const maximumInlineBytes = 8 * 1024 * 1024

export function createArtifactUploader(uploadSlots = []) {
  const slots = Array.isArray(uploadSlots) ? uploadSlots : []
  const direct = slots.length > 0
  let nextSlot = 0
  let failures = 0
  let inlineBytes = 0
  return {
    get failures() {
      return failures
    },
    async upload(metadata, bytes) {
      if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0) {
        failures++
        return null
      }
      if (!direct) {
        if (inlineBytes + bytes.byteLength > maximumInlineBytes) {
          failures++
          return null
        }
        inlineBytes += bytes.byteLength
        return {
          ...metadata,
          byteSize: bytes.byteLength,
          contentBase64: bytes.toString("base64"),
        }
      }
      const slot = slots[nextSlot++]
      if (
        !slot?.id ||
        !slot?.url ||
        bytes.byteLength > Number(slot.maxBytes || 0)
      ) {
        failures++
        return null
      }
      try {
        const target = new URL(slot.url)
        if (!["http:", "https:"].includes(target.protocol)) {
          throw new Error("Artifact upload URL is invalid.")
        }
        const response = await fetch(target, {
          method: "PUT",
          headers: {
            "Content-Type": metadata.contentType,
          },
          body: bytes,
          signal: AbortSignal.timeout(30_000),
        })
        if (!response.ok) {
          throw new Error(`Artifact upload returned ${response.status}.`)
        }
        return {
          ...metadata,
          uploadId: slot.id,
          byteSize: bytes.byteLength,
          etag: (response.headers.get("etag") || "").replaceAll('"', ""),
        }
      } catch {
        failures++
        return null
      }
    },
  }
}

export async function downloadArtifact(baseline) {
  const maximumBytes = Math.min(
    Math.max(Number(baseline?.maxBytes || 0), 1),
    maximumArtifactBytes
  )
  if (!baseline?.contentUrl) {
    throw new Error("Approved visual baseline artifact is unavailable.")
  }
  const target = new URL(baseline.contentUrl)
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("Approved visual baseline artifact URL is invalid.")
  }
  const response = await fetch(target, {
    method: "GET",
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    throw new Error("Approved visual baseline artifact could not be loaded.")
  }
  const declaredSize = Number(response.headers.get("content-length") || 0)
  if (declaredSize > maximumBytes) {
    throw new Error("Approved visual baseline artifact exceeds its size limit.")
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.byteLength || bytes.byteLength > maximumBytes) {
    throw new Error("Approved visual baseline artifact is empty or too large.")
  }
  return bytes
}
