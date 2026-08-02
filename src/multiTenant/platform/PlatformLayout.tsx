import { useEffect, useRef, useState, type ReactNode } from "react";
import { LogOut, Menu, Moon, Sun, X } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { PlatformNavigation } from "./PlatformNavigation";
import { ConfirmDialog } from "./shared/ConfirmDialog";
import { PlatformIconButton } from "./shared/PlatformIconButton";

interface PlatformLayoutProps {
  currentPath: string;
  displayName: string;
  role: string;
  menuOpen: boolean;
  onMenuOpen: () => void;
  onMenuClose: () => void;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  children: ReactNode;
}

export function PlatformLayout({
  currentPath,
  displayName,
  role,
  menuOpen,
  onMenuOpen,
  onMenuClose,
  onNavigate,
  onLogout,
  children,
}: PlatformLayoutProps) {
  const { darkMode, toggleDarkMode } = useTheme();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuCloseRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => menuCloseRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onMenuClose(); return; }
      if (event.key !== "Tab") return;
      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      menuTriggerRef.current?.focus();
    };
  }, [menuOpen, onMenuClose]);
  const navigation = (
    <PlatformNavigation
      currentPath={currentPath}
      role={role}
      onNavigate={onNavigate}
    />
  );
  return (
    <div
      dir="rtl"
      className="min-h-screen bg-slate-50 text-slate-800 dark:bg-slate-950 dark:text-slate-100"
    >
      <aside className="fixed inset-y-0 right-0 z-20 hidden w-64 overflow-y-auto border-l border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:block">
        {navigation}
      </aside>
      <header className="flex min-h-16 items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 lg:mr-64">
        <div className="lg:hidden">
          <PlatformIconButton
            ref={menuTriggerRef}
            onClick={onMenuOpen}
            label="فتح القائمة"
          >
            <Menu size={20} strokeWidth={1.8} />
          </PlatformIconButton>
        </div>
        <div>
          <p className="font-bold">{displayName || "صاحب المنصة"}</p>
          <p className="text-xs text-slate-500">{role}</p>
        </div>
        <div className="flex items-center gap-2">
          <PlatformIconButton
            onClick={toggleDarkMode}
            label={darkMode ? "تفعيل الوضع الفاتح" : "تفعيل الوضع الداكن"}
            title={darkMode ? "الوضع الفاتح" : "الوضع الداكن"}
          >
            {darkMode ? (
              <Sun size={19} strokeWidth={1.8} />
            ) : (
              <Moon size={19} strokeWidth={1.8} />
            )}
          </PlatformIconButton>
          <PlatformIconButton
            onClick={() => setConfirmLogout(true)}
            className="text-rose-700 dark:text-rose-300"
            label="تسجيل الخروج"
            title="تسجيل الخروج"
          >
            <LogOut size={19} strokeWidth={1.8} />
          </PlatformIconButton>
        </div>
      </header>
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-[1px] lg:hidden"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onMenuClose();
          }}
        >
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="قائمة منصة الإدارة"
            className="h-full w-[min(18rem,88vw)] overflow-y-auto bg-white p-4 shadow-2xl dark:bg-slate-900"
          >
            <PlatformIconButton
              ref={menuCloseRef}
              onClick={onMenuClose}
              className="mb-5"
              label="إغلاق القائمة"
            >
              <X size={20} strokeWidth={1.8} />
            </PlatformIconButton>
            {navigation}
          </aside>
        </div>
      )}
      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:mr-64">{children}</main>
      <ConfirmDialog
        open={confirmLogout}
        title="تسجيل الخروج"
        description="هل تريد إنهاء جلسة منصة الإدارة؟"
        confirmLabel="تسجيل الخروج"
        dangerous
        onClose={() => setConfirmLogout(false)}
        onConfirm={() => {
          setConfirmLogout(false);
          onLogout();
        }}
      />
    </div>
  );
}
