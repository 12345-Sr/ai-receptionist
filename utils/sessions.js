/**
 * Very simple in-memory session store keyed by Twilio CallSid.
 * Fine for a single-instance demo. For production, swap this for Redis
 * so sessions survive restarts and work across multiple server instances.
 */
const sessions = new Map();

function getSession(callSid) {
  if (!sessions.has(callSid)) {
    sessions.set(callSid, {
      messages: [], // { role: 'user' | 'assistant', content: string }
      bookingDraft: {},
    });
  }
  return sessions.get(callSid);
}

function clearSession(callSid) {
  sessions.delete(callSid);
}

module.exports = { getSession, clearSession };
