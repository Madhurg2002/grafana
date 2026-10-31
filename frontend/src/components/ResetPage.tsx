import { useState, type FormEvent } from "react";
import { KeyRound, Radio } from "lucide-react";
import { motion } from "framer-motion";
import {
  requestPasswordReset,
  resetPassword,
  type AuthResponse,
} from "../lib/api";
import { useAuth } from "../hooks/useAuth";

const inputClass = "field";

/**
 * /reset — forgot-password flow, two modes in one page:
 *  - no token in the URL: request a reset link by email;
 *  - `?token=…` in the URL (from the email link): choose a new password.
 */
export function ResetPage(): JSX.Element {
  const { applyAuth } = useAuth();
  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);

  async function handleRequest(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await requestPasswordReset(email.trim());
      setSentTo(email.trim());
      setDevLink(result.devResetUrl ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReset(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response: AuthResponse = await resetPassword(token, password);
      applyAuth(response.token, response.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#5eead4]/30 bg-[#5eead4]/10 text-[#5eead4]">
          <Radio className="h-4 w-4" aria-hidden />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Passthrough</h1>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card w-full max-w-md p-6"
        data-testid="reset-form"
      >
        {token !== "" ? (
          <>
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-[#5eead4]" aria-hidden />
              <h2 className="eyebrow text-[#c3cad8]">
                Choose a new password
              </h2>
            </div>
            <form
              className="mt-5 space-y-4"
              onSubmit={(event) => {
                void handleReset(event);
              }}
            >
              <div>
                <label htmlFor="new-password" className="field-label">
                  New password
                </label>
                <input
                  id="new-password"
                  type="password"
                  className={inputClass}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="at least 8 characters"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
              {error !== null ? (
                <div role="alert" className="rounded-lg border border-[#fb7185]/40 bg-[#fb7185]/10 px-3 py-2 text-xs text-[#fda4af]">
                  {error}
                </div>
              ) : null}
              <button
                type="submit"
                disabled={submitting}
                title="Set the new password and sign in"
                className="btn btn-primary w-full gap-2 px-4 py-2.5 text-sm"
              >
                <KeyRound className="h-4 w-4" aria-hidden />
                {submitting ? "Saving…" : "Set new password"}
              </button>
            </form>
          </>
        ) : sentTo !== null ? (
          <div className="space-y-3" data-testid="reset-requested">
            <h2 className="eyebrow text-[#c3cad8]">
              Check your inbox
            </h2>
            <p className="text-sm leading-relaxed text-[#8d95a8]">
              If an account exists for <span className="text-[#e6e9f0]">{sentTo}</span>,
              a reset link is on its way. It expires in 30 minutes.
            </p>
            {devLink !== null ? (
              <p className="rounded-lg border border-[#fbbf24]/30 bg-[#fbbf24]/10 px-3 py-2 text-xs leading-relaxed text-[#fcd34d]">
                Email sending isn't configured yet — use this link to reset now:{" "}
                <a
                  className="break-all font-semibold text-amber-200 underline underline-offset-2"
                  data-testid="dev-reset-link"
                  href={devLink}
                >
                  {devLink}
                </a>
              </p>
            ) : null}
            <a href="/login" className="block text-xs text-[#8d95a8] transition hover:text-[#7df0dc]">
              ← Back to sign in
            </a>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-[#5eead4]" aria-hidden />
              <h2 className="eyebrow text-[#c3cad8]">
                Reset your password
              </h2>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[#8d95a8]">
              Enter your account email and we'll send a link to set a new password.
            </p>
            <form
              className="mt-5 space-y-4"
              onSubmit={(event) => {
                void handleRequest(event);
              }}
            >
              <div>
                <label htmlFor="reset-email" className="field-label">
                  Email
                </label>
                <input
                  id="reset-email"
                  type="email"
                  className={inputClass}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </div>
              {error !== null ? (
                <div role="alert" className="rounded-lg border border-[#fb7185]/40 bg-[#fb7185]/10 px-3 py-2 text-xs text-[#fda4af]">
                  {error}
                </div>
              ) : null}
              <button
                type="submit"
                disabled={submitting}
                title="Send a password-reset link to this email"
                className="btn btn-primary w-full gap-2 px-4 py-2.5 text-sm"
              >
                <KeyRound className="h-4 w-4" aria-hidden />
                {submitting ? "Sending…" : "Send reset link"}
              </button>
            </form>
            <p className="mt-4 text-center text-xs text-[#8d95a8]">
              Remembered it?{" "}
              <a href="/login" className="font-semibold text-[#7df0dc] hover:text-[#5eead4]">
                Back to sign in
              </a>
            </p>
          </>
        )}
      </motion.div>

      <p className="text-center text-[11px] text-[#5f6779]">
        <a href="/terms" className="underline-offset-2 hover:text-[#c3cad8] hover:underline">Terms of Service</a>
        <span className="mx-2">·</span>
        <a href="/privacy" className="underline-offset-2 hover:text-[#c3cad8] hover:underline">Privacy Policy</a>
      </p>
    </div>
  );
}
