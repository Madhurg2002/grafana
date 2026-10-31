import { useState, type FormEvent } from "react";
import { LogIn, UserPlus, Radio } from "lucide-react";
import { motion } from "framer-motion";
import { login, signup, type AuthResponse } from "../lib/api";
import { useAuth } from "../hooks/useAuth";

export type AuthMode = "login" | "signup";

const inputClass = "field";

export function AuthForm({ initialMode = "login" }: { initialMode?: AuthMode }): JSX.Element {
  const { applyAuth } = useAuth();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response: AuthResponse =
        mode === "signup"
          ? await signup(email.trim(), password, displayName.trim() || undefined)
          : await login(email.trim(), password);
      applyAuth(response.token, response.user);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Authentication failed";
      // Friendlier copy for the common cases; keep backend detail otherwise.
      if (mode === "signup" && /already exists/i.test(raw)) {
        setError(`An account with this email already exists — sign in instead`);
      } else if (mode === "signup" && /failed to fetch/i.test(raw)) {
        setError("Can't reach the server — check your connection and try again");
      } else if (mode === "login" && /invalid email or password/i.test(raw)) {
        setError("Invalid email or password");
      } else if (/failed to fetch/i.test(raw)) {
        setError("Can't reach the server — check your connection and try again");
      } else {
        setError(raw);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card w-full max-w-md p-6"
      data-testid="auth-form"
    >
      <div className="flex items-center gap-2">
        <Radio className="h-4 w-4 text-[#5eead4]" aria-hidden />
        <h2 className="eyebrow text-[#c3cad8]">
          {mode === "signup" ? "Create your account" : "Sign in"}
        </h2>
      </div>

      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        {mode === "signup" ? (
          <div>
            <label htmlFor="displayName" className="field-label">
              Display name <span className="normal-case tracking-normal text-[#5f6779]">(optional)</span>
            </label>
            <input
              id="displayName"
              className={inputClass}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Madhur"
              autoComplete="name"
            />
          </div>
        ) : null}
        <div>
          <label htmlFor="email" className="field-label">
            Email
          </label>
          <input
            id="email"
            type="email"
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </div>
        <div>
          <label htmlFor="password" className="field-label">
            Password
          </label>
          <input
            id="password"
            type="password"
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? "at least 8 characters" : "••••••••"}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            minLength={mode === "signup" ? 8 : 1}
            required
          />
        </div>

        {error !== null ? (
          <div role="alert" className="rounded-lg border border-[#fb7185]/40 bg-[#fb7185]/10 px-3 py-2 text-xs text-[#fda4af]">
            <p>{error}</p>
            {mode === "signup" && /already exists/i.test(error) ? (
              <button
                type="button"
                title="Switch to the sign-in form"
                className="mt-1 font-semibold text-[#7df0dc] hover:text-[#5eead4]"
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
              >
                Switch to sign in →
              </button>
            ) : null}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          title={mode === "signup" ? "Create your free account" : "Sign in with your email and password"}
          className="btn btn-primary w-full gap-2 px-4 py-2.5 text-sm"
        >
          {mode === "signup" ? <UserPlus className="h-4 w-4" aria-hidden /> : <LogIn className="h-4 w-4" aria-hidden />}
          {submitting ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>

        {mode === "login" ? (
          <p className="text-center">
            <a
              href="/reset"
              title="Start password recovery — we email you a reset link"
              className="text-[11px] text-[#8d95a8] transition hover:text-[#7df0dc]"
            >
              Forgot password?
            </a>
          </p>
        ) : null}
      </form>

      <p className="mt-4 text-center text-xs text-[#8d95a8]">
        {mode === "signup" ? "Already have an account?" : "New here?"}{" "}
        <button
          type="button"
          title={mode === "signup" ? "Switch to the sign-in form" : "Switch to the sign-up form"}
          className="font-semibold text-[#7df0dc] hover:text-[#5eead4]"
          onClick={() => {
            setMode(mode === "signup" ? "login" : "signup");
            setError(null);
          }}
        >
          {mode === "signup" ? "Sign in" : "Create an account"}
        </button>
      </p>

      <p className="mt-6 text-center text-[11px] leading-relaxed text-[#5f6779]">
        By continuing you agree to our{" "}
        <a href="/terms" className="underline-offset-2 hover:text-[#c3cad8] hover:underline">
          Terms of Service
        </a>{" "}
        and acknowledge our{" "}
        <a href="/privacy" className="underline-offset-2 hover:text-[#c3cad8] hover:underline">
          Privacy Policy
        </a>.
      </p>
    </motion.div>
  );
}
