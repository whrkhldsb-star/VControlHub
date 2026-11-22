/**
 * 2FA Disable — verify the current second factor, then disable 2FA.
 * POST /api/auth/2fa/disable  { code }
 *
 * `code` is an authenticator code OR one of the account's recovery codes. A
 * recovery code has to be accepted here: it is enough to sign in, and this is
 * the only self-service way off 2FA once the authenticator device is gone.
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { isAcceptableTwoFactorCodeShape } from "@/lib/auth/two-factor-challenge-shape";
import { changeTwoFactorWithProof } from "@/lib/auth/two-factor-settings";
import { refreshedSessionResponse } from "@/lib/auth/refreshed-session-response";
import { accountSecurityAuditTeam, auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { getServerLocale, t } from "@/lib/i18n/translations";

import { ValidationError } from "@/lib/errors";
const disableSchema = z.object({ code: z.string().min(1) });

export async function POST(request: Request) {
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    {
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: t("api.auth.twoFactor.disableFailed", locale),
      bodySchema: disableSchema,
    },
    async ({ session, body }) => {
      const { code } = body;

      if (!isAcceptableTwoFactorCodeShape(code)) {
        throw new ValidationError(t("api.auth.twoFactor.invalidCode", locale));
      }

      const { credentialBinding, usedRecoveryCode } = await changeTwoFactorWithProof(session, code, () => ({
        data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorRecoveryCodes: Prisma.DbNull },
        value: null,
      }));
      await auditUserAction(
        session.userId,
        "auth.2fa.disable",
        { userId: session.userId, usedRecoveryCode },
        "INFO",
        accountSecurityAuditTeam(session),
      );

      return refreshedSessionResponse(session, request, { success: true }, credentialBinding);
    },
  );
}
