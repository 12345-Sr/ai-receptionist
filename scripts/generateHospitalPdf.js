const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

/**
 * Generates the official KMC Hospital (Kanpur Medical Centre Pvt. Ltd.) & Doctors Directory PDF.
 * Official Website: https://kmcpvtltd.com
 * Address: 120/500 (23-24) Lajpat Nagar, Near JK Temple, Kanpur - 208005, Uttar Pradesh
 */
function generateHospitalPdf(outputPath) {
  const targetPath =
    outputPath || path.join(__dirname, "..", "data", "hospital_and_doctors.pdf");

  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const writeStream = fs.createWriteStream(targetPath);

    doc.pipe(writeStream);

    // Header Box
    doc.rect(40, 40, 515, 60).fill("#1a365d");

    doc
      .fillColor("#ffffff")
      .fontSize(18)
      .font("Helvetica-Bold")
      .text("KMC HOSPITAL (Kanpur Medical Centre Pvt. Ltd.)", 50, 50, { align: "center", width: 495 });

    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor("#e2e8f0")
      .text("Official Hospital & Doctors Directory - Lajpat Nagar, Kanpur | https://kmcpvtltd.com", 50, 74, {
        align: "center",
        width: 495,
      });

    doc.moveDown(2);

    // Section 1: Hospital Overview
    doc
      .fillColor("#1a365d")
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("1. HOSPITAL GENERAL INFORMATION & CONTACT DETAILS");

    doc
      .strokeColor("#cbd5e1")
      .lineWidth(1)
      .moveTo(40, doc.y + 2)
      .lineTo(555, doc.y + 2)
      .stroke();

    doc.moveDown(0.6);

    const hospitalDetails = [
      ["Hospital Name:", "KMC Hospital (Kanpur Medical Centre Pvt. Ltd., Lajpat Nagar, Kanpur)"],
      ["Official Website:", "https://kmcpvtltd.com"],
      ["Address:", "120/500 (23-24) Lajpat Nagar, Near J.K. Temple, Kanpur, Uttar Pradesh - 208005"],
      ["Reception & Helpline:", "+91-7408412008, +91-8601012233, +91-7068468946"],
      ["Emergency & Ambulance:", "24x7 Open (Toll-Free Emergency Helpline: 1800 120 3176 / +91-7408412008)"],
      ["OPD Timings:", "Monday to Saturday, 10:00 AM to 7:00 PM (Subah 10 baje se Shaam 7 baje tak)"],
      ["Sunday Schedule:", "OPD Closed on Sundays (Emergency, ICU, Trauma & Pharmacy remain open 24x7)."],
      ["OPD Consultation Fee:", "Rs. 500 per visit (Paramarsh Shulk: 500 Rupaye)"],
      [
        "Hospital Facilities:",
        "24x7 Emergency & Trauma, ICU / HDU / NICU, Dialysis Unit, CT Scan, Ultrasound, Digital X-Ray, Pathology Lab, Endoscopy Unit, 24x7 IPD/OPD Pharmacy.",
      ],
    ];

    doc.fontSize(8.5).font("Helvetica");
    hospitalDetails.forEach(([label, value]) => {
      doc
        .font("Helvetica-Bold")
        .fillColor("#0f172a")
        .text(label, { continued: true, width: 150 })
        .font("Helvetica")
        .fillColor("#334155")
        .text(" " + value);
      doc.moveDown(0.2);
    });

    doc.moveDown(0.7);

    // Section 2: Three Daily Appointment Shifts Policy
    doc
      .fillColor("#1a365d")
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("2. APPOINTMENT TIME SLOTS POLICY (THREE SHIFTS ONLY)");

    doc
      .strokeColor("#cbd5e1")
      .lineWidth(1)
      .moveTo(40, doc.y + 2)
      .lineTo(555, doc.y + 2)
      .stroke();

    doc.moveDown(0.5);

    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#334155")
      .text(
        "For all OPD doctors at KMC Hospital Kanpur, appointments are scheduled in THREE standardized daily shifts:"
      );

    doc.moveDown(0.3);

    const shifts = [
      ["Shift 1: Subah (Morning Shift)", "10:00 AM (Subah 10:00 Baje)"],
      ["Shift 2: Dopahar / Noon (Afternoon Shift)", "2:00 PM (Dopahar 2:00 Baje)"],
      ["Shift 3: Shaam (Evening Shift)", "5:30 PM (Shaam 5:30 Baje)"],
    ];

    shifts.forEach(([shiftName, timeSlot]) => {
      doc
        .font("Helvetica-Bold")
        .fillColor("#0f766e")
        .text("   * " + shiftName + ": ", { continued: true })
        .fillColor("#0f172a")
        .text(timeSlot);
      doc.moveDown(0.2);
    });

    doc.moveDown(0.7);

    // Section 3: Complete Doctors Directory
    doc
      .fillColor("#1a365d")
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("3. DOCTORS DIRECTORY, SPECIALTIES & SCHEDULE (KMC HOSPITAL KANPUR)");

    doc
      .strokeColor("#cbd5e1")
      .lineWidth(1)
      .moveTo(40, doc.y + 2)
      .lineTo(555, doc.y + 2)
      .stroke();

    doc.moveDown(0.5);

    const doctors = [
      {
        name: "Dr. H.S. Chawla",
        hindiTitle: "Doctor H.S. Chawla (Consultant Physician / General Medicine)",
        specialty: "General Medicine / Physician",
        qualifications: "M.D. Medicine",
        room: "Cabin 101, Ground Floor",
        days: "Monday to Saturday (Somwar se Shanivar)",
        shifts: "Subah 10:00 AM, Dopahar 2:00 PM, Shaam 5:30 PM",
        fee: "Rs. 500",
        symptoms:
          "Fever (Bukhar), Cold & Cough (Jukam, Khansi), Body weakness (Kamjori), Headache (Sirdard), Viral infections, BP & Sugar checkup, Stomach pain (Pet dard), General ailments.",
      },
      {
        name: "Dr. Gaurav Chawla",
        hindiTitle: "Doctor Gaurav Chawla (Gastroenterologist & Hepatologist / Pet evum Liver Rog)",
        specialty: "Gastroenterology & Hepatology (Digestive & Liver Specialist)",
        qualifications: "M.D. Med, D.M. Gastroenterology (CMC Vellore)",
        room: "Cabin 105, First Floor",
        days: "Monday to Saturday (Somwar se Shanivar)",
        shifts: "Subah 10:00 AM, Dopahar 2:00 PM, Shaam 5:30 PM",
        fee: "Rs. 500",
        symptoms:
          "Acidity, Gas, Indigestion (Apach), Constipation (Kabz), Liver problems, Jaundice (Peeliya), Hepatitis, Stomach burning/ulcers, Vomiting, Endoscopy inquiries.",
      },
      {
        name: "Dr. Saurabh Chawla",
        hindiTitle: "Doctor Saurabh Chawla (Orthopedic Surgeon / Haddi, Jod evum Spine Rog)",
        specialty: "Orthopedics & Joint Replacement (Bone & Joint Specialist)",
        qualifications: "M.S. Ortho (Consultant Orthopedic Surgeon)",
        room: "Cabin 108, Ground Floor",
        days: "Monday to Saturday (Somwar se Shanivar)",
        shifts: "Subah 10:00 AM, Dopahar 2:00 PM, Shaam 5:30 PM",
        fee: "Rs. 500",
        symptoms:
          "Bone & Joint pain (Haddiyon aur jodon ka dard), Knee pain (Ghutne ka dard), Backache & Spine (Kamar dard, Sciatica), Arthritis (Gathiya), Sprains (Moch), Fractures.",
      },
      {
        name: "Dr. Rashmi Suri",
        hindiTitle: "Doctor Rashmi Suri (Gynecologist / Stri evum Prasuti Rog Visheshagya)",
        specialty: "Obstetrics & Gynecology (Women Health & Maternity)",
        qualifications: "M.S. OBG",
        room: "Cabin 104, First Floor",
        days: "Monday to Saturday (Somwar se Shanivar)",
        shifts: "Subah 10:00 AM, Dopahar 2:00 PM, Shaam 5:30 PM",
        fee: "Rs. 500",
        symptoms:
          "Women's health (Mahila swasthya), Pregnancy care (Garbhavastha paramarsh), Irregular Periods & PCOS/PCOD, Infertility, Antenatal checkup, Delivery planning.",
      },
      {
        name: "Dr. C.S. Gandhi",
        hindiTitle: "Doctor C.S. Gandhi (Pediatrician / Shishu evum Baal Rog Visheshagya)",
        specialty: "Paediatrics & Neonatology (Child Specialist)",
        qualifications: "M.D. Paediatrics",
        room: "Cabin 102, Ground Floor (Children Ward)",
        days: "Monday to Saturday (Somwar se Shanivar)",
        shifts: "Subah 10:00 AM, Dopahar 2:00 PM, Shaam 5:30 PM",
        fee: "Rs. 500",
        symptoms:
          "Child fever (Bachhon ka bukhar), Cough & Cold in babies (Shishu jukam), Child stomach issues, Vaccination (Tika-karan), Child growth, newborn care.",
      },
      {
        name: "Dr. Shubhendu Bhaduri",
        hindiTitle: "Doctor Shubhendu Bhaduri (Urologist / Mutra, Pathri evum Kidney Rog)",
        specialty: "Urology & General Surgery (Kidney Stone & Urinary Specialist)",
        qualifications: "M.S. Gen Surgery, M.Ch. Urology",
        room: "Cabin 110, First Floor",
        days: "Monday to Saturday (Somwar se Shanivar)",
        shifts: "Subah 10:00 AM, Dopahar 2:00 PM, Shaam 5:30 PM",
        fee: "Rs. 500",
        symptoms:
          "Kidney stones (Gurde ki pathri), Burning or pain in urine (Peshabor jalan), Urinary blockage, Prostate enlargement, UTI, bladder disorders.",
      },
      {
        name: "Dr. Varsha Ambwani",
        hindiTitle: "Doctor Varsha Ambwani (Neurologist / Mashtishk evum Nas Rog Visheshagya)",
        specialty: "Neurology (Brain, Nerve & Headache Specialist)",
        qualifications: "M.D., D.M. Neurology (SGPGI Lucknow)",
        room: "Cabin 106, First Floor",
        days: "Monday to Saturday (Somwar se Shanivar)",
        shifts: "Subah 10:00 AM, Dopahar 2:00 PM, Shaam 5:30 PM",
        fee: "Rs. 500",
        symptoms:
          "Chronic headache, Migraine (Aadhe sar ka dard), Vertigo (Chakkar), Seizures / Epilepsy (Mirgi/daure), Nerve numbness, Paralysis (Lakwa), neuropathy.",
      },
      {
        name: "Dr. A.K. Verma",
        hindiTitle: "Doctor A.K. Verma (Pulmonologist / Phepde evum Shwas Rog Visheshagya)",
        specialty: "Respiratory Medicine & Pulmonology (Chest & Lungs Specialist)",
        qualifications: "M.D., D.M. Chest",
        room: "Cabin 107, First Floor",
        days: "Monday to Saturday (Somwar se Shanivar)",
        shifts: "Subah 10:00 AM, Dopahar 2:00 PM, Shaam 5:30 PM",
        fee: "Rs. 500",
        symptoms:
          "Shortness of breath (Saans phoolna), Asthma (Dama), Chronic cough (Purani khansi), Chest congestion, Lung infections, TB, respiratory allergy.",
      },
      {
        name: "Dr. Umesh Kapoor",
        hindiTitle: "Doctor Umesh Kapoor (Dermatologist / Twacha, Baal evum Charm Rog)",
        specialty: "Dermatology (Skin, Hair & Venereology Specialist)",
        qualifications: "Consultant Dermatologist",
        room: "Cabin 103, Ground Floor",
        days: "Monday, Wednesday, Friday (Somwar, Budhwar, Shukrawar)",
        shifts: "Subah 10:00 AM, Dopahar 2:00 PM, Shaam 5:30 PM",
        fee: "Rs. 500",
        symptoms:
          "Skin itching (Khujli), Allergies, Fungal infections, Ringworm (Daad-khaj), Acne / Pimples, Hair fall, Psoriasis, skin rash.",
      },
    ];

    doctors.forEach((docInfo, idx) => {
      if (doc.y > 670) {
        doc.addPage();
      }

      doc
        .fontSize(9.5)
        .font("Helvetica-Bold")
        .fillColor("#1e293b")
        .text(`${idx + 1}. ${docInfo.name} - ${docInfo.specialty}`);

      doc
        .fontSize(8)
        .font("Helvetica-Bold")
        .fillColor("#0f766e")
        .text("   Qualifications: ", { continued: true })
        .font("Helvetica")
        .fillColor("#334155")
        .text(docInfo.qualifications, { continued: true })
        .font("Helvetica-Bold")
        .fillColor("#0f766e")
        .text(" | Cabin: ", { continued: true })
        .font("Helvetica")
        .fillColor("#334155")
        .text(docInfo.room);

      doc
        .fontSize(8)
        .font("Helvetica-Bold")
        .fillColor("#0f766e")
        .text("   Available Days: ", { continued: true })
        .font("Helvetica")
        .fillColor("#334155")
        .text(docInfo.days, { continued: true })
        .font("Helvetica-Bold")
        .fillColor("#0f766e")
        .text(" | Shifts: ", { continued: true })
        .font("Helvetica-Bold")
        .fillColor("#b45309")
        .text(docInfo.shifts);

      doc
        .fontSize(8)
        .font("Helvetica-Bold")
        .fillColor("#0f766e")
        .text("   Symptoms Treated: ", { continued: true })
        .font("Helvetica")
        .fillColor("#334155")
        .text(docInfo.symptoms);

      doc.moveDown(0.4);
    });

    if (doc.y > 640) {
      doc.addPage();
    }

    // Section 4: Strict Knowledge Boundary & Policy
    doc.moveDown(0.5);
    doc
      .fillColor("#b91c1c")
      .fontSize(11)
      .font("Helvetica-Bold")
      .text("4. STRICT KNOWLEDGE BOUNDARY & UNLISTED INQUIRIES RULE");

    doc
      .strokeColor("#fca5a5")
      .lineWidth(1)
      .moveTo(40, doc.y + 2)
      .lineTo(555, doc.y + 2)
      .stroke();

    doc.moveDown(0.4);

    doc
      .fontSize(8.5)
      .font("Helvetica")
      .fillColor("#334155")
      .text(
        "Single Source of Truth Rule: The AI Receptionist must strictly base answers on KMC Hospital's official record. If a caller asks questions not covered in this directory (e.g. unlisted medical procedures, outside medications, dental surgery), do not hallucinate."
      );

    doc.moveDown(0.3);

    doc
      .font("Helvetica-Bold")
      .fillColor("#b91c1c")
      .fontSize(8.5)
      .text(
        'Required Fallback Response for Unlisted Queries: "Maaf kijiye ji, is baare mein hamare hospital record mein jaankari uplabdh nahi hai. Adhik jaankari ke liye aap hamare KMC helpline number 7408412008 ya toll-free 1800 120 3176 par sampark kar sakte hain, ya yadi aap doctor se paramarsh chahte hain to main appointment book kar sakti hoon."'
      );

    doc.moveDown(0.3);

    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor("#64748b")
      .text(
        "Emergency Protocol: In life-threatening emergencies, advise the caller to immediately come to KMC Hospital 24x7 Emergency Room at 120/500 Lajpat Nagar, Near JK Temple, Kanpur, or call 1800 120 3176 directly."
      );

    // Section 5: FAQs
    if (doc.y > 550) {
      doc.addPage();
    } else {
      doc.moveDown(0.6);
    }

    doc
      .fillColor("#1a365d")
      .fontSize(11)
      .font("Helvetica-Bold")
      .text("5. FREQUENTLY ASKED PATIENT QUESTIONS & OFFICIAL ANSWERS (FAQ MEMORY)");

    doc
      .strokeColor("#cbd5e1")
      .lineWidth(1)
      .moveTo(40, doc.y + 2)
      .lineTo(555, doc.y + 2)
      .stroke();

    doc.moveDown(0.4);

    const faqs = [
      [
        "Q1: Doctor consultation fees kitni hai? (Fees / Charges)",
        "A: Doctor consultation fee is flat Rs. 500 per visit, payable at the KMC Hospital reception counter.",
      ],
      [
        "Q2: Hospital kahan par hai aur kaise pahunchein? (Address / Location)",
        "A: KMC Hospital is located at 120/500 (23-24) Lajpat Nagar, near JK Temple, Kanpur, Uttar Pradesh (Pin 208005).",
      ],
      [
        "Q3: OPD ka samay kya hai aur kya Sunday ko doctor milte hain? (Timings / Sunday)",
        "A: OPD runs Monday to Saturday, 10:00 AM to 7:00 PM. Sunday OPD is closed, but 24x7 Emergency, ICU & Pharmacy are always open.",
      ],
      [
        "Q4: Doctors ke milne ke kaun se 3 samay uplabdh hain? (3 Shifts Policy)",
        "A: All consultations have 3 daily shifts: Subah 10:00 AM, Dopahar 2:00 PM, and Shaam 5:30 PM.",
      ],
      [
        "Q5: Kya CT Scan, Dialysis, X-Ray ya Ultrasound ki suvidha hai? (Diagnostic Tests)",
        "A: Yes, in-house CT Scan, Dialysis Unit, Digital X-Ray, Ultrasound, and 24x7 Pathology Lab are fully operational.",
      ],
      [
        "Q6: Kya dawaiyan hospital mein mil jayengi? (Pharmacy / Medical Store)",
        "A: Yes, 24x7 in-house Pharmacy/Medical Store is open on the hospital campus with all prescribed medicines.",
      ],
      [
        "Q7: Pet dard, gas, acidity ya liver ke liye kaun se doctor hain?",
        "A: Dr. Gaurav Chawla (DM Gastroenterology CMC Vellore, Cabin 105, Mon to Sat).",
      ],
      [
        "Q8: Bukhar, sirdard ya sugar/BP ke liye kaun se doctor hain?",
        "A: Dr. H.S. Chawla (MD Medicine, Cabin 101, Mon to Sat).",
      ],
      [
        "Q9: Ghutne, kamar ya haddi-jod ke dard ke liye kaun se doctor hain?",
        "A: Dr. Saurabh Chawla (MS Ortho, Cabin 108, Mon to Sat).",
      ],
      [
        "Q10: Mahila swasthya, pregnancy ya periods problem ke liye kaun se doctor hain?",
        "A: Dr. Rashmi Suri (MS OBG Gynecologist, Cabin 104, Mon to Sat).",
      ],
      [
        "Q11: Bachhon ke bukhar ya vaccination ke liye kaun se doctor hain?",
        "A: Dr. C.S. Gandhi (MD Paediatrics Child Specialist, Cabin 102, Mon to Sat).",
      ],
      [
        "Q12: Pathri (stone) ya peshab ki dikkat ke liye kaun se doctor hain?",
        "A: Dr. Shubhendu Bhaduri (MCh Urology Specialist, Cabin 110, Mon to Sat).",
      ],
      [
        "Q13: Migraine, chakkar ya naso ki kamzori ke liye kaun se doctor hain?",
        "A: Dr. Varsha Ambwani (DM Neurology SGPGI Lucknow, Cabin 106, Mon to Sat).",
      ],
      [
        "Q14: Dama, khansi ya saans phoolne ke liye kaun se doctor hain?",
        "A: Dr. A.K. Verma (DM Chest / Pulmonologist, Cabin 107, Mon to Sat).",
      ],
      [
        "Q15: Twacha, khujli ya daad ke liye kaun se doctor hain?",
        "A: Dr. Umesh Kapoor (Dermatologist / Skin Specialist, Cabin 103, Mon, Wed, Fri).",
      ],
    ];

    faqs.forEach(([q, a]) => {
      if (doc.y > 690) {
        doc.addPage();
      }
      doc
        .fontSize(8)
        .font("Helvetica-Bold")
        .fillColor("#0f766e")
        .text(q);
      doc
        .fontSize(7.5)
        .font("Helvetica")
        .fillColor("#334155")
        .text("   " + a);
      doc.moveDown(0.2);
    });

    doc.end();

    writeStream.on("finish", () => {
      console.log(`[PDF Generator] ✅ Successfully generated KMC Hospital directory at: ${targetPath}`);
      resolve(targetPath);
    });

    writeStream.on("error", (err) => {
      console.error("[PDF Generator] ❌ Error writing PDF:", err);
      reject(err);
    });
  });
}

if (require.main === module) {
  generateHospitalPdf().then((p) => console.log("Done:", p));
}

module.exports = { generateHospitalPdf };
