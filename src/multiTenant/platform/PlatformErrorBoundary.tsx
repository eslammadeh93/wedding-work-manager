import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State { hasError: boolean; }

/** Isolated boundary so a platform rendering error cannot affect the legacy app. */
export class PlatformErrorBoundary extends Component<{ children: ReactNode }, State> {
  declare props: { children: ReactNode };
  state: State = { hasError: false };
  static getDerivedStateFromError(): State { return { hasError: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Logging can be added by platform observability later. */ }
  render() {
    if (this.state.hasError) return <div dir="rtl" className="min-h-screen flex items-center justify-center p-6 text-center text-slate-600">تعذر عرض لوحة المنصة. يرجى إعادة تحميل الصفحة.</div>;
    return this.props.children;
  }
}
