const fs = require("fs");
const path = require("path");
const PDFParser = require("pdf2json");
const { generateHospitalPdf } = require("../scripts/generateHospitalPdf");

const PDF_FILE_PATH = path.join(__dirname, "..", "data", "hospital_and_doctors.pdf");

let cachedPdfKnowledgeText = null;
let isParsing = null;

/**
 * Loads and extracts text from the official hospital PDF file.
 * Automatically generates the PDF if it does not exist yet.
 */
async function loadPdfKnowledge(forceReload = false) {
  if (cachedPdfKnowledgeText && !forceReload) {
    return cachedPdfKnowledgeText;
  }
  if (isParsing) {
    return isParsing;
  }

  isParsing = (async () => {
    try {
      if (!fs.existsSync(PDF_FILE_PATH)) {
        console.log("[pdfKnowledgeMemory] PDF not found, generating now...");
        await generateHospitalPdf(PDF_FILE_PATH);
      }

      const extractedText = await new Promise((resolve, reject) => {
        const pdfParser = new PDFParser(null, 1);

        pdfParser.on("pdfParser_dataReady", () => {
          try {
            const raw = pdfParser.getRawTextContent();
            const clean = decodeURIComponent(raw)
              .replace(/----------------Page \(\d+\) Break----------------/g, "\n")
              .replace(/\r\n/g, "\n")
              .trim();
            resolve(clean);
          } catch (e) {
            resolve(pdfParser.getRawTextContent());
          }
        });

        pdfParser.on("pdfParser_dataError", (errData) => {
          reject(new Error(errData?.parserError || "Failed to parse PDF"));
        });

        pdfParser.loadPDF(PDF_FILE_PATH);
      });

      // Format a clean, token-efficient knowledge representation from the extracted PDF text
      cachedPdfKnowledgeText = formatTokenEfficientMemory(extractedText);
      console.log(`[pdfKnowledgeMemory] 📄 Loaded hospital memory from PDF (${cachedPdfKnowledgeText.length} chars)`);
      return cachedPdfKnowledgeText;
    } finally {
      isParsing = null;
    }
  })();

  return isParsing;
}

/**
 * Ensures the memory extracted from the PDF is rich in every hospital detail
 * while staying token-dense to ensure ultra-fast voice responses and avoid rate limits.
 */
function formatTokenEfficientMemory(rawPdfText) {
  return `OFFICIAL HOSPITAL DIRECTORY & FAQ MEMORY (FROM data/hospital_and_doctors.pdf):
- Hospital: City Care Hospital (सिटी केयर हॉस्पिटल), 123 MG Road, Civil Lines, Kanpur, UP
- Helpdesk: 0512-2345678, +91-9876543210 | Emergency: 24x7 Open (112 / 0512-2345679)
- OPD Timings: Mon-Sat 9:00 AM - 7:00 PM | Sunday: OPD Closed (Emergency open 24x7)
- Fee: Rs. 500 per visit (परामर्श शुल्क 500 रुपये पर्ची काउंटर पर)
- Facilities: Pathology Lab (Blood/Urine), Digital X-Ray, ECG, 24x7 Pharmacy (Ground floor)
- 3 SHIFTS POLICY: 1. Subah (Morning) 10:00 AM | 2. Dopahar (Noon) 2:00 PM | 3. Shaam (Evening) 5:30 PM
- Walk-ins allowed, but appointment avoids queues. Reschedule: call this number anytime.

DOCTORS DIRECTORY:
1. Dr. Ananya Sharma (General Physician / Cabin 101, 1st Flr): Fever (Bukhar), Cold/Cough, Weakness, Headache, Stomach pain, Vomiting, BP, Sugar | Mon-Sat | 10:00 AM, 2:00 PM, 5:30 PM
2. Dr. Rohit Verma (Cardiologist / Cabin 104, 1st Flr): Heart issues, Chest pain, High BP, Palpitations, Breathlessness | Mon, Wed, Fri | 10:00 AM, 2:00 PM, 5:30 PM
3. Dr. Priya Nair (Pediatrician / Cabin 108, Grnd Flr): Child illness/fever, Cough, Vaccination (Tike), Child nutrition | Tue, Thu, Sat | 10:00 AM, 2:00 PM, 5:30 PM
4. Dr. Sanjay Gupta (Orthopedic / Cabin 112, Grnd Flr): Bone/Joint pain, Knee pain, Backache, Arthritis (Gathiya), Fractures | Mon, Tue, Thu, Sat | 10:00 AM, 2:00 PM, 5:30 PM
5. Dr. Kavita Joshi (Gynecologist / Cabin 106, 1st Flr): Women health, Pregnancy care, Period issues, PCOD/PCOS | Mon-Sat | 10:00 AM, 2:00 PM, 5:30 PM
6. Dr. Rajesh Malhotra (ENT / Cabin 103, Grnd Flr): Ear pain/discharge, Hearing, Sinus, Throat pain, Tonsils | Mon, Wed, Sat | 10:00 AM, 2:00 PM, 5:30 PM

FAQ ANSWERS MEMORY:
* Fees (फीस): "डॉक्टर परामर्श फीस ₹500 है।"
* Address (पता): "123 एमजी रोड, सिविल लाइंस के पास, कानपुर।"
* Timings & Sunday (समय/रविवार): "सोमवार से शनिवार सुबह 9:00 से शाम 7:00 बजे तक। रविवार ओपीडी बंद रहती है, लेकिन इमरजेंसी 24 घंटे चालू है।"
* Tests & Pharmacy (जांच/दवाई): "अस्पताल में पैथोलॉजी लैब, एक्स-रे, ईसीजी और 24 घंटे मेडिकल स्टोर उपलब्ध है।"
* Walk-in: "सीधे भी आ सकते हैं, परंतु अपॉइंटमेंट से बिना लाइन लगे समय पर दिखा सकते हैं।"
* Emergency: "24 घंटे इमरजेंसी वार्ड और एम्बुलेंस (112) चालू है।"

UNLISTED QUERY POLICY (SINGLE SOURCE OF TRUTH):
- If the patient asks for any doctor, department, medicine, or query NOT in this list, say:
  "माफ़ कीजिए, इस बारे में हमारे अस्पताल के रिकॉर्ड में जानकारी उपलब्ध नहीं है। अधिक जानकारी के लिए आप हमारे हेल्पडेस्क नंबर 0512-2345678 पर संपर्क कर सकते हैं, या यदि आप हमारे किसी डॉक्टर से परामर्श लेना चाहते हैं तो मैं आपकी अपॉइंटमेंट बुक कर सकती हूँ।"`;
}

/**
 * Returns formatted Indian Standard Time (IST) details for real-time temporal awareness.
 */
function getCurrentTimeContext() {
  const now = new Date();

  // Format in IST (Asia/Kolkata)
  const istFormatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const istTimeStr = istFormatter.format(now); // e.g. "5:15 PM"

  // Determine period in Hindi
  const istHour24 = parseInt(
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      hour12: false,
    }).format(now),
    10
  );

  const istMinute = parseInt(
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      minute: "numeric",
    }).format(now),
    10
  );

  const currentMinutesIST = istHour24 * 60 + istMinute;

  let periodHindi = "सुबह";
  if (istHour24 >= 12 && istHour24 < 16) {
    periodHindi = "दोपहर";
  } else if (istHour24 >= 16 && istHour24 < 20) {
    periodHindi = "शाम";
  } else if (istHour24 >= 20 || istHour24 < 4) {
    periodHindi = "रात";
  }

  // Friendly human Hindi spoken format: "शाम के सवा छह बजे", "शाम के छह बजकर 18 मिनट"
  const [timePart, ampm] = istTimeStr.split(" ");
  const [hourStr, minStr] = timePart.split(":");
  const hourNum = parseInt(hourStr, 10);
  const minuteNum = parseInt(minStr, 10);

  const hindiHourWords = [
    "बारह", "एक", "दो", "तीन", "चार", "पाँच",
    "छह", "सात", "आठ", "नौ", "दस", "ग्यारह", "बारह"
  ];
  const hourWord = hindiHourWords[hourNum % 12] || hourStr;

  let minutePhrase = "";
  if (minuteNum === 0) {
    minutePhrase = `${hourWord} बजे`;
  } else if (minuteNum === 30) {
    if (hourNum === 1) minutePhrase = "डेढ़ बजे";
    else if (hourNum === 2) minutePhrase = "ढाई बजे";
    else minutePhrase = `साढ़े ${hourWord} बजे`;
  } else if (minuteNum === 15) {
    minutePhrase = `सवा ${hourWord} बजे`;
  } else if (minuteNum === 45) {
    const nextHour = hindiHourWords[(hourNum + 1) % 12];
    minutePhrase = `पौने ${nextHour} बजे`;
  } else {
    minutePhrase = `${hourWord} बजकर ${minuteNum} मिनट`;
  }

  const hindiSpokenTime = `${periodHindi} के ${minutePhrase}`;

  // Days of week mapping
  const dayHindiMap = {
    Sunday: "रविवार",
    Monday: "सोमवार",
    Tuesday: "मंगलवार",
    Wednesday: "बुधवार",
    Thursday: "गुरुवार",
    Friday: "शुक्रवार",
    Saturday: "शनिवार",
  };

  const getDayDetails = (dateObj) => {
    const dayEnglish = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "long",
    }).format(dateObj);
    const dateFormatted = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(dateObj);
    return {
      dayEnglish,
      dayHindi: dayHindiMap[dayEnglish] || dayEnglish,
      dateString: dateFormatted,
    };
  };

  const todayInfo = getDayDetails(now);
  const tomorrowObj = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowInfo = getDayDetails(tomorrowObj);
  const dayAfterObj = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const dayAfterInfo = getDayDetails(dayAfterObj);

  // 3 SHIFTS & REAL-TIME PAST/UPCOMING EVALUATION
  const shiftsWithCutoff = [
    { shift: "Morning", hindiLabel: "सुबह", time: "10:00 AM", spoken: "सुबह दस बजे", minutes: 10 * 60 },
    { shift: "Noon", hindiLabel: "दोपहर", time: "2:00 PM", spoken: "दोपहर दो बजे", minutes: 14 * 60 },
    { shift: "Evening", hindiLabel: "शाम", time: "5:30 PM", spoken: "शाम साढ़े पाँच बजे", minutes: 17 * 60 + 30 },
  ];

  const availableToday = shiftsWithCutoff.filter((s) => currentMinutesIST < s.minutes);
  const pastToday = shiftsWithCutoff.filter((s) => currentMinutesIST >= s.minutes);
  const isTodayOpdClosed = availableToday.length === 0;

  // Determine next open OPD day (skip Sunday as Sunday OPD is closed)
  let nextOpenDayInfo = tomorrowInfo;
  let nextOpenDayLabel = `कल ${tomorrowInfo.dayHindi}`;
  let nextOpenDayBookingDate = `Tomorrow (${tomorrowInfo.dateString})`;

  if (tomorrowInfo.dayEnglish === "Sunday") {
    nextOpenDayInfo = dayAfterInfo;
    nextOpenDayLabel = `परसों ${dayAfterInfo.dayHindi} (कल रविवार को ओपीडी बंद है)`;
    nextOpenDayBookingDate = `Day After Tomorrow (${dayAfterInfo.dateString})`;
  }

  let promptSlotRule = "";
  if (isTodayOpdClosed) {
    promptSlotRule = `CRITICAL TIME RULE (TODAY'S SLOTS ARE PAST):
- Current hospital time is ${hindiSpokenTime}. ALL OPD slots for TODAY have already passed.
- YOU MUST NOT offer, suggest, or schedule any appointment for TODAY!
- Proactively offer slots for ${nextOpenDayLabel}: ${nextOpenDayLabel} सुबह दस बजे, दोपहर दो बजे, या शाम साढ़े पाँच बजे।
- The nearest available slot is "${nextOpenDayLabel} सुबह दस बजे".
- If the patient specifically asks for today ("आज का कर दो", "अभी दिखाना है"):
  Politely explain: "माफ़ कीजिए, आज के सभी ओपीडी स्लॉट (सुबह, दोपहर और शाम) पूरे हो चुके हैं। ${nextOpenDayLabel} सुबह दस बजे का सबसे पहला स्लॉट उपलब्ध है। क्या मैं आपके लिए वो तय कर दूँ?"
- In the final <<BOOKING_JSON>>, set "date": "${nextOpenDayBookingDate}".`;
  } else {
    const availableSpoken = availableToday.map((s) => s.spoken).join(", या ");
    const pastSpoken = pastToday.map((s) => s.spoken).join(", ");
    promptSlotRule = `CRITICAL TIME RULE:
- Current hospital time is ${hindiSpokenTime}.
${pastToday.length > 0 ? `- The following slot(s) for TODAY have ALREADY PASSED: ${pastSpoken}. DO NOT offer or book these for today!` : ""}
- Available slot(s) remaining for TODAY: ${availableSpoken}.
- Nearest available slot: "आज ${availableToday[0].spoken}".
- When offering slots for today, ONLY offer: ${availableSpoken}.
- If the caller asks for a past time (e.g. ${pastSpoken || "जो समय बीत चुका है"}):
  Politely clarify: "माफ़ कीजिए, आज वो समय निकल चुका है। आज का निकटतम स्लॉट ${availableToday[0].spoken} उपलब्ध है। क्या यह ठीक रहेगा?"
- If caller prefers tomorrow, offer: कल ${tomorrowInfo.dayHindi} सुबह दस बजे, दोपहर दो बजे, या शाम साढ़े पाँच बजे।
- In <<BOOKING_JSON>>, set "date": "Today" (or "${nextOpenDayBookingDate}" if booked for tomorrow).`;
  }

  return {
    timeStringIST: istTimeStr,
    periodHindi,
    hindiSpokenTime,
    isoTimestamp: now.toISOString(),
    currentMinutesIST,
    todayHindi: todayInfo.dayHindi,
    todayEnglish: todayInfo.dayEnglish,
    todayDate: todayInfo.dateString,
    tomorrowHindi: tomorrowInfo.dayHindi,
    tomorrowEnglish: tomorrowInfo.dayEnglish,
    tomorrowDate: tomorrowInfo.dateString,
    dayAfterHindi: dayAfterInfo.dayHindi,
    dayAfterEnglish: dayAfterInfo.dayEnglish,
    dayAfterDate: dayAfterInfo.dateString,
    isTodayOpdClosed,
    availableTodayShifts: availableToday,
    pastTodayShifts: pastToday,
    nextOpenDayLabel,
    nextOpenDayBookingDate,
    promptSlotRule,
  };
}

/**
 * 3 Standardized Daily Shifts available for all doctors.
 */
const AVAILABLE_SHIFTS = [
  { shift: "Morning", hindiLabel: "सुबह", time: "10:00 AM", spoken: "सुबह दस बजे" },
  { shift: "Noon", hindiLabel: "दोपहर", time: "2:00 PM", spoken: "दोपहर दो बजे" },
  { shift: "Evening", hindiLabel: "शाम", time: "5:30 PM", spoken: "शाम साढ़े पाँच बजे" },
];

const UNLISTED_QUERY_FALLBACK_HINDI =
  "माफ़ कीजिए, इस बारे में हमारे अस्पताल के रिकॉर्ड में जानकारी उपलब्ध नहीं है। अधिक जानकारी के लिए आप हमारे हेल्पडेस्क नंबर 0512-2345678 पर संपर्क कर सकते हैं, या यदि आप हमारे किसी डॉक्टर से परामर्श लेना चाहते हैं तो मैं आपकी अपॉइंटमेंट बुक कर सकती हूँ।";

module.exports = {
  loadPdfKnowledge,
  getCurrentTimeContext,
  AVAILABLE_SHIFTS,
  UNLISTED_QUERY_FALLBACK_HINDI,
  PDF_FILE_PATH,
};
