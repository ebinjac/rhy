import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Switch } from "@workspace/ui/components/switch"

import { InfoHint } from "@/components/info-hint"
import { FormField } from "@/features/applications/form-field"

export type SaharaFormValue = {
  saharaEnabled: boolean
  saharaAssignmentGroup: string
  saharaReporterGroup: string
  saharaEnvironmentAffected: string
  saharaDefaultSeverity: string
}

export const emptySaharaForm: SaharaFormValue = {
  saharaEnabled: false,
  saharaAssignmentGroup: "",
  saharaReporterGroup: "",
  saharaEnvironmentAffected: "",
  saharaDefaultSeverity: "",
}

export function SaharaSettingsFields({
  value,
  onChange,
}: {
  value: SaharaFormValue
  onChange: (value: SaharaFormValue) => void
}) {
  return (
    <div className="md:col-span-2 lg:col-span-3 space-y-4">
      <div className="flex items-start justify-between gap-4 rounded-lg bg-muted/30 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <Label htmlFor="sahara-enabled">Sahara incident dispatch</Label>
            <InfoHint title="Sahara incident dispatch">
              When linked monitors fail, Rhythm opens a Sahara incident for this
              application&apos;s support group. Assignment group is required
              while dispatch is on.
            </InfoHint>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Opens a Sahara incident when linked monitors fail.
          </p>
        </div>
        <Switch
          checked={value.saharaEnabled}
          id="sahara-enabled"
          onCheckedChange={(checked) =>
            onChange({ ...value, saharaEnabled: Boolean(checked) })
          }
        />
      </div>
      {value.saharaEnabled ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <FormField
            label="Sahara assignment group"
            info="Required. Sahara routes the incident to this ticketing assignment / support group."
          >
            <Input
              aria-label="Sahara assignment group"
              className="font-mono"
              value={value.saharaAssignmentGroup}
              onChange={(event) =>
                onChange({
                  ...value,
                  saharaAssignmentGroup: event.target.value,
                })
              }
              placeholder="DP_KMS_VRS_TKS_Support"
            />
          </FormField>
          <FormField
            label="Reporter group"
            info="Optional. Sahara records this group as the reporter. Defaults to the assignment group."
          >
            <Input
              aria-label="Sahara reporter group"
              className="font-mono"
              value={value.saharaReporterGroup}
              onChange={(event) =>
                onChange({
                  ...value,
                  saharaReporterGroup: event.target.value,
                })
              }
              placeholder="Same as assignment group"
            />
          </FormField>
          <FormField
            label="Environment affected"
            info="Optional environment label sent on the Sahara ticket, such as E3. Helps routing when one application spans multiple environments."
          >
            <Input
              aria-label="Sahara environment affected"
              value={value.saharaEnvironmentAffected}
              onChange={(event) =>
                onChange({
                  ...value,
                  saharaEnvironmentAffected: event.target.value,
                })
              }
              placeholder="E3"
            />
          </FormField>
          <FormField
            label="Default ticket severity"
            info="Optional Sahara ticketing.severity. Leave as derive-from-alert to use the monitor alert severity instead."
          >
            <Select
              onValueChange={(next) =>
                onChange({
                  ...value,
                  saharaDefaultSeverity: next === "NONE" ? "" : (next ?? ""),
                })
              }
              value={value.saharaDefaultSeverity || "NONE"}
            >
              <SelectTrigger aria-label="Default Sahara ticket severity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">Derive from alert</SelectItem>
                <SelectItem value="Sev1">Sev1</SelectItem>
                <SelectItem value="Sev2">Sev2</SelectItem>
                <SelectItem value="Sev3">Sev3</SelectItem>
                <SelectItem value="Sev4">Sev4</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        </div>
      ) : null}
    </div>
  )
}
