/** Only this state is still governed by ADMIN_INITIAL_PASSWORD. */
export function isInitialAdminPasswordState(user: { status: string; mustChangePassword: boolean }) {
  return user.status === "PENDING_PASSWORD_RESET" && user.mustChangePassword;
}
