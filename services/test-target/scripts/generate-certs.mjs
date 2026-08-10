#!/usr/bin/env node
import { mkdirSync, existsSync, writeFileSync, unlinkSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const certDir = join(__dirname, "..", "certs")
mkdirSync(certDir, { recursive: true })

const caKey = join(certDir, "ca-key.pem")
const caCert = join(certDir, "ca.pem")
const serverKey = join(certDir, "server-key.pem")
const serverCert = join(certDir, "server.pem")
const serverCsr = join(certDir, "server.csr")
const clientKey = join(certDir, "client-key.pem")
const clientCert = join(certDir, "client.pem")
const clientCsr = join(certDir, "client.csr")
const extFile = join(certDir, "ext.cnf")

const openssl = (args) =>
  execFileSync("openssl", args, { stdio: ["ignore", "pipe", "pipe"] })

writeFileSync(
  extFile,
  `subjectAltName=DNS:localhost,DNS:test-target,DNS:host.docker.internal,IP:127.0.0.1
extendedKeyUsage=serverAuth
`
)

console.log("[certs] generating CA…")
openssl([
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  caKey,
  "-out",
  caCert,
  "-days",
  "3650",
  "-subj",
  "/CN=Rhythm Test CA",
])

console.log("[certs] generating server cert…")
openssl([
  "req",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  serverKey,
  "-out",
  serverCsr,
  "-subj",
  "/CN=test-target",
])
openssl([
  "x509",
  "-req",
  "-in",
  serverCsr,
  "-CA",
  caCert,
  "-CAkey",
  caKey,
  "-CAcreateserial",
  "-out",
  serverCert,
  "-days",
  "3650",
  "-extfile",
  extFile,
])

writeFileSync(
  extFile,
  `extendedKeyUsage=clientAuth
`
)

console.log("[certs] generating client cert…")
openssl([
  "req",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  clientKey,
  "-out",
  clientCsr,
  "-subj",
  "/CN=rhythm-test-client",
])
openssl([
  "x509",
  "-req",
  "-in",
  clientCsr,
  "-CA",
  caCert,
  "-CAkey",
  caKey,
  "-CAcreateserial",
  "-out",
  clientCert,
  "-days",
  "3650",
  "-extfile",
  extFile,
])

for (const temp of [serverCsr, clientCsr, extFile, join(certDir, "ca.srl")]) {
  if (existsSync(temp)) unlinkSync(temp)
}

console.log(`[certs] wrote PEMs to ${certDir}`)
console.log("  ca.pem, server.pem, server-key.pem, client.pem, client-key.pem")
