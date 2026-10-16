/**
 * Startup config check. Production me galat/missing setting = server start hi nahi
 * hoga (saaf error ke saath) — taaki live call pe pata na chale ki key missing thi.
 */
function validateEnv(env = process.env) {
  const errors = [];
  const warnings = [];
  const prod = env.NODE_ENV === "production";
  const has = (k) => Boolean(env[k] && String(env[k]).trim());

  if (!has("MONGODB_URI")) errors.push("MONGODB_URI missing (MongoDB Atlas connection string)");
  if (!has("GROQ_API_KEY") && !has("GEMINI_API_KEY")) errors.push("LLM key missing: GROQ_API_KEY ya GEMINI_API_KEY chahiye");
  if (!has("GROQ_API_KEY") && !has("SARVAM_API_KEY")) errors.push("STT key missing: GROQ_API_KEY ya SARVAM_API_KEY chahiye");
  if (!has("DASHBOARD_API_KEY") || env.DASHBOARD_API_KEY === "change_me") {
    (prod ? errors : warnings).push("DASHBOARD_API_KEY set karo (openssl rand -hex 32) — /api aur outbound calls isi se protected hain");
  }
  if (!has("BASE_URL")) (prod ? errors : warnings).push("BASE_URL missing (e.g. https://ai-receptionist.onrender.com)");
  else if (prod && !/^https:\/\//.test(env.BASE_URL)) errors.push("BASE_URL https:// se shuru hona chahiye");

  const plivo = has("PLIVO_AUTH_ID") && has("PLIVO_AUTH_TOKEN");
  const exotel = has("EXOTEL_SID") && has("EXOTEL_API_KEY") && has("EXOTEL_API_TOKEN");
  if (!plivo && !exotel) warnings.push("Koi telephony credentials nahi (PLIVO_AUTH_ID/PLIVO_AUTH_TOKEN) — inbound stream chalega, par hangup/outbound nahi");
  if (has("PLIVO_AUTH_ID") !== has("PLIVO_AUTH_TOKEN")) errors.push("PLIVO_AUTH_ID aur PLIVO_AUTH_TOKEN dono chahiye");
  if (prod && !plivo && !has("STREAM_SECRET") && !exotel) errors.push("Plivo stream signing ke liye PLIVO_AUTH_TOKEN ya STREAM_SECRET chahiye");

  const paidTts = ["SARVAM_API_KEY", "AZURE_SPEECH_KEY", "ELEVENLABS_API_KEY"].filter(has);
  if (!paidTts.length) {
    warnings.push("Sirf Microsoft Edge TTS (free, unofficial) — client production ke liye SARVAM_API_KEY / AZURE_SPEECH_KEY daalo");
  } else if (paidTts.length === 1) {
    warnings.push(`Sirf ek paid TTS (${paidTts[0]}) — fallback ke liye doosra bhi rakho (Sarvam + Azure recommended)`);
  }
  if (env.HUMAN_HANDOFF === "true" && !has("HANDOFF_NUMBER")) warnings.push("HUMAN_HANDOFF=true par HANDOFF_NUMBER nahi — hospitalConfig.hospitalPhone use hoga");

  return { errors, warnings };
}

function assertEnv() {
  const { errors, warnings } = validateEnv();
  for (const w of warnings) console.warn(`[config] ⚠️  ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`[config] ❌ ${e}`);
    throw new Error(`Config invalid (${errors.length} error) — upar dekho`);
  }
}

module.exports = { validateEnv, assertEnv };
