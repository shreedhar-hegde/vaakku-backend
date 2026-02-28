/**
 * Shared JWT secret for auth middleware and auth routes.
 * In production JWT_SECRET must be set.
 */
export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  return secret || 'dev-secret';
}
