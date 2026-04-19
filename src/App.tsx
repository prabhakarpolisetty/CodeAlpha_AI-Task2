/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import { Send, Bot, User, Loader2, MessageSquare, RefreshCw, HelpCircle, Mic, MicOff, ThumbsUp, ThumbsDown, ArrowRight, Settings, Plus, Trash2, Edit2, X, Check, ChevronLeft, Search, Sparkles, Download } from "lucide-react";

// Speech Recognition Types
// ... (rest of types)
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: any) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
}

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

// FAQ Data
const DEFAULT_FAQS: FAQ[] = [
  {
    id: '1',
    question: "How do I set up my Smart Hub?",
    answer: "1. Plug in the hub. 2. Open the 'SmartLife' app. 3. Connect your phone to 2.4GHz Wi-Fi. 4. Follow the app's pairing steps.",
    relatedQuestions: ["Installation guide", "Getting started", "How to pair"]
  },
  {
    id: '2',
    question: "Which devices are compatible?",
    answer: "The hub works with Zigbee 3.0, Z-Wave Plus, and Wi-Fi devices from brands like Philips Hue, TP-Link, LIFX, and Samsung SmartThings.",
    relatedQuestions: ["Supported brands", "Zigbee support", "Compatible devices"]
  },
  {
    id: '3',
    question: "How do I reset the device?",
    answer: "Hold the back pinhole button for 10 seconds using a paperclip. The LED will flash red when the reset is done.",
    relatedQuestions: ["Factory reset", "Device not responding", "Clear settings"]
  },
  {
    id: '4',
    question: "Can I control it with voice?",
    answer: "Yes. Link your SmartLife account to Alexa or Google Assistant to control devices with voice commands.",
    relatedQuestions: ["Alexa setup", "Google Home", "Voice control"]
  },
  {
    id: '5',
    question: "What is the range of the hub?",
    answer: "The range is up to 1,500 square feet. Walls and electronics may reduce this distance.",
    relatedQuestions: ["Signal strength", "Distance limits", "Connection range"]
  },
  {
    id: '6',
    question: "Is there a monthly subscription fee?",
    answer: "No. Basic features and remote access are free. An optional 'Pro Cloud' plan is available for camera video history.",
    relatedQuestions: ["Is it free?", "Service cost", "Subscription info"]
  }
];

interface FAQ {
  id: string;
  question: string;
  answer: string;
  relatedQuestions: string[];
}

interface Message {
  id: string;
  role: 'user' | 'bot';
  text: string;
  timestamp: Date;
  feedback?: 'up' | 'down' | null;
  feedbackDetail?: string;
  faqId?: string;
  suggestions?: string[];
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  timestamp: Date;
}

interface Toast {
  id: string;
  message: string;
  type: 'error' | 'success' | 'info';
}

export default function App() {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = localStorage.getItem('chat_sessions');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return parsed.map((s: any) => ({
          ...s,
          timestamp: new Date(s.timestamp),
          messages: s.messages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }))
        }));
      } catch (e) {
        console.error("Failed to parse sessions", e);
      }
    }
    return [];
  });

  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => {
    return localStorage.getItem('current_session_id');
  });

  const [messages, setMessages] = useState<Message[]>([]);
  
  // Initialize messages from current session
  useEffect(() => {
    if (currentSessionId) {
      const session = sessions.find(s => s.id === currentSessionId);
      if (session) {
        setMessages(session.messages);
        return;
      }
    }
    // Default initial message if no session
    setMessages([
      {
        id: '1',
        role: 'bot',
        text: "Hi there! I'm Dev, your Smart Hub guide. I'm here to help you get the most out of your smart home. What can I help you with today?",
        timestamp: new Date(),
        feedback: null
      }
    ]);
  }, [currentSessionId, sessions]);

  const [faqs, setFaqs] = useState<FAQ[]>(() => {
    const saved = localStorage.getItem('faq_data');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse FAQs", e);
      }
    }
    return DEFAULT_FAQS;
  });

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionTitle, setEditingSessionTitle] = useState('');
  const [editingFaq, setEditingFaq] = useState<FAQ | null>(null);
  const [faqSearchQuery, setFaqSearchQuery] = useState('');
  const [isGeneratingVariations, setIsGeneratingVariations] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [feedbackMessageId, setFeedbackMessageId] = useState<string | null>(null);
  const [feedbackComment, setFeedbackComment] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const showToast = (message: string, type: 'error' | 'success' | 'info' = 'info') => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  };

  const getErrorMessage = (error: any, fallback: string) => {
    if (!navigator.onLine) return "You're offline. Please check your connection and try again.";
    const msg = error?.message?.toLowerCase() || "";
    if (msg.includes('api_key_invalid')) return "Invalid API key. Please check your settings.";
    if (msg.includes('quota')) return "Daily limit reached. Please try again tomorrow.";
    if (msg.includes('network')) return "Network error. Please check your connection.";
    return fallback;
  };

  useEffect(() => {
    localStorage.setItem('chat_sessions', JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    if (currentSessionId) {
      localStorage.setItem('current_session_id', currentSessionId);
    } else {
      localStorage.removeItem('current_session_id');
    }
  }, [currentSessionId]);

  // Update current session messages
  useEffect(() => {
    if (currentSessionId && messages.length > 0) {
      setSessions(prev => prev.map(s => 
        s.id === currentSessionId ? { ...s, messages, timestamp: new Date() } : s
      ));
    }
  }, [messages, currentSessionId]);

  useEffect(() => {
    localStorage.setItem('faq_data', JSON.stringify(faqs));
  }, [faqs]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
        setIsListening(false);
        if (transcript.trim()) {
          handleSend(transcript);
        }
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
        const errorMsg = event.error === 'not-allowed' 
          ? "Microphone access denied. Please enable it in your browser settings."
          : "I couldn't hear you clearly. Please try again.";
        showToast(errorMsg, "error");
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      setInput('');
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  const handleFeedback = (messageId: string, type: 'up' | 'down') => {
    setMessages(prev => prev.map(msg => 
      msg.id === messageId ? { ...msg, feedback: msg.feedback === type ? null : type } : msg
    ));
    
    if (type === 'down') {
      const msg = messages.find(m => m.id === messageId);
      if (msg?.feedback !== 'down') {
        setFeedbackMessageId(messageId);
        setFeedbackComment('');
      }
    } else if (type === 'up') {
      showToast("Thanks for the feedback!", "success");
    }
  };

  const submitFeedbackDetail = () => {
    if (!feedbackMessageId) return;
    
    setMessages(prev => prev.map(msg => 
      msg.id === feedbackMessageId ? { ...msg, feedbackDetail: feedbackComment } : msg
    ));
    
    setFeedbackMessageId(null);
    setFeedbackComment('');
    showToast("Thank you for your detailed feedback!", "success");
  };

  const summarizeChat = async () => {
    if (messages.length < 2 || isSummarizing) return;
    
    setIsSummarizing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const chatContent = messages.map(m => `${m.role.toUpperCase()}: ${m.text}`).join('\n');
      
      const prompt = `
        Summarize this chat between a user and a support bot.
        Provide a very brief overview of topics and resolutions.
        Max 2 short sentences.
        
        Conversation:
        ${chatContent}
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });

      setSummary(response.text || "Could not generate summary.");
      showToast("Summary generated successfully!", "success");
    } catch (error) {
      console.error("Error summarizing chat:", error);
      const errorMsg = getErrorMessage(error, "Failed to generate summary. Please try again later.");
      setSummary(errorMsg);
      showToast(errorMsg, "error");
    } finally {
      setIsSummarizing(false);
    }
  };

  const generateRelatedVariations = async () => {
    if (!editingFaq?.question || isGeneratingVariations) return;
    
    setIsGeneratingVariations(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `
        Given the following FAQ question for a Smart Home Hub support bot, generate 3-5 concise "Related Variations" or alternative ways a user might ask this question.
        
        Question: "${editingFaq.question}"
        
        Return the response as a simple comma-separated list of strings.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: prompt,
      });

      const suggestions = response.text?.split(',').map(s => s.trim()).filter(s => s !== '') || [];
      if (suggestions.length > 0) {
        setEditingFaq({
          ...editingFaq,
          relatedQuestions: [...new Set([...editingFaq.relatedQuestions, ...suggestions])]
        });
        showToast("Variations suggested!", "success");
      } else {
        showToast("No variations found for this question.", "info");
      }
    } catch (error) {
      console.error("Error generating variations:", error);
      showToast(getErrorMessage(error, "Failed to generate variations."), "error");
    } finally {
      setIsGeneratingVariations(false);
    }
  };

  const handleSend = async (text: string = input) => {
    if (!text.trim() || isLoading) return;

    let sessionId = currentSessionId;
    if (!sessionId) {
      sessionId = Date.now().toString();
      const newSession: ChatSession = {
        id: sessionId,
        title: text.trim().slice(0, 30) + (text.length > 30 ? '...' : ''),
        messages: [],
        timestamp: new Date()
      };
      setSessions(prev => [newSession, ...prev]);
      setCurrentSessionId(sessionId);
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: text.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const faqContext = faqs.map((f, i) => `FAQ ${i+1}:\nQ: ${f.question}\nRelated: ${f.relatedQuestions?.join(', ')}\nA: ${f.answer}`).join('\n\n');
      
      const prompt = `
        You are Dev, a friendly, patient, and expert FAQ Chatbot for a Smart Home Hub. 
        Your goal is to guide users clearly and warmly through their smart home journey.
        Below is a list of Frequently Asked Questions, their related variations, and their answers.
        
        ${faqContext}
        
        User Question: "${text}"
        
        Instructions:
        1. Find the FAQ that most closely matches the user's question.
        2. Provide a **very concise**, jargon-free answer. **Directly address the user's core question first.**
        3. Tone: Warm and helpful (Dev persona), but **strictly avoid filler phrases** (e.g., "I'd be happy to help"). Get straight to the point.
        4. Use simple language. Replace technical terms with common words.
        5. If a match is found, deliver the answer in **1-2 short sentences** and return the corresponding FAQ ID.
        6. If the user greets you, respond with a very brief, warm greeting.
        7. If no match is found, say: "I don't have that info yet. Please email support@smarthub.com." and return null for faqId.
        8. Provide 2-3 **one-to-three word** follow-up suggestions.
        9. Return the response in JSON format.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              answer: { type: Type.STRING },
              faqId: { type: Type.STRING, nullable: true },
              suggestions: { 
                type: Type.ARRAY,
                items: { type: Type.STRING }
              }
            },
            required: ["answer", "suggestions"]
          }
        }
      });

      const result = JSON.parse(response.text || "{}");

      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'bot',
        text: result.answer || "I'm sorry, I encountered an error processing your request.",
        timestamp: new Date(),
        feedback: null,
        faqId: result.faqId,
        suggestions: result.suggestions || []
      };

      setMessages(prev => [...prev, botMessage]);
    } catch (error) {
      console.error("Error matching FAQ:", error);
      const errorMsg = getErrorMessage(error, "I'm having trouble connecting to my brain right now. Please try again in a moment.");
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'bot',
        text: errorMsg,
        timestamp: new Date(),
        feedback: null
      };
      setMessages(prev => [...prev, errorMessage]);
      showToast(errorMsg, "error");
    } finally {
      setIsLoading(false);
    }
  };

  const startNewChat = () => {
    setCurrentSessionId(null);
    setMessages([
      {
        id: '1',
        role: 'bot',
        text: "Hi there! I'm Dev, your Smart Hub guide. I'm here to help you get the most out of your smart home. What can I help you with today?",
        timestamp: new Date(),
        feedback: null
      }
    ]);
    setSummary(null);
    setIsHistoryOpen(false);
  };

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this conversation?')) {
      setSessions(prev => prev.filter(s => s.id !== id));
      if (currentSessionId === id) {
        startNewChat();
      }
      showToast("Conversation deleted", "info");
    }
  };

  const renameSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const session = sessions.find(s => s.id === id);
    if (session) {
      setEditingSessionId(id);
      setEditingSessionTitle(session.title);
    }
  };

  const saveSessionName = (id: string) => {
    if (editingSessionTitle.trim()) {
      setSessions(prev => prev.map(s => s.id === id ? { ...s, title: editingSessionTitle.trim() } : s));
      setEditingSessionId(null);
      showToast("Conversation renamed", "success");
    }
  };

  const exportSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const session = sessions.find(s => s.id === id);
    if (!session) return;

    const content = session.messages.map(m => 
      `[${m.timestamp.toLocaleString()}] ${m.role.toUpperCase()}: ${m.text}`
    ).join('\n\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-history-${session.title.replace(/\s+/g, '-').toLowerCase()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Chat exported as .txt", "success");
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center p-4 font-sans overflow-hidden">
      <div className="w-full max-w-4xl bg-white rounded-3xl shadow-2xl shadow-blue-100/50 overflow-hidden flex h-[85vh] border border-gray-100 relative">
        
        {/* Toast Container */}
        <div className="absolute bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
          <AnimatePresence>
            {toasts.map(toast => (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: 20, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl border ${
                  toast.type === 'error' ? 'bg-red-50 border-red-100 text-red-600' :
                  toast.type === 'success' ? 'bg-green-50 border-green-100 text-green-600' :
                  'bg-blue-50 border-blue-100 text-blue-600'
                }`}
              >
                {toast.type === 'error' ? <X className="w-4 h-4" /> :
                 toast.type === 'success' ? <Check className="w-4 h-4" /> :
                 <HelpCircle className="w-4 h-4" />}
                <span className="text-sm font-bold tracking-tight">{toast.message}</span>
                <button 
                  onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
                  className="ml-2 hover:opacity-70 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Sidebar / History */}
        <AnimatePresence>
          {isHistoryOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="border-r border-gray-100 bg-gray-50 flex flex-col overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between shrink-0">
                <h2 className="font-bold text-gray-900 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-blue-600" />
                  History
                </h2>
                <button onClick={() => setIsHistoryOpen(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 shrink-0">
                <button 
                  onClick={startNewChat}
                  className="w-full py-3 bg-white border border-blue-100 text-blue-600 rounded-xl font-bold text-sm hover:bg-blue-50 transition-all flex items-center justify-center gap-2 shadow-sm"
                >
                  <Plus className="w-4 h-4" />
                  New Chat
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {sessions.length === 0 ? (
                  <div className="text-center py-10">
                    <MessageSquare className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                    <p className="text-xs text-gray-400 font-medium px-4">No past conversations yet. Start chatting to save history!</p>
                  </div>
                ) : (
                  sessions.map(session => (
                    <div 
                      key={session.id}
                      onClick={() => {
                        if (editingSessionId === session.id) return;
                        setCurrentSessionId(session.id);
                        setIsHistoryOpen(false);
                      }}
                      className={`p-4 rounded-2xl cursor-pointer transition-all group relative border ${
                        currentSessionId === session.id 
                          ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-200' 
                          : 'bg-white border-gray-100 text-gray-700 hover:border-blue-200 hover:shadow-md'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-xl shrink-0 ${currentSessionId === session.id ? 'bg-white/20' : 'bg-blue-50'}`}>
                          <MessageSquare className={`w-4 h-4 ${currentSessionId === session.id ? 'text-white' : 'text-blue-600'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          {editingSessionId === session.id ? (
                            <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                              <input 
                                autoFocus
                                value={editingSessionTitle}
                                onChange={e => setEditingSessionTitle(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && saveSessionName(session.id)}
                                className="w-full bg-white/10 border border-white/20 rounded px-2 py-1 text-xs font-bold focus:outline-none"
                              />
                              <button onClick={() => saveSessionName(session.id)} className="text-white hover:text-green-300">
                                <Check className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <>
                              <p className="text-xs font-bold truncate pr-2">{session.title}</p>
                              <p className={`text-[10px] mt-1 line-clamp-1 opacity-60`}>
                                {session.messages[session.messages.length - 1]?.text || "Empty chat"}
                              </p>
                              <div className="flex items-center justify-between mt-2">
                                <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-md ${currentSessionId === session.id ? 'bg-white/20' : 'bg-gray-100 text-gray-500'}`}>
                                  {session.messages.length} messages
                                </span>
                                <span className={`text-[9px] opacity-60`}>
                                  {new Date(session.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Action Buttons */}
                      {!editingSessionId && (
                        <div className={`absolute right-2 top-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-all`}>
                          <button 
                            onClick={(e) => renameSession(session.id, e)}
                            className={`p-1.5 rounded-lg transition-all ${
                              currentSessionId === session.id ? 'text-white/60 hover:text-white hover:bg-white/10' : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'
                            }`}
                            title="Rename"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button 
                            onClick={(e) => exportSession(session.id, e)}
                            className={`p-1.5 rounded-lg transition-all ${
                              currentSessionId === session.id ? 'text-white/60 hover:text-white hover:bg-white/10' : 'text-gray-400 hover:text-green-600 hover:bg-green-50'
                            }`}
                            title="Export"
                          >
                            <Download className="w-3 h-3" />
                          </button>
                          <button 
                            onClick={(e) => deleteSession(session.id, e)}
                            className={`p-1.5 rounded-lg transition-all ${
                              currentSessionId === session.id ? 'text-white/60 hover:text-white hover:bg-white/10' : 'text-gray-400 hover:text-red-500 hover:bg-red-50'
                            }`}
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <header className="bg-white border-b border-gray-100 p-6 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setIsHistoryOpen(!isHistoryOpen)}
                className={`p-2 rounded-xl transition-colors ${isHistoryOpen ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                title="Toggle History"
              >
                <MessageSquare className="w-6 h-6" />
              </button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-200">
                  <Bot className="text-white w-6 h-6" />
                </div>
                <div>
                  <h1 className="text-lg font-bold text-gray-900 tracking-tight">Dev • Smart Guide</h1>
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Dev is Online</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
            <button 
              onClick={summarizeChat}
              disabled={messages.length < 2 || isSummarizing}
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-xl text-xs font-bold hover:bg-blue-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title="Summarize Conversation"
            >
              {isSummarizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
              Summary
            </button>
            <button 
              onClick={() => setIsAdminMode(!isAdminMode)}
              className={`p-2 rounded-xl transition-colors ${isAdminMode ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
              title="Manage FAQs"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button 
              onClick={startNewChat}
              className="p-2 hover:bg-gray-100 rounded-xl transition-colors text-gray-400 hover:text-gray-600"
              title="New Chat"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Feedback Detail Modal */}
          <AnimatePresence>
            {feedbackMessageId && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-50 bg-white/80 backdrop-blur-sm flex items-center justify-center p-6"
              >
                <motion.div 
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="bg-white border border-gray-100 rounded-3xl shadow-2xl p-6 w-full max-w-md space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-gray-900">Help us improve</h3>
                    <button onClick={() => setFeedbackMessageId(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
                  </div>
                  <p className="text-sm text-gray-500 leading-relaxed">What was wrong with this response? Your feedback helps Dev learn and provide better answers.</p>
                  <textarea 
                    value={feedbackComment}
                    onChange={(e) => setFeedbackComment(e.target.value)}
                    placeholder="e.g., The answer was incorrect, too long, or confusing..."
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 h-32 resize-none"
                  />
                  <div className="flex gap-3 pt-2">
                    <button 
                      onClick={() => setFeedbackMessageId(null)}
                      className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold text-sm hover:bg-gray-200 transition-all"
                    >
                      Skip
                    </button>
                    <button 
                      onClick={submitFeedbackDetail}
                      disabled={!feedbackComment.trim()}
                      className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-all disabled:opacity-50 shadow-lg shadow-blue-200"
                    >
                      Submit Feedback
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {isAdminMode ? (
              <motion.div
                key="admin"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="absolute inset-0 bg-gray-50 flex flex-col overflow-y-auto"
              >
                <div className="p-6 space-y-6">
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        <Settings className="w-5 h-5 text-blue-600" />
                        Manage FAQ Database
                      </h2>
                      <button 
                        onClick={() => setEditingFaq({ id: Date.now().toString(), question: '', answer: '', relatedQuestions: [] })}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200"
                      >
                        <Plus className="w-4 h-4" />
                        Add FAQ
                      </button>
                    </div>

                    {/* FAQ Search Bar */}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input 
                        type="text"
                        value={faqSearchQuery}
                        onChange={(e) => setFaqSearchQuery(e.target.value)}
                        placeholder="Search FAQs by question or answer..."
                        className="w-full bg-white border border-gray-200 rounded-xl py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
                      />
                      {faqSearchQuery && (
                        <button 
                          onClick={() => setFaqSearchQuery('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {editingFaq && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="bg-white p-6 rounded-2xl border border-blue-100 shadow-xl shadow-blue-50/50 space-y-4"
                    >
                      <div className="flex items-center justify-between border-b border-gray-100 pb-4 mb-4">
                        <h3 className="font-bold text-blue-600">{editingFaq.question ? 'Edit FAQ Entry' : 'New FAQ Entry'}</h3>
                        <button onClick={() => setEditingFaq(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Question</label>
                          <input 
                            type="text" 
                            value={editingFaq.question}
                            onChange={(e) => setEditingFaq({...editingFaq, question: e.target.value})}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            placeholder="What is the user asking?"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Answer</label>
                          <textarea 
                            value={editingFaq.answer}
                            onChange={(e) => setEditingFaq({...editingFaq, answer: e.target.value})}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 h-24 resize-none"
                            placeholder="What is the official answer?"
                          />
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">Related Variations (comma separated)</label>
                            <button 
                              type="button"
                              onClick={generateRelatedVariations}
                              disabled={!editingFaq.question || isGeneratingVariations}
                              className="text-[10px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 disabled:opacity-50 transition-all"
                            >
                              {isGeneratingVariations ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                              Suggest with AI
                            </button>
                          </div>
                          <input 
                            type="text" 
                            value={editingFaq.relatedQuestions.join(', ')}
                            onChange={(e) => setEditingFaq({...editingFaq, relatedQuestions: e.target.value.split(',').map(s => s.trim()).filter(s => s !== '')})}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            placeholder="setup, installation, pairing..."
                          />
                        </div>
                        <button 
                          onClick={() => {
                            if (editingFaq.question && editingFaq.answer) {
                              setFaqs(prev => {
                                const exists = prev.find(f => f.id === editingFaq.id);
                                if (exists) return prev.map(f => f.id === editingFaq.id ? editingFaq : f);
                                return [...prev, editingFaq];
                              });
                              setEditingFaq(null);
                            }
                          }}
                          className="w-full py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-all flex items-center justify-center gap-2"
                        >
                          <Check className="w-5 h-5" />
                          Save FAQ Entry
                        </button>
                      </div>
                    </motion.div>
                  )}

                  <div className="space-y-3">
                    {faqs
                      .filter(faq => 
                        faq.question.toLowerCase().includes(faqSearchQuery.toLowerCase()) || 
                        faq.answer.toLowerCase().includes(faqSearchQuery.toLowerCase())
                      )
                      .map(faq => (
                        <div key={faq.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-start justify-between group hover:border-blue-200 transition-all">
                        <div className="flex-1 pr-4">
                          <h4 className="font-bold text-gray-900 text-sm mb-1">{faq.question}</h4>
                          <p className="text-xs text-gray-500 line-clamp-2">{faq.answer}</p>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {faq.relatedQuestions.map((rq, i) => (
                              <span key={i} className="text-[9px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">{rq}</span>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={() => setEditingFaq(faq)}
                            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => {
                              if (confirm('Are you sure you want to delete this FAQ?')) {
                                setFaqs(prev => prev.filter(f => f.id !== faq.id));
                                showToast("FAQ deleted", "info");
                              }
                            }}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Trend Analysis Section */}
                  <div className="space-y-4 pt-6 border-t border-gray-200">
                    <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-blue-500" />
                      Trend Analysis
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Most Downvoted FAQs</p>
                        <div className="space-y-3">
                          {(() => {
                            const downvotedFaqCounts = sessions.flatMap(s => s.messages)
                              .filter(m => m.role === 'bot' && m.feedback === 'down' && m.faqId)
                              .reduce((acc, m) => {
                                acc[m.faqId!] = (acc[m.faqId!] || 0) + 1;
                                return acc;
                              }, {} as Record<string, number>);

                            const sortedFaqs = Object.entries(downvotedFaqCounts)
                              .sort((a, b) => (b[1] as number) - (a[1] as number))
                              .slice(0, 3);

                            if (sortedFaqs.length === 0) return <p className="text-xs text-gray-400">No trends detected yet.</p>;

                            return sortedFaqs.map(([id, count]) => {
                              const faq = faqs.find(f => f.id === id);
                              return (
                                <div key={id} className="flex items-center justify-between gap-3">
                                  <p className="text-xs font-medium text-gray-700 truncate">{faq?.question || "Unknown FAQ"}</p>
                                  <span className="px-2 py-0.5 bg-red-50 text-red-600 text-[10px] font-bold rounded-full">{count} downvotes</span>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </div>
                      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Overall Satisfaction</p>
                        <div className="flex items-center gap-4">
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            {(() => {
                              const botMessages = sessions.flatMap(s => s.messages).filter(m => m.role === 'bot' && m.feedback);
                              const upvotes = botMessages.filter(m => m.feedback === 'up').length;
                              const total = botMessages.length;
                              const percentage = total > 0 ? (upvotes / total) * 100 : 0;
                              return (
                                <div 
                                  className="h-full bg-green-500 transition-all duration-1000" 
                                  style={{ width: `${percentage}%` }}
                                ></div>
                              );
                            })()}
                          </div>
                          <span className="text-sm font-bold text-gray-700">
                            {(() => {
                              const botMessages = sessions.flatMap(s => s.messages).filter(m => m.role === 'bot' && m.feedback);
                              const upvotes = botMessages.filter(m => m.feedback === 'up').length;
                              const total = botMessages.length;
                              return total > 0 ? `${Math.round((upvotes / total) * 100)}%` : '-%';
                            })()}
                          </span>
                        </div>
                        <p className="text-[10px] text-gray-400 mt-2 italic">Based on {sessions.flatMap(s => s.messages).filter(m => m.role === 'bot' && m.feedback).length} ratings</p>
                      </div>
                    </div>
                  </div>

                  {/* Feedback Review Section */}
                  <div className="space-y-4 pt-6 border-t border-gray-200">
                    <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                      <ThumbsDown className="w-5 h-5 text-red-500" />
                      Feedback for Review
                    </h2>
                    <div className="space-y-3">
                      {sessions.flatMap(s => s.messages.filter(m => m.feedback === 'down')).length === 0 ? (
                        <div className="bg-white p-8 rounded-2xl border border-dashed border-gray-200 text-center">
                          <p className="text-sm text-gray-400">No downvoted responses to review. Great job!</p>
                        </div>
                      ) : (
                        sessions.flatMap(s => s.messages.filter(m => m.feedback === 'down')).map((msg, idx) => (
                          <div key={idx} className="bg-white p-4 rounded-2xl border border-red-100 shadow-sm space-y-3">
                            <div className="flex items-start justify-between gap-4">
                              <div className="space-y-1">
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">User Question</p>
                                <p className="text-sm font-medium text-gray-900">
                                  {(() => {
                                    const session = sessions.find(s => s.messages.some(m => m.id === msg.id));
                                    const msgIdx = session?.messages.findIndex(m => m.id === msg.id) ?? -1;
                                    return (msgIdx > 0 ? session?.messages[msgIdx - 1]?.text : null) || "Unknown question";
                                  })()}
                                </p>
                              </div>
                              <span className="px-2 py-1 bg-red-50 text-red-600 text-[10px] font-bold rounded-lg uppercase tracking-wider">Flagged</span>
                            </div>
                            <div className="space-y-1">
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Bot Response</p>
                              <p className="text-sm text-gray-600 italic">"{msg.text}"</p>
                            </div>
                            {msg.feedbackDetail && (
                              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">User Feedback</p>
                                <p className="text-sm text-gray-700 font-medium">{msg.feedbackDetail}</p>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="chat"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="absolute inset-0 flex flex-col overflow-hidden"
              >
                {/* Summary Banner */}
                <AnimatePresence>
                  {summary && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="bg-blue-600 text-white px-6 py-4 relative overflow-hidden shrink-0"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-1">
                          <MessageSquare className="w-4 h-4" />
                        </div>
                        <div className="flex-1">
                          <h3 className="text-[10px] font-bold uppercase tracking-widest mb-1 opacity-80">Conversation Summary</h3>
                          <p className="text-sm leading-relaxed font-medium">{summary}</p>
                        </div>
                        <button 
                          onClick={() => setSummary(null)}
                          className="text-white/60 hover:text-white transition-colors"
                        >
                          <RefreshCw className="w-4 h-4 rotate-45" />
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Chat Area */}
                <main className="flex-1 overflow-y-auto p-6 space-y-6 bg-gradient-to-b from-white to-gray-50/50">
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`flex gap-3 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    msg.role === 'user' ? 'bg-gray-100' : 'bg-blue-100'
                  }`}>
                    {msg.role === 'user' ? <User className="w-5 h-5 text-gray-600" /> : <Bot className="w-5 h-5 text-blue-600" />}
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className={`p-4 rounded-2xl shadow-sm ${
                      msg.role === 'user' 
                        ? 'bg-blue-600 text-white rounded-tr-none' 
                        : 'bg-white border border-gray-100 text-gray-800 rounded-tl-none'
                    }`}>
                      <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                      <span className={`text-[10px] mt-2 block opacity-60 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    
                    {/* Feedback Buttons for Bot Messages */}
                    {msg.role === 'bot' && (
                      <div className="flex items-center gap-2 mt-1 ml-1">
                        <button
                          onClick={() => handleFeedback(msg.id, 'up')}
                          className={`p-1.5 rounded-lg transition-all ${
                            msg.feedback === 'up' 
                              ? 'bg-green-100 text-green-600' 
                              : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'
                          }`}
                          title="Helpful"
                        >
                          <ThumbsUp className={`w-3.5 h-3.5 ${msg.feedback === 'up' ? 'fill-current' : ''}`} />
                        </button>
                        <button
                          onClick={() => handleFeedback(msg.id, 'down')}
                          className={`p-1.5 rounded-lg transition-all ${
                            msg.feedback === 'down' 
                              ? 'bg-red-100 text-red-600' 
                              : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'
                          }`}
                          title="Not helpful"
                        >
                          <ThumbsDown className={`w-3.5 h-3.5 ${msg.feedback === 'down' ? 'fill-current' : ''}`} />
                        </button>
                      </div>
                    )}

                    {/* Quick Reply Suggestions */}
                    {msg.role === 'bot' && msg.suggestions && msg.suggestions.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2 ml-1">
                        {msg.suggestions.map((suggestion, idx) => (
                          <button
                            key={idx}
                            onClick={() => handleSend(suggestion)}
                            className="text-[11px] font-semibold px-3 py-1.5 bg-white border border-blue-100 text-blue-600 rounded-full hover:bg-blue-50 transition-all flex items-center gap-1.5 shadow-sm"
                          >
                            {suggestion}
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        ))}
                      </div>
                    )}
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
              <div className="flex gap-3 items-center bg-white border border-gray-100 p-4 rounded-2xl rounded-tl-none shadow-sm">
                <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                <span className="text-sm text-gray-500 font-medium">Assistant is thinking...</span>
              </div>
            </motion.div>
          )}

          {isListening && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex justify-center"
            >
              <div className="flex items-center gap-3 bg-red-50 text-red-600 px-6 py-3 rounded-full border border-red-100 shadow-sm">
                <div className="w-2 h-2 bg-red-600 rounded-full animate-ping"></div>
                <span className="text-sm font-bold uppercase tracking-wider">Listening...</span>
              </div>
            </motion.div>
          )}
          <div ref={messagesEndRef} />
        </main>

        {/* Footer / Input */}
        <footer className="p-6 bg-white border-t border-gray-100 shrink-0">
          {/* Suggested Questions */}
          {messages.length < 4 && !isListening && (
            <div className="flex flex-wrap gap-2 mb-4">
              {faqs.slice(0, 3).map((faq, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(faq.question)}
                  className="text-xs font-medium px-3 py-2 bg-blue-50 text-blue-700 rounded-full hover:bg-blue-100 transition-colors flex items-center gap-2 border border-blue-100"
                >
                  <HelpCircle className="w-3 h-3" />
                  {faq.question}
                </button>
              ))}
            </div>
          )}

          <form 
            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
            className="relative flex items-center gap-2"
          >
            <div className="relative flex-1">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={isListening ? "Listening..." : "Ask a question about your Smart Hub..."}
                className={`w-full bg-gray-50 border border-gray-200 rounded-2xl py-4 pl-5 pr-14 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all ${
                  isListening ? 'ring-2 ring-red-500/20 border-red-500' : ''
                }`}
              />
              <button
                type="button"
                onClick={toggleListening}
                className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-xl transition-all ${
                  isListening 
                    ? 'bg-red-600 text-white shadow-lg shadow-red-200' 
                    : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'
                }`}
                title={isListening ? "Stop Listening" : "Start Voice Input"}
              >
                {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
            </div>
            <button
              type="submit"
              disabled={!input.trim() || isLoading || isListening}
              className="p-4 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-all shadow-lg shadow-blue-200 flex-shrink-0"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
          <p className="text-[10px] text-center text-gray-400 mt-4 uppercase tracking-widest font-semibold">
            Powered by Gemini 1.5 Flash • Voice Enabled Support
          </p>
        </footer>
      </motion.div>
    )}
  </AnimatePresence>
</div>
</div>
</div>
</div>
);
}
