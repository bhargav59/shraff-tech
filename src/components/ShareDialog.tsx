import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
} from "react";
import { Check, Copy, FileCode2, Link2, Mail, Send, Sparkles, X } from "lucide-react";
import type { LanguageId } from "../runners/types";
import { createSnippet, sendSnippetEmail } from "../utils/api";
import { encodeStatelessShareHash } from "../utils/shareHash";

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  language: LanguageId;
  title: string;
  code: string;
  stdin: string;
  output: string;
  currentSlug: string | null;
  onSlugCreated: (slug: string, url: string) => void;
}

export function ShareDialog({
  open,
  onClose,
  language,
  title,
  code,
  stdin,
  output,
  currentSlug,
  onSlugCreated,
}: ShareDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const pressedOutsideRef = useRef(false);

  const [shareUrl, setShareUrl] = useState<string>("");
  const [slug, setSlug] = useState<string | null>(currentSlug);
  const [creatingLink, setCreatingLink] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);

  const [email, setEmail] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailFeedback, setEmailFeedback] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [ariaErrorInvalid, setAriaErrorInvalid] = useState(false);
  const [statusAnnouncement, setStatusAnnouncement] = useState("");

  useEffect(() => {
    setSlug(currentSlug);
    if (currentSlug && typeof window !== "undefined") {
      setShareUrl(`${window.location.origin}/s/${currentSlug}`);
    } else {
      setShareUrl("");
    }
  }, [currentSlug]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      setLinkError("");
      setEmailFeedback(null);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleClose = () => {
    const dialog = dialogRef.current;
    if (dialog) {
      dialog.returnValue = "";
    }
    onClose();
  };

  // Fallback light-dismiss for Safari (which lacks <dialog closedby="any">)
  const isOutsideDialogBox = (e: PointerEvent<HTMLDialogElement>, dialog: HTMLDialogElement) => {
    const r = dialog.getBoundingClientRect();
    return (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    );
  };

  const handleCreateLink = async () => {
    setLinkError("");
    setCreatingLink(true);
    try {
      const res = await createSnippet({ language, title, code, stdin });
      setSlug(res.slug);
      const localUrl = `${window.location.origin}/s/${res.slug}`;
      setShareUrl(localUrl);
      onSlugCreated(res.slug, localUrl);
      setStatusAnnouncement("Shareable link created.");
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : "Failed to create share link.");
    } finally {
      setCreatingLink(false);
    }
  };

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setStatusAnnouncement("Snippet URL copied to clipboard.");
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setStatusAnnouncement("Unable to copy URL.");
    }
  };

  const handleCopyStatelessHashUrl = async () => {
    try {
      const hash = await encodeStatelessShareHash({ language, title, code, stdin });
      const url = `${window.location.origin}/${hash}`;
      await navigator.clipboard.writeText(url);
      setCopiedHash(true);
      setStatusAnnouncement("Zero-server compressed hash URL copied.");
      setTimeout(() => setCopiedHash(false), 2200);
    } catch {
      setStatusAnnouncement("Unable to generate stateless URL.");
    }
  };

  const handleCopyMarkdown = async () => {
    const md = [
      `### ${title} (${language})`,
      shareUrl ? `Run in browser: ${shareUrl}` : "",
      "",
      `\`\`\`${language}`,
      code.trimEnd(),
      "```",
    ]
      .filter((line, idx, arr) => !(line === "" && idx === 1 && arr[0] !== ""))
      .join("\n");

    try {
      await navigator.clipboard.writeText(md);
      setCopiedMarkdown(true);
      setStatusAnnouncement("Markdown code block copied.");
      setTimeout(() => setCopiedMarkdown(false), 2200);
    } catch {
      setStatusAnnouncement("Unable to copy Markdown.");
    }
  };

  const syncEmailAriaValidity = (inputEl: HTMLInputElement | null, afterInteraction = false) => {
    if (!inputEl) return;
    const isInvalid = afterInteraction
      ? !inputEl.validity.valid
      : inputEl.matches(":user-invalid");

    if (!CSS.supports("selector(:user-invalid)") && afterInteraction) {
      inputEl.classList.toggle("user-invalid-fallback", isInvalid);
      inputEl.classList.toggle("user-valid-fallback", !isInvalid);
    }

    setAriaErrorInvalid(isInvalid);
    inputEl.setAttribute("aria-invalid", isInvalid ? "true" : "false");
    const ids = ["share-email-hint", ...(isInvalid ? ["share-email-error"] : [])];
    inputEl.setAttribute("aria-describedby", ids.join(" "));
  };

  const handleEmailSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setEmailFeedback(null);

    const inputEl = emailInputRef.current;
    if (inputEl && !inputEl.checkValidity()) {
      syncEmailAriaValidity(inputEl, true);
      inputEl.focus();
      return;
    }

    setSendingEmail(true);
    try {
      const res = await sendSnippetEmail({
        email: email.trim(),
        slug: slug ?? undefined,
        language,
        title,
        code,
        stdin,
        output,
      });

      const localUrl = `${window.location.origin}/s/${res.slug}`;
      setSlug(res.slug);
      setShareUrl(localUrl);
      onSlugCreated(res.slug, localUrl);
      setEmailFeedback({
        kind: "success",
        text: `Sent snippet and link to ${email.trim()} via Resend.`,
      });
      setStatusAnnouncement("Snippet email sent.");
    } catch (err) {
      setEmailFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to send email.",
      });
    } finally {
      setSendingEmail(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: "any" } as Record<string, string>)}
      aria-labelledby="share-dialog-title"
      onClose={handleClose}
      onPointerDown={(e) => {
        if ("closedBy" in HTMLDialogElement.prototype) return;
        const dialog = dialogRef.current;
        if (dialog) pressedOutsideRef.current = isOutsideDialogBox(e, dialog);
      }}
      onPointerUp={(e) => {
        if ("closedBy" in HTMLDialogElement.prototype) return;
        const dialog = dialogRef.current;
        if (dialog && pressedOutsideRef.current && isOutsideDialogBox(e, dialog)) {
          dialog.close();
        }
        pressedOutsideRef.current = false;
      }}
    >
      <div className="p-5 sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 id="share-dialog-title" className="m-0 text-lg font-bold">
              Share &amp; Save Snippet
            </h1>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              Stored in Supabase PostgreSQL &amp; cached 24h on Upstash Redis.
            </p>
          </div>
          <form method="dialog">
            <button
              type="submit"
              value="close"
              aria-label="Close share dialog"
              className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border"
              style={{
                backgroundColor: "var(--bg-elevated)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </form>
        </div>

        {/* Short Slug URL Section */}
        <section
          aria-label="Shareable link"
          className="mb-4 rounded-xl border p-4"
          style={{
            backgroundColor: "var(--bg-elevated)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <div className="mb-2.5 flex items-center gap-2 text-sm font-semibold">
            <Link2 size={15} aria-hidden="true" style={{ color: "var(--accent)" }} />
            <span>Short URL (shraff.tech/s/:slug)</span>
          </div>

          {shareUrl ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                readOnly
                aria-label="Generated snippet URL"
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-lg border px-3 py-2 font-mono text-xs"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-primary)",
                }}
              />
              <button
                type="button"
                onClick={handleCopyLink}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"
                style={{
                  backgroundColor: "var(--accent)",
                  color: "var(--accent-ink)",
                }}
              >
                {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                <span>{copied ? "Copied" : "Copy"}</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              autoFocus
              disabled={creatingLink}
              onClick={handleCreateLink}
              className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold"
              style={{
                backgroundColor: "var(--accent)",
                color: "var(--accent-ink)",
              }}
            >
              <Link2 size={15} aria-hidden="true" />
              <span>{creatingLink ? "Creating 7-char slug..." : "Generate Share Link"}</span>
            </button>
          )}

          {shareUrl && (
            <button
              type="button"
              disabled={creatingLink}
              onClick={handleCreateLink}
              className="mt-2.5 cursor-pointer text-xs font-medium underline"
              style={{ color: "var(--accent)" }}
            >
              {creatingLink ? "Saving new snapshot..." : "Save current edits as a new link"}
            </button>
          )}

          {linkError && (
            <p className="mt-2 text-xs" role="alert" style={{ color: "var(--danger)" }}>
              {linkError}
            </p>
          )}

          {/* Zero-server compressed URL + Markdown copy utilities */}
          <div className="mt-3 flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
            <button
              type="button"
              onClick={handleCopyStatelessHashUrl}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
            >
              {copiedHash ? <Check size={13} aria-hidden="true" /> : <Sparkles size={13} aria-hidden="true" />}
              <span>{copiedHash ? "Copied #hash URL" : "Copy Zero-DB #hash URL"}</span>
            </button>

            <button
              type="button"
              onClick={handleCopyMarkdown}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
            >
              {copiedMarkdown ? <Check size={13} aria-hidden="true" /> : <FileCode2 size={13} aria-hidden="true" />}
              <span>{copiedMarkdown ? "Copied Markdown" : "Copy as Markdown"}</span>
            </button>
          </div>
        </section>

        {/* Optional Email Share Section */}
        <form noValidate onSubmit={handleEmailSubmit}>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Mail size={15} aria-hidden="true" style={{ color: "var(--accent)" }} />
            <label htmlFor="share-email-input">Email formatted snippet (optional)</label>
          </div>
          <span
            id="share-email-hint"
            className="mb-2 block text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            Format: you@example.com — sends code, output, and permanent link from noreply@shraff.tech.
          </span>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <input
                ref={emailInputRef}
                id="share-email-input"
                name="email"
                type="email"
                required
                inputMode="email"
                autoComplete="email"
                value={email}
                aria-invalid={ariaErrorInvalid ? "true" : "false"}
                aria-describedby="share-email-hint"
                data-error="share-email-error"
                placeholder="developer@example.com"
                onBlur={(e) => syncEmailAriaValidity(e.currentTarget, true)}
                onChange={(e) => {
                  setEmail(e.target.value);
                  syncEmailAriaValidity(e.currentTarget, false);
                }}
                onInvalid={(e) => syncEmailAriaValidity(e.currentTarget, true)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{
                  backgroundColor: "var(--bg-elevated)",
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-primary)",
                }}
              />
              <div id="share-email-error" className="field-error-msg">
                <span role="img" aria-label="Error">
                  ⚠
                </span>{" "}
                Enter an email address in the format you@example.com.
              </div>
            </div>

            <button
              type="submit"
              disabled={sendingEmail}
              className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-semibold"
              style={{
                backgroundColor: "var(--bg-elevated)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
            >
              <Send size={14} aria-hidden="true" />
              <span>{sendingEmail ? "Sending..." : "Send"}</span>
            </button>
          </div>

          {emailFeedback && (
            <p
              role={emailFeedback.kind === "error" ? "alert" : "status"}
              className="mt-2.5 text-xs font-medium"
              style={{
                color:
                  emailFeedback.kind === "error" ? "var(--danger)" : "var(--success)",
              }}
            >
              {emailFeedback.text}
            </p>
          )}
        </form>

        <div role="status" className="visually-hidden">
          {statusAnnouncement}
        </div>
      </div>
    </dialog>
  );
}
