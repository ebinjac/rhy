import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const migrationDirectory = resolve(root, 'services/api/db/migrations')
const changelogPath = resolve(root, 'dbscripts/main_changelog.xml')

const files = await readdir(migrationDirectory)
const up = files.filter((name) => name.endsWith('.up.sql')).sort()
const down = new Set(files.filter((name) => name.endsWith('.down.sql')))
const changelog = await readFile(changelogPath, 'utf8')
const referencedUp = [...changelog.matchAll(/path="\$\{migrationRoot\}\/([^"/]+\.up\.sql)"/g)].map(
  (match) => match[1],
)
const referencedDown = [...changelog.matchAll(/path="\$\{migrationRoot\}\/([^"/]+\.down\.sql)"/g)].map(
  (match) => match[1],
)

const failures = []
for (const name of up) {
  const rollback = name.replace(/\.up\.sql$/, '.down.sql')
  if (!down.has(rollback)) failures.push(`${name} has no matching ${rollback}`)
  if (!referencedUp.includes(name)) failures.push(`${name} is missing from the Liquibase changelog`)
  if (!referencedDown.includes(rollback)) failures.push(`${rollback} is missing from the Liquibase rollback`)
}
for (const name of referencedUp) {
  if (!up.includes(name)) failures.push(`Liquibase references missing migration ${name}`)
}
if (new Set(referencedUp).size !== referencedUp.length) {
  failures.push('Liquibase contains duplicate up-migration references')
}

const changeSetIds = [...changelog.matchAll(/<changeSet id="([^"]+)"/g)].map((match) => match[1])
const expectedIds = up.map((name) => name.replace(/\.up\.sql$/, ''))
if (JSON.stringify(changeSetIds) !== JSON.stringify(expectedIds)) {
  failures.push('Liquibase change-set order does not exactly match the embedded Go migration order')
}

if (failures.length > 0) {
  console.error('Migration parity check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Migration parity verified for ${up.length} up/down change sets.`)
