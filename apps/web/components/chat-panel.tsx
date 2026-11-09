"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRealtime } from "@/hooks/use-realtime";
import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/utils";

interface Message { id: string; sender_id: string; body: string; created_at: string }

/** In-app chat between passenger and assigned driver (persisted in chat_messages, pushed via booking:<id>). */
export function ChatPanel({ bookingId, conversationId, userId, closed }: {
  bookingId: string; conversationId: string; userId: string; closed: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data } = await createClient().from("chat_messages").select("id, sender_id, body, created_at")
      .eq("conversation_id", conversationId).order("created_at").limit(200);
    setMessages(data ?? []);
  }, [conversationId]);

  useEffect(() => { void load(); }, [load]);
  useRealtime(`booking:${bookingId}`, {
    chat: (p) => setMessages((m) => (m.some((x) => x.id === p.id) ? m : [...m, p as unknown as Message])),
  }, load);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    const { data, error } = await createClient().from("chat_messages")
      .insert({ conversation_id: conversationId, body }).select("id, sender_id, body, created_at").single();
    setSending(false);
    if (error) {
      setError("Message not sent.");
      return;
    }
    setText("");
    setMessages((m) => (m.some((x) => x.id === data.id) ? m : [...m, data]));
  }

  return (
    <div className="flex h-72 flex-col rounded-xl border border-line">
      <div className="flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite">
        {messages.length === 0 && <p className="text-muted text-center text-xs">No messages yet.</p>}
        {messages.map((m) => (
          <div key={m.id} className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-sm",
            m.sender_id === userId ? "ml-auto bg-brand-600 text-white" : "surface-muted")}>
            {m.body}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {closed ? (
        <p className="text-muted border-t border-line p-2 text-center text-xs">Chat closed</p>
      ) : (
        <form onSubmit={send} className="flex gap-2 border-t border-line p-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message" maxLength={1000} aria-label="Message" />
          <Button type="submit" size="icon" loading={sending} aria-label="Send">{!sending && <Send className="h-4 w-4" />}</Button>
        </form>
      )}
      {error && <p className="px-3 pb-2 text-xs text-signal-600">{error}</p>}
    </div>
  );
}
