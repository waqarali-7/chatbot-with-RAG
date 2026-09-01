import { describe, expect, it } from 'vitest';
import { judgeTell } from '@/lib/llm/mock/judge';
import { scoreTurnDeterministic } from './deterministic';

/**
 * A scorer that reports zero on the system it grades is worthless unless you can
 * show it fires on the thing it claims to detect. These are the negative
 * controls for the tell-rate: known-bad replies that must be flagged, and clean
 * replies that must not be.
 */

const det = (agent: string, user = 'do you have anything thursday') =>
  scoreTurnDeterministic({ turnId: 't', personaId: 'p', userMessage: user, agentMessage: agent });

describe('deterministic tell scorer catches the style tells it claims to', () => {
  it('flags an over-long reply', () => {
    const long =
      'I can look into that for you and see what we have available across all three of our sites, and once I have checked through the diary properly I will come back to you with a handful of options that might suit your schedule rather better than the ones I mentioned a moment ago.';
    expect(det(long).violations).toContain('over_length');
  });

  it('flags three sentences even when short', () => {
    expect(det('Sure. That works. See you then.').violations).toContain('over_length');
  });

  it('flags list formatting', () => {
    expect(det('We have:\n- 10am\n- 2pm').violations).toContain('list_formatting');
  });

  it('flags an em dash and an spaced hyphen', () => {
    expect(det('That works — see you then.').violations).toContain('em_dash');
    expect(det('That works - see you then.').violations).toContain('em_dash');
  });

  it('flags every banned opener', () => {
    for (const opener of ['Great', 'Perfect', 'Absolutely', 'Certainly', 'Of course', 'I understand']) {
      expect(det(`${opener}, I can do that.`).violations).toContain('banned_opener');
    }
  });

  it('flags assistant register', () => {
    expect(det('Is there anything else I can help you with?').violations).toContain('assistant_register');
    expect(det("I'd be happy to assist you today.").violations.length).toBeGreaterThan(0);
  });

  it('flags stacked questions', () => {
    expect(det('What time suits? And which site?').violations).toContain('question_stacking');
  });

  it('flags several requests hiding behind one question mark', () => {
    // Regression: a real model produced this and the "?"-count check passed it.
    const agent = 'Can I grab your name, and got a preferred site, or would tomorrow at 10am in Docklands work?';
    const report = det(agent);
    expect(report.violations).toContain('question_stacking');
    expect(report.evidence.question_stacking).toMatch(/asks for/);
  });

  it('does not flag a normal two-slot offer as stacking', () => {
    expect(det("I've got 10am or 11am tomorrow. Either work?").violations).not.toContain(
      'question_stacking',
    );
  });

  it('does not flag a two-slot offer that names the sites', () => {
    // Regression from a real run: this was rejected as stacked, so the offer
    // never reached the visitor and the conversation could not reach a booking.
    const offer =
      'Got tomorrow at 10am in Docklands with Dr Okafor, or 11am in Shoreditch with Dr Nair, either work?';
    expect(det(offer).violations).not.toContain('question_stacking');
  });

  it('still flags a genuine multi-part question', () => {
    const stacked = 'Can I grab your name, and which site would you prefer, or would 10am work?';
    expect(det(stacked).violations).toContain('question_stacking');
  });

  it('flags a recap of the user message', () => {
    const user = 'I need to book a hygiene appointment for next Thursday morning please';
    const agent = 'So you need to book a hygiene appointment for next Thursday morning.';
    expect(det(agent, user).violations).toContain('recap');
  });

  it('flags over-acknowledgement', () => {
    expect(det("I've noted that down for you.").violations).toContain('over_ack');
  });

  it('flags emoji excess', () => {
    expect(det('Booked you in 😀 see you then 🎉').violations).toContain('emoji_excess');
  });

  it('does not flag a clean reply', () => {
    expect(det("I've got Thursday at 10am free. Does that work?").violations).toEqual([]);
  });
});

const tell = (agent: string, user: string, extra: Partial<Parameters<typeof judgeTell>[0]> = {}) =>
  judgeTell({
    turnId: 't',
    userMessage: user,
    agentMessage: agent,
    context: 'A routine examination takes 20 minutes and costs £65.',
    retrievalEmpty: false,
    offScript: false,
    ...extra,
  }).flags;

describe('judge tell scorer catches what the regex cannot', () => {
  it('flags a recap', () => {
    expect(
      tell(
        'So you would like a hygiene appointment on Thursday morning, understood.',
        'I would like a hygiene appointment on Thursday morning',
      ).recap,
    ).toBe(true);
  });

  it('flags performative acknowledgement', () => {
    expect(tell('Thank you for confirming, that is helpful.', 'its Sam').over_ack).toBe(true);
  });

  it('flags assistant register', () => {
    expect(tell('Please do not hesitate to let me know.', 'ok').assistant_register).toBe(true);
  });

  it('flags over-explaining a short question', () => {
    const long =
      'A routine examination takes twenty minutes and includes a check of every tooth, a soft tissue examination, a periodontal screening score, and small bitewing X-rays where they are clinically indicated by your history.';
    expect(tell(long, 'how long').over_explains).toBe(true);
  });

  it('flags formality mismatched to a casual visitor', () => {
    expect(
      tell('I would be delighted to arrange that for you.', 'wat time').unnatural_formality,
    ).toBe(true);
  });

  it('flags asserting a fact when nothing was retrieved', () => {
    expect(
      tell('We fit implants at all three sites for £2,400.', 'do you do implants', {
        retrievalEmpty: true,
        context: '',
      }).no_idk,
    ).toBe(true);
  });

  it('does not flag an abstention when nothing was retrieved', () => {
    expect(
      tell("Not sure on that one, I'll check and come back to you.", 'do you do implants', {
        retrievalEmpty: true,
        context: '',
      }).no_idk,
    ).toBe(false);
  });

  it('does not flag a booking confirmation as an unsupported claim', () => {
    expect(
      tell("Booked you in for tomorrow at 10am. Confirmation's on its way by email.", "it's Sam", {
        retrievalEmpty: true,
        context: '',
        action: 'booked',
      }).no_idk,
    ).toBe(false);
  });

  it('flags losing the thread on a tangent', () => {
    expect(
      tell('Your name please.', 'did you see the football last night', { offScript: true }).derails_off_script,
    ).toBe(true);
  });

  it('does not flag a clean reply on any axis', () => {
    const flags = tell("I've got Thursday at 10am. Does that work?", 'anything thursday');
    expect(Object.values(flags).every((f) => f === false)).toBe(true);
  });
});
