/**
 * Regenerate single-use 2FA recovery codes for the current account.
 * A live second factor is required so a stolen browser session cannot replace
 * an account's last-resort recovery path. One of the account's own recovery
 * codes counts as that factor (and is consumed) — otherwise a user whose
 * authenticator is gone could never top the set back up, and would be locked
 * out for good once the last code was spent.
 */
import { z } from "zod";
import { isAcceptableTwoFactorCodeShape } from "@/lib/auth/two-factor-challenge-shape";
import { createTwoFactorRecoveryCodes } from "@/lib/auth/two-factor-recovery";
import { changeTwoFactorWithProof } from "@/lib/auth/two-factor-settings";
import { refreshedSessionResponse } from "@/lib/auth/refreshed-session-response";
import { accountSecurityAuditTeam, auditUserAction } from "@/lib/audit/service";
import { ValidationError } from "@/lib/errors";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { getServerLocale, t } from "@/lib/i18n/translations";

// Shape is checked in the handler: an authenticator code and a recovery code
// have different formats, and rejecting one of them here would hard-code the
// dead end this route exists to avoid.
const regenerateSchema = z.object({ code: z.string().min(1) });

export async function POST(request: Request) {
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    {
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: t("api.auth.twoFactor.recoveryCodesFailed", locale),
      bodySchema: regenerateSchema,
    },
    async ({ session, body }) => {
      if (!isAcceptableTwoFactorCodeShape(body.code)) {
        throw new ValidationError(t("api.auth.twoFactor.invalidCode", locale));
      }

      const { credentialBinding, usedRecoveryCode, value: recoveryCodes } = await changeTwoFactorWithProof(session, body.code, () => {
        const recovery = createTwoFactorRecoveryCodes();
        return { data: { twoFactorRecoveryCodes: recovery.hashes }, value: recovery.codes };
      });
      await auditUserAction(
        session.userId,
        "auth.2fa.recovery_codes_regenerated",
        { userId: session.userId, usedRecoveryCode },
        "WARNING",
        accountSecurityAuditTeam(session),
      );

      return refreshedSessionResponse(session, request, { success: true, recoveryCodes }, credentialBinding);
    },
  );
}
