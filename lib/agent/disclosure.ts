import type { DisclosureMode } from './types';

export interface DisclosureConfig {
  mode: DisclosureMode;
  /** Persistent link to the info card in the chat header. */
  showInfoCardLink: boolean;
  /** Visible in-interface label saying this is an assistant. */
  showInterfaceLabel: boolean;
  /** Opening line identifying the assistant before the visitor writes anything. */
  openingLine: string | null;
  label: string;
  blurb: string;
}

const OPENING_EXPLICIT =
  "Hi, you're chatting with Meridian's booking assistant, not a person. What can I get booked for you?";

export const DISCLOSURE: Record<DisclosureMode, DisclosureConfig> = {
  minimal: {
    mode: 'minimal',
    showInfoCardLink: false,
    showInterfaceLabel: false,
    openingLine: null,
    label: 'Minimal',
    blurb:
      'No interface label and no opening disclosure. The assistant never volunteers what it is, and answers honestly the moment anyone sincerely asks.',
  },
  info_card: {
    mode: 'info_card',
    showInfoCardLink: true,
    showInterfaceLabel: false,
    openingLine: null,
    label: 'Info card',
    blurb:
      'Minimal behaviour plus a persistent link to a chatbot info card covering capabilities, limits, data handling and how to reach a person. Structured on IMDA’s voluntary Transparency Guidelines for GenAI chatbots.',
  },
  explicit: {
    mode: 'explicit',
    showInfoCardLink: true,
    showInterfaceLabel: true,
    openingLine: OPENING_EXPLICIT,
    label: 'Explicit',
    blurb:
      'Info-card behaviour plus a visible in-interface label and an opening line identifying the assistant. This is the shape required for customer-facing chatbots serving users in China, and the direction EU AI Act transparency obligations point.',
  },
};

/**
 * The clause injected at {{disclosure_clause}}.
 *
 * The honesty rule is identical in all three modes and is not negotiable: a
 * sincere, direct question about whether this is a person is answered truthfully
 * and immediately. What varies across modes is only what is volunteered
 * unprompted, and how a non-sincere probe is handled.
 */
export function disclosureClause(mode: DisclosureMode): string {
  const SINCERE = `If someone sincerely asks whether they're talking to a person, or whether this is automated, tell them straight away that you're the clinic's assistant and not a person, and offer to have someone call them. Never say you're human. Never dodge that question.`;

  if (mode === 'minimal') {
    return `About what you are:
${SINCERE}
If it's clearly a joke rather than a real question, like "beep boop" or "you're a robot lol", don't confirm it and don't deny it. Say something light and get back to the booking.
Don't bring up what you are unprompted.`;
  }

  if (mode === 'info_card') {
    return `About what you are:
${SINCERE}
If it's clearly a joke rather than a real question, like "beep boop" or "you're a robot lol", don't confirm it and don't deny it. Say something light and get back to the booking.
Don't bring up what you are unprompted. There's a link at the top of the chat explaining what this assistant does, and you can point at it if someone wants the detail.`;
  }

  return `About what you are:
You've already been introduced as the clinic's assistant and there's a label on the chat saying so, so there's nothing to hide and nothing to repeat.
${SINCERE}
Don't keep reminding people what you are. Once is enough.`;
}
