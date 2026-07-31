import assert from "node:assert/strict"
import http from "node:http"
import test from "node:test"

import {
  createArtifactUploader,
  downloadArtifact,
} from "../artifact-transfer.mjs"

async function withServer(handler, run) {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const address = server.address()
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test("direct uploads return only bounded object metadata", async () => {
  const body = Buffer.from("masked screenshot")
  await withServer(
    async (request, response) => {
      assert.equal(request.method, "PUT")
      assert.equal(request.headers["content-type"], "image/png")
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      assert.deepEqual(Buffer.concat(chunks), body)
      response.setHeader("ETag", '"safe-etag"')
      response.end()
    },
    async (baseURL) => {
      const uploader = createArtifactUploader([
        { id: "artifact-1", url: `${baseURL}/upload`, maxBytes: 1024 },
      ])
      const result = await uploader.upload(
        { kind: "SUCCESS_SCREENSHOT", contentType: "image/png", masked: true },
        body
      )
      assert.deepEqual(result, {
        kind: "SUCCESS_SCREENSHOT",
        contentType: "image/png",
        masked: true,
        uploadId: "artifact-1",
        byteSize: body.length,
        etag: "safe-etag",
      })
      assert.equal("contentBase64" in result, false)
      assert.equal(uploader.failures, 0)
    }
  )
})

test("preview fallback remains bounded and inline", async () => {
  const uploader = createArtifactUploader()
  const result = await uploader.upload(
    { kind: "SUCCESS_SCREENSHOT", contentType: "image/png", masked: true },
    Buffer.from("preview")
  )
  assert.equal(result.contentBase64, Buffer.from("preview").toString("base64"))
  assert.equal(result.byteSize, 7)
  assert.equal(uploader.failures, 0)
})

test("upload slots reject bodies above their declared limit", async () => {
  const uploader = createArtifactUploader([
    { id: "artifact-1", url: "http://127.0.0.1/unreached", maxBytes: 2 },
  ])
  assert.equal(
    await uploader.upload(
      { kind: "VISUAL_DIFF", contentType: "image/png", masked: true },
      Buffer.from("large")
    ),
    null
  )
  assert.equal(uploader.failures, 1)
})

test("baseline downloads enforce the signed artifact size limit", async () => {
  await withServer(
    (_request, response) => {
      response.setHeader("Content-Length", "5")
      response.end("12345")
    },
    async (baseURL) => {
      await assert.rejects(
        downloadArtifact({ contentUrl: `${baseURL}/baseline`, maxBytes: 4 }),
        /exceeds its size limit/
      )
    }
  )
})
