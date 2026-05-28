/**
 * In-memory guest-session token store.
 *
 * Replaces the previous sessionStorage-based stash of `aa_guest_token` /
 * `aa_guest_session_id` / `aa_guest_participant_id` / `aa_join_data`.
 *
 * Why: sessionStorage is readable by any script on the page (XSS → token
 * theft is trivial). Module-scope state lives only in the JS heap for the
 * lifetime of the current page load. On hard refresh the guest simply
 * re-joins via the share link — guest tokens are short-lived (~1h) anyway.
 */

let _state = null; // { token, sessionId, participantId, name, joinData }

// Expose the getter on window so axios.js can reach it without creating
// a circular import (axios is imported very early in the bundle).
if (typeof window !== 'undefined') {
  window.__aaGuestStore = window.__aaGuestStore || {};
}

export function setGuestSession({ token, sessionId, participantId, name, joinData }) {
  _state = {
    token: String(token || ''),
    sessionId: String(sessionId || ''),
    participantId: Number(participantId || 0),
    name: String(name || 'Guest'),
    joinData: joinData || null,
  };
  if (typeof window !== 'undefined') {
    window.__aaGuestStore.getGuestSession = (sid) => getGuestSession(sid);
  }
}

export function getGuestSession(sessionId) {
  if (!_state) return null;
  if (sessionId != null && String(sessionId) !== _state.sessionId) return null;
  return _state;
}

export function clearGuestSession() {
  _state = null;
  if (typeof window !== 'undefined') {
    delete window.__aaGuestStore.getGuestSession;
  }
}
