import { useEffect, useState } from "react"
import { Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { Check, ChevronRight, Circle, X } from "lucide-react"

const dismissalKey = "rhythm-onboarding-dismissed"

export type OnboardingStep = {
  id: string
  label: string
  description: string
  complete: boolean
  to:
    | "/"
    | "/applications"
    | "/monitors"
    | "/monitors/new"
    | "/elf"
    | "/elf/settings"
    | "/suites"
    | "/configuration"
}

export function OnboardingChecklist({ steps }: { steps: OnboardingStep[] }) {
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    setDismissed(window.localStorage.getItem(dismissalKey) === "true")
  }, [])

  const completed = steps.filter((step) => step.complete).length
  if (dismissed || completed === steps.length) return null

  function dismiss() {
    window.localStorage.setItem(dismissalKey, "true")
    setDismissed(true)
  }

  return (
    <section
      aria-labelledby="getting-started-heading"
      className="mt-6 border-y py-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="getting-started-heading" className="text-lg font-semibold">
            Get Rhythm operational
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {completed} of {steps.length} setup tasks complete. Completion is
            derived from your workspace—not a manual checkbox.
          </p>
        </div>
        <Button
          aria-label="Dismiss getting started checklist"
          onClick={dismiss}
          size="icon"
          variant="ghost"
        >
          <X />
        </Button>
      </div>
      <ol className="mt-4 grid gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-2 xl:grid-cols-3">
        {steps.map((step) => (
          <li className="bg-background" key={step.id}>
            <Link
              className="flex min-h-20 items-start gap-3 p-4 transition-colors hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
              to={step.to}
            >
              {step.complete ? (
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-success-soft text-success-foreground">
                  <Check aria-hidden="true" className="size-3.5" />
                  <span className="sr-only">Complete</span>
                </span>
              ) : (
                <Circle
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{step.label}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  {step.description}
                </span>
              </span>
              <ChevronRight
                aria-hidden="true"
                className="mt-0.5 size-4 text-muted-foreground"
              />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
