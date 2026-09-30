/**
 * Hospital Configuration and Doctors Directory.
 * Synchronized with the official Hospital & Doctors Directory PDF (data/hospital_and_doctors.pdf).
 */

module.exports = {
  hospitalName: "सिटी केयर हॉस्पिटल (City Care Hospital)",
  hospitalPhone: "0512-2345678",
  emergencyPhone: "112 / 0512-2345679",
  address: "123 एमजी रोड, सिविल लाइंस के पास, कानपुर, उत्तर प्रदेश (123 MG Road, Kanpur)",
  consultationFee: "₹500 (परामर्श शुल्क 500 रुपये)",
  workingHours: "सुबह 9:00 बजे से शाम 7:00 बजे तक (सोमवार से शनिवार)",

  // Natural, warm human greeting
  greeting:
    "नमस्ते! सिटी केयर हॉस्पिटल में आपका स्वागत है। मैं आपकी अपॉइंटमेंट असिस्टेंट हूँ। बताइए, आज आपको क्या स्वास्थ्य परेशानी है, या किस डॉक्टर को दिखाना चाहते हैं?",

  // Standardized 3 Daily Shifts for all doctors
  shifts: [
    { label: "सुबह", time: "10:00 AM", spoken: "सुबह 10:00 बजे" },
    { label: "दोपहर", time: "2:00 PM", spoken: "दोपहर 2:00 बजे" },
    { label: "शाम", time: "5:30 PM", spoken: "शाम 5:30 बजे" },
  ],

  // Complete List of Hospital Doctors
  doctors: [
    {
      name: "Dr. Ananya Sharma",
      hindiName: "डॉक्टर अनन्या शर्मा",
      specialty: "General Physician (सामान्य चिकित्सक)",
      qualifications: "MBBS, MD (General Medicine)",
      room: "Cabin 101, First Floor",
      availableDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      availableSlots: ["10:00 AM", "2:00 PM", "5:30 PM"],
      slotLabels: ["सुबह 10:00 बजे", "दोपहर 2:00 बजे", "शाम 5:30 बजे"],
      symptoms: "बुखार, जुकाम, खांसी, कमजोरी, सिरदर्द, पेट दर्द, उल्टी, दस्त, वायरल इन्फेक्शन, बीपी, शुगर",
    },
    {
      name: "Dr. Rohit Verma",
      hindiName: "डॉक्टर रोहित वर्मा",
      specialty: "Cardiologist (हृदय रोग विशेषज्ञ)",
      qualifications: "MBBS, MD, DM (Cardiology)",
      room: "Cabin 104, First Floor",
      availableDays: ["Monday", "Wednesday", "Friday"],
      availableSlots: ["10:00 AM", "2:00 PM", "5:30 PM"],
      slotLabels: ["सुबह 10:00 बजे", "दोपहर 2:00 बजे", "शाम 5:30 बजे"],
      symptoms: "दिल की बीमारी, सीने में दर्द, हाई बीपी, घबराहट, दिल की धड़कन तेज होना, सांस फूलना",
    },
    {
      name: "Dr. Priya Nair",
      hindiName: "डॉक्टर प्रिया नायर",
      specialty: "Pediatrician (शिशु एवं बाल रोग विशेषज्ञ)",
      qualifications: "MBBS, MD (Pediatrics), DCH",
      room: "Cabin 108, Ground Floor",
      availableDays: ["Tuesday", "Thursday", "Saturday"],
      availableSlots: ["10:00 AM", "2:00 PM", "5:30 PM"],
      slotLabels: ["सुबह 10:00 बजे", "दोपहर 2:00 बजे", "शाम 5:30 बजे"],
      symptoms: "बच्चों का बुखार, शिशु जुकाम-खांसी, टीकाकरण (वैक्सीनेशन), बच्चों की कमजोरी, पेट दर्द",
    },
    {
      name: "Dr. Sanjay Gupta",
      hindiName: "डॉक्टर संजय गुप्ता",
      specialty: "Orthopedic Surgeon (हड्डी एवं जोड़ रोग विशेषज्ञ)",
      qualifications: "MBBS, MS (Orthopedics)",
      room: "Cabin 112, Ground Floor",
      availableDays: ["Monday", "Tuesday", "Thursday", "Saturday"],
      availableSlots: ["10:00 AM", "2:00 PM", "5:30 PM"],
      slotLabels: ["सुबह 10:00 बजे", "दोपहर 2:00 बजे", "शाम 5:30 बजे"],
      symptoms: "हड्डियों व जोड़ों का दर्द, घुटनों का दर्द, कमर दर्द, गठिया (Arthritis), मोच, फ्रैक्चर",
    },
    {
      name: "Dr. Kavita Joshi",
      hindiName: "डॉक्टर कविता जोशी",
      specialty: "Gynecologist & Obstetrician (स्त्री एवं प्रसूति रोग विशेषज्ञ)",
      qualifications: "MBBS, MS (Obstetrics & Gynecology)",
      room: "Cabin 106, First Floor",
      availableDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      availableSlots: ["10:00 AM", "2:00 PM", "5:30 PM"],
      slotLabels: ["सुबह 10:00 बजे", "दोपहर 2:00 बजे", "शाम 5:30 बजे"],
      symptoms: "महिला स्वास्थ्य, गर्भावस्था परामर्श (Pregnancy), अनियमित पीरियड्स, पीसीओडी/पीसीओएस",
    },
    {
      name: "Dr. Rajesh Malhotra",
      hindiName: "डॉक्टर राजेश मल्होत्रा",
      specialty: "ENT Specialist (कान, नाक एवं गला विशेषज्ञ)",
      qualifications: "MBBS, MS (ENT)",
      room: "Cabin 103, Ground Floor",
      availableDays: ["Monday", "Wednesday", "Saturday"],
      availableSlots: ["10:00 AM", "2:00 PM", "5:30 PM"],
      slotLabels: ["सुबह 10:00 बजे", "दोपहर 2:00 बजे", "शाम 5:30 बजे"],
      symptoms: "कान का दर्द या बहना, कम सुनाई देना, साइनस, बंद नाक, गले में दर्द, टॉन्सिल, खर्राटे",
    },
  ],

  emergencyNote:
    "यदि यह कोई गंभीर इमरजेंसी है, तो कृपया तुरंत अस्पताल के 24x7 इमरजेंसी वार्ड (123 एमजी रोड, कानपुर) में आएं या 112 पर कॉल करें।",
  unlistedQueryFallback:
    "माफ़ कीजिए जी, इस बारे में हमारे अस्पताल के रिकॉर्ड में जानकारी उपलब्ध नहीं है। अधिक जानकारी के लिए आप हमारे हेल्पडेस्क नंबर 0512-2345678 पर संपर्क कर सकते हैं, या यदि आप किसी डॉक्टर से परामर्श लेना चाहते हैं तो मैं आपकी अपॉइंटमेंट बुक कर सकती हूँ।",
};
