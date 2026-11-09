import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
  /**
   * When this changes (for example the route path), a failed boundary clears and renders its children again,
   * so one broken page does not block the others. Giving it also shows the message inside the page instead of
   * filling the whole window, with a Try again button.
   */
  resetKey?: unknown
}

interface State {
  failed: boolean
  resetKey: unknown
}

/** Catches a crash in any screen so the person sees a way forward instead of a blank page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, resetKey: this.props.resetKey }

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (Object.is(props.resetKey, state.resetKey)) return null
    return { failed: false, resetKey: props.resetKey }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('timedesk crashed:', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    const inPage = this.props.resetKey !== undefined
    return (
      <div role="alert" className={inPage ? 'flex flex-col items-center justify-center gap-4 py-16 text-center' : 'flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center'}>
        <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-muted-foreground max-w-md text-sm">
          {inPage
            ? 'This page hit an unexpected problem. Your data is safe. Try again, or open another page.'
            : 'timedesk hit an unexpected problem. Your data is safe on the server. Reloading usually fixes it.'}
        </p>
        <div className="flex gap-2">
          {inPage ? (
            <Button onClick={() => this.setState({ failed: false })}>Try again</Button>
          ) : (
            <Button onClick={() => window.location.reload()}>Reload</Button>
          )}
          <Button variant="outline" onClick={() => window.location.assign('/')}>
            Go to the dashboard
          </Button>
        </div>
      </div>
    )
  }
}
