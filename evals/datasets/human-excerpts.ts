/**
 * Twenty short exchanges written as a human receptionist at a private dental
 * practice. These are the control arm of the blind clock-rate study: a labeller
 * who can pick the agent out of this set is genuinely clocking it, rather than
 * spotting that one set is "chat-shaped" and the other is not.
 *
 * They are invented, not transcribed. No real client data is used anywhere in
 * this project.
 */
export const HUMAN_EXCERPTS: { id: string; lines: { who: 'visitor' | 'desk'; text: string }[] }[] = [
  { id: 'h01', lines: [
    { who: 'visitor', text: 'hi do you have anything friday' },
    { who: 'desk', text: "Friday's pretty full I'm afraid. I've got 9am or half four." },
    { who: 'visitor', text: 'half four' },
    { who: 'desk', text: "That's fine. Name?" },
  ]},
  { id: 'h02', lines: [
    { who: 'visitor', text: "I've chipped a front tooth, is that an emergency" },
    { who: 'desk', text: "Depends if it's sore. Is it hurting or just the edge gone?" },
    { who: 'visitor', text: 'just the edge' },
    { who: 'desk', text: "Then we can do it properly rather than rushing it. Tuesday 11am?" },
  ]},
  { id: 'h03', lines: [
    { who: 'visitor', text: 'how much is a filling' },
    { who: 'desk', text: "Between £160 and £320 depending how big it is. The dentist gives you the exact figure before anything's done." },
  ]},
  { id: 'h04', lines: [
    { who: 'visitor', text: "can I move tomorrow's appointment" },
    { who: 'desk', text: "Yeah no problem. What day suits instead?" },
    { who: 'visitor', text: 'next week sometime' },
    { who: 'desk', text: "I've got Wednesday 2pm or Thursday 10am." },
  ]},
  { id: 'h05', lines: [
    { who: 'visitor', text: 'do you take bupa' },
    { who: 'desk', text: "We don't bill them directly, you'd pay us and claim it back. The receipt has the codes they want on it." },
  ]},
  { id: 'h06', lines: [
    { who: 'visitor', text: "I'm really nervous about coming in" },
    { who: 'desk', text: "That's alright, lots of people are. I'll put you with Tom, he does the longer appointments." },
    { who: 'visitor', text: 'thank you' },
    { who: 'desk', text: "You can come and just look at the room first if you want, no charge for that." },
  ]},
  { id: 'h07', lines: [
    { who: 'visitor', text: 'whats the earliest you have' },
    { who: 'desk', text: "Tomorrow 8am at Docklands. Bit early but it's there." },
    { who: 'visitor', text: 'anything shoreditch' },
    { who: 'desk', text: "Shoreditch is Thursday, 9.30." },
  ]},
  { id: 'h08', lines: [
    { who: 'visitor', text: 'parking?' },
    { who: 'desk', text: "Six spaces round the back at Docklands, first come first served. Reception gives you the code." },
  ]},
  { id: 'h09', lines: [
    { who: 'visitor', text: 'I need a hygienist but ive not been in ages' },
    { who: 'desk', text: "You'd need an exam first then, since we've not seen you. Want me to do both?" },
    { who: 'visitor', text: 'go on then' },
  ]},
  { id: 'h10', lines: [
    { who: 'visitor', text: 'do you do saturdays' },
    { who: 'desk', text: '9 til 2 at all three. They go quickly though.' },
    { who: 'visitor', text: 'this saturday?' },
    { who: 'desk', text: "Nothing left this week, sorry. Following Saturday I've got 11.30." },
  ]},
  { id: 'h11', lines: [
    { who: 'visitor', text: 'can I pay monthly' },
    { who: 'desk', text: "There's a plan at £24.50 a month, covers two exams and two hygienes. Or finance if it's a bigger bit of work." },
  ]},
  { id: 'h12', lines: [
    { who: 'visitor', text: 'my son is 7 can he come' },
    { who: 'desk', text: "Course. You'd need to be in the room the whole time though. £45 for a child exam." },
  ]},
  { id: 'h13', lines: [
    { who: 'visitor', text: 'sorry im going to be about 15 mins late' },
    { who: 'desk', text: "Hang on, let me look. What time were you in for?" },
    { who: 'visitor', text: '3pm' },
    { who: 'desk', text: "Should be alright, it's a 40 minute one. Come when you can." },
  ]},
  { id: 'h14', lines: [
    { who: 'visitor', text: 'is whitening worth it' },
    { who: 'desk', text: "Not really my call, that's one for the dentist. I can book you a consult if you want to talk it through." },
  ]},
  { id: 'h15', lines: [
    { who: 'visitor', text: 'what do I need to bring' },
    { who: 'desk', text: 'List of any medication and your old dentist\'s details if you were seen in the last couple of years.' },
    { who: 'visitor', text: 'ok' },
    { who: 'desk', text: "There's a form in the email too, saves you ten minutes if you do it before." },
  ]},
  { id: 'h16', lines: [
    { who: 'visitor', text: 'ive got a really bad toothache' },
    { who: 'desk', text: "How bad, keeping you up bad?" },
    { who: 'visitor', text: 'yeah barely slept' },
    { who: 'desk', text: "Right. Emergency slots go at 8 tomorrow, but hang on, let me see if I can squeeze you in today." },
  ]},
  { id: 'h17', lines: [
    { who: 'visitor', text: 'do you have a lift at shoreditch' },
    { who: 'desk', text: "Yes, surgeries are first floor and the lift's fine for a wheelchair." },
  ]},
  { id: 'h18', lines: [
    { who: 'visitor', text: 'cancel my appointment please' },
    { who: 'desk', text: "No problem. Which one, the Thursday?" },
    { who: 'visitor', text: 'yes' },
    { who: 'desk', text: "Done. Want me to rebook or leave it for now?" },
  ]},
  { id: 'h19', lines: [
    { who: 'visitor', text: 'im pregnant can I still have a clean' },
    { who: 'desk', text: "Yes that's fine all the way through. Just tell the hygienist when you're in." },
  ]},
  { id: 'h20', lines: [
    { who: 'visitor', text: 'how long does a new patient one take' },
    { who: 'desk', text: "Forty minutes. You get a written plan emailed after, usually same day." },
    { who: 'visitor', text: 'and the cost' },
    { who: 'desk', text: '£95.' },
  ]},
];
