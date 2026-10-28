// Guest websocket auth. Guests used to put their secret in the /api/ws URL (?secret=), where it
// lands in access logs. New clients send it as the first websocket message instead:
//   { type: 'auth', profileId: 'guest:<uuid>', secret: '<guest secret>' }
// The URL form is still accepted during the transition so cached old clients keep working.
// Pure helpers so they can be unit tested without a Durable Object.

export const GUEST_ID_RE = /^guest:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SECRET_MIN = 16;
export const SECRET_MAX = 256;

export function validGuestSecret(s) {
  return typeof s === 'string' && s.length >= SECRET_MIN && s.length <= SECRET_MAX;
}

// Returns { profileId, secret } when a message is a well-formed guest auth this socket may use,
// else null. A socket that is already verified (token / URL secret / an earlier auth) is left alone.
export function parseWsAuth(data, attachment) {
  if (!data || data.type !== 'auth') return null;
  if (attachment && attachment.verifiedProfileId) return null;
  const profileId = typeof data.profileId === 'string' ? data.profileId : '';
  if (!GUEST_ID_RE.test(profileId) || !validGuestSecret(data.secret)) return null;
  return { profileId, secret: data.secret };
}
