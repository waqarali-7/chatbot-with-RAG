'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationState, Turn } from '@/lib/agent/types';

interface Bubble {
  id: string;
  who: 'them' | 'me';
  text: string;
  at: number;
}

interface Props {
  business: string;
  showInfoCardLink: boolean;
  showInterfaceLabel: boolean;
  openingLine: string | null;
}

const GAP_FOR_TIMESTAMP_MS = 4 * 60 * 1000;

const timeOf = (ms: number) =>
  new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).format(
    new Date(ms),
  );

export default function Chat({
  business,
  showInfoCardLink,
  showInterfaceLabel,
  openingLine,
}: Props) {
  const [bubbles, setBubbles] = useState<Bubble[]>(() =>
    openingLine ? [{ id: 'open', who: 'them', text: openingLine, at: Date.now() }] : [],
  );
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const [closed, setClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionId = useRef<string>('');
  const state = useRef<ConversationState | null>(null);
  const history = useRef<Turn[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  if (!sessionId.current && typeof window !== 'undefined') {
    sessionId.current = crypto.randomUUID();
  }

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [bubbles, typing]);

  const send = useCallback(async () => {
    const message = draft.trim();
    if (!message || sending || closed) return;

    const now = Date.now();
    setDraft('');
    setError(null);
    setSending(true);
    setBubbles((b) => [...b, { id: `me-${now}`, who: 'me', text: message, at: now }]);
    history.current = [...history.current, { role: 'user', content: message, at: now }];

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId.current,
          message,
          state: state.current,
          history: history.current.slice(0, -1),
        }),
      });

      if (res.status === 429) {
        setError("You've hit the demo's message limit for this hour.");
        setSending(false);
        return;
      }
      if (!res.body) throw new Error('no stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const line = frame.replace(/^data: /, '').trim();
          if (!line) continue;
          const event = JSON.parse(line) as
            | { type: 'typing'; ms: number }
            | { type: 'bubble'; text: string }
            | { type: 'done'; state: ConversationState; closed: boolean }
            | { type: 'error'; message: string };

          if (event.type === 'typing') setTyping(true);
          else if (event.type === 'bubble') {
            setTyping(false);
            const at = Date.now();
            setBubbles((b) => [...b, { id: `them-${at}-${b.length}`, who: 'them', text: event.text, at }]);
            history.current = [...history.current, { role: 'assistant', content: event.text, at }];
          } else if (event.type === 'done') {
            state.current = event.state;
            if (event.closed) setClosed(true);
          } else if (event.type === 'error') {
            setError('Something went wrong. Try again in a moment.');
          }
        }
      }
    } catch {
      setError('Something went wrong. Try again in a moment.');
    } finally {
      setTyping(false);
      setSending(false);
      inputRef.current?.focus();
    }
  }, [draft, sending, closed]);

  return (
    <div className="flex h-dvh flex-col bg-[var(--color-chat-ground)]">
      <header className="shrink-0 border-b border-[var(--color-chat-rule)] px-4 py-3">
        <div className="mx-auto flex max-w-[34rem] items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <h1 className="text-[15px] font-medium text-[var(--color-chat-agent-ink)]">{business}</h1>
            {showInterfaceLabel && (
              <span className="rounded-full border border-[var(--color-chat-rule)] px-2 py-[1px] text-[11px] text-[var(--color-chat-meta)]">
                Automated assistant
              </span>
            )}
          </div>
          {showInfoCardLink && (
            <a
              href="/about-this-assistant"
              className="text-[13px] text-[var(--color-chat-meta)] underline underline-offset-2 hover:text-[var(--color-chat-agent-ink)]"
            >
              About this assistant
            </a>
          )}
        </div>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-[34rem] flex-col gap-1.5">
          {bubbles.map((b, i) => {
            const prev = bubbles[i - 1];
            const showTime = !prev || b.at - prev.at > GAP_FOR_TIMESTAMP_MS;
            return (
              <div key={b.id}>
                {showTime && (
                  <div className="py-2 text-center text-[11px] text-[var(--color-chat-meta)]">
                    {timeOf(b.at)}
                  </div>
                )}
                <div className={b.who === 'me' ? 'flex justify-end' : 'flex justify-start'}>
                  <p
                    className={
                      b.who === 'me'
                        ? 'max-w-[80%] rounded-[18px] rounded-br-[5px] bg-[var(--color-chat-me)] px-3.5 py-2 text-[15px] leading-[1.45] text-[var(--color-chat-me-ink)]'
                        : 'max-w-[80%] rounded-[18px] rounded-bl-[5px] bg-[var(--color-chat-agent)] px-3.5 py-2 text-[15px] leading-[1.45] text-[var(--color-chat-agent-ink)]'
                    }
                  >
                    {b.text}
                  </p>
                </div>
              </div>
            );
          })}

          {typing && (
            <div className="flex justify-start" aria-live="polite" aria-label="typing">
              <span className="flex items-center gap-1 rounded-[18px] rounded-bl-[5px] bg-[var(--color-chat-agent)] px-4 py-3">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="typing-dot h-[6px] w-[6px] rounded-full bg-[var(--color-chat-meta)]"
                    style={{ animationDelay: `${i * 0.16}s` }}
                  />
                ))}
              </span>
            </div>
          )}

          {error && (
            <p className="py-2 text-center text-[12px] text-[var(--color-chat-meta)]">{error}</p>
          )}
          {closed && (
            <p className="py-2 text-center text-[12px] text-[var(--color-chat-meta)]">
              This conversation has ended.
            </p>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-[var(--color-chat-rule)] px-4 py-3">
        <form
          className="mx-auto flex max-w-[34rem] items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label htmlFor="msg" className="sr-only">
            Message
          </label>
          <textarea
            id="msg"
            ref={inputRef}
            rows={1}
            value={draft}
            disabled={closed}
            placeholder={closed ? 'Conversation ended' : 'Message'}
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            className="max-h-[120px] min-h-[40px] flex-1 resize-none rounded-[20px] border border-[var(--color-chat-rule)] bg-white px-4 py-2 text-[15px] leading-[1.4] text-[var(--color-chat-agent-ink)] placeholder:text-[var(--color-chat-meta)] disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!draft.trim() || sending || closed}
            className="h-[40px] shrink-0 rounded-full bg-[var(--color-chat-me)] px-4 text-[14px] font-medium text-white disabled:opacity-35"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
