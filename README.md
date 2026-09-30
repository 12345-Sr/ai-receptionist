# AI Receptionist — Exotel Voicebot (WebSocket wss://)

A 100% native Exotel AI Voicebot that answers inbound phone calls directly, listens and speaks in natural Hindi via real-time WebSockets, manages appointment slots dynamically, and logs transcripts & bookings in MongoDB.

---

## Architecture Overview (Twilio-Free)

```
Caller (Phone) 
   │ (GSM / Inbound Call)
   ▼
Exotel Virtual Number (08047289047 / 095-138-86363)
   │
   ▼ Voicebot Applet (AgentStream)
WebSocket Server: wss://your-domain.ngrok-free.dev/exotel/media
   │
   ├── Audio in (8000 Hz 16-bit PCM) ──► Groq Whisper STT (whisper-large-v3-turbo)
   │                                           │ (Hindi Text)
   │                                           ▼
   │                                     Groq LLM (qwen/qwen3.8-27b)
   │                                           │ (Hindi Response + Slot Validation)
   │                                           ▼
   └── Audio out (8000 Hz PCM) ◄──────── Google TTS + WebAssembly PCM Decoder
```

---

## Features

1. **Direct Exotel Inbound:** Patients call the registered Indian virtual number directly.
2. **Real-Time Voice Streaming (`wss://`):** Exotel AgentStream sends and receives 8000 Hz 16-bit PCM audio chunks over WebSockets with barge-in support.
3. **Natural Hindi Voice & Conversation:** Powered by Groq Whisper (`whisper-large-v3-turbo`), Groq LLM (`qwen/qwen3.8-27b`), and Google TTS.
4. **No Phone Number Asking:** The caller's number is captured from telephony metadata; the assistant only asks for the patient's name, doctor/department, date, and preferred time.
5. **Slot Booking & Conflict Handling:** If a patient requests a booked slot (such as Dr. Ananya Sharma at 2:00 PM), the assistant informs them that the slot is full and recommends open slots (e.g., 2:30 PM or 3:00 PM).
6. **MongoDB Storage:** Appointments and full call transcripts are automatically stored in MongoDB.

---

## Configuration & Environment Variables (`.env`)

```env
PORT=3000
BASE_URL=https://marshland-giant-engraved.ngrok-free.dev

# MongoDB Atlas
MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.k1ayaix.mongodb.net

# Exotel Credentials
EXOTEL_API_KEY=your_exotel_api_key
EXOTEL_API_TOKEN=your_exotel_api_token
EXOTEL_SID=your_exotel_sid
EXOTEL_PHONE_NUMBER=095-138-86363

# Groq
GROQ_API_KEY=gsk_...
GROQ_MODEL=qwen/qwen3.8-27b
```

---

## Setting up Exotel App Bazaar (Voicebot Applet)

1. Log into your [Exotel Dashboard](https://my.exotel.com/).
2. Go to **App Bazaar** → Create or Edit your Inbound Flow (e.g., App ID `1347948`).
3. Add the **Voicebot** (or **AgentStream / Audio Stream**) applet as the first block.
4. Set the Stream URL to:
   ```
   wss://marshland-giant-engraved.ngrok-free.dev/exotel/media
   ```
5. Set:
   - **Audio Format:** `Linear PCM 16-bit 8000 Hz`
   - **Track:** `Inbound & Outbound (Both tracks)`
6. Save and assign this flow to your Exotel phone number (`08047289047` / `095-138-86363`).

---

## Running Locally

1. Start ngrok on port 3000:
   ```bash
   ngrok http 3000
   ```
2. Start the Voicebot server:
   ```bash
   npm start
   ```
3. Dial your Exotel number from your phone!
