/**
 * Domain logic — now a barrel.
 *
 * Until v1.29.0 this file was 852 lines and 88 exports: money, dates, tokens,
 * invoices, patients, the queue, reporting, validation, CSV and the clinic defaults,
 * cohesive by *language* rather than by *responsibility*, so an edit to a date
 * helper sat in the same file as an edit to invoice tax. docs/ARCHITECTURE.md §3
 * step 3 splits it into focused modules.
 *
 * **Every existing import keeps working.** This file re-exports the same names from
 * the same modules, and a test asserts that each re-export is the identical
 * function object, so moving code cannot change behaviour by accident.
 */

export { moneyToPaise, paiseToInput, formatMoney, amountInWords, applyPayment, sumBy } from './money.mjs';
export { localISO, validISO, today, currentMonth, addDays, shiftMonth, monthLabel, recentMonths, formatDate, relativeDay, daysBetween, timeToMinutes, minutesToTime, formatTime, formatSlotRange, ageFromDOB, ageLabel, financialYear } from './dates.mjs';
export { ordinalSuffix, initials, titleCase, slugify } from './text.mjs';
export { patientCode, invoiceNumber, nextRxNumber, nextId } from './ids.mjs';
export { APPOINTMENT_STATUS, APPOINTMENT_TYPES, statusMeta, generateSlots, sortAppointments, appointmentsForDate, slotAvailability, appointmentMatchesQuery } from './appointments.mjs';
export { DEFAULT_SERVICES, computeLine, computeInvoice, invoiceStatus, invoiceBalance, outstandingByPatient, feeForVisit } from './invoicing.mjs';
export { patientSearch, patientVisits, visitFrequency, lastAppointmentVisit, appointmentVisitsSince, lastVisit, followUpDue } from './patients.mjs';
export { nextTokenNo, tokenLabel, waitedMinutes, humanWait, queueBoard, queueState, averageWait, ROOM_LIMIT, canCallNext, roomFullMessage, roomSeats } from './queue.mjs';
export { inMonth, monthTotals, revenueSeries, footfallSeries, categoryRevenue, payerMix, doctorPerformance, occupancy, topDiagnoses } from './reporting.mjs';
export { PHONE_RE, validatePatient, validateAppointment, validateConsultation } from './validation.mjs';
export { CLINIC_TYPES, ROLES, PAYMENT_METHODS, BLOOD_GROUPS, GENDERS, CHRONIC_TAGS, PLANS, DEFAULT_CLINIC, DEFAULT_PREFERENCES, PROFILE_COLUMNS, pickColumns, profilePatch } from './constants.mjs';
export { toCSV, downloadFile } from './csv.mjs';
