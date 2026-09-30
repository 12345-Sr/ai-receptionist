/**
 * Single source of truth for the patient's name during a call.
 *
 * THE BUG THIS FIXES:
 * Previously, session.patientName and session.nameConfirmed could be overwritten on
 * almost every turn from three different places (a regex heuristic on raw speech, the
 * AI's own "draft" JSON, and again from the AI's final booking JSON) with no lock. Once
 * the patient had confirmed their name, later turns could still silently replace it with
 * a different, mis-heard, or hallucinated name before the appointment was booked.
 *
 * THE FIX:
 * Once `session.nameConfirmed` is true, the name is FROZEN. Nothing below (heuristic
 * extraction, the AI's draft, or the AI's final booking JSON) is allowed to change it
 * again for the rest of the call. Only an explicit "no, that's wrong" from the caller
 * (detected deterministically, not by trusting the AI) unlocks it.
 */

const AFFIRMATIVE_RE =
  /(?:^|\b)(?:हाँ|जी\s*हाँ|यस|yes|सही\s*है|correct|right|yeah|yep|sure|that's right|जी|bilkul|बिल्कुल|यही\s*नाम|यही\s*है|ठीक\s*है)(?:$|\b)/i;
const NEGATIVE_RE = /(?:^|\b)(?:नहीं\s*है|गलत|wrong|nope|not this|नहीं\s*गलत|गलत\s*है|ये\s*नाम\s*नहीं)(?:$|\b)/i;
const ASKED_CONFIRM_RE = /(?:क्या यह सही है|क्या यह नाम सही है|मैंने आपका नाम|नाम नोट किया|is that correct)/i;
const ASKED_SPELL_RE = /(?:स्पेलिंग|spell)/i;
const ASKED_NAME_RE =
  /(?:आपका\s*नाम|अपना\s*नाम|नाम\s*बताएं|नाम\s*बताओ|नाम\s*बताइए|नाम\s*क्या\s*है|your\s*name|full\s*name)/i;
const EXPLICIT_NAME_RE = /(?:मेरा\s*नाम|मरीज़?\s*का\s*नाम|नाम\s*है|my\s*name\s*is)/i;

const DOCTOR_NAME_PATTERNS = [
  /sanjay\s*gupta/i,
  /rohit\s*verma/i,
  /ananya\s*sharma/i,
  /priya\s*nair/i,
  /संजय\s*गुप्ता/i,
  /रोहित\s*वर्मा/i,
  /अनन्या\s*शर्मा/i,
  /प्रिया\s*नायर/i,
  /हॉस्पिटल|क्लिनिक/i
];

function isInvalidPatientName(name) {
  if (!name) return true;
  const clean = String(name).trim();
  if (
    !clean ||
    clean === "undefined" ||
    clean === "null" ||
    clean === "Unknown" ||
    clean === "Patient" ||
    /^spelling/i.test(clean) ||
    /^स्पेलिंग/i.test(clean)
  ) {
    return true;
  }
  for (const pat of DOCTOR_NAME_PATTERNS) {
    if (pat.test(clean)) return true;
  }
  return false;
}

function lastAssistantMessage(session) {
  return [...session.messages].reverse().find((m) => m.role === "assistant")?.content || "";
}

/**
 * Runs on every caller turn, BEFORE calling the AI. Returns context flags the caller
 * (exotelWsService) can use, and mutates session.patientName / session.nameConfirmed
 * ONLY when the name is not yet locked.
 */
function applyCallerTurn(session, callerText, heuristics) {
  // Safety guard: nameConfirmed can NEVER be true if there is no valid patient name!
  if (session.nameConfirmed && isInvalidPatientName(session.patientName)) {
    session.nameConfirmed = false;
    session.patientName = null;
  }

  const lastMsg = lastAssistantMessage(session);
  const wasAskedForConfirmation = ASKED_CONFIRM_RE.test(lastMsg);
  const wasAskedForSpelling = ASKED_SPELL_RE.test(lastMsg);
  const wasAskedForName = ASKED_NAME_RE.test(lastMsg);
  const trimmed = String(callerText || "").trim();
  
  // Colloquial Indian affirmative phrases like "यही नाम है", "नहीं, यही नाम है", "हाँ यही नाम है"
  const hasYahiNaam = /(?:यही\s*नाम|यही\s*है|सही\s*है|हाँ|yes|correct|बिल्कुल|ठीक\s*है)/i.test(trimmed);
  const isAffirmative = hasYahiNaam || AFFIRMATIVE_RE.test(trimmed);
  const isNegative = !hasYahiNaam && NEGATIVE_RE.test(trimmed);

  if (session.nameConfirmed) {
    // LOCKED. Only an explicit rejection re-opens it.
    if (wasAskedForConfirmation && isNegative) {
      session.nameConfirmed = false;
      session.patientName = null;
    }
    return { wasAskedForConfirmation, wasAskedForSpelling, wasAskedForName, locked: session.nameConfirmed };
  }

  // Name confirmation can ONLY happen when there is an actual recognized valid patient name
  if (wasAskedForConfirmation && session.patientName && !isInvalidPatientName(session.patientName)) {
    if (isAffirmative) {
      session.nameConfirmed = true;
    } else if (isNegative) {
      session.nameConfirmed = false;
      session.patientName = null;
    }
  }

  if (!session.nameConfirmed) {
    const spelledCandidate = heuristics.parseSpelledName(callerText);
    if (spelledCandidate && !isInvalidPatientName(spelledCandidate)) {
      session.patientName = spelledCandidate;
    } else if (
      !session.appointmentBooked &&
      (!session.patientName || isInvalidPatientName(session.patientName))
    ) {
      // Only let name extraction fire when context actually supports it (asked for name or said "मेरा नाम")
      const contextSupportsGuess = wasAskedForName || EXPLICIT_NAME_RE.test(callerText);
      if (contextSupportsGuess && (!wasAskedForSpelling || EXPLICIT_NAME_RE.test(callerText))) {
        const candidateName = heuristics.extractPatientNameFromSpeech(callerText);
        if (candidateName && !isInvalidPatientName(candidateName)) {
          session.patientName = candidateName;
        }
      }
    }
  }

  return { wasAskedForConfirmation, wasAskedForSpelling, wasAskedForName, locked: session.nameConfirmed };
}

/** Applies the AI's own draft.patientName - but never blindly confirms or locks without a valid name. */
function applyAiDraft(session, draft, toEnglishName) {
  if (!draft) return;

  // Never accept invalid names or let AI draft override once confirmed
  if (
    !session.nameConfirmed &&
    draft.patientName &&
    draft.patientName !== "Unknown" &&
    draft.patientName !== "Patient" &&
    !draft.patientName.includes("[") &&
    draft.patientName.trim().length > 1 &&
    !isInvalidPatientName(draft.patientName)
  ) {
    session.patientName = toEnglishName(draft.patientName);
  }

  // Safety invariant: name can NEVER be marked confirmed if patientName is missing or invalid!
  if (session.nameConfirmed && isInvalidPatientName(session.patientName)) {
    session.nameConfirmed = false;
  }
}

/** The booked appointment ALWAYS uses the locked session name - never whatever the AI put in the booking JSON. */
function finalizeBookingName(session, booking) {
  if (session.patientName && !isInvalidPatientName(session.patientName)) {
    booking.patientName = session.patientName;
  }
  return booking;
}

module.exports = { applyCallerTurn, applyAiDraft, finalizeBookingName, isInvalidPatientName };
