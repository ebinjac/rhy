import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const root = process.cwd()
const services = [
  { name: "rhythm-frontdoor", role: "frontdoor", workflow: "deploy-rhythm-frontdoor.yml" },
  { name: "rhythm-control", role: "control", workflow: "deploy-rhythm-control.yml" },
  { name: "rhythm-api-executor", role: "api-executor", workflow: "deploy-rhythm-api-executor.yml" },
  { name: "rhythm-browser-executor", role: "browser-executor", workflow: "deploy-rhythm-browser-executor.yml" },
]
const environments = ["e1", "e2", "e3_ipc1", "e3_ipc2"]
const failures = []

if (existsSync(join(root, "deploy/hydra/Dockerfile"))) {
  failures.push("deploy/hydra/Dockerfile must not exist; each Hydra service owns its Dockerfile")
}

for (const service of services) {
  const directory = join(root, "deploy/hydra/services", service.name)
  const dockerfilePath = join(directory, "Dockerfile")
  const manifestPath = join(directory, "hydra-service.yaml")
  const vaultPath = join(directory, "vault/secrets.example")
  const workflowPath = join(root, ".github/workflows", service.workflow)
  for (const path of [dockerfilePath, manifestPath, vaultPath, workflowPath]) {
    if (!existsSync(path)) failures.push(`missing Hydra service artifact: ${path.slice(root.length + 1)}`)
  }
  if (!existsSync(dockerfilePath)) continue
  const dockerfile = readFileSync(dockerfilePath, "utf8")
  if (!dockerfile.includes(`RHYTHM_SERVICE_ROLE=${service.role}`)) {
    failures.push(`${service.name} Dockerfile does not set its exclusive service role`)
  }
  if (!/^EXPOSE 8080$/m.test(dockerfile) || /^EXPOSE (?!8080$)/m.test(dockerfile)) {
    failures.push(`${service.name} must expose only port 8080`)
  }
  for (const line of dockerfile.split(/\r?\n/).filter((value) => value.startsWith("ARG HYDRA_"))) {
    if (!line.includes("artifactory.aexp.com/paas-registry/buildpacks/")) {
      failures.push(`${service.name} has a non-Hydra default buildpack: ${line}`)
    }
  }
  if (service.name === "rhythm-browser-executor" && !dockerfile.includes("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1")) {
    failures.push("browser executor must use the buildpack Chromium and skip Playwright's public browser download")
  }
  const vault = readFileSync(vaultPath, "utf8")
  if (!vault.includes("/opt/epaas/vault/secrets/secrets")) {
    failures.push(`${service.name} Vault inventory does not document the Hydra mount`)
  }
  if (/=(?!<)[^\s#]+/m.test(vault)) {
    failures.push(`${service.name} Vault example contains a non-placeholder value`)
  }
  for (const environment of environments) {
    const valuesPath = join(directory, "helm", `values_${environment}.yaml`)
    if (!existsSync(valuesPath)) {
      failures.push(`${service.name} is missing values_${environment}.yaml`)
      continue
    }
    const values = readFileSync(valuesPath, "utf8")
    if (!values.includes("automaticFailover: true")) {
      failures.push(`${service.name} values_${environment}.yaml must enable global service failover`)
    }
    if (!values.includes("path: /health") || !values.includes("port: 8080")) {
      failures.push(`${service.name} values_${environment}.yaml must probe /health on 8080`)
    }
    if (values.includes("http://rhythm-browser-executor:8080")) {
      failures.push(`${service.name} values_${environment}.yaml uses a non-Hydra service address`)
    }
  }
}

const catalog = readFileSync(join(root, "deploy/hydra/service-catalog.yaml"), "utf8")
for (const service of services) {
  if (!catalog.includes(`deploy/hydra/services/${service.name}/Dockerfile`)) {
    failures.push(`service catalog does not reference ${service.name}'s Dockerfile`)
  }
  if (!catalog.includes(`.github/workflows/${service.workflow}`)) {
    failures.push(`service catalog does not reference ${service.name}'s workflow`)
  }
}

const sharedWorkflowPath = join(root, ".github/workflows/_hydra-service-contract.yml")
const databaseWorkflowPath = join(root, ".github/workflows/deploy-rhythm-database.yml")
for (const path of [sharedWorkflowPath, databaseWorkflowPath]) {
  if (!existsSync(path)) failures.push(`missing Hydra workflow artifact: ${path.slice(root.length + 1)}`)
}
if (existsSync(sharedWorkflowPath)) {
  const workflow = readFileSync(sharedWorkflowPath, "utf8")
  if (!workflow.includes("deployment-action-required") || !workflow.includes("Prevent a false successful deployment")) {
    failures.push("Hydra workflow must fail deployment operations until the approved internal deployment action is bound")
  }
}
if (!catalog.includes(".github/workflows/deploy-rhythm-database.yml")) {
  failures.push("service catalog does not reference the independent database workflow")
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"))
  process.exit(1)
}

console.log("Hydra deployment contract verified for four independently onboarded services.")
