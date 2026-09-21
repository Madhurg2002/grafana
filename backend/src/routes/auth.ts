import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../services/passwords.js";
import {
  createUser,
  findUserByEmail,
  ensureOwnedTenant,
  findUserById,
  createPasswordResetToken,
  consumePasswordResetToken,
  updatePasswordHash,
} from "../db/users.js";
import { issueUserToken, requireUser } from "../middleware/auth.js";
import { authRateLimitOptions } from "../middleware/rateLimit.js";
import { sendPasswordResetEmail } from "../services/email.js";

const signupSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(80).optional(),
});

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});

export interface AuthResponse {
  token: string;
  user: { id: string; email: string; displayName: string | null; tenantId: string };
}

/** POST /api/auth/signup, /api/auth/login, GET /api/auth/me */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: unknown }>(
    "/api/auth/signup",
    { config: authRateLimitOptions() },
    async (request, reply) => {
    const parsed = signupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request body",
        details: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    const { email, password, displayName } = parsed.data;

    const existing = await findUserByEmail(email);
    if (existing !== null) {
      return reply.code(409).send({ error: "An account with this email already exists" });
    }

    const passwordHash = await hashPassword(password);
    const user = await createUser({
      email,
      passwordHash,
      displayName: displayName ?? email.split("@")[0],
    });
    const tenantId = await ensureOwnedTenant(
      user.id,
      displayName ?? email.split("@")[0]
    );

    const response: AuthResponse = {
      token: issueUserToken(user.id, user.email),
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        tenantId,
      },
    };
    return reply.code(201).send(response);
    }
  );

  /** GET /api/auth/me — session restore for the client. */
  app.get("/api/auth/me", async (request, reply) => {
    const claims = await requireUser(request, reply);
    if (claims === null) {
      return reply; // 401 already sent
    }
    const user = await findUserById(claims.sub);
    if (user === null) {
      return reply.code(401).send({ error: "Account no longer exists" });
    }
    const tenantId = await ensureOwnedTenant(
      user.id,
      user.display_name ?? user.email.split("@")[0]
    );
    return reply.code(200).send({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        tenantId,
      },
    });
  });

  app.post<{ Body: unknown }>(
    "/api/auth/login",
    { config: authRateLimitOptions() },
    async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body" });
    }
    const { email, password } = parsed.data;

    const user = await findUserByEmail(email);
    // Uniform error + dummy verify to avoid user-enumeration timing signals.
    const passwordOk =
      user === null
        ? await verifyPassword(password, "scrypt$00$00")
        : await verifyPassword(password, user.password_hash);

    if (user === null || !passwordOk) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }

    const tenantId = await ensureOwnedTenant(
      user.id,
      user.display_name ?? user.email.split("@")[0]
    );

    const response: AuthResponse = {
      token: issueUserToken(user.id, user.email),
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        tenantId,
      },
    };
    return reply.code(200).send(response);
    }
  );

  /**
   * POST /api/auth/request-reset — begin the forgot-password flow.
   *
   * Always answers 202 with the same body, whether or not the account
   * exists (no user enumeration). When mail is configured the reset link
   * goes out via Brevo; otherwise the link is returned as `devResetUrl`
   * so the flow is testable without mail infrastructure. Tokens are
   * single-use, 30-minute expiry, hashed at rest.
   */
  app.post<{ Body: unknown }>(
    "/api/auth/request-reset",
    { config: authRateLimitOptions() },
    async (request, reply) => {
      const parsed = z
        .object({ email: z.string().email().max(254) })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "A valid email is required" });
      }
      const email = parsed.data.email.toLowerCase().trim();
      const user = await findUserByEmail(email);

      if (user === null) {
        return reply.code(202).send({ status: "dispatched" });
      }

      const rawToken = await createPasswordResetToken(user.id);
      const origin = request.headers.origin ?? `http://localhost:${process.env.PORT ?? 8787}`;
      const resetUrl = `${origin}/reset?token=${rawToken}`;

      const mail = await sendPasswordResetEmail({ to: user.email, resetUrl });
      return reply.code(202).send(
        mail.status === "sent"
          ? { status: "dispatched" }
          : { status: "dispatched", devResetUrl: resetUrl, mailReason: mail.reason }
      );
    }
  );

  const resetSchema = z.object({
    token: z.string().min(16).max(256),
    password: z.string().min(8).max(128),
  });

  /**
   * POST /api/auth/reset — finish the forgot-password flow.
   *
   * Consumes the single-use token, sets the new password, and issues a
   * fresh session. Any other live sessions of that account stay valid
   * (stateless HMAC tokens); the account owner can sign them out by
   * rotating JWT_SECRET, and the attacker holding THIS token cannot use
   * it again.
   */
  app.post<{ Body: unknown }>(
    "/api/auth/reset",
    { config: authRateLimitOptions() },
    async (request, reply) => {
      const parsed = resetSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Token and a new password (min 8 chars) are required",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
      }
      const { token, password } = parsed.data;

      const userId = await consumePasswordResetToken(token);
      if (userId === null) {
        return reply
          .code(400)
          .send({ error: "This reset link is invalid or has expired" });
      }
      const user = await findUserById(userId);
      if (user === null) {
        return reply
          .code(400)
          .send({ error: "This reset link is invalid or has expired" });
      }

      const passwordHash = await hashPassword(password);
      await updatePasswordHash(userId, passwordHash);

      const tenantId = await ensureOwnedTenant(
        user.id,
        user.display_name ?? user.email.split("@")[0]
      );
      return reply.code(200).send({
        token: issueUserToken(user.id, user.email),
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          tenantId,
        },
      });
    }
  );
}
