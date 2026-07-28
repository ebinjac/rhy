import { useEffect, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Moon, Sun, SunMoon } from "lucide-react"

type Theme = "light" | "dark"
type ThemePreference = Theme | "system"

const storageKey = "rhythm-theme"

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark")
  document.documentElement.style.colorScheme = theme
}

export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>("system")
  const [theme, setTheme] = useState<Theme>("light")
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey)
    const initialPreference: ThemePreference =
      stored === "light" || stored === "dark" ? stored : "system"
    const initialTheme =
      initialPreference === "system" ? systemTheme() : initialPreference
    applyTheme(initialTheme)
    setPreference(initialPreference)
    setTheme(initialTheme)
    setMounted(true)

    if (stored === "light" || stored === "dark") return
    const preference = window.matchMedia("(prefers-color-scheme: dark)")
    const updateFromSystem = () => {
      const next = preference.matches ? "dark" : "light"
      applyTheme(next)
      setTheme(next)
    }
    preference.addEventListener("change", updateFromSystem)
    return () => preference.removeEventListener("change", updateFromSystem)
  }, [])

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

  function toggleTheme() {
    const nextTheme =
      nextPreference === "system" ? systemTheme() : nextPreference
    window.localStorage.setItem(storageKey, nextPreference)
    applyTheme(nextTheme)
    setPreference(nextPreference)
    setTheme(nextTheme)
  }

  return (
    <Button
      aria-label={label}
      onClick={toggleTheme}
      size="icon"
      title={label}
      type="button"
      variant="ghost"
    >
      {!mounted || preference === "system" ? (
        <SunMoon aria-hidden="true" />
      ) : theme === "dark" ? (
        <Sun aria-hidden="true" />
      ) : (
        <Moon aria-hidden="true" />
      )}
    </Button>
  )
}
