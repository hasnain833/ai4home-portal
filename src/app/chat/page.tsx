"use client";

import { useState, useEffect, useRef } from "react";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Send, 
  Bot, 
  User as UserIcon, 
  Loader2, 
  Paperclip, 
  RefreshCw,
  AlertTriangle
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  diySteps?: string[];
}

export default function AIChatPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Initial greeting
  useEffect(() => {
    const fetchGreeting = async () => {
      try {
        const response = await fetch("/api/agent-config");
        if (response.ok) {
          const configs = await response.json();
          const active = configs.find((c: any) => c.isActive);
          if (active) {
            setMessages([{
              id: "0",
              role: "assistant",
              content: active.greetingMessage || "Hello! I'm your AI warranty assistant. How can I help you today?",
              timestamp: new Date()
            }]);
          }
        }
      } catch (error) {
        console.error("Failed to load greeting:", error);
      }
    };
    fetchGreeting();
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messages.concat(userMessage).map(m => ({ role: m.role, content: m.content })),
          companyId: user?.companyId,
          homeownerId: user?.id,
          conversationId: conversationId
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.conversationId) setConversationId(data.conversationId);

        const aiMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: data.content,
          diySteps: data.diySteps,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, aiMessage]);
      }
    } catch (error) {
      console.error("Chat error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ProtectedRoute allowedRoles={["admin", "staff", "homeowner"]}>
      <PortalLayout>
        <div className="flex flex-col h-[calc(100vh-120px)] max-w-4xl mx-auto">
          <Card className="flex-1 flex flex-col overflow-hidden shadow-xl border-t-4 border-t-primary">
            <CardHeader className="border-b bg-muted/30 py-4 flex flex-row items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-primary/10 p-2 rounded-full">
                  <Bot className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">AI Warranty Assistant</CardTitle>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
                    Online | Powered by Ai.Lumen
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setMessages([])}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </CardHeader>
            
            <CardContent className="flex-1 overflow-hidden p-0 relative">
              <ScrollArea className="h-full p-4 md:p-6">
                <div className="space-y-6">
                  <AnimatePresence initial={false}>
                    {messages.map((m) => (
                      <motion.div
                        key={m.id}
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div className={`flex gap-3 max-w-[85%] md:max-w-[75%] ${m.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                          <Avatar className="h-8 w-8 mt-1 border shadow-sm">
                            <AvatarFallback className={m.role === "assistant" ? "bg-primary text-white" : "bg-muted"}>
                              {m.role === "assistant" ? <Bot className="h-4 w-4" /> : <UserIcon className="h-4 w-4" />}
                            </AvatarFallback>
                          </Avatar>
                          <div className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
                            <div className={`rounded-2xl px-4 py-3 shadow-sm ${
                              m.role === "user" 
                                ? "bg-primary text-primary-foreground rounded-tr-none" 
                                : "bg-muted border rounded-tl-none"
                            }`}>
                              <p className="text-sm md:text-base whitespace-pre-wrap leading-relaxed">
                                {m.content}
                              </p>
                              {m.diySteps && m.diySteps.length > 0 && (
                                <div className="mt-4 p-3 bg-background/50 rounded-lg border border-primary/20">
                                  <p className="text-xs font-bold uppercase tracking-wider text-primary mb-2">Self-Fix Instructions:</p>
                                  <ul className="space-y-1">
                                    {m.diySteps.map((step, i) => (
                                      <li key={i} className="text-sm flex gap-2">
                                        <span className="text-primary font-bold">{i+1}.</span>
                                        <span>{step.replace(/^\d\./, "").trim()}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                            <span className="text-[10px] text-muted-foreground mt-1 px-1">
                              {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  
                  {isLoading && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex justify-start"
                    >
                      <div className="flex gap-3 max-w-[75%]">
                        <Avatar className="h-8 w-8 border shadow-sm">
                          <AvatarFallback className="bg-primary text-white">
                            <Bot className="h-4 w-4" />
                          </AvatarFallback>
                        </Avatar>
                        <div className="bg-muted border rounded-2xl rounded-tl-none px-4 py-3 shadow-sm flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          <span className="text-sm text-muted-foreground italic">Thinking...</span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                  <div ref={scrollRef} />
                </div>
              </ScrollArea>
            </CardContent>

            <div className="p-4 border-t bg-background">
              <div className="flex gap-2 items-end">
                <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-primary">
                  <Paperclip className="h-5 w-5" />
                </Button>
                <div className="flex-1 relative">
                  <Input
                    placeholder="Type your warranty question here..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSend()}
                    className="pr-12 min-h-[44px] rounded-xl focus-visible:ring-primary shadow-inner"
                  />
                  <Button 
                    size="icon" 
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-8 rounded-lg"
                    onClick={handleSend}
                    disabled={isLoading || !input.trim()}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-center gap-4 text-[10px] text-muted-foreground uppercase tracking-widest font-bold">
                <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Life Safety Issues? Call 911</span>
              </div>
            </div>
          </Card>
        </div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
