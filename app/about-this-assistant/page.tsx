import Link from 'next/link';
import { DISCLOSURE } from '@/lib/agent/disclosure';
import { disclosureModeFromEnv } from '@/lib/agent/types';

export const dynamic = 'force-dynamic';

const LAST_UPDATED = '31 August 2026';

/**
 * Chatbot info card. Structured on the IMDA principles of relevance,
 * accessibility and timeliness, in plain language rather than legal register.
 * Short enough to read in ninety seconds, because long disclosure nobody reads
 * is worse than none.
 */
export default function AboutPage() {
  const mode = disclosureModeFromEnv();

  return (
    <main className="mx-auto max-w-[38rem] px-5 py-12 sm:py-16">
      <p className="text-[13px] text-[var(--color-ink-faint)]">
        <Link href="/" className="underline underline-offset-2 hover:text-[var(--color-ink)]">
          Back to the chat
        </Link>
      </p>

      <h1 className="mt-6 text-[26px] font-semibold leading-tight tracking-[-0.01em]">
        About this assistant
      </h1>
      <p className="mt-3 text-[16px] leading-[1.6] text-[var(--color-ink-soft)]">
        The chat on our website is answered by an automated assistant, not a person. It handles
        enquiries and books appointments for all three Meridian sites. Here is what it does, what it
        does not do, and how to get a human instead.
      </p>

      <Section title="What it can do">
        <ul className="list-none space-y-2">
          <Item>Answer questions about our services, prices, opening hours, locations and policies.</Item>
          <Item>Show you appointments that are genuinely free and book one for you.</Item>
          <Item>Take your name and the reason for your visit. Nothing else is needed to book.</Item>
          <Item>Put you on the short-notice list when nothing suitable is open.</Item>
        </ul>
      </Section>

      <Section title="What it cannot do">
        <ul className="list-none space-y-2">
          <Item>Give clinical advice, or tell you what treatment you need. Only a clinician does that.</Item>
          <Item>Quote a final price. Prices are bands until a dentist has looked at your mouth.</Item>
          <Item>Deal with a dental emergency. If you are in severe pain or your face is swelling, call us on 020 7946 0812, or NHS 111 when we are closed.</Item>
          <Item>Change or cancel an existing appointment. Call the practice for that.</Item>
        </ul>
      </Section>

      <Section title="How reliable it is, and where it is likely to be wrong">
        <p className="text-[15px] leading-[1.65] text-[var(--color-ink-soft)]">
          It answers only from a fixed set of practice documents. When a question is not covered, it
          is built to say it is not sure and offer to check, rather than guess. That behaviour is
          tested: on our internal test set it declines every question the documents cannot answer.
        </p>
        <p className="mt-3 text-[15px] leading-[1.65] text-[var(--color-ink-soft)]">
          Where it is most likely to be wrong: anything unusual or specific to your circumstances,
          anything clinical, and anything that changed in the last few days but is not yet in its
          documents. It errs toward saying it does not know, so expect it to decline sometimes when a
          person on the phone could have answered.
        </p>
        <p className="mt-3 text-[15px] leading-[1.65] text-[var(--color-ink-soft)]">
          Appointment times are read live from the practice diary, so a time it offers is a time that
          is genuinely free at that moment.
        </p>
      </Section>

      <Section title="What happens to what you type">
        <ul className="list-none space-y-2">
          <Item>Your messages are sent to a third-party AI provider to generate the reply.</Item>
          <Item>The conversation and a technical record of each turn are stored so we can check the assistant is behaving. Demo conversations are cleared nightly.</Item>
          <Item>If you book, your name and the reason for your visit go into the practice diary.</Item>
          <Item>Please do not type card details, ID numbers, or medical detail beyond the reason for your visit. The assistant will never ask for any of them.</Item>
        </ul>
      </Section>

      <Section title="How to reach a person instead">
        <p className="text-[15px] leading-[1.65] text-[var(--color-ink-soft)]">
          Ask the assistant for a callback at any point and it will arrange one, or call the Docklands
          front desk on{' '}
          <a href="tel:+442079460812" className="underline underline-offset-2">
            020 7946 0812
          </a>
          , Monday to Friday 8am to 6pm and Saturday 9am to 2pm. You never have to go through the
          assistant to reach us.
        </p>
      </Section>

      <Section title="How to report a problem">
        <p className="text-[15px] leading-[1.65] text-[var(--color-ink-soft)]">
          If the assistant told you something wrong, or you were uncomfortable with how it handled
          something, tell the practice manager. Complaints are acknowledged within three working days
          and answered within twenty-one. Reporting a problem with the assistant never affects your
          care.
        </p>
      </Section>

      <div className="mt-10 border-t border-[var(--color-rule)] pt-5 text-[13px] text-[var(--color-ink-faint)]">
        <p>Last updated {LAST_UPDATED}. Disclosure mode currently in force: {DISCLOSURE[mode].label}.</p>
        <p className="mt-2">
          This is a demonstration. Meridian Dental &amp; Aesthetics is not a real practice, and every
          document behind the assistant is synthetic.
        </p>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="text-[17px] font-semibold tracking-[-0.005em]">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <li className="relative pl-4 text-[15px] leading-[1.65] text-[var(--color-ink-soft)] before:absolute before:left-0 before:top-[0.72em] before:h-[3px] before:w-[3px] before:rounded-full before:bg-[var(--color-rule-strong)]">
      {children}
    </li>
  );
}
