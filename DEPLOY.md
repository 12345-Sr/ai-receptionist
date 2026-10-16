# Deploy Guide — AI Receptionist (Plivo + Sarvam + Groq)

Total time: ~1–2 ghante (Plivo India number KYC me 1–3 din lag sakte hain — pehle shuru karo).

---

## 0. Accounts banao (sab pay-as-you-go)

| Service | Kya chahiye | Kahan se |
|---|---|---|
| **Plivo** | Auth ID, Auth Token, Indian number (KYC) | console.plivo.com → onboarding me *"Build Your Voice Agent Programmatically"* |
| **MongoDB Atlas** | Connection string | cloud.mongodb.com → Free M0 / Flex, region **Mumbai (ap-south-1)** |
| **Groq** | API key | console.groq.com → API Keys |
| **Sarvam AI** | API key (main awaaz) | dashboard.sarvam.ai |
| **Azure Speech** | Key + region (fallback awaaz) | portal.azure.com → *Speech service* → region **Central India** → Keys |
| Gemini (optional) | API key (LLM fallback) | aistudio.google.com |
| **Render** | Account + GitHub repo | render.com |

> MongoDB Atlas → Network Access → `0.0.0.0/0` allow karo (Render ke IP fixed nahi hote) — strong password zaroor rakho.

---

## 1. Code GitHub pe

```bash
unzip ai-receptionist-deploy.zip && cd ai-receptionist
git remote set-url origin https://github.com/<you>/ai-receptionist.git   # agar naya repo
git push -u origin feat/v3-streaming-low-cost   # ya main me merge karke main push
```

`.env` kabhi commit mat karna (`.gitignore` me hai).

## 2. Render pe deploy

1. Render → **New → Blueprint** → repo chuno → `render.yaml` apne aap padh lega.
2. Jo values `sync: false` hain, Render poochega — bharo:
   - `BASE_URL` = abhi `https://ai-receptionist.onrender.com` (deploy ke baad jo URL mile; custom domain baad me)
   - `MONGODB_URI`, `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN`, `PLIVO_PHONE_NUMBER` (e.g. `918045xxxxxx`)
   - `HANDOFF_NUMBER` (reception, e.g. `917408412008`)
   - `GROQ_API_KEY`, `SARVAM_API_KEY`, `AZURE_SPEECH_KEY`, `GEMINI_API_KEY`
   - `ALLOWED_ORIGINS` = dashboard ka URL (na ho to khaali)
3. Deploy. Logs me ye dikhna chahiye:
   ```
   [db] Connected to MongoDB (ai_receptionist)
   [server] listening on 10000 | ... Plivo answer URL: https://<domain>/plivo/answer
   [tts] Pre-warmed 10/10 phrases
   ```
   `[config] ❌ ...` aaye to wahi setting missing hai — Render → Environment me theek karo.
4. Check: `https://<domain>/health` → `"status":"healthy"`, `"engines":["sarvam","azure",...]`.

> Plan: **starter** ($7) ~3–4 ek saath calls. Zyada load → **standard** ($25). Free plan mat lena (so jaata hai, pehli call fail).

## 3. Plivo connect

1. Plivo console → **Voice → Applications → Add New Application**
   - Answer URL: `https://<domain>/plivo/answer` — Method **POST**
   - Hangup URL: `https://<domain>/plivo/hangup` — Method **POST**
2. **Phone Numbers → Your Numbers** → apna number → Application Type *XML Application* → upar wali app → Save.
3. Number pe call karo. 🎉

## 4. Go-live test checklist (har naye hospital pe)

- [ ] Call uthte hi 1 s ke andar greeting
- [ ] "मुझे बुखार है" → sahi doctor + khaali slot
- [ ] Naam bol ke "हाँ" → booking confirm; MongoDB `appointments` me entry, phone number sahi
- [ ] Bot bolte waqt beech me bolo → bot turant rukta hai
- [ ] "रिसेप्शन से बात करनी है" / `0` dabao → reception pe call jaati hai
- [ ] 10 s chup raho → "हेलो?" → 2 baar ke baad call politely band
- [ ] "सीने में तेज़ दर्द" → emergency number turant
- [ ] Outbound: `curl -X POST https://<domain>/plivo/outbound -H "X-API-Key: <DASHBOARD_API_KEY>" -H "Content-Type: application/json" -d '{"to":"98xxxxxxxx"}'`
- [ ] Call ke baad CallLog me `durationSeconds`, `callCost` aa raha hai
- [ ] `/health` me `tts.hits` badh raha hai (cache kaam kar raha hai)

Awaaz na aaye par logs me `🤖 "..."` dikhe → Plivo audio format issue: support ko batao, ya mujhse mu-law version banwao.

## 5. Naya hospital onboard karna

Sirf `config/hospitalConfig.js` badlo (naam, doctors, din, shifts, fees, FAQ, greeting) → har hospital ka alag Render service + alag Plivo number + alag `MONGODB_DB`. Prompt/availability sab isi se banta hai.

## 6. Monthly kharcha (20,000 min/month ka andaza)

| Item | ~₹/month |
|---|---|
| Plivo calls (₹0.38/min) + number | 7,800 |
| Sarvam TTS (cache ke baad) | 9,000–18,000 |
| Groq STT + LLM (gpt-oss-20b) | 2,000–2,500 |
| Render + MongoDB + domain | 700–3,300 |
| **Total (+GST Plivo/Sarvam pe)** | **~₹22,000–35,000 (₹1.1–1.75/min)** |

## 7. Kahin aur deploy (VPS / AWS / DigitalOcean)

```bash
cp .env.example .env    # values bharo, NODE_ENV=production
docker compose up -d --build
```
Aage Caddy/Nginx se HTTPS + WebSocket proxy lagao (Plivo ko `wss://` chahiye). Server India region me rakho (Mumbai) — latency kam.

## 8. Tuning (env, redeploy ki zaroorat nahi — Render pe save = restart)

| Setting | Default | Kab badlo |
|---|---|---|
| `END_OF_TURN_MS` | 800 | Bot caller ko beech me kaat-ta hai → 1000; jawab der se → 650 |
| `SARVAM_SPEAKER` | priya | neha / ritu / kavya sun ke chuno |
| `SARVAM_MODEL` | bulbul:v3 | `bulbul:v4-flash` sasta/tez (speaker naam alag — Sarvam docs) |
| `MAX_CALL_SECONDS` | 420 | Lambi consultation calls → 600 |
| `LLM_STREAM` | true | Koi dikkat → `false` (purana behaviour) |
| `STT_PROVIDER` | groq | Hindi galat sunta hai → `sarvam` |
