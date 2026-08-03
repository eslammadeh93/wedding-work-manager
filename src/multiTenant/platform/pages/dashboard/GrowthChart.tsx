import { useEffect, useMemo, useState } from "react";
import { PlatformSection } from "../../shared/PlatformSection";
import type { DashboardSeriesPoint } from "./dashboardTypes";

type Viewport = "mobile" | "tablet" | "desktop";

const viewportLimits: Record<Viewport, { points: number; labels: number }> = {
  mobile: { points: 12, labels: 6 },
  tablet: { points: 18, labels: 9 },
  desktop: { points: 24, labels: 12 },
};

function getViewport(): Viewport {
  if (typeof window === "undefined") return "desktop";
  if (window.matchMedia("(max-width: 639px)").matches) return "mobile";
  if (window.matchMedia("(max-width: 1023px)").matches) return "tablet";
  return "desktop";
}

function useViewport() {
  const [viewport, setViewport] = useState<Viewport>(getViewport);

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 639px)");
    const tablet = window.matchMedia("(min-width: 640px) and (max-width: 1023px)");
    const update = () => setViewport(mobile.matches ? "mobile" : tablet.matches ? "tablet" : "desktop");
    mobile.addEventListener("change", update);
    tablet.addEventListener("change", update);
    return () => {
      mobile.removeEventListener("change", update);
      tablet.removeEventListener("change", update);
    };
  }, []);

  return viewport;
}

function formatMonth(month: string) {
  const match = /^(\d{4})-(\d{2})/.exec(month);
  return match ? `${match[2]}/${match[1].slice(2)}` : month.slice(0, 7);
}

function getAxisMax(maxValue: number) {
  if (maxValue <= 0) return 4;
  const roughStep = maxValue / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step = Math.max(1, Math.ceil(roughStep / magnitude) * magnitude);
  return step * 4;
}

export function GrowthChart({ title, points }: { title: string; points: DashboardSeriesPoint[] }) {
  const viewport = useViewport();
  const limits = viewportLimits[viewport];
  const visiblePoints = useMemo(
    () => points
      .map((point) => ({ ...point, value: Number.isFinite(point.value) ? Math.max(0, point.value) : 0 }))
      .sort((a, b) => a.month.localeCompare(b.month, "en"))
      .slice(-limits.points),
    [limits.points, points],
  );
  const maxValue = Math.max(0, ...visiblePoints.map((point) => point.value));
  const axisMax = getAxisMax(maxValue);
  const ticks = Array.from({ length: 5 }, (_, index) => (axisMax / 4) * index).reverse();
  const labelStep = Math.max(1, Math.ceil(visiblePoints.length / limits.labels));

  return (
    <PlatformSection className="min-w-0 max-w-full overflow-hidden !p-3 sm:!p-4 lg:!p-5">
      <h2 className="mb-2 font-black sm:mb-3">{title}</h2>
      {!visiblePoints.length ? (
        <div className="flex h-60 items-center justify-center text-sm text-slate-500 sm:h-64 lg:h-72">
          لا توجد بيانات كافية للرسم حاليًا.
        </div>
      ) : (
        <div
          className="h-60 w-full max-w-full overflow-hidden sm:h-64 lg:h-72"
          dir="ltr"
          role="img"
          aria-label={title}
        >
          <div className="flex h-full min-w-0 gap-1.5 sm:gap-2.5">
            <div className="relative mb-7 w-9 shrink-0 text-[10px] tabular-nums text-slate-500 sm:w-10 sm:text-[11px]">
              {ticks.map((tick, index) => (
                <span
                  key={`${tick}-${index}`}
                  className="absolute right-0 -translate-y-1/2"
                  style={{ top: `${index * 25}%` }}
                >
                  {Math.round(tick).toLocaleString("ar-EG")}
                </span>
              ))}
            </div>

            <div className="relative min-w-0 flex-1">
              <div className="absolute inset-x-0 bottom-7 top-0" aria-hidden="true">
                {ticks.map((tick, index) => (
                  <div
                    key={`${tick}-${index}`}
                    className="absolute inset-x-0 border-t border-slate-200/70 dark:border-slate-700/60"
                    style={{ top: `${index * 25}%` }}
                  />
                ))}
              </div>

              <div className="absolute inset-x-0 bottom-7 top-0 flex min-w-0 items-end justify-around gap-1 sm:gap-1.5 lg:gap-2">
                {visiblePoints.map((point, index) => {
                  const height = point.value === 0 ? 0 : Math.max(2, (point.value / axisMax) * 100);
                  const showLabel = index % labelStep === 0 || index === visiblePoints.length - 1;
                  return (
                    <div key={`${point.month}-${index}`} className="group relative flex h-full min-w-0 flex-1 items-end justify-center">
                      <button
                        type="button"
                        className="relative z-10 w-full max-w-10 rounded-t-md bg-amber-600/75 outline-none transition-colors hover:bg-amber-600 focus-visible:ring-2 focus-visible:ring-amber-500 dark:bg-amber-400/70 dark:hover:bg-amber-400 sm:max-w-12"
                        style={{ height: `${height}%`, minHeight: point.value === 0 ? 2 : undefined }}
                        aria-label={`${point.month}: ${Math.round(point.value).toLocaleString("ar-EG")}`}
                      >
                        <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[10px] font-bold text-white shadow-lg group-hover:block group-focus-within:block dark:bg-slate-100 dark:text-slate-900">
                          {formatMonth(point.month)} · {Math.round(point.value).toLocaleString("ar-EG")}
                        </span>
                      </button>
                      {showLabel && (
                        <span className="absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap text-[9px] tabular-nums text-slate-500 sm:text-[10px]">
                          {formatMonth(point.month)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </PlatformSection>
  );
}
