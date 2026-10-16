# AI Receptionist: Hindi Voice Agent (Plivo / Exotel)

Hospital ke liye AI receptionist. Asli phone call uthata hai, Hindi/Hinglish mein baat karta hai, aur doctor ki appointment **validate karke** MongoDB mein book karta hai.

```
Caller ──PSTN──► Exotel number ──► Voicebot applet ──wss──► /exotel/media
                                                         │
     ┌───────────── caller audio (8 kHz PCM) ◄───────────┤
     │  VAD + barge-in + end-of-turn (utils/audioDsp)     │
     ▼                                                    │
  STT: Groq Whisper-turbo ⇄ Sarvam Saaras (fallback)      │
                         ▼                                │
  LLM STREAM (Groq → Gemini) ──► har poora vaakya turant ─┤
                         │  DRAFT/BOOKING tags (bole nahi jaate)
                         ▼                                │
                 bookingService (server validation,       │
                 slot capacity, doctor days, idempotent)  │
                         ▼                                │
  TTS queue: Sarvam stream → ElevenLabs → Edge, LRU cache ──► ≥3200-byte frames
```

## v3: smooth + sasta

| Area | v2 | v3 |
|---|---|---|
| Bolna kab shuru | Poora LLM jawab + JSON aane ke baad | LLM stream; **pehla vaakya aate hi** TTS (har turn ~0.5–1.5 s kam chup) |
| Barge-in | Audio rukta tha, LLM chalta rehta tha | Audio + LLM stream dono band (bekaar tokens nahi) |
| TTS engine | ElevenLabs pehle (sabse mehenga) | `TTS_ENGINES` order; default **Sarvam Bulbul streaming** (Hindi voice, kaafi sasta) |
| TTS cache | Sirf greeting/fillers | Har chhota vaakya (≤60 chars) LRU cache — repeat = free + instant |
| Prompt | Ghadi beech me => har minute cache miss | Static pehle, dynamic aakhir => Groq/Gemini prefix cache hit |
| STT | Sirf Groq Whisper | `STT_PROVIDER` groq/sarvam + auto fallback; default turbo |
| Lambi call | Koi limit nahi | `MAX_CALL_SECONDS` (default 7 min) politely band |
| Silence | 9 s reprompt | 7 s (dead line pe Exotel minute bachao) |
| `/health` | DB + calls | + TTS cache hits/misses, active engines |

`LLM_STREAM=false` se purana behaviour wapas.

## v2 mein kya badla

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

## Plivo setup (recommended)

Plivo onboarding me **"Build Your Voice Agent Programmatically (WebSocket, Audio Streaming)"** chuno.

1. Deploy karo (Render) aur `.env` me `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN`, `PLIVO_PHONE_NUMBER`, `BASE_URL=https://<domain>` bharo.
2. Plivo console → **Voice → Applications → Add New (XML)**:
   - Answer URL: `https://<domain>/plivo/answer` (POST)
   - Hangup URL: `https://<domain>/plivo/hangup` (POST)
3. **Phone Numbers** → apna Indian number → Application = upar wali app. (India number ke liye Plivo KYC docs lagenge.)
4. Call karo. Server khud ye XML deta hai:

```xml
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-l16;rate=8000">
    wss://<domain>/plivo/media?c=<CallUUID>&t=<hmac>
  </Stream>
  <Dial><Number>reception</Number></Dial>   <!-- sirf HUMAN_HANDOFF=true -->
</Response>
```

- Stream URL har call ke liye **signed** hai — bina token ke WebSocket 401 (koi aapke LLM/TTS ka bill nahi bana sakta).
- Bot call kaate (silence / time limit) to Plivo REST se hangup hota hai, warna `keepCallAlive` call ko `<Dial>` pe le jaata.
- Handoff: "इंसान से बात" / DTMF 0 → stream band → `<Dial>` reception (`HANDOFF_NUMBER`).
- Outbound: `POST /plivo/outbound {"to":"98xxxxxxxx"}` (header `X-API-Key`). `PLIVO_MACHINE_DETECTION=true` voicemail pe turant kaat-ta hai.
- Hangup callback se `durationSeconds`, `hangupCause`, `callCost` (Plivo TotalCost) CallLog me — per-call cost report.

Exotel bhi chalta rahega (`/exotel/media`); dono ek hi server pe.

## Setup

```bash
cp .env.example .env     # values bharo
npm install
npm test                 # 26 tests: booking rules + simulated Exotel & Plivo calls (batch + streaming)
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
- `POST /plivo/outbound` `{ "to": "98xxxxxxxx" }`
- `POST /exotel/outbound` `{ "to": "98xxxxxxxx" }`
- `GET /health`: DB status + active calls (Render health check)

## Tuning (env)

`END_OF_TURN_MS`, `BARGE_IN`, `BARGE_IN_MS`, `FILLER_AFTER_MS`, `IDLE_REPROMPT_MS`, `SLOT_CAPACITY`, `SLOT_LEAD_MINUTES`. Details `.env.example` mein hain.

## Known limits

- Sessions in-memory hain: ek hi instance chalao (ya Redis mein le jao).
- STT abhi bhi utterance-batch hai (caller chup hone ke baad). Agla latency jump: Sarvam/Deepgram **streaming STT** (WebSocket) — caller bolte-bolte transcript.
- Sarvam stream `linear16` output: WAV header aaye to code khud hatata hai. Speaker naam model ke hisaab se badalte hain (v3 vs v4-flash) — console me test karke set karo.
