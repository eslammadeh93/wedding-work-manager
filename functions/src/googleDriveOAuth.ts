export type GoogleOAuthTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

export type GoogleDriveRefreshFailure = 'reauth_required' | 'configuration_error' | 'temporary_error';

/** Classifies Google's token endpoint response without exposing token values. */
export const classifyGoogleDriveRefreshFailure = (
  status: number,
  payload: GoogleOAuthTokenResponse,
): GoogleDriveRefreshFailure => {
  if (payload.error === 'invalid_grant') return 'reauth_required';
  if (payload.error === 'invalid_client' || payload.error === 'unauthorized_client') return 'configuration_error';
  if (status >= 500 || status === 429) return 'temporary_error';
  return 'temporary_error';
};

