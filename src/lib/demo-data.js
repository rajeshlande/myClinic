// ---------------------------------------------------------------------------
// Demo workspace: fictional but realistic OPD data so the product can be
// explored end-to-end without a Supabase project. Nothing here is real PHI.
// ---------------------------------------------------------------------------
import {
  DEFAULT_CLINIC, DEFAULT_PREFERENCES, addDays, currentMonth, localISO,
  nextId, shiftMonth, today,
} from './logic.mjs';

// Deterministic PRNG so the demo looks the same on every device.
function rng(seed = 20260101) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const FIRST = ['Aarav', 'Ananya', 'Rohit', 'Meera', 'Kabir', 'Sara', 'Vikram', 'Neha', 'Arjun', 'Priya', 'Rahul', 'Divya', 'Imran', 'Kavya', 'Sanjay', 'Ritu', 'Aditya', 'Pooja', 'Nikhil', 'Farah', 'Manish', 'Shreya', 'Gaurav', 'Tanvi', 'Vivek', 'Isha', 'Karan', 'Aisha', 'Deepak', 'Sneha', 'Yash', 'Rituraj'];
const LAST = ['Sharma', 'Iyer', 'Patel', 'Nair', 'Khan', 'Desai', 'Bose', 'Reddy', 'Joshi', 'Menon', 'Gupta', 'Kulkarni', 'Chopra', 'Verma', 'Shetty', 'Rao', 'Malhotra', 'Sen'];
const CITIES = ['Mumbai', 'Thane', 'Navi Mumbai', 'Bandra', 'Andheri', 'Borivali', 'Powai', 'Dadar'];
const COMPLAINTS = ['Fever and body ache for 3 days', 'Persistent dry cough at night', 'Recurrent headache with photophobia', 'Lower back pain after lifting', 'Itching and rash on forearms', 'Acidity and bloating after meals', 'Knee pain on climbing stairs', 'Sore throat with mild fever', 'Follow-up for blood pressure review', 'Follow-up for diabetes medication', 'Child routine vaccination review', 'Dizziness on standing up'];
const DIAGNOSES = ['Acute viral pharyngitis', 'Iron deficiency anaemia', 'Allergic rhinitis', 'Lumbar strain', 'Atopic dermatitis', 'GERD', 'Osteoarthritis knee', 'Type 2 diabetes mellitus', 'Essential hypertension', 'Vitamin D deficiency', 'Migraine', 'Acute bronchitis'];
const ADVICE = ['Rest, warm fluids and steam inhalation. Return if fever crosses 103°F.', 'Start medication after food. Repeat CBC in 2 weeks.', 'Avoid dust and cold exposure. Antihistamine at bedtime.', 'Physiotherapy 3×/week. Avoid heavy lifting for 10 days.', 'Moisturise twice daily. Stop the new detergent.', 'Small frequent meals. No late dinners for 2 weeks.', 'Quadriceps strengthening. Review in 3 weeks.', 'Continue current dose. Log morning readings for 7 days.'];
const DRUGS = [
  ['Paracetamol 650mg', '1 tablet', 'Thrice a day', '5 days', 'After food'],
  ['Cetirizine 10mg', '1 tablet', 'At bedtime', '5 days', 'May cause drowsiness'],
  ['Pantoprazole 40mg', '1 tablet', 'Once daily', '14 days', '30 min before breakfast'],
  ['Amoxicillin 500mg', '1 capsule', 'Thrice a day', '5 days', 'Complete the course'],
  ['Metformin 500mg', '1 tablet', 'Twice a day', '30 days', 'After meals'],
  ['Telmisartan 40mg', '1 tablet', 'Once daily', '30 days', 'Morning'],
  ['Vitamin D3 sachet', '1 sachet', 'Weekly', '8 weeks', 'After a fatty meal'],
];
const TAGS = ['', '', 'Diabetes', 'Hypertension', 'Allergy', 'Asthma', 'Thyroid', 'Post-surgery'];
const PAYERS = ['cash', 'upi', 'card', 'insurance', 'credit'];

export function makeDemoWorkspace() {
  const rand = rng();
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
  const now = new Date();
  const t = today();

  const clinic = {
    ...DEFAULT_CLINIC,
    id: 'clinic-demo',
    name: 'Sunrise Multispecialty OPD',
    slug: 'sunrise-opd',
    plan: 'growth',
    created_at: `${shiftMonth(currentMonth(), -14)}-01T09:00:00.000Z`,
  };

  const staff = [
    {
      id: 'doc-anita', clinic_id: clinic.id, user_id: 'demo-user', full_name: 'Dr. Anita Rao',
      role: 'owner', specialty: 'Internal Medicine', qualification: 'MBBS, MD (Internal Medicine)',
      registration_no: 'MH-2011-48213', phone: '+91 98200 11234', email: 'anita@sunriseclinic.in',
      color: '#0f766e', day_start: '09:00', day_end: '13:00', slot_minutes: 15,
      fee_paise: 60000, follow_up_fee_paise: 30000, active: true,
    },
    {
      id: 'doc-imran', clinic_id: clinic.id, user_id: null, full_name: 'Dr. Imran Sheikh',
      role: 'doctor', specialty: 'Paediatrics', qualification: 'MBBS, DCH',
      registration_no: 'MH-2014-71290', phone: '+91 98200 55678', email: 'imran@sunriseclinic.in',
      color: '#7c5cd6', day_start: '16:00', day_end: '20:00', slot_minutes: 15,
      fee_paise: 70000, follow_up_fee_paise: 35000, active: true,
    },
    {
      id: 'fd-priya', clinic_id: clinic.id, user_id: null, full_name: 'Priya Kamble',
      role: 'frontdesk', specialty: 'Front desk', qualification: 'BCom',
      registration_no: '', phone: '+91 98200 99001', email: 'priya@sunriseclinic.in',
      color: '#c2872b', day_start: '08:30', day_end: '20:30', slot_minutes: 15,
      fee_paise: 0, follow_up_fee_paise: 0, active: true,
    },
  ];

  const profile = {
    id: 'demo-user', full_name: 'Dr. Anita Rao', phone: '+91 98200 11234',
    designation: 'Consultant Physician', ...DEFAULT_PREFERENCES, default_clinic_id: clinic.id,
  };

  const patients = [];
  const count = 26;
  for (let i = 0; i < count; i++) {
    const gender = rand() > 0.45 ? 'Female' : 'Male';
    const age = int(6, 78);
    const years = gender === 'Female' ? Math.max(1, age) : age;
    const dob = `${now.getFullYear() - years}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`;
    // The first few patients registered in the last three weeks so "new this
    // month" and the registration trend are meaningful.
    const createdDaysAgo = i < 5 ? int(0, Math.max(1, now.getDate() - 1)) : int(30, 420);
    patients.push({
      id: `pat-${i + 1}`,
      clinic_id: clinic.id,
      code: `PT-${String(i + 1).padStart(5, '0')}`,
      full_name: `${pick(FIRST)} ${pick(LAST)}`,
      phone: `+91 9${int(100000000, 899999999)}`,
      email: rand() > 0.5 ? `patient${i + 1}@example.com` : '',
      gender,
      dob,
      age_years: null,
      blood_group: pick(['A+', 'B+', 'O+', 'AB+', 'O-', '']),
      address: `${int(1, 40)}, ${pick(['Lotus Court', 'Sea Breeze', 'Green Acres', 'Palm Residency'])}, ${pick(CITIES)}`,
      city: pick(CITIES),
      emergency_contact: rand() > 0.6 ? `+91 9${int(100000000, 899999999)}` : '',
      tags: [pick(TAGS)].filter(Boolean),
      allergies: rand() > 0.75 ? pick(['Penicillin', 'Sulfa drugs', 'Dust', 'None reported']) : '',
      notes: '',
      archived: false,
      created_at: new Date(Date.now() - createdDaysAgo * 86400000).toISOString(),
    });
  }

  const doctors = staff.filter((s) => s.role !== 'frontdesk');
  const appointments = [];
  const consultations = [];
  const invoices = [];
  let invoiceSeq = 0;

  // History: six months of completed visits.
  for (let monthsAgo = 5; monthsAgo >= 0; monthsAgo--) {
    const month = shiftMonth(currentMonth(), -monthsAgo);
    const visitsThisMonth = monthsAgo === 0 ? int(14, 22) : int(28, 46);
    for (let v = 0; v < visitsThisMonth; v++) {
      const patient = pick(patients);
      const doctor = pick(doctors);
      const day = monthsAgo === 0 ? int(1, Math.max(1, now.getDate())) : int(1, 28);
      const visited_on = `${month}-${String(day).padStart(2, '0')}`;
      // Stay inside this doctor's session so every seeded visit lands on the board.
      const mOpen = Number(String(doctor.day_start || '09:00').slice(0, 2)) * 60 + Number(String(doctor.day_start || '09:00').slice(3, 5));
      const mClose = Number(String(doctor.day_end || '13:00').slice(0, 2)) * 60 + Number(String(doctor.day_end || '13:00').slice(3, 5));
      const steps = Math.max(1, Math.floor((mClose - mOpen) / 15));
      const mAt = mOpen + int(0, steps - 1) * 15;
      const scheduled_at = `${String(Math.floor(mAt / 60)).padStart(2, '0')}:${String(mAt % 60).padStart(2, '0')}`;
      const apptId = `apt-${appointments.length + 1}`;
      const isPast = visited_on < t;

      appointments.push({
        id: apptId, clinic_id: clinic.id, patient_id: patient.id, doctor_id: doctor.id,
        scheduled_on: visited_on, scheduled_at, duration_minutes: 15,
        kind: rand() > 0.65 ? 'Follow-up' : 'New consultation',
        status: isPast ? 'completed' : 'booked',
        reason: pick(COMPLAINTS), notes: '', source: pick(['walk-in', 'phone', 'online', 'referral']),
        created_at: `${visited_on}T${scheduled_at}:00.000Z`,
      });

      if (!isPast) continue;

      const dx = pick(DIAGNOSES);
      const drugCount = int(1, 3);
      const prescription = Array.from({ length: drugCount }, (_, d) => {
        const drug = DRUGS[(d + v) % DRUGS.length];
        return { drug: drug[0], dose: drug[1], frequency: drug[2], duration: drug[3], instructions: drug[4] };
      });
      consultations.push({
        id: `con-${consultations.length + 1}`, clinic_id: clinic.id, patient_id: patient.id,
        doctor_id: doctor.id, appointment_id: apptId, visited_on,
        vitals: {
          temperature_c: Number((97 + rand() * 3).toFixed(1)),
          pulse_bpm: int(62, 104),
          bp_systolic: int(104, 148),
          bp_diastolic: int(66, 94),
          spo2: int(95, 100),
          weight_kg: int(40, 92),
        },
        complaint: pick(COMPLAINTS),
        examination: pick(['Chest clear. No added sounds.', 'Throat congested, no exudate.', 'Tenderness over lumbar paraspinal muscles.', 'Dry scaly patches on both forearms.', 'Epigastric tenderness, no guarding.']),
        diagnoses: [dx],
        advice: pick(ADVICE),
        prescription,
        follow_up_on: rand() > 0.5 ? addDays(visited_on, int(7, 30)) : null,
        follow_up_done: monthsAgo >= 1 ? rand() > 0.14 : rand() > 0.55,
        created_at: `${visited_on}T${scheduled_at}:00.000Z`,
      });

      const method = pick(PAYERS);
      const base = Number(doctor.fee_paise);
      const procedure = rand() > 0.72;
      const lines = [
        { service_id: 'svc-consult', name: 'Consultation', category: 'Consultation', qty: 1, rate_paise: base, discount: 0, tax_rate: 0, total: base },
      ];
      if (procedure) {
        const extra = int(20000, 140000);
        lines.push({ service_id: 'svc-procedure', name: 'Minor procedure', category: 'Procedure', qty: 1, rate_paise: extra, discount: 0, tax_rate: 0, total: extra });
      }
      if (rand() > 0.8) {
        const extra = 45000;
        lines.push({ service_id: 'svc-ecg', name: 'ECG', category: 'Diagnostics', qty: 1, rate_paise: extra, discount: 0, tax_rate: 0, total: extra });
      }
      const total = lines.reduce((s, l) => s + l.total, 0);
      const isUnpaid = method === 'credit' || (monthsAgo === 0 && rand() > 0.78);
      invoiceSeq += 1;
      invoices.push({
        id: `inv-${invoiceSeq}`, clinic_id: clinic.id,
        number: `INV/2526/${String(invoiceSeq).padStart(4, '0')}`,
        patient_id: patient.id, doctor_id: doctor.id, appointment_id: apptId,
        issued_on: visited_on, lines,
        subtotal_paise: total, discount_paise: 0, tax_paise: 0, total_paise: total,
        paid_paise: isUnpaid ? 0 : total,
        method, status: isUnpaid ? 'unpaid' : 'paid', notes: '',
        created_at: `${visited_on}T${scheduled_at}:00.000Z`,
      });
    }
  }

  // Today's live queue: tokens issued at the front desk, oldest still waiting.
  // minutes ago each token was issued at the desk — a believable mid-session queue
  const tokenPlan = [
    { status: 'completed', doctor: 0, minsAgo: 132 },
    { status: 'completed', doctor: 0, minsAgo: 116 },
    { status: 'completed', doctor: 1, minsAgo: 84 },
    { status: 'in-consult', doctor: 0, minsAgo: 46 },
    { status: 'checked-in', doctor: 0, minsAgo: 38 },
    { status: 'checked-in', doctor: 0, minsAgo: 24 },
    { status: 'booked', doctor: 0, minsAgo: 12 },
    { status: 'booked', doctor: 1, minsAgo: 9 },
    { status: 'booked', doctor: 1, minsAgo: 5 },
    { status: 'no-show', doctor: 0, minsAgo: 68 },
  ];
  // Demo appointments must sit inside each doctor's own session, otherwise the
  // scheduling board would show them all as off-grid. Tokens are laid out at the
  // start of that doctor's session in 15-minute steps, which is exactly how a real
  // OPD fills up.
  const toM = (hhmm) => Number(String(hhmm).slice(0, 2)) * 60 + Number(String(hhmm).slice(3, 5));
  const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const sessionStart = new Map();
  const sessionCount = new Map();
  const tokenCounters = new Map();
  tokenPlan.forEach((plan, i) => {
    const doctor = doctors[plan.doctor];
    const patient = patients[(i * 3 + 1) % patients.length];
    const tokenNo = (tokenCounters.get(doctor.id) ?? 0) + 1;
    tokenCounters.set(doctor.id, tokenNo);
    // Lay the token out inside this doctor's session.
    if (!sessionStart.has(doctor.id)) {
      sessionStart.set(doctor.id, toM(doctor.day_start || '09:00'));
      sessionCount.set(doctor.id, 0);
    }
    const openM = sessionStart.get(doctor.id);
    const closeM = toM(doctor.day_end || '13:00');
    const n = sessionCount.get(doctor.id);
    sessionCount.set(doctor.id, n + 1);
    const slot = fmt(Math.min(closeM - 15, openM + n * 15));
    const apptId = `apt-today-${i + 1}`;
    appointments.push({
      id: apptId, clinic_id: clinic.id, patient_id: patient.id, doctor_id: doctor.id,
      scheduled_on: t, scheduled_at: slot, duration_minutes: 15,
      kind: i % 3 === 1 ? 'Follow-up' : 'New consultation', status: plan.status,
      reason: pick(COMPLAINTS), notes: '', source: 'walk-in', token_no: tokenNo,
      created_at: new Date(Date.now() - plan.minsAgo * 60000).toISOString(),
    });

    // Everyone already seen today has a consultation and a paid invoice.
    if (plan.status === 'completed') {
      const seenAt = new Date(Date.now() - (plan.minsAgo - 9) * 60000);
      consultations.push({
        id: `con-today-${i + 1}`, clinic_id: clinic.id, patient_id: patient.id, doctor_id: doctor.id,
        appointment_id: apptId, visited_on: t,
        vitals: { temperature_c: 98.6, pulse_bpm: int(66, 96), bp_systolic: int(108, 142), bp_diastolic: int(68, 92), spo2: int(96, 100), weight_kg: int(42, 88) },
        complaint: pick(COMPLAINTS), examination: 'Chest clear. No added sounds.',
        diagnoses: [pick(DIAGNOSES)], advice: pick(ADVICE),
        prescription: [{ drug: DRUGS[i % DRUGS.length][0], dose: '1 tablet', frequency: 'Twice a day', duration: '5 days', instructions: 'After food' }],
        follow_up_on: addDays(t, int(7, 21)), follow_up_done: false,
        created_at: seenAt.toISOString(),
      });
      const fee = Number(doctor.fee_paise);
      invoiceSeq += 1;
      invoices.push({
        id: `inv-today-${i + 1}`, clinic_id: clinic.id,
        number: `INV/2526/${String(invoiceSeq).padStart(4, '0')}`,
        patient_id: patient.id, doctor_id: doctor.id, appointment_id: apptId,
        issued_on: t,
        lines: [{ service_id: 'svc-consult', name: 'Consultation', category: 'Consultation', qty: 1, rate_paise: fee, discount: 0, tax_rate: 0, total: fee }],
        subtotal_paise: fee, discount_paise: 0, tax_paise: 0, total_paise: fee, paid_paise: fee,
        method: pick(['upi', 'cash', 'card']), status: 'paid', notes: '', created_at: seenAt.toISOString(),
      });
    }
  });
  for (let d = 1; d <= 5; d++) {
    const date = addDays(t, d);
    const n = int(3, 6);
    const used = new Set();
    for (let i = 0; i < n; i++) {
      const patient = pick(patients);
      const doctor = pick(doctors);
      // One booking per doctor per slot, chosen from the clinic's real session.
      // Offer slots from the picked doctor's own session, not a fixed 9-to-5 grid.
      const dOpen = toM(doctor.day_start || '09:00');
      const dClose = toM(doctor.day_end || '13:00');
      const candidates = [];
      for (let m = dOpen; m + 15 <= dClose; m += 30) candidates.push(fmt(m));
      let slot = null;
      for (const candidate of candidates) {
        const key = `${doctor.id}-${candidate}`;
        if (!used.has(key)) { used.add(key); slot = candidate; break; }
      }
      if (!slot) continue;
      appointments.push({
        id: `apt-${date}-${i}`, clinic_id: clinic.id, patient_id: patient.id, doctor_id: doctor.id,
        scheduled_on: date, scheduled_at: slot, duration_minutes: 15,
        kind: pick(['New consultation', 'Follow-up', 'Teleconsultation']), status: 'booked',
        reason: pick(COMPLAINTS), notes: '', source: pick(['phone', 'online', 'referral']),
        created_at: new Date().toISOString(),
      });
    }
  }

  // (older sessions already invoiced above; this block only catches seeded history)
  appointments.filter((a) => a.scheduled_on === t && a.status === 'completed' && !invoices.some((inv) => inv.appointment_id === a.id)).forEach((appt) => {
    const doctor = doctors.find((d) => d.id === appt.doctor_id);
    const fee = doctor?.fee_paise ?? 50000;
    invoiceSeq += 1;
    invoices.push({
      id: `inv-${invoiceSeq}`, clinic_id: clinic.id,
      number: `INV/2526/${String(invoiceSeq).padStart(4, '0')}`,
      patient_id: appt.patient_id, doctor_id: appt.doctor_id, appointment_id: appt.id,
      issued_on: t,
      lines: [{ service_id: 'svc-consult', name: 'Consultation', category: 'Consultation', qty: 1, rate_paise: fee, discount: 0, tax_rate: 0, total: fee }],
      subtotal_paise: fee, discount_paise: 0, tax_paise: 0, total_paise: fee, paid_paise: fee,
      method: pick(['upi', 'cash', 'card']), status: 'paid', notes: '',
      created_at: `${t}T${appt.scheduled_at}:00.000Z`,
    });
  });

  // One patient seen at the end of the morning whose bill was never raised. The
  // day-close view exists to catch exactly this, so the demo has to contain one.
  const gapPatient = patients[7];
  const gapApptId = 'apt-today-unbilled';
  appointments.push({
    id: gapApptId, clinic_id: clinic.id, patient_id: gapPatient.id, doctor_id: doctors[0].id,
    scheduled_on: t, scheduled_at: '10:45', duration_minutes: 15,
    kind: 'New consultation', status: 'completed', reason: 'Review of thyroid report',
    notes: '', source: 'walk-in', token_no: 8,
    created_at: new Date(Date.now() - 52 * 60000).toISOString(),
  });
  consultations.push({
    id: 'con-today-unbilled', clinic_id: clinic.id, patient_id: gapPatient.id, doctor_id: doctors[0].id,
    appointment_id: gapApptId, visited_on: t,
    vitals: { temperature_c: 98.2, pulse_bpm: 78, bp_systolic: 118, bp_diastolic: 76, spo2: 99, weight_kg: 64 },
    complaint: 'Review of thyroid report', examination: 'No goitre. No tremor.',
    diagnoses: ['Hypothyroidism'], advice: 'Continue the same dose. Repeat TSH in 8 weeks.',
    prescription: [{ drug: 'Levothyroxine 50mcg', dose: '1 tablet', frequency: 'Once daily', duration: '60 days', instructions: 'Empty stomach' }],
    follow_up_on: addDays(t, 21), follow_up_done: false,
    created_at: new Date(Date.now() - 43 * 60000).toISOString(),
  });

  return {
    mode: 'demo',
    clinic,
    profile,
    staff,
    patients,
    appointments,
    consultations,
    invoices,
    // Added in 1.10.0. An empty log is honest: nothing has been sent from this
    // browser yet.
    day_closes: [],
    reminders: [],
    schemaReady: true,
    serviceCatalogue: [],
    loadedAt: new Date().toISOString(),
    version: 1,
  };
}

export const demoIds = { next: () => nextId() };
