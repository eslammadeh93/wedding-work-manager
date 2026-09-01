import React, { Component } from 'react';

interface GlobalSearchErrorBoundaryProps {
  children: React.ReactNode;
  onClose: () => void;
}

interface GlobalSearchErrorBoundaryState {
  hasError: boolean;
}

export class GlobalSearchErrorBoundary extends Component<GlobalSearchErrorBoundaryProps, GlobalSearchErrorBoundaryState> {
  declare props: GlobalSearchErrorBoundaryProps;
  state: GlobalSearchErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): GlobalSearchErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Global Search rendering failed', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/60 px-4 pt-16 backdrop-blur-sm"><div role="alert" dir="rtl" className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-2xl dark:border-slate-800 dark:bg-slate-900"><p className="font-bold text-slate-900 dark:text-white">تعذر عرض البحث العام.</p><p className="mt-2 text-sm text-slate-500">أغلق نافذة البحث ثم حاول مرة أخرى.</p><button type="button" onClick={this.props.onClose} className="mt-4 rounded-xl bg-amber-500 px-4 py-2 font-bold text-slate-950">إغلاق</button></div></div>;
  }
}
