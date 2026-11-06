# The prescription, against the Indian format

A prescription in India is not a free-form note. The National Medical Commission's
model format and the Drugs Rules ask for specific things on the paper, and a clinic
that omits them is the clinic a pharmacist has to phone. This page maps every element
of that format to where myClinic holds it and where it prints, so nothing is left to
memory — and it says plainly what the app does not do.

Sources for the checklist: the NMC/MCI model prescription format, the Drugs Rules,
AIIMS Raipur's prescription-writing note, and the e-prescription summaries from
smartclinicindia. The ordering below follows the one most clinics are taught.

## 1. Prescriber details

| Required | Where it lives | Where it prints |
| --- | --- | --- |
| Full name | `staff.full_name` | Header, right block, and again above the signature |
| Qualifications (MBBS, MD…) | `staff.qualification` | Header under the doctor's name, and at the signature |
| State Medical Council registration number | `staff.registration_no` | Header (`Reg. …`) **and** repeated at the signature |
| Specialty | `staff.specialty` | Header |
| Clinic/hospital address | `clinics.address`, `clinics.city` | Document header and footer |
| Phone, email | `clinics.phone`, `clinics.email` | Footer and the repeating page footer |
| Signature and rubber stamp | physical | A ruled signature block with *Signature & clinic seal* under it |

Set them once in **Team → (the doctor) → Edit**: name, qualification, registration
number. An empty registration number prints nothing rather than a placeholder — the
slip never invents a number.

## 2. Patient details

| Required | Where it lives | Where it prints |
| --- | --- | --- |
| Name | `patients.full_name` | Patient block, footer, running footer |
| Age | `patients.dob` or `age_years` | `Age / Sex` line as `34 y` / `8 m` / `12 d` |
| Sex | `patients.gender` | `Age / Sex` line |
| Address | `patients.address`, `patients.city` | `Address` line (added in 1.16.0) |
| Weight | `consultations.vitals.weight_kg` | Vitals strip |
| Height | `consultations.vitals.height_cm` | Vitals strip (added in 1.16.0) |
| Date of prescription | `consultations.visited_on` | Patient block, footer, running footer |
| Patient ID (`PT-00042`) | `patients.code` | Patient block — the handle a phone call quotes |

Weight and height matter most in paediatrics, where a syrup is dosed per kilogram.
They print only when they were measured at that visit: an empty vital is not a zero.

## 3. The medication section

| Required | How myClinic does it |
| --- | --- |
| **℞** superscription | Printed as `℞` beside the *Medicines* heading |
| Drug name | Brand as picked (`Augmentin 625`), and the **generic name in capitals** underneath (`AMOXICILLIN + CLAVULANIC ACID`) |
| Dosage form | `Tablet`, `Syrup`, `Injection`… taken from the drug directory row |
| Strength / potency | In the composition line (`500 mg + 125 mg`), including both ingredients of an FDC |
| Dose & frequency | `Dose` column plus the **pad pattern** printed under it (`1-0-1`) and the frequency read out in words in the patient's language, with the English line beside it |
| Duration | In the directions (`… for 5 days`) |
| **Quantity to be dispensed** | `Qty` column, computed: 1 tablet × twice a day × 5 days = **10 tablets** |
| Schedule H / H1 / X marking | `Schedule H1` / `Schedule X` printed under the generic name where the drug carries one |

The quantity is arithmetic on what was typed, never a guess:

- `1 tablet · Twice a day · 5 days` → **10 tablets**
- `½ tablet · Once a day · 10 days` → **5 tablets**
- `5 ml · Three times a day · 5 days` → **75 ml**
- `1 puff · Twice a day · 1 month` → **60 puffs**
- every 6 hours counts as four a day, every 8 hours as three
- `When needed`, `Once a week`, `till review`, `Apply thinly` → **—** (a dash, because
  a number there would be a lie, and a chemist would dispense to it)

`quantityToDispense()` in `src/lib/rx-language.js` is the one implementation; the
print, the WhatsApp message and the tests all use it.

### The dose pattern

A prescription here is written as three numbers — **morning, afternoon, night** —
and the doctor types them, in the consultation, beside *How often*:

| Typed | Means | Words on the slip | Quantity it gives |
| --- | --- | --- | --- |
| `1-0-1` | one in the morning, one at night | in the morning · at night | 1 tablet × 2 × 5 days = **10 tablets** |
| `1-1-1` | after each meal | in the morning · in the afternoon · at night | **15 tablets** for 5 days |
| `0-0-1` | bedtime only | at night | **5 tablets** for 5 days |
| `0-1-0` | midday only | in the afternoon | **5 tablets** for 5 days |
| `1-1-1-1` | four times, adding the evening | morning · afternoon · evening · night | **8 tablets** for 2 days |
| `½-0-1` | half in the morning, one at night | ½ in the morning · 1 at night | **15 tablets** for 10 days |
| `0-0-3`, dose `5 ml` | three doses of 5 ml at night | at night | **60 ml** for 4 days |

- Two numbers are morning and night (`1-1`), three are morning–afternoon–night,
  four add the evening. `0.5` is accepted and printed as `½`; spaces and dashes
  are both read.
- The pattern **decides the words**: `1-0-1` sets *Twice a day*, `½-0-½` does too,
  and `0-1-0` has no frequency words and keeps its own. Touching the frequency
  dropdown clears the pattern, so the two cannot contradict each other on paper.
- A pattern that cannot be followed is refused in the field — `0-0-0`, `5-0-1`,
  `1-0-1-1-1`, a stray letter — and the row cannot be saved. Nothing unreadable
  reaches the database.
- A half tablet still comes out of a whole one, so a fractional total rounds up:
  `½-0-1` for 3 days is **5 tablets**, not 4.5. A volume is dosed by the
  millilitre, so the number in the pattern multiplies the millilitres; for a
  solid it *is* the count.
- Rows saved before 1.17.0 have no stored pattern; the slip derives one from the
  frequency and the dose exactly as 1.15.0 did (`Twice a day` + `1 tablet` →
  `1-0-1`), so old prescriptions reprint unchanged.

## 4. Clinical notes and advice

| Required | Where it lives | Where it prints |
| --- | --- | --- |
| Chief complaint | `consultations.complaint` | Complaint heading |
| Examination findings | `consultations.examination` | Chart only (not on the patient's slip) |
| Diagnosis / impression | `consultations.diagnoses[]` | Diagnosis chips |
| **Investigations advised** | `consultations.investigations[]` (schema 16) | *Investigations advised* heading |
| Lifestyle / diet / red flags | `consultations.advice` | Advice |
| Follow-up date | `consultations.follow_up_on` | Follow-up block, localised |

Investigations moved out of the free-text advice in 1.16.0: typed comma-separated in
the consultation, they print as their own list, which is what the format asks for and
what the next visit reads back.

## E-prescription

An e-prescription is legal in India when it carries the prescriber's identity and a
signature; the NMC telemedicine guidelines treat a digitally signed prescription the
same as a written one. What myClinic prints is deliberately explicit about that:

> Computer-generated e-prescription · valid only with the prescriber's signature and
> clinic seal

So a sheet that has not been signed cannot be passed off as a signed one, which is the
failure mode that matters. The slip is a PDF the clinic prints, WhatsApps or files; the
signature and the stamp stay a physical act.

What the app does **not** do, on purpose:

- **No digital signature certificate.** A real DSC (or an Aadhaar e-sign) needs a
  signing service and a per-doctor key; pretending a printed name is one would be
  worse than leaving the line blank.
- **No registration-number check.** The State Medical Council register is not public
  in a form worth calling; the number is stored as typed and printed as typed.
- **No Schedule X register.** Schedule X drugs carry a separate statutory register that
  a prescription slip does not replace.
- **No pharmacy licence block.** A clinic that also dispenses needs its own Drug
  Licence numbers; they belong on the clinic's letterhead, not invented here.

## Verify it

1. Open any consultation → **Print / PDF**.
2. Check, top to bottom: clinic name, address, phone, email · doctor name,
   qualifications, `Reg. …` · patient name, ID, age/sex, address, date · vitals
   including weight and height · complaint and diagnosis · `℞` with brand over
   CAPITALISED generic · dose, directions in the chosen language, `Qty` ·
   investigations · advice · follow-up · signature block with `Reg. …` and
   *Signature & clinic seal* · footer saying it is a computer-generated e-prescription
   valid only when signed.
3. Switch the instruction language: the directions change, medicine names, strengths
   and the clinic's details do not.

## The page it prints on

The sheet is A4 — 210 × 297 mm — and it is that size on screen too, so the preview
is not a guess. `.print-sheet` carries the page box (`width: 210mm`,
`min-height: 297mm`, `padding: 13mm 12mm 18mm`) with the same margins `@page`
gives the printer, and `@page { size: A4; margin: 13mm 12mm 18mm }` sets the paper.
Both give a 186 mm content width, so a line that fits on screen fits on paper.

- The bottom 8 mm of a printed sheet is kept clear for the footer that repeats on
  every page (`.print-foot`), so the last line of a one-page slip never sits under
  it.
- A prescription longer than a page breaks between medicine rows
  (`break-inside: avoid` on `tr`, `.rx-sign`, `.rx-patient`, `.doc-foot`), never
  inside one, and the medicine table header repeats (`display: table-header-group`).
- On a phone the sheet drops the fixed A4 height and keeps 16 px of padding; a
  297 mm page on a 360 px screen is not a preview, it is a scrollbar.

To check it: print → destination *Save as PDF* → paper size **A4**, margins
**Default**, scale **100%** (not "Fit to page"). The PDF's page count should match
what the screen showed.

### What the print stylesheet refuses to do, and why

The generated PDF was once unreadable: the footer printed above the header and the
slip arrived in pieces on two pages. Each of those had a cause worth keeping out
of the code:

| Rule | Why |
| --- | --- |
| `html, body, #root, .shell, .doc-page { height: auto; min-height: 0 }` in print | They are `100%` / `100dvh` on screen. In paged media that resolves against the page box, and content taller than it overflows a container that cannot fragment — the overflow restarts at the top of page two, taking `break-inside: avoid` blocks with it. |
| No `position: fixed` anywhere in the document | A fixed element prints on every page, but Chrome emits it at the head of each page's content stream: it lands on the letterhead, and it comes first in any text extraction of the PDF. The footer is in flow. |
| No `display: grid` in print | Chrome's grid fragmentation is unreliable, and a grid with `break-inside: avoid` can jump to the top of the next page. `.rx-patient`, `.doc-foot` and the invoice blocks are flex rows on paper. |
| One footer, not two | `.doc-foot` carries the clinic identity, the validity line and the e-prescription line. A second, repeating footer was duplication on page one and noise in the file. |

Verify with `rx-print-check.html` in the workspace: a standalone copy of the slip
that uses the app's own stylesheet, so it prints exactly as the app does.

## Where the code lives

| Piece | File |
| --- | --- |
| Slip layout | `src/pages/PrescriptionView.jsx` |
| Directions, patterns, quantities | `src/lib/rx-language.js` |
| WhatsApp/printed message version | `src/lib/messages.mjs` (`prescriptionMessage`) |
| Doctor and clinic details | `supabase/schema.sql` (`staff`, `clinics`) |
| Investigations column | `supabase/schema.sql` §16 |
| Tests | `tests/rx-line.test.mjs`, `supabase/schema-tests.sql` Suite L |
