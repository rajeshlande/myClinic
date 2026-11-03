/**
 * Clinic medicine master.
 *
 * Why a static module and not a table
 * -----------------------------------
 * A prescription is written while the patient is in the chair, sometimes with the
 * clinic's internet down. The catalogue therefore ships with the app: it is
 * available offline on the first consult, needs no seeding, and cannot disagree
 * between the front desk and the doctor's phone. Anything the clinic adds lives in
 * its own patients' prescriptions (see `recentMedicines`), which merge into the
 * same search.
 *
 * What this is NOT
 * ----------------
 * Not a drug database. It is a curated starter list of medicines common in Indian
 * OPD practice, carrying the composition needed to catch duplicate therapy and the
 * defaults needed to stop retyping "1 tablet / Twice a day / 5 days / After food".
 * A commercial 250k-product directory can be layered on later behind the same
 * `searchMedicines()` interface.
 *
 * Safety posture
 * --------------
 * Every rule here is deliberately conservative and explainable in one sentence.
 * Alerts are advisory, never blocking: the doctor can always prescribe, but an
 * override is recorded (`rx_safety` on the consultation) so the decision is
 * auditable months later. Rules are about *composition and class*, not dosage
 * arithmetic — this module never pretends to dose a patient.
 */

export const FORMULARY_VERSION = '2026.11';

/** Dispensing schedule — printed so the chemist and the register stay correct. */
export const SCHEDULES = {
  OTC: { label: 'OTC', tone: 'success', note: 'Over the counter' },
  H: { label: 'H', tone: 'warn', note: 'Schedule H — prescription required' },
  H1: { label: 'H1', tone: 'danger', note: 'Schedule H1 — record in the H1 register' },
  X: { label: 'X', tone: 'danger', note: 'Schedule X — restricted' },
};

export const FORMS = {
  tab: 'Tablet', cap: 'Capsule', syrup: 'Syrup', sachet: 'Sachet', inj: 'Injection',
  inh: 'Inhaler', neb: 'Nebuliser', drops: 'Drops', cream: 'Cream', oint: 'Ointment', gel: 'Gel',
};

const T = (id, brand, salt, strength, form, schedule, classes, freq, duration, relation, keywords) => ({
  id, brand, salt, strength, form, schedule, classes,
  dose: form === 'syrup' ? '5 ml' : form === 'inj' ? 'As directed' : form === 'inh' ? '2 puffs'
    : form === 'cream' || form === 'oint' || form === 'gel' ? 'Thin layer' : form === 'drops' ? '2 drops'
      : form === 'sachet' ? '1 sachet' : '1 tablet',
  frequency: freq,
  duration,
  instructions: relation,
  keywords: `${keywords ?? ''} ${brand} ${salt}`.toLowerCase(),
});

/**
 * Starter catalogue. `classes` drives the class-level duplicate/interaction rules,
 * so a doctor typing a brand we have never heard of still gets checked as long as
 * its composition matches a salt below.
 */
export const MEDICINES = [
  // ---------------------------------------------------------------- analgesia
  T('dolo650', 'Dolo 650', 'Paracetamol', '650 mg', 'tab', 'OTC', ['paracetamol', 'analgesic', 'antipyretic'], 'Three times a day', '3 days', 'After food', 'fever pain body ache headache dolo crocin'),
  T('crocin500', 'Crocin Advance', 'Paracetamol', '500 mg', 'tab', 'OTC', ['paracetamol', 'analgesic', 'antipyretic'], 'Three times a day', '3 days', 'After food', 'fever pain'),
  T('calpol', 'Calpol 250', 'Paracetamol', '250 mg/5 ml', 'syrup', 'OTC', ['paracetamol', 'analgesic', 'antipyretic'], 'Three times a day', '3 days', 'After food', 'fever child paediatric'),
  T('brufen400', 'Brufen', 'Ibuprofen', '400 mg', 'tab', 'H', ['nsaid', 'analgesic', 'antipyretic'], 'Twice a day', '3 days', 'After food', 'pain fever inflammation'),
  T('voveran50', 'Voveran', 'Diclofenac', '50 mg', 'tab', 'H', ['nsaid', 'analgesic'], 'Twice a day', '3 days', 'After food', 'pain joint back knee'),
  T('zerodolp', 'Zerodol-P', 'Aceclofenac + Paracetamol', '100 mg + 325 mg', 'tab', 'H', ['nsaid', 'paracetamol', 'analgesic'], 'Twice a day', '5 days', 'After food', 'pain inflammation dental'),
  T('ecosprin75', 'Ecosprin', 'Aspirin', '75 mg', 'tab', 'H', ['antiplatelet', 'nsaid'], 'Once a day', '30 days', 'After food', 'blood thinner heart clot'),
  T('suminat', 'Suminat', 'Sumatriptan', '50 mg', 'tab', 'H', ['triptan'], 'When needed', '3 days', 'After food', 'migraine headache'),

  // --------------------------------------------------------------- antibiotics
  T('mox500', 'Mox', 'Amoxicillin', '500 mg', 'cap', 'H', ['penicillin', 'antibiotic'], 'Three times a day', '5 days', 'After food', 'infection throat chest'),
  T('augmentin625', 'Augmentin 625', 'Amoxicillin + Clavulanic acid', '500 mg + 125 mg', 'tab', 'H', ['penicillin', 'antibiotic'], 'Twice a day', '5 days', 'After food', 'infection chest throat dental'),
  T('azithral500', 'Azithral', 'Azithromycin', '500 mg', 'tab', 'H', ['macrolide', 'antibiotic'], 'Once a day', '3 days', 'After food', 'infection chest cough atypical'),
  T('taxim200', 'Taxim-PH O', 'Cefixime', '200 mg', 'tab', 'H', ['cephalosporin', 'antibiotic'], 'Twice a day', '5 days', 'After food', 'infection urine throat'),
  T('ciplox500', 'Ciplox', 'Ciprofloxacin', '500 mg', 'tab', 'H', ['fluoroquinolone', 'antibiotic'], 'Twice a day', '5 days', 'After food', 'infection urine diarrhoea'),
  T('levoflox500', 'Levoflox', 'Levofloxacin', '500 mg', 'tab', 'H', ['fluoroquinolone', 'antibiotic'], 'Once a day', '5 days', 'After food', 'infection pneumonia urine'),
  T('doxtsl', 'Doxt-SL', 'Doxycycline', '100 mg', 'tab', 'H1', ['tetracycline', 'antibiotic'], 'Twice a day', '7 days', 'After food', 'infection acne scrub typhus'),
  T('flagyl400', 'Flagyl', 'Metronidazole', '400 mg', 'tab', 'H', ['nitroimidazole', 'antibiotic'], 'Three times a day', '5 days', 'After food', 'diarrhoea amoebic dental infection'),
  T('septran', 'Septran DS', 'Sulfamethoxazole + Trimethoprim', '800 mg + 160 mg', 'tab', 'H', ['sulfonamide', 'antibiotic'], 'Twice a day', '5 days', 'After food', 'infection urine sulfa'),
  T('dalacin300', 'Dalacin', 'Clindamycin', '300 mg', 'cap', 'H', ['lincosamide', 'antibiotic'], 'Three times a day', '5 days', 'After food', 'infection dental skin'),
  T('zentel400', 'Zentel', 'Albendazole', '400 mg', 'tab', 'OTC', ['anthelmintic'], 'Once a day', '1 days', 'After food', 'worm deworming'),

  // ------------------------------------------------------------ gut / acidity
  T('pan40', 'Pan 40', 'Pantoprazole', '40 mg', 'tab', 'H', ['ppi'], 'Once a day', '14 days', 'Empty stomach', 'acidity reflux gastritis'),
  T('omez20', 'Omez', 'Omeprazole', '20 mg', 'cap', 'H', ['ppi'], 'Once a day', '14 days', 'Empty stomach', 'acidity reflux gastritis'),
  T('razo20', 'Razo', 'Rabeprazole', '20 mg', 'tab', 'H', ['ppi'], 'Once a day', '14 days', 'Empty stomach', 'acidity reflux gastritis'),
  T('emeset4', 'Emeset', 'Ondansetron', '4 mg', 'tab', 'H', ['antiemetic'], 'When needed', '3 days', 'Before food', 'vomiting nausea'),
  T('domstal', 'Domstal', 'Domperidone', '10 mg', 'tab', 'H', ['prokinetic'], 'Three times a day', '3 days', 'Before food', 'vomiting nausea bloating'),
  T('duphalac', 'Duphalac', 'Lactulose', '10 g/15 ml', 'syrup', 'OTC', ['laxative'], 'At night', '7 days', 'After food', 'constipation'),
  T('ors', 'Electral', 'Oral rehydration salts', '20.5 g', 'sachet', 'OTC', ['ors'], 'When needed', '3 days', 'With food', 'diarrhoea dehydration'),
  T('mucolite', 'Mucolite', 'Ambroxol', '30 mg/5 ml', 'syrup', 'OTC', ['mucolytic'], 'Three times a day', '5 days', 'After food', 'cough phlegm chest'),

  // ----------------------------------------------------------------- allergy
  T('alerid', 'Alerid', 'Cetirizine', '10 mg', 'tab', 'OTC', ['antihistamine'], 'At night', '5 days', 'After food', 'allergy rhinitis itching'),
  T('levocet', 'Levocet', 'Levocetirizine', '5 mg', 'tab', 'H', ['antihistamine'], 'At night', '5 days', 'After food', 'allergy rhinitis itching'),
  T('allegra120', 'Allegra', 'Fexofenadine', '120 mg', 'tab', 'H', ['antihistamine'], 'Once a day', '7 days', 'After food', 'allergy urticaria'),
  T('montairlc', 'Montair-LC', 'Montelukast + Levocetirizine', '10 mg + 5 mg', 'tab', 'H', ['antihistamine', 'leukotriene'], 'At night', '14 days', 'After food', 'allergy asthma rhinitis'),
  T('avil', 'Avil', 'Pheniramine', '25 mg', 'tab', 'H', ['antihistamine'], 'At night', '3 days', 'After food', 'allergy itching injection'),

  // -------------------------------------------------------------- respiratory
  T('asthalin', 'Asthalin', 'Salbutamol', '100 mcg', 'inh', 'H', ['saba'], 'When needed', '1 months', 'Before food', 'wheeze asthma breathless inhaler'),
  T('foracort', 'Foracort 200', 'Budesonide + Formoterol', '200 mcg + 6 mcg', 'inh', 'H', ['ics', 'laba'], 'Twice a day', '1 months', 'Before food', 'asthma inhaler controller'),
  T('budecort', 'Budecort', 'Budesonide', '0.5 mg/2 ml', 'neb', 'H', ['ics'], 'Twice a day', '5 days', 'Before food', 'nebuliser asthma wheeze'),
  T('wysolone10', 'Wysolone', 'Prednisolone', '10 mg', 'tab', 'H', ['corticosteroid'], 'Once a day', '5 days', 'After food', 'steroid inflammation asthma allergy'),
  T('dexona', 'Dexona', 'Dexamethasone', '4 mg/ml', 'inj', 'H', ['corticosteroid'], 'When needed', '1 days', 'With food', 'steroid injection'),

  // ------------------------------------------------------------- cardiac / BP
  T('amlong5', 'Amlong', 'Amlodipine', '5 mg', 'tab', 'H', ['ccb'], 'Once a day', '30 days', 'After food', 'blood pressure hypertension'),
  T('telma40', 'Telma', 'Telmisartan', '40 mg', 'tab', 'H', ['arb'], 'Once a day', '30 days', 'After food', 'blood pressure hypertension'),
  T('enalapril5', 'Envas', 'Enalapril', '5 mg', 'tab', 'H', ['acei'], 'Once a day', '30 days', 'After food', 'blood pressure hypertension heart'),
  T('metolar50', 'Metolar-XR', 'Metoprolol', '50 mg', 'tab', 'H', ['beta_blocker'], 'Once a day', '30 days', 'After food', 'blood pressure heart rate angina'),
  T('atorva10', 'Atorva', 'Atorvastatin', '10 mg', 'tab', 'H', ['statin'], 'At night', '30 days', 'After food', 'cholesterol lipid'),
  T('rosuvas10', 'Rosuvas', 'Rosuvastatin', '10 mg', 'tab', 'H', ['statin'], 'At night', '30 days', 'After food', 'cholesterol lipid'),
  T('clopilet75', 'Clopilet', 'Clopidogrel', '75 mg', 'tab', 'H', ['antiplatelet'], 'Once a day', '30 days', 'After food', 'blood thinner clot stent'),
  T('warf5', 'Warf', 'Warfarin', '5 mg', 'tab', 'H', ['anticoagulant'], 'Once a day', '30 days', 'After food', 'blood thinner clot anticoagulant'),

  // -------------------------------------------------------------- diabetes
  T('glycomet500', 'Glycomet', 'Metformin', '500 mg', 'tab', 'H', ['biguanide'], 'Twice a day', '30 days', 'After food', 'diabetes sugar'),
  T('amaryl2', 'Amaryl', 'Glimepiride', '2 mg', 'tab', 'H', ['sulfonylurea'], 'Once a day', '30 days', 'Before food', 'diabetes sugar'),
  T('januvia100', 'Januvia', 'Sitagliptin', '100 mg', 'tab', 'H', ['gliptin'], 'Once a day', '30 days', 'After food', 'diabetes sugar'),
  T('thyronorm50', 'Thyronorm', 'Levothyroxine', '50 mcg', 'tab', 'H', ['thyroid', 'levothyroxine'], 'Once a day', '30 days', 'Empty stomach', 'thyroid hypothyroid'),

  // ---------------------------------------------------------------- neuro
  T('gabapin300', 'Gabapin', 'Gabapentin', '300 mg', 'cap', 'H', ['gabapentinoid'], 'At night', '14 days', 'After food', 'nerve pain neuropathy'),
  T('pregeb75', 'Pregeb', 'Pregabalin', '75 mg', 'cap', 'H', ['gabapentinoid'], 'At night', '14 days', 'After food', 'nerve pain neuropathy'),
  T('amitril10', 'Amitril', 'Amitriptyline', '10 mg', 'tab', 'H', ['tca'], 'At night', '30 days', 'After food', 'nerve pain sleep migraine prophylaxis'),

  // -------------------------------------------------------------- vitamins
  T('uprised3', 'Uprise D3 60K', 'Cholecalciferol', '60000 IU', 'sachet', 'OTC', ['vitamin_d'], 'Once a week', '8 weeks', 'After food', 'vitamin d deficiency bone'),
  T('shelcal', 'Shelcal 500', 'Calcium + Vitamin D3', '500 mg + 250 IU', 'tab', 'OTC', ['calcium'], 'Once a day', '30 days', 'After food', 'calcium bone'),
  T('autrin', 'Autrin', 'Ferrous fumarate + Folic acid', '100 mg + 1.5 mg', 'tab', 'OTC', ['iron'], 'Once a day', '30 days', 'After food', 'iron anaemia haemoglobin'),
  T('methylcobal', 'Nurokind', 'Methylcobalamin', '1500 mcg', 'tab', 'OTC', ['vitamin_b12'], 'Once a day', '30 days', 'After food', 'b12 nerve vitamin'),

  // ------------------------------------------------------------- topical / eye
  T('candidb', 'Candid-B', 'Clotrimazole + Beclomethasone', '1% + 0.025%', 'cream', 'H', ['antifungal', 'corticosteroid'], 'Twice a day', '14 days', 'After food', 'fungal ringworm itch cream'),
  T('tbact', 'T-Bact', 'Mupirocin', '2%', 'oint', 'H', ['antibiotic'], 'Three times a day', '7 days', 'After food', 'skin infection wound ointment'),
  T('ciploxeye', 'Ciplox Eye Drops', 'Ciprofloxacin', '0.3%', 'drops', 'H', ['fluoroquinolone', 'antibiotic'], 'Four times a day', '5 days', 'After food', 'eye infection conjunctivitis'),
];

/** Everything a prescription line needs to remember about the chosen medicine. */
/**
 * How a medicine is written on a prescription: brand, plus the strength only when
 * the brand does not already carry it ("Dolo 650", not "Dolo 650 650 mg").
 */
export function medicineName(med) {
  if (!med) return '';
  const firstNumber = (String(med.strength ?? '').match(/\d+(?:\.\d+)?/) ?? [])[0];
  const brandNamesStrength = firstNumber
    ? new RegExp(`(^|\\s)${firstNumber.replace(/\./g, '\\.')}(\\s|$)`).test(med.brand)
    : false;
  return med.strength && !brandNamesStrength ? `${med.brand} ${med.strength}` : med.brand;
}

export function medicineToLine(med) {
  if (!med) return null;
  return {
    medicine_id: med.id,
    drug: medicineName(med),
    // A house line typed by hand has no recorded molecule; infer it so that
    // duplicate-molecule and allergy checks still see it.
    salt: med.salt || inferSalt(med.brand ?? ''),
    form: FORMS[med.form] ?? med.form,
    schedule: med.schedule,
    dose: med.dose,
    frequency: med.frequency,
    duration: med.duration,
    instructions: med.instructions,
  };
}

// Typing "  Dolo   650 " must behave exactly like "dolo 650": collapse runs of
// whitespace and strip punctuation people add out of habit.
// Typing "  Dolo-650 " must behave exactly like "dolo 650": case, punctuation and
// runs of whitespace are all noise when a doctor is typing fast.
const norm = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Best-effort molecule for a hand-typed line ("Pantoprazole 40mg" -> "Pantoprazole").
 * Used only to make the safety checks work on lines that were never picked from
 * the catalogue; a line that matches nothing keeps an empty salt and is treated
 * as free text.
 */
export function inferSalt(text) {
  const t = norm(text);
  if (t.length < 4) return '';
  let best = '';
  for (const med of MEDICINES) {
    for (const molecule of String(med.salt ?? '').split('+').map((x) => x.trim())) {
      const n = norm(molecule);
      if (n.length >= 6 && t.includes(n) && n.length > best.length) best = molecule;
    }
  }
  if (best) return best;
  // No molecule written? Fall back to a known brand name ("Dolo 650").
  for (const med of MEDICINES) {
    const brand = norm(med.brand);
    if (brand.length >= 5 && t.includes(brand)) return med.salt;
  }
  return '';
}

/**
 * Rank candidates for what the doctor is typing.
 *
 * Brand prefix beats salt prefix beats "contains", so `dolo` finds Dolo and `para`
 * finds every paracetamol brand. `clinicHistory` (the clinic's own past lines) is
 * merged in so a drug this clinic uses every day surfaces even if it is not in the
 * starter list.
 */
export function searchMedicines(query, { limit = 8, clinicHistory = [] } = {}) {
  const q = norm(query);
  if (!q) return [];

  const scored = [];
  const seen = new Set();

  for (const med of MEDICINES) {
    const brand = norm(med.brand);
    const salt = norm(med.salt);
    let score = 0;
    if (brand === q) score = 100;
    else if (brand.startsWith(q)) score = 80;
    else if (salt.startsWith(q)) score = 60;
    else if (salt.includes(q)) score = 40;
    else if (brand.includes(q)) score = 30;
    else if (med.keywords.includes(q)) score = 20;
    if (!score) continue;
    scored.push({ ...med, source: 'formulary', score });
    seen.add(`${brand}|${salt}`);
  }

  // The clinic's own history, ranked above the starter list when it matches.
  // Molecules already offered by the catalogue: a house line of the same molecule
  // ("Pantoprazole 40mg") must not push a second, less precise row into the list.
  const catalogueSalts = new Set(scored.map((m) => norm(m.salt).split(' + ')[0]).filter(Boolean));

  for (const line of clinicHistory) {
    const brand = norm(line.drug);
    if (!brand) continue;
    const salt = norm(line.salt) || norm(inferSalt(line.drug));
    const key = `${brand}|${salt}`;
    if (seen.has(key)) continue;
    if (salt && catalogueSalts.has(salt)) continue;
    let score = 0;
    if (brand === q) score = 95;
    else if (brand.startsWith(q)) score = 75;
    else if (salt.startsWith(q)) score = 55;
    else if (brand.includes(q) || salt.includes(q)) score = 25;
    if (!score) continue;
    seen.add(key);
    scored.push({
      id: line.medicine_id ?? `hist-${key}`,
      brand: line.drug,
      salt: line.salt || inferSalt(line.drug),
      strength: '',
      form: null,
      schedule: line.schedule ?? null,
      classes: [],
      dose: line.dose, frequency: line.frequency, duration: line.duration, instructions: line.instructions,
      keywords: key,
      source: 'history',
      score: score + 3, // an established house habit is a strong signal
    });
  }

  return scored.sort((a, b) => b.score - a.score || a.brand.localeCompare(b.brand)).slice(0, limit);
}

/** Look a medicine up again from a stored line (used when re-opening an old Rx). */
export function medicineById(id) {
  return MEDICINES.find((m) => m.id === id) ?? null;
}

/** Distinct past lines from the clinic's consultations, newest first. */
export function recentMedicines(consultations = [], limit = 60) {
  const out = [];
  const seen = new Set();
  const ordered = [...consultations].sort((a, b) => String(b.visited_on).localeCompare(String(a.visited_on)));
  for (const visit of ordered) {
    for (const line of visit.prescription ?? []) {
      if (!line?.drug) continue;
      const key = `${norm(line.drug)}|${norm(line.salt)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(line);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Safety rules
// ---------------------------------------------------------------------------

/**
 * Class-level interaction rules. `a`/`b` match any class in a line's `classes`.
 * Text is written for a doctor mid-consult: what happens, and what to do.
 */
export const INTERACTIONS = [
  { a: ['nsaid'], b: ['nsaid'], severity: 'high', title: 'Two NSAIDs together', detail: 'Doubles the GI bleed risk without adding analgesia. Keep one anti-inflammatory and add paracetamol if needed.' },
  { a: ['nsaid'], b: ['anticoagulant'], severity: 'high', title: 'NSAID with an anticoagulant', detail: 'Bleeding risk. If unavoidable, use the lowest dose for the shortest time and review for GI protection.' },
  { a: ['nsaid'], b: ['antiplatelet'], severity: 'high', title: 'NSAID with an antiplatelet', detail: 'GI bleeding risk is additive. Consider paracetamol instead.' },
  { a: ['nsaid'], b: ['corticosteroid'], severity: 'high', title: 'NSAID with a corticosteroid', detail: 'Additive ulcerogenic risk. Add gastroprotection or avoid the combination.' },
  { a: ['nsaid'], b: ['acei'], severity: 'moderate', title: 'NSAID with an ACE inhibitor', detail: 'Blunted blood-pressure control and reduced renal perfusion. Monitor BP and creatinine if continued.' },
  { a: ['nsaid'], b: ['arb'], severity: 'moderate', title: 'NSAID with an ARB', detail: 'Blunted blood-pressure control and reduced renal perfusion. Monitor BP and creatinine if continued.' },
  { a: ['anticoagulant'], b: ['macrolide'], severity: 'high', title: 'Warfarin with a macrolide', detail: 'Azithromycin can raise the INR. Check INR within 3–5 days or choose another antibiotic.' },
  { a: ['anticoagulant'], b: ['nitroimidazole'], severity: 'high', title: 'Warfarin with metronidazole', detail: 'Marked INR rise. Prefer another antibiotic; if not possible, reduce the warfarin dose and recheck INR.' },
  { a: ['antiplatelet'], b: ['antiplatelet'], severity: 'moderate', title: 'Dual antiplatelet therapy', detail: 'Intentional after a stent, otherwise review — this is a bleeding-risk decision, not an automatic error.' },
  { a: ['fluoroquinolone'], b: ['ppi'], severity: 'moderate', title: 'Fluoroquinolone with a PPI / antacid', detail: 'Absorption falls. Space the doses by at least 2 hours.' },
  { a: ['fluoroquinolone'], b: ['calcium'], severity: 'moderate', title: 'Fluoroquinolone with calcium', detail: 'Chelation reduces absorption. Separate the doses by 2 hours.' },
  { a: ['fluoroquinolone'], b: ['iron'], severity: 'moderate', title: 'Fluoroquinolone with iron', detail: 'Chelation reduces absorption. Separate the doses by 2 hours.' },
  { a: ['levothyroxine'], b: ['calcium'], severity: 'moderate', title: 'Levothyroxine with calcium', detail: 'Absorption falls. Take levothyroxine on an empty stomach and calcium at least 4 hours later.' },
  { a: ['levothyroxine'], b: ['iron'], severity: 'moderate', title: 'Levothyroxine with iron', detail: 'Absorption falls. Separate the two doses by at least 4 hours.' },
  { a: ['levothyroxine'], b: ['ppi'], severity: 'moderate', title: 'Levothyroxine with a PPI', detail: 'Reduced absorption over time. Recheck TSH after 6–8 weeks of the combination.' },
  { a: ['beta_blocker'], b: ['saba'], severity: 'high', title: 'Beta blocker with salbutamol', detail: 'Beta blockers antagonise bronchodilators and can trigger bronchospasm in an asthmatic. Use a cardioselective agent only if it is essential.' },
  { a: ['corticosteroid'], b: ['biguanide'], severity: 'moderate', title: 'Steroid with metformin', detail: 'Steroids raise blood glucose. Expect higher readings and review the diabetes dose.' },
  { a: ['corticosteroid'], b: ['sulfonylurea'], severity: 'moderate', title: 'Steroid with a sulfonylurea', detail: 'Glycaemic control may worsen while the steroid course runs.' },
  { a: ['antiplatelet'], b: ['ppi'], severity: 'moderate', title: 'Clopidogrel with omeprazole', detail: 'Omeprazole/esomeprazole reduce clopidogrel activation. Pantoprazole is the preferred PPI here.' },
  { a: ['antiemetic'], b: ['macrolide'], severity: 'moderate', title: 'Ondansetron with a macrolide', detail: 'Both prolong the QT interval. Keep the course short and correct any hypokalaemia.' },
  { a: ['antiemetic'], b: ['fluoroquinolone'], severity: 'moderate', title: 'Ondansetron with a fluoroquinolone', detail: 'Additive QT prolongation. Review if there is other QT risk.' },
  { a: ['triptan'], b: ['triptan'], severity: 'moderate', title: 'Two triptans', detail: 'Never combine triptans. Use one agent per attack.' },
];

/**
 * Allergy keywords → drug classes. Matching is on the words a clinic actually
 * writes in the allergy field ("penicillin", "sulfa", "NSAID"), so the check works
 * with free text rather than requiring a coded allergy list.
 */
export const ALLERGY_MAP = [
  { match: ['penicillin', 'penicillin group', 'amoxicillin', 'augmentin'], classes: ['penicillin'], severity: 'high', label: 'penicillin' },
  { match: ['sulfa', 'sulfonamide', 'septran', 'cotrimoxazole'], classes: ['sulfonamide'], severity: 'high', label: 'sulfa drugs' },
  { match: ['nsaid', 'ibuprofen', 'diclofenac', 'aspirin', 'aceclofenac'], classes: ['nsaid'], severity: 'high', label: 'NSAIDs' },
  { match: ['cephalosporin', 'cefixime'], classes: ['cephalosporin'], severity: 'moderate', label: 'cephalosporins' },
  { match: ['macrolide', 'azithromycin'], classes: ['macrolide'], severity: 'high', label: 'macrolides' },
  { match: ['fluoroquinolone', 'ciprofloxacin', 'levofloxacin'], classes: ['fluoroquinolone'], severity: 'high', label: 'fluoroquinolones' },
  { match: ['paracetamol', 'acetaminophen'], classes: ['paracetamol'], severity: 'high', label: 'paracetamol' },
  { match: ['steroid', 'prednisolone', 'corticosteroid'], classes: ['corticosteroid'], severity: 'moderate', label: 'corticosteroids' },
];

const lineClasses = (line) => {
  const found = new Set();
  const med = line.medicine_id ? medicineById(line.medicine_id) : null;
  for (const c of med?.classes ?? []) found.add(c);
  if (!med && line.salt) {
    // A hand-typed line still gets checked when its salt matches a known medicine.
    const salt = norm(line.salt);
    for (const m of MEDICINES) {
      if (norm(m.salt).startsWith(salt) || salt.startsWith(norm(m.salt))) m.classes.forEach((c) => found.add(c));
    }
  }
  return found;
};

/**
 * Everything worth telling the doctor about this prescription, right now.
 *
 * Returns warnings, each with a stable `id` (so an acknowledgement can be matched
 * after a re-render), a severity, and the line indices it refers to.
 */
export function checkPrescriptionSafety(lines = [], { allergies = '' } = {}) {
  const filled = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => norm(line?.drug));

  const warnings = [];
  const classes = new Map(filled.map(({ line, index }) => [index, lineClasses(line)]));

  // --- 1. same molecule prescribed twice -----------------------------------
  const bySalt = new Map();
  for (const { line, index } of filled) {
    const salt = norm(line.salt) || norm(line.drug);
    if (!salt) continue;
    bySalt.set(salt, [...(bySalt.get(salt) ?? []), index]);
  }
  for (const [salt, indices] of bySalt) {
    if (indices.length < 2) continue;
    const brand = filled.find((f) => f.index === indices[0]).line;
    warnings.push({
      id: `duplicate-salt:${salt}`,
      severity: 'high',
      title: 'Same molecule prescribed twice',
      detail: `${indices.map((i) => `#${i + 1}`).join(' and ')} both contain ${brand.salt || brand.drug}. That doubles the dose without a clinical reason — remove one.`,
      lines: indices,
    });
  }

  // --- 2. duplicate therapy inside a class, for drug classes where it matters
  // Classes where two members at once is usually a mistake. Each class appears once.
  const duplicateClasses = ['nsaid', 'ppi', 'antihistamine', 'statin', 'gabapentinoid', 'levothyroxine'];
  for (const cls of new Set(duplicateClasses)) {
    const hits = [...classes.entries()].filter(([, set]) => set.has(cls)).map(([i]) => i);
    if (hits.length < 2) continue;
    const salts = new Set(hits.map((i) => norm(filled.find((f) => f.index === i).line.salt || filled.find((f) => f.index === i).line.drug)));
    if (salts.size < 2) continue; // already covered by the duplicate-salt rule
    warnings.push({
      id: `duplicate-class:${cls}`,
      severity: cls === 'nsaid' ? 'high' : 'moderate',
      title: `Two ${cls === 'ppi' ? 'acid suppressants' : cls === 'nsaid' ? 'NSAIDs' : `${cls}s`} together`,
      detail: `${hits.map((i) => `#${i + 1}`).join(' and ')} belong to the same class. Check that this is intentional.`,
      lines: hits,
    });
  }

  // --- 3. curated interaction pairs ----------------------------------------
  for (let i = 0; i < filled.length; i += 1) {
    for (let j = i + 1; j < filled.length; j += 1) {
      const a = filled[i];
      const b = filled[j];
      const ca = classes.get(a.index);
      const cb = classes.get(b.index);
      for (const rule of INTERACTIONS) {
        const forward = rule.a.some((x) => ca.has(x)) && rule.b.some((x) => cb.has(x));
        const backward = rule.a.some((x) => cb.has(x)) && rule.b.some((x) => ca.has(x));
        if (!forward && !backward) continue;
        // A rule whose two sides are the same class is the duplicate rule's job.
        if (rule.a.join() === rule.b.join()) continue;
        const id = `interaction:${rule.title}:${a.index}-${b.index}`;
        if (warnings.some((w) => w.id === id)) continue;
        warnings.push({
          id,
          severity: rule.severity,
          title: rule.title,
          detail: rule.detail,
          lines: [a.index, b.index],
        });
      }
    }
  }

  // --- 4. recorded allergy vs the chosen drug ------------------------------
  const allergyText = norm(allergies);
  if (allergyText && !/^(none|nil|no known|nka)/.test(allergyText)) {
    for (const { line, index } of filled) {
      const set = classes.get(index);
      for (const rule of ALLERGY_MAP) {
        if (!rule.match.some((word) => allergyText.includes(word))) continue;
        if (!rule.classes.some((c) => set.has(c))) continue;
        warnings.push({
          id: `allergy:${rule.label}:${index}`,
          severity: rule.severity,
          title: `Recorded allergy: ${rule.label}`,
          detail: `#${index + 1} ${line.drug} belongs to the ${rule.label} group this patient is allergic to. Choose an alternative unless this is a deliberate desensitisation.`,
          lines: [index],
        });
      }
    }
  }

  // --- 5. schedule — a register has to be filled, not an alert -------------
  const register = filled.filter(({ line }) => {
    const med = line.medicine_id ? medicineById(line.medicine_id) : null;
    return (line.schedule ?? med?.schedule) === 'H1';
  });
  if (register.length) {
    warnings.push({
      id: 'schedule:h1',
      severity: 'info',
      title: 'Schedule H1 drug on this prescription',
      detail: `${register.map(({ index, line }) => `#${index + 1} ${line.drug}`).join(', ')} must be entered in the H1 register with the prescriber's name and the patient's details.`,
      lines: register.map(({ index }) => index),
    });
  }

  const order = { high: 0, moderate: 1, info: 2 };
  return warnings.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** High-severity findings must be explicitly accepted before the note is saved. */
export function requiresAcknowledgement(warnings = []) {
  return warnings.filter((w) => w.severity === 'high');
}
