# AI Receptionist: Hindi Voice Agent (Exotel)

Hospital ke liye AI receptionist. Asli phone call uthata hai, Hindi/Hinglish mein baat karta hai, aur doctor ki appointment **validate karke** MongoDB mein book karta hai.

```
Caller ──PSTN──► Exotel number ──► Voicebot applet ──wss──► /exotel/media
                                                         │
     ┌───────────── caller audio (8 kHz PCM) ◄───────────┤
     │  VAD + barge-in + end-of-turn (utils/audioDsp)     │
     ▼                                                    │
  Groq Whisper STT ──► LLM (Groq → Gemini fallback)       │
                         │  speech + DRAFT/BOOKING tags   │
                         ▼                                │
                 bookingService (server validation,       │
                 slot capacity, doctor days, idempotent)  │
                         ▼                                │
         TTS: ElevenLabs stream → Sarvam → Edge ──► ≥3200-byte frames
```

## Is version mein kya badla (v2)

| Area | Pehle | Ab |
|---|---|---|
| Outbound audio | 320-byte chunks (Exotel ka minimum 3200 hai) | 3200-byte+ frames, 320 ke multiple |
| Barge-in | Bot bolte waqt caller ka audio ignore; `clear` kabhi nahi bheja | Caller bole to bot rukta hai (`clear` + TTS abort) |
| Overlapping turns | Do reply ek saath, double booking | Turns serialize; purana LLM call abort + text merge |
| Booking | LLM ka JSON bina check ke save | Doctor ke din, beete slot, capacity, duplicate: sab server check karta hai |
| Date | `"Today (30 September 2026)"` string | `YYYY-MM-DD` (IST) |
| Naam confirm | `\b` Devanagari pe fail: "नहीं, गलत है" kabhi reject nahi hota tha | Devanagari-safe classifier |
| Doctor/time | Har turn pe regex overwrite ("हाथ" → ortho) | LLM draft + normalizer, caller mann badal sakta hai |
| Knowledge | PDF parse hota tha par text ignore hota tha | `config/hospitalConfig.js` = single source |
| Latency | 1.4 s end-of-turn, poora TTS ke baad bolna, 18 s tak silence possible | 0.8 s, streaming TTS, cached greeting/fillers, time budget |
| Humanlike | — | Fillers, silence reprompt, emergency reply, human handoff, read-back confirmation |
| Security | `/api` + `/exotel/outbound` khule (koi bhi aapke account se call lagwa sakta tha) | API key; CORS allow-list |

## Setup

```bash
cp .env.example .env     # values bharo
npm install
npm test                 # 13 tests: booking rules + simulated Exotel calls
npm run dev
ngrok http 3000          # local testing
```

**Exotel flow (App Bazaar):**
1. **Voicebot** applet → URL `wss://<your-domain>/exotel/media`
2. (Optional, `HUMAN_HANDOFF=true`) uske baad **Connect** applet → reception number. Jab caller "किसी इंसान से बात" bole ya `0` dabaye, bot stream band karta hai aur Exotel agla applet chalata hai.
3. Flow ko ExoPhone pe assign karo.

## Hospital data badalna

Sirf `config/hospitalConfig.js` edit karo: doctors, din, shifts, fees, FAQ, greeting. Prompt, availability aur validation sab isi se bante hain.

## API (header `X-API-Key: $DASHBOARD_API_KEY`)

- `GET /api/calls`: dashboard format
- `GET /api/appointments`
- `POST /exotel/outbound` `{ "to": "98xxxxxxxx" }`
- `GET /health`: DB status + active calls (Render health check)

## Tuning (env)

`END_OF_TURN_MS`, `BARGE_IN`, `BARGE_IN_MS`, `FILLER_AFTER_MS`, `IDLE_REPROMPT_MS`, `SLOT_CAPACITY`, `SLOT_LEAD_MINUTES`. Details `.env.example` mein hain.

## Known limits

- Sessions in-memory hain: ek hi instance chalao (ya Redis mein le jao).
- STT abhi batch Whisper hai. Agla bada latency jump streaming STT (Deepgram / Sarvam / Google Chirp streaming) se milega.
