/**
 * Source of truth for the golden set. Each answerable row carries an `evidence`
 * phrase that must appear verbatim in exactly one chunk; scripts/build-golden.ts
 * resolves that to the ground-truth chunk id, so the ids in golden.jsonl are
 * derived rather than hand-copied and cannot drift when the corpus is re-chunked.
 *
 * 48 answerable, 12 unanswerable. The 12 are unanswerable on purpose. Most golden sets skip this, and
 * confabulating on a question the corpus does not cover is exactly the failure
 * that makes an agent sound fake.
 */
export interface GoldenSource {
  id: string;
  question: string;
  answer: string;
  /** Verbatim span from the corpus. Omitted for unanswerable rows. */
  evidence?: string;
  answerable: boolean;
  /** Why this row is unanswerable, for the report. */
  gapReason?: string;
}

export const GOLDEN: GoldenSource[] = [
  // ---------------------------------------------------------------- services
  { id: 'g01', question: 'How long is a routine check up?', answer: 'A routine examination takes 20 minutes.', evidence: 'A routine examination takes 20 minutes', answerable: true },
  { id: 'g02', question: 'how long does a first appointment take', answer: 'A new patient examination takes 40 minutes.', evidence: 'A new patient examination takes 40 minutes', answerable: true },
  { id: 'g03', question: 'do you still use silver fillings', answer: 'No. Fillings are white composite as standard and amalgam is no longer placed at any site.', evidence: 'Amalgam is no longer placed at any Meridian site', answerable: true },
  { id: 'g04', question: 'how many appointments is a root canal on a back tooth', answer: 'A molar root canal is usually two appointments of 90 minutes, two to three weeks apart.', evidence: 'A molar is usually two appointments of 90 minutes', answerable: true },
  { id: 'g07', question: 'is deep cleaning done in one go', answer: 'No, it is split across two appointments of 45 minutes, one per side, usually two weeks apart.', evidence: 'split across two appointments of 45 minutes', answerable: true },
  { id: 'g08', question: 'can I have a hygienist at shoreditch', answer: 'Yes. Docklands and Shoreditch both have a dedicated hygienist.', evidence: 'Hygiene is available at Docklands and Shoreditch with a dedicated hygienist', answerable: true },
  { id: 'g09', question: 'can i get filler on the same day as the consultation', answer: 'No. There is a mandatory two-week cooling-off period before a first-time filler treatment.', evidence: 'mandatory two-week cooling-off period', answerable: true },
  { id: 'g10', question: 'do you do aesthetics in shoreditch', answer: 'No. Aesthetics is available at Docklands and Clapham only.', evidence: 'Shoreditch does not offer aesthetics', answerable: true },
  { id: 'g11', question: 'how long does in surgery whitening take', answer: 'A single appointment of 90 minutes.', evidence: 'In-surgery whitening is a single appointment of 90 minutes', answerable: true },
  { id: 'g12', question: 'will whitening work on my crown', answer: 'No. Whitening does not change the colour of crowns, veneers or white fillings.', evidence: 'does not change the colour of crowns, veneers or white fillings', answerable: true },
  { id: 'g13', question: 'what time do the emergency appointments get released', answer: 'Each site holds two emergency slots per weekday, released at 8am on the day.', evidence: 'released at 8am on the day', answerable: true },
  { id: 'g14', question: 'is there an out of hours number', answer: 'There is no on-call service. The answerphone gives the NHS 111 number.', evidence: 'The answerphone gives the NHS 111 number', answerable: true },

  // ----------------------------------------------------------------- pricing
  { id: 'g15', question: 'how much is a new patient appointment', answer: 'A new patient examination is £95.', evidence: '| New patient examination | £95 |', answerable: true },
  { id: 'g16', question: 'whats a check up cost', answer: 'A routine examination is £65.', evidence: '| Routine examination | £65 |', answerable: true },
  { id: 'g17', question: 'how much for a crown', answer: 'Crowns are in the £750 to £1,100 band, with the exact figure in the written plan after an examination.', evidence: '| Crown | £750 to £1,100 |', answerable: true },
  { id: 'g18', question: 'price for a hygiene appointment', answer: 'Hygiene is £85 for 30 minutes, or £130 for 45 minutes with air-flow.', evidence: '| Hygiene, 30 minutes | £85 |', answerable: true },
  { id: 'g19', question: 'how much is take home whitening', answer: 'Take-home whitening with custom trays is £395.', evidence: '| Take-home whitening with custom trays | £395 |', answerable: true },
  { id: 'g20', question: 'cost of anti wrinkle for three areas', answer: 'Anti-wrinkle for three areas is £320.', evidence: '| Anti-wrinkle, three areas | £320 |', answerable: true },
  { id: 'g22', question: 'how much are xrays', answer: 'X-rays are £25 each, and are included in the new patient examination fee where clinically indicated.', evidence: 'X-rays are £25 each', answerable: true },
  { id: 'g24', question: 'why is the crown price a range', answer: 'It depends on where the tooth is, how much is left, whether the work is being redone, and how long the appointment needs.', evidence: 'Where the tooth is, how much of it is left', answerable: true },

  // ------------------------------------------------------------------- prep
  { id: 'g25', question: 'what do i need to bring to my first appointment', answer: 'A list of your medication and the name and address of your previous dentist if you have been treated in the last two years.', evidence: 'Bring a list of any medication you take', answerable: true },
  { id: 'g26', question: 'how early should i turn up', answer: 'Five minutes early for a routine appointment, fifteen for a first visit.', evidence: 'Arrive five minutes early for a routine appointment', answerable: true },
  { id: 'g28', question: 'what should i avoid before filler', answer: 'Alcohol for 24 hours, and ibuprofen, aspirin, fish oil, vitamin E and ginkgo for 48 hours where safe, because they increase bruising.', evidence: 'Avoid ibuprofen, aspirin, fish oil, vitamin E', answerable: true },
  { id: 'g29', question: 'can my mum bring my son in', answer: 'Only if she holds parental responsibility. A grandparent cannot consent otherwise.', evidence: 'A grandparent or childminder\ncannot consent unless they hold parental responsibility', answerable: true },
  { id: 'g30', question: 'i think ive got a cold should i still come', answer: 'Call and move it. There is no charge for cancelling because you are ill, at any notice.', evidence: 'There is no charge for cancelling because you are ill', answerable: true },

  // ----------------------------------------------------------- cancellation
  { id: 'g31', question: 'how much notice to cancel', answer: '24 hours, or 48 hours for appointments longer than 45 minutes.', evidence: "We ask for 24 hours' notice", answerable: true },
  { id: 'g32', question: 'what happens if i miss an appointment', answer: 'A first missed appointment carries no charge. A second within twelve months is charged at 50% of the fee.', evidence: 'A first missed appointment carries no charge', answerable: true },
  { id: 'g33', question: 'is the deposit refundable', answer: 'Yes, in full, if the appointment is changed with the required notice.', evidence: 'It is refunded in full if the appointment is changed with the required notice', answerable: true },
  { id: 'g35', question: 'im running 15 mins late is that ok', answer: 'For a 20-minute appointment we usually need to rebook after ten minutes. Call ahead and we will tell you honestly.', evidence: 'more than ten minutes late for a 20-minute appointment', answerable: true },
  { id: 'g36', question: 'how does the cancellation list work', answer: 'We text the short-notice list in order when someone cancels, and the first to reply takes the slot. Most people get an offer within eight working days.', evidence: 'get an offer within eight working days', answerable: true },

  // ------------------------------------------------------------- locations
  { id: 'g37', question: 'where do i park at docklands', answer: 'Six patient bays behind the building off the service road, free for two hours with a code from reception.', evidence: 'six patient bays behind the building', answerable: true },
  { id: 'g39', question: 'what time do you close on saturday', answer: 'All three sites close at 2pm on Saturday.', evidence: 'Saturday 9am to 2pm', answerable: true },
  { id: 'g40', question: 'are you open sundays', answer: 'No. All three sites are closed on Sundays and bank holidays.', evidence: 'closed on Sundays and on bank holidays', answerable: true },
  { id: 'g41', question: 'is shoreditch wheelchair accessible', answer: 'The surgeries are on the first floor and there is a lift, large enough for a wheelchair.', evidence: 'The lift is large enough for a wheelchair', answerable: true },
  { id: 'g42', question: 'can i be seen at a different branch to my usual one', answer: 'Yes. Records are shared across all three sites, though your usual clinician does not move with you.', evidence: 'Your records are shared across all three sites', answerable: true },

  // --------------------------------------------------------------- payment
  { id: 'g44', question: 'do you take nhs', answer: 'No. Meridian is fully private and holds no NHS contract at any site.', evidence: 'We do not hold an NHS contract', answerable: true },
  { id: 'g45', question: 'can i pay with bupa', answer: 'We do not bill insurers directly. You pay us and claim back with the itemised receipt.', evidence: 'we do not bill insurers directly', answerable: true },
  { id: 'g46', question: 'how much is the monthly plan', answer: 'The Meridian Plan is £24.50 a month.', evidence: 'The Meridian Plan is £24.50 a month', answerable: true },
  { id: 'g47', question: 'can i pay in instalments', answer: 'Interest-free finance over six or twelve months is available on plans over £1,000, subject to a credit check.', evidence: 'Interest-free finance over six or twelve months', answerable: true },
  { id: 'g48', question: 'can i pay cash at shoreditch', answer: 'No. Shoreditch does not take cash. Docklands and Clapham take cash up to £500.', evidence: 'We do not take cash at Shoreditch', answerable: true },

  // ---------------------------------------------------- team / new patients
  { id: 'g49', question: 'who is best for someone whos scared of the dentist', answer: 'Dr Tom Okafor at Docklands, who runs the longer slots and does the familiarisation visits.', evidence: 'focus on nervous patients', answerable: true },
  { id: 'g50', question: 'which days does elena work', answer: 'Docklands on Wednesdays and Fridays, and Clapham on Thursdays.', evidence: 'Consults at Docklands on Wednesdays and Fridays', answerable: true },
  { id: 'g52', question: 'can i just come and look round first', answer: 'Yes. A familiarisation visit is fifteen minutes with nothing done, at no charge.', evidence: 'That is a familiarisation visit', answerable: true },

  // ------------------------------------------------------- aftercare / faq
  { id: 'g54', question: 'when can i eat after a filling', answer: 'Once the numbness has gone, usually two to three hours.', evidence: 'avoid eating until the numbness has gone', answerable: true },
  { id: 'g55', question: 'can i rinse after having a tooth out', answer: 'Not for 24 hours. After that, warm salty water four times a day for a week.', evidence: 'Do not rinse at all for 24 hours', answerable: true },
  { id: 'g56', question: 'whats a dry socket', answer: 'A deep ache starting three to four days after an extraction that painkillers barely touch, often with a bad taste. It is dressed in a ten-minute appointment.', evidence: 'A dry socket typically starts three to four days afterwards', answerable: true },
  { id: 'g57', question: 'im pregnant can i still have a clean', answer: 'Yes. Routine examinations and hygiene are safe throughout pregnancy.', evidence: 'Routine examinations and hygiene are safe throughout pregnancy', answerable: true },
  { id: 'g58', question: 'how do i complain', answer: 'In writing to the practice manager. Acknowledged within three working days and answered within twenty-one days.', evidence: 'acknowledged within three working days', answerable: true },

  // ------------------------------------------------- deliberately unanswerable
  // The corpus is silent on these. An agent that answers them fluently is
  // confabulating, and that is the single failure this set exists to catch.
  { id: 'u01', question: 'do you do invisalign', answer: 'ABSTAIN', answerable: false, gapReason: 'Orthodontics is not covered anywhere in the corpus.' },
  { id: 'u02', question: 'can i get braces as an adult', answer: 'ABSTAIN', answerable: false, gapReason: 'Orthodontics is not covered anywhere in the corpus.' },
  { id: 'u03', question: 'do you offer sedation', answer: 'ABSTAIN', answerable: false, gapReason: 'Sedation is not covered; the corpus only discusses local anaesthetic.' },
  { id: 'u04', question: 'can i be put to sleep for treatment', answer: 'ABSTAIN', answerable: false, gapReason: 'General anaesthetic is not covered anywhere in the corpus.' },
  { id: 'u05', question: 'how much is a dental implant', answer: 'ABSTAIN', answerable: false, gapReason: 'Implants appear in no service list and no pricing band.' },
  { id: 'u06', question: 'do you place implants at docklands', answer: 'ABSTAIN', answerable: false, gapReason: 'Implants appear in no service list and no pricing band.' },
  { id: 'u07', question: 'is there parking at clapham', answer: 'ABSTAIN', answerable: false, gapReason: 'Parking is documented for Docklands and Shoreditch only. The Clapham section is silent, and this is the hard case: retrieval returns a highly relevant chunk that does not contain the answer.' },
  { id: 'u08', question: 'do you have a car park at the clapham branch', answer: 'ABSTAIN', answerable: false, gapReason: 'Parking is documented for Docklands and Shoreditch only.' },
  { id: 'u09', question: 'do you do teeth straightening', answer: 'ABSTAIN', answerable: false, gapReason: 'Orthodontics is not covered anywhere in the corpus.' },
  // Replaced a flawed row. The original u10 asked for the cancellation charge on
  // a hygiene appointment "specifically", on the theory that the corpus gives
  // only a percentage. But it gives both the percentage and the hygiene fee, so
  // the answer is derivable and the row was mislabelled as unanswerable. The
  // agent answering it was correct and the eval was wrong. Sports mouthguards
  // are genuinely absent, and sit next to night guards in the corpus, which
  // makes retrieval return something plausible and adjacent.
  { id: 'u10', question: 'do you do mouthguards for rugby', answer: 'ABSTAIN', answerable: false, gapReason: 'Sports mouthguards appear nowhere. The corpus lists a night guard for grinding, which is a different appliance for a different problem.' },
  { id: 'u11', question: 'do you sell electric toothbrushes', answer: 'ABSTAIN', answerable: false, gapReason: 'Retail products are not covered anywhere in the corpus.' },
  { id: 'u12', question: 'is there a hearing loop at shoreditch', answer: 'ABSTAIN', answerable: false, gapReason: 'A hearing loop is documented at Docklands only. Shoreditch accessibility is described without mentioning one, so the answer is not stated either way.' },
];
