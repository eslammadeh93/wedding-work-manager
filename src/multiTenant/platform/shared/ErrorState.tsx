import { CircleAlert } from "lucide-react";
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="rounded-2xl bg-rose-50 p-5 text-rose-800 dark:bg-rose-950 dark:text-rose-100"
      role="alert"
    >
      <CircleAlert className="mb-2" />
      {message}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mr-3 font-bold underline"
        >
          إعادة المحاولة
        </button>
      )}
    </div>
  );
}
