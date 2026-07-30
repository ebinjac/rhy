import { Component } from "react"
import type { ErrorInfo, ReactNode } from "react"
import { Button } from "@workspace/ui/components/button"
import { CircleAlert, RefreshCw } from "lucide-react"

type Props = {
  children: ReactNode
}

type State = {
  error: Error | null
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Rhythm render error", error, info.componentStack)
  }

  private reset = () => {
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) {
      return this.props.children
    }

    return (
      <main className="mx-auto max-w-2xl px-4 py-16 md:px-6">
        <CircleAlert aria-hidden="true" className="size-7 text-destructive" />
        <h1 className="mt-4 text-2xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Rhythm hit an unexpected rendering error. Your data was not changed.
          Try again, or reload the page.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={this.reset} type="button">
            <RefreshCw data-icon="inline-start" />
            Try again
          </Button>
          <Button
            onClick={() => window.location.assign("/")}
            type="button"
            variant="outline"
          >
            Back to overview
          </Button>
        </div>
      </main>
    )
  }
}
