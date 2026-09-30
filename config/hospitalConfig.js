/**
 * SINGLE SOURCE OF TRUTH for hospital data.
 *
 * Pehle ye data 3 jagah copy tha (yeh file, aiService ka fallback prompt, aur
 * pdfKnowledgeMemory ka hardcoded text) — aur PDF se parse hua text asal me use
 * hi nahi hota tha. Ab sirf yahi file edit karo; prompt, booking validation
 * aur slot availability sab isi se banta hai.
 */

module.exports = {
  hospitalName: "सिटी केयर हॉस्पिटल",
  hospitalNameEn: "City Care Hospital",
  hospitalPhone: "0512-2345678",
  helpdeskMobile: "+91-9876543210",
  emergencyPhone: "112 / 0512-2345679",
  address: "123 एमजी रोड, सिविल लाइंस के पास, कानपुर",
  consultationFee: 500,
  opdDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  opdHoursText: "सोमवार से शनिवार, सुबह नौ से शाम सात बजे तक। रविवार ओपीडी बंद रहती है, इमरजेंसी चौबीसों घंटे खुली है।",

  // Receptionist ka naam — insaan jaisa feel deta hai
  assistantName: "नेहा",

  greeting:
    "नमस्ते, सिटी केयर हॉस्पिटल से नेहा बात कर रही हूँ। बताइए, मैं आपकी क्या मदद कर सकती हूँ?",

  // Appointment shifts (sab doctors ke liye same). `minutes` = din ke shuru se minute.
  shifts: [
    { key: "morning", time: "10:00 AM", minutes: 10 * 60, spoken: "सुबह दस बजे" },
    { key: "noon", time: "2:00 PM", minutes: 14 * 60, spoken: "दोपहर दो बजे" },
    { key: "evening", time: "5:30 PM", minutes: 17 * 60 + 30, spoken: "शाम साढ़े पाँच बजे" },
  ],

  // Ek shift me ek doctor kitne patients dekh sakta hai (env se override: SLOT_CAPACITY)
  slotCapacity: Number(process.env.SLOT_CAPACITY || 8),

  // Aaj ka slot kitne minute pehle tak book ho sakta hai (9:55 pe 10 baje ka slot mat do)
  slotLeadMinutes: Number(process.env.SLOT_LEAD_MINUTES || 30),

  doctors: [
    {
      name: "Dr. Ananya Sharma",
      hindiName: "डॉक्टर अनन्या शर्मा",
      specialty: "General Physician",
      specialtyHindi: "जनरल फिजिशियन",
      room: "Cabin 101, First Floor",
      availableDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      symptoms: "बुखार, जुकाम, खांसी, कमजोरी, सिरदर्द, पेट दर्द, उल्टी, दस्त, बीपी, शुगर",
      aliases: ["ananya", "अनन्या", "general", "जनरल", "फिजिशियन", "physician"],
    },
    {
      name: "Dr. Rohit Verma",
      hindiName: "डॉक्टर रोहित वर्मा",
      specialty: "Cardiologist",
      specialtyHindi: "हृदय रोग विशेषज्ञ",
      room: "Cabin 104, First Floor",
      availableDays: ["Monday", "Wednesday", "Friday"],
      symptoms: "दिल की बीमारी, सीने में दर्द, हाई बीपी, घबराहट, धड़कन तेज़, सांस फूलना",
      aliases: ["rohit", "रोहित", "cardio", "कार्डियो", "हार्ट", "दिल"],
    },
    {
      name: "Dr. Priya Nair",
      hindiName: "डॉक्टर प्रिया नायर",
      specialty: "Pediatrician",
      specialtyHindi: "बच्चों की डॉक्टर",
      room: "Cabin 108, Ground Floor",
      availableDays: ["Tuesday", "Thursday", "Saturday"],
      symptoms: "बच्चों का बुखार, जुकाम-खांसी, टीकाकरण, बच्चों की कमजोरी",
      aliases: ["priya", "प्रिया", "pediatric", "पीडियाट्रिक", "बच्चों"],
    },
    {
      name: "Dr. Sanjay Gupta",
      hindiName: "डॉक्टर संजय गुप्ता",
      specialty: "Orthopedic",
      specialtyHindi: "हड्डी रोग विशेषज्ञ",
      room: "Cabin 112, Ground Floor",
      availableDays: ["Monday", "Tuesday", "Thursday", "Saturday"],
      symptoms: "हड्डी और जोड़ों का दर्द, घुटने का दर्द, कमर दर्द, गठिया, मोच, फ्रैक्चर",
      aliases: ["sanjay", "संजय", "ortho", "ऑर्थो", "हड्डी"],
    },
    {
      name: "Dr. Kavita Joshi",
      hindiName: "डॉक्टर कविता जोशी",
      specialty: "Gynecologist",
      specialtyHindi: "स्त्री रोग विशेषज्ञ",
      room: "Cabin 106, First Floor",
      availableDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      symptoms: "महिला स्वास्थ्य, प्रेगनेंसी, पीरियड्स की समस्या, पीसीओडी",
      aliases: ["kavita", "कविता", "gyn", "गायनी", "स्त्री"],
    },
    {
      name: "Dr. Rajesh Malhotra",
      hindiName: "डॉक्टर राजेश मल्होत्रा",
      specialty: "ENT Specialist",
      specialtyHindi: "कान, नाक, गला विशेषज्ञ",
      room: "Cabin 103, Ground Floor",
      availableDays: ["Monday", "Wednesday", "Saturday"],
      symptoms: "कान दर्द, कम सुनाई देना, साइनस, बंद नाक, गले में दर्द, टॉन्सिल",
      aliases: ["rajesh", "राजेश", "ent", "ईएनटी", "कान", "गला"],
    },
  ],

  faq: [
    "फीस: डॉक्टर की परामर्श फीस पाँच सौ रुपये है, काउंटर पर जमा होती है।",
    "पता: 123 एमजी रोड, सिविल लाइंस के पास, कानपुर।",
    "सुविधाएँ: पैथोलॉजी लैब, डिजिटल एक्स-रे, ईसीजी, और ग्राउंड फ्लोर पर 24 घंटे मेडिकल स्टोर।",
    "वॉक-इन: सीधे भी आ सकते हैं, पर अपॉइंटमेंट से लाइन में इंतज़ार नहीं करना पड़ता।",
    "रीशेड्यूल/कैंसिल: इसी नंबर पर कॉल करके करवा सकते हैं।",
  ],

  // Emergency / handoff lines (deterministic — LLM pe depend nahi)
  emergencyReply:
    "यह इमरजेंसी लग रही है। कृपया तुरंत एक सौ बारह पर कॉल करें या सीधे हमारे इमरजेंसी वार्ड आएँ, वो चौबीसों घंटे खुला है।",
  handoffReply: "ठीक है, मैं आपको हमारे रिसेप्शन से जोड़ रही हूँ, एक पल रुकिए।",
  unlistedQueryFallback:
    "माफ़ कीजिए, इसकी जानकारी मेरे पास नहीं है। आप हेल्पडेस्क नंबर शून्य पाँच एक दो, दो तीन चार पाँच छह सात आठ पर पूछ सकते हैं। क्या मैं किसी डॉक्टर की अपॉइंटमेंट बुक कर दूँ?",
};
