import { useEffect, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Moon, Sun, SunMoon } from "lucide-react"

type Theme = "light" | "dark"

const storageKey = "rhythm-theme"

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark")
  document.documentElement.style.colorScheme = theme
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light")
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey)
    const initial = stored === "light" || stored === "dark" ? stored : systemTheme()
    applyTheme(initial)
    setTheme(initial)
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

  const nextTheme: Theme = theme === "dark" ? "light" : "dark"
  const label = mounted ? `Switch to ${nextTheme} mode` : "Toggle color mode"

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark"
    window.localStorage.setItem(storageKey, next)
    applyTheme(next)
    setTheme(next)
  }

  return (
    <Button
      aria-label={label}
      aria-pressed={mounted && theme === "dark"}
      onClick={toggleTheme}
      size="icon"
      title={label}
      type="button"
      variant="ghost"
    >
      {!mounted ? <SunMoon aria-hidden="true" /> : theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  )
}
