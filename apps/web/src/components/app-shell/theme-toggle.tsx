import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Button } from "@workspace/ui/components/button"
import { Moon, Sun, SunMoon } from "lucide-react"

type ThemePreference = "light" | "dark" | "system"

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const preference = (theme as ThemePreference | undefined) ?? "system"
  const nextPreference: ThemePreference =
    preference === "system"
      ? "light"
      : preference === "light"
        ? "dark"
        : "system"
  const label = mounted
    ? nextPreference === "system"
      ? "Follow system color mode"
      : `Use ${nextPreference} mode`
    : "Change color mode"

  return (
    <Button
      aria-label={label}
      onClick={() => setTheme(nextPreference)}
      size="icon"
      title={label}
      type="button"
      variant="ghost"
    >
      {!mounted || preference === "system" ? (
        <SunMoon aria-hidden="true" />
      ) : resolvedTheme === "dark" ? (
        <Sun aria-hidden="true" />
      ) : (
        <Moon aria-hidden="true" />
      )}
    </Button>
  )
}
