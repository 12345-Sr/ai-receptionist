/**
 * SINGLE SOURCE OF TRUTH for hospital data: KMC Hospital (Kanpur Medical Centre Pvt. Ltd.)
 * Official Website: https://kmcpvtltd.com
 * Address: 120/500 (23-24) Lajpat Nagar, Near JK Temple, Kanpur - 208005, Uttar Pradesh
 */

module.exports = {
  hospitalName: "केएमसी हॉस्पिटल (कानपुर मेडिकल सेन्टर)",
  hospitalNameEn: "KMC Hospital (Kanpur Medical Centre)",
  hospitalPhone: "+91-7408412008",
  helpdeskMobile: "+91-8601012233",
  emergencyPhone: "1800 120 3176 (टोल-फ्री) / +91-7408412008",
  address: "120/500 (23-24) लाजपत नगर, जे.के. टेम्पल के पास, कानपुर - 208005",
  consultationFee: 500,
  opdDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  opdHoursText:
    "सोमवार से शनिवार, सुबह दस से शाम सात बजे तक। रविवार ओपीडी बंद रहती है, 24 घंटे इमरजेंसी, आईसीयू और फार्मेसी खुली है।",

  // Receptionist ka naam — human feel
  assistantName: "नेहा",

  greeting:
    "नमस्ते, केएमसी हॉस्पिटल कानपुर से नेहा बात कर रही हूँ। बताइए, मैं आपकी क्या मदद कर सकती हूँ?",

  // Appointment shifts (standardized 3 daily shifts)
  shifts: [
    { key: "morning", time: "10:00 AM", minutes: 10 * 60, spoken: "सुबह दस बजे" },
    { key: "noon", time: "2:00 PM", minutes: 14 * 60, spoken: "दोपहर दो बजे" },
    { key: "evening", time: "5:30 PM", minutes: 17 * 60 + 30, spoken: "शाम साढ़े पाँच बजे" },
  ],

  // Shift capacity & lead time
  slotCapacity: Number(process.env.SLOT_CAPACITY || 8),
  slotLeadMinutes: Number(process.env.SLOT_LEAD_MINUTES || 30),

  doctors: [
    {
      name: "Dr. H.S. Chawla",
      hindiName: "डॉक्टर एच.एस. चावला",
      specialty: "General Physician",
      specialtyHindi: "जनरल फिजिशियन (वरिष्ठ चिकित्सक)",
      qualifications: "M.D. Medicine",
      room: "Cabin 101, Ground Floor",
      availableDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      symptoms: "बुखार, जुकाम, खांसी, कमजोरी, सिरदर्द, बीपी, शुगर, पेट दर्द, उल्टी, दस्त, वायरल फीवर, सामान्य बीमारियां",
      aliases: ["chawla", "hs chawla", "एचएस चावला", "चावला", "general", "जनरल", "physician", "फिजिशियन", "medicine"],
    },
    {
      name: "Dr. Gaurav Chawla",
      hindiName: "डॉक्टर गौरव चावला",
      specialty: "Gastroenterologist",
      specialtyHindi: "पेट, गैस व लिवर रोग विशेषज्ञ",
      qualifications: "M.D. Med, D.M. Gastroenterology (CMC Vellore)",
      room: "Cabin 105, First Floor",
      availableDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      symptoms: "गैस, एसिडिटी, पेट दर्द, अपच, कब्ज, लिवर की बीमारी, पीलिया, हेपेटाइटिस, उल्टी, एंडोस्कोपी, आंतों में जलन",
      aliases: ["gaurav", "गौरव", "gastro", "गैस्ट्रो", "पेट", "liver", "लिवर", "stomach", "endoscopy", "acid"],
    },
    {
      name: "Dr. Saurabh Chawla",
      hindiName: "डॉक्टर सौरभ चावला",
      specialty: "Orthopedic",
      specialtyHindi: "हड्डी, जोड़ व रीढ़ रोग विशेषज्ञ",
      qualifications: "M.S. Ortho (Consultant Orthopedic Surgeon)",
      room: "Cabin 108, Ground Floor",
      availableDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      symptoms: "हड्डी और जोड़ों का दर्द, घुटने का दर्द, गठिया, कमर दर्द, साइटिका, स्पाइन, फ्रैक्चर, मोच, लिगामेंट इंजरी",
      aliases: ["saurabh", "सौरभ", "ortho", "ऑर्थो", "हड्डी", "joint", "जोड़", "ghutna", "घुटने", "spine"],
    },
    {
      name: "Dr. Rashmi Suri",
      hindiName: "डॉक्टर रश्मि सूरी",
      specialty: "Gynecologist",
      specialtyHindi: "स्त्री एवं प्रसूति रोग विशेषज्ञ",
      qualifications: "M.S. OBG",
      room: "Cabin 104, First Floor",
      availableDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      symptoms: "महिला स्वास्थ्य, प्रेगनेंसी (गर्भावस्था), पीरियड्स/माहवारी की समस्या, पीसीओडी (PCOD/PCOS), बांझपन, डिलीवरी",
      aliases: ["rashmi", "रश्मि", "suri", "सूरी", "gyn", "गाइनी", "गायनी", "महिला", "pregnancy", "स्त्री", "periods"],
    },
    {
      name: "Dr. C.S. Gandhi",
      hindiName: "डॉक्टर सी.एस. गांधी",
      specialty: "Pediatrician",
      specialtyHindi: "शिशु एवं बाल रोग विशेषज्ञ",
      qualifications: "M.D. Paediatrics",
      room: "Cabin 102, Ground Floor (Children Ward)",
      availableDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      symptoms: "बच्चों का बुखार, शिशु जुकाम-खांसी, बच्चों का पेट दर्द, उल्टी-दस्त, टीकाकरण (वैक्सीनेशन), बच्चों का विकास",
      aliases: ["gandhi", "गांधी", "cs gandhi", "pediatric", "पीडियाट्रिक", "बच्चों", "बच्चा", "child", "infant"],
    },
    {
      name: "Dr. Shubhendu Bhaduri",
      hindiName: "डॉक्टर शुभेंदु भादुरी",
      specialty: "Urologist",
      specialtyHindi: "मूत्र, पथरी एवं प्रोस्टेट रोग विशेषज्ञ",
      qualifications: "M.S. Gen Surgery, M.Ch. Urology",
      room: "Cabin 110, First Floor",
      availableDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      symptoms: "गुर्दे की पथरी (किडनी स्टोन), पेशाब में जलन या दर्द, पेशाब रुकना, प्रोस्टेट, यूरिन इन्फेक्शन, मूत्राशय रोग",
      aliases: ["shubhendu", "शुभेंदु", "bhaduri", "भादुरी", "urology", "यूरोलॉजी", "पथरी", "stone", "kidney", "urine", "पेशाब"],
    },
    {
      name: "Dr. Varsha Ambwani",
      hindiName: "डॉक्टर वर्षा अम्बवानी",
      specialty: "Neurologist",
      specialtyHindi: "न्यूरोलॉजिस्ट (मस्तिष्क एवं नस रोग विशेषज्ञ)",
      qualifications: "M.D., D.M. Neurology (SGPGI Lucknow)",
      room: "Cabin 106, First Floor",
      availableDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      symptoms: "सिरदर्द, माइग्रेन, चक्कर आना, मिर्गी (दौरे), नसों में सुन्नपन या कमजोरी, पैरालिसिस (लकवा), नसों का दर्द",
      aliases: ["varsha", "वर्षा", "ambwani", "अम्बवानी", "neuro", "न्यूरो", "दिमाग", "नस", "माइग्रेन", "brain"],
    },
    {
      name: "Dr. A.K. Verma",
      hindiName: "डॉक्टर ए.के. वर्मा",
      specialty: "Pulmonologist",
      specialtyHindi: "फेफड़े व श्वास रोग विशेषज्ञ",
      qualifications: "M.D., D.M. Chest & Respiratory Medicine",
      room: "Cabin 107, First Floor",
      availableDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      symptoms: "सांस फूलना, दमा (अस्थमा), पुरानी खांसी, सीने में जकड़न, फेफड़ों का इन्फेक्शन, टीबी, एलर्जी, खर्राटे",
      aliases: ["verma", "ak verma", "एके वर्मा", "वर्मा", "chest", "चेस्ट", "pulmo", "सांस", "दमा", "lungs", "asthma"],
    },
    {
      name: "Dr. Umesh Kapoor",
      hindiName: "डॉक्टर उमेश कपूर",
      specialty: "Dermatologist",
      specialtyHindi: "त्वचा, बाल एवं चर्म रोग विशेषज्ञ",
      qualifications: "Consultant Dermatologist",
      room: "Cabin 103, Ground Floor",
      availableDays: ["Monday", "Wednesday", "Friday"],
      symptoms: "त्वचा में खुजली, एलर्जी, दाद, खाज, मुँहासे, बाल झड़ना, चर्म रोग, फंगल इन्फेक्शन",
      aliases: ["umesh", "उमेश", "kapoor", "कपूर", "skin", "स्किन", "चर्म", "derma", "डर्मा", "त्वचा"],
    },
  ],

  faq: [
    "फीस: डॉक्टर की परामर्श फीस 500 रुपये है, जो रिसेप्शन काउंटर पर जमा होती है।",
    "पता: 120/500 (23-24) लाजपत नगर, जे.के. टेम्पल के पास, कानपुर - 208005।",
    "सुविधाएँ: 24x7 इमरजेंसी एवं ट्रॉमा, आईसीयू/एनआईसीयू, डायलिसिस, सीटी स्कैन, अल्ट्रासाउंड, डिजिटल एक्स-रे, पैथोलॉजी लैब, और 24x7 इन-हाउस मेडिकल स्टोर।",
    "वॉक-इन: सीधे भी आ सकते हैं, पर अपॉइंटमेंट से लाइन में इंतज़ार नहीं करना पड़ता।",
    "इमरजेंसी: 24 घंटे इमरजेंसी व एम्बुलेंस सेवा उपलब्ध है, टोल-फ्री नंबर 1800 120 3176 पर संपर्क करें।",
    "रीशेड्यूल/कैंसिल: इसी नंबर पर कॉल करके करवा सकते हैं।",
  ],

  // Emergency / handoff lines (deterministic)
  emergencyReply:
    "यह इमरजेंसी लग रही है। कृपया तुरंत हमारे टोल-फ्री नंबर 1800 120 3176 पर कॉल करें या सीधे केएमसी इमरजेंसी वार्ड लाजपत नगर कानपुर आएँ, वो चौबीसों घंटे खुला है।",
  handoffReply: "ठीक है, मैं आपको हमारे रिसेप्शन से जोड़ रही हूँ, एक पल रुकिए।",
  unlistedQueryFallback:
    "माफ़ कीजिए, इसकी जानकारी हमारे अस्पताल रिकॉर्ड में उपलब्ध नहीं है। आप केएमसी हेल्पडेस्क नंबर 7408412008 या टोल-फ्री 1800 120 3176 पर पूछ सकते हैं। क्या मैं किसी डॉक्टर की अपॉइंटमेंट बुक कर दूँ?",
};
