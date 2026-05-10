import Link from "next/link";

const COPY =
  "Chronicle organizes your records for conversations with your doctor. Not medical advice. Severity reflects suggested discussion priority, not clinical urgency.";

export function DisclaimerFooter({ showEvalLink = true }: { showEvalLink?: boolean }) {
  return (
    <footer className="border-t border-line bg-base">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-2 px-6 py-5 text-center text-[13px] leading-relaxed text-ink-muted sm:flex-row sm:justify-between sm:text-left">
        <p className="max-w-3xl">{COPY}</p>
        {showEvalLink ? (
          <Link
            href="/eval"
            className="shrink-0 underline-offset-4 hover:underline text-accent-teal"
          >
            View evaluation metrics
          </Link>
        ) : null}
      </div>
    </footer>
  );
}
