import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/** Last line of defence: a render error shows a reset panel, never a blank page. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('AeroTwin render error', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-8 font-mono text-txt">
        <div className="w-full max-w-md border border-edge border-l-2 border-l-red bg-panel p-6">
          <div className="text-[16px] uppercase leading-6 tracking-[0.14em] text-red">
            Something went wrong - reset
          </div>
          <p className="mt-3 font-sans text-base leading-5 text-dim">
            The console hit an unexpected error and stopped this view. Reset reloads the app at
            the brief.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="primary mt-6 w-full px-4 py-2 text-base"
          >
            RESET
          </button>
        </div>
      </div>
    );
  }
}
