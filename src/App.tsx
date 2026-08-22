import { useState, useEffect, useRef } from "react";
import { 
  FileText, ShieldCheck, Database, FolderGit, FileSpreadsheet, CloudLightning, 
  HelpCircle, Settings, LogIn, ExternalLink, RefreshCw, LogOut, CheckCircle, ListTodo, Calculator, Sparkles, Cpu, Users,
  Menu, X, ChevronLeft, ChevronRight, Search, AlertTriangle, ChevronDown, Check, FileEdit
} from "lucide-react";
import { CompanyData, EditalAnalysis, SyncItem } from "./types";
import EditalAnalyzerTab from "./components/EditalAnalyzerTab";
import RadarOportunidadesTab from "./components/RadarOportunidadesTab";
import DisputasSheetTab from "./components/DisputasSheetTab";
import CompanyDocsTab from "./components/CompanyDocsTab";
import CreateDocTab from "./components/CreateDocTab";
import PricingCalculatorTab from "./components/PricingCalculatorTab";
import ProductComparatorTab from "./components/ProductComparatorTab";
import LanceBotTab from "./components/LanceBotTab";
import CompetitorAnalyzerTab from "./components/CompetitorAnalyzerTab";
import AiConfigTab from "./components/AiConfigTab";
import FloatingAiChat from "./components/FloatingAiChat";
import DocPreviewModal from "./components/DocPreviewModal";
import { 
  getSyncedItems, getGoogleAccessToken, isGoogleConnected, initAuth, googleSignIn, logout 
} from "./utils/googleSync";
import {
  getSupabaseConfig,
  getSupabaseClient,
  signUpWithSupabase,
  signInWithSupabase,
  signOutWithSupabase,
  fetchCompanyDataFromSupabase,
  fetchUserConfigFromSupabase,
  saveCompanyDataToSupabase
} from "./utils/supabaseClient";
import SupabaseLoginScreen from "./components/SupabaseLoginScreen";
import ThemeToggle from "./components/ThemeToggle";

// Default Initial Corporate profile representing a Brazilian company 
const DEFAULT_COMPANY_DATA: CompanyData = {
  razonSocial: "",
  cnpj: "",
  address: "",
  phone: "",
  email: "",
  representativeName: "",
  representativeCpf: "",
  bankDetails: ""
};

export default function App() {
  const [activeTab, setActiveTab ] = useState<"analyzer" | "radar" | "disputasSheet" | "createDoc" | "documents" | "calculator" | "comparator" | "bot" | "competitors" | "aiConfig">("analyzer");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  
  // Dark/Light theme state removed as requested
  
  // App-wide state
  const [companyData, setCompanyData] = useState<CompanyData>(() => {
    const saved = localStorage.getItem("aip_company_data");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Clear fictitious default remnants of previous builds from user's cache
        if (
          parsed.razonSocial?.toUpperCase().includes("VORTEX") || 
          parsed.cnpj === "28.452.910/0001-44" ||
          parsed.representativeCpf === "402.129.558-02" ||
          parsed.representativeName?.includes("Siqueira")
        ) {
          localStorage.removeItem("aip_company_data");
          return DEFAULT_COMPANY_DATA;
        }
        return parsed;
      } catch (e) {
        return DEFAULT_COMPANY_DATA;
      }
    }
    return DEFAULT_COMPANY_DATA;
  });

  const [activeEdital, setActiveEdital] = useState<EditalAnalysis | null>(() => {
    const saved = localStorage.getItem("aip_active_edital");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return null;
      }
    }
    return null;
  });

  // Synced files stream
  const [syncedItems, setSyncedItems] = useState<SyncItem[]>([]);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Supabase SaaS states
  const [supabaseUser, setSupabaseUser] = useState<any | null>(null);
  const [supabaseModalOpen, setSupabaseModalOpen] = useState(false);
  const [saasPlan, setSaasPlan] = useState<string>(() => {
    return localStorage.getItem("supabase_saas_plan") || "Free";
  });
  const [supabaseConnected, setSupabaseConnected] = useState(false);
  const [aiQuotaWarning, setAiQuotaWarning] = useState<string | null>(null);

  useEffect(() => {
    const handleQuotaWarning = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && customEvent.detail.message) {
        setAiQuotaWarning(customEvent.detail.message);
      }
    };
    window.addEventListener("ai-quota-warning", handleQuotaWarning);
    return () => {
      window.removeEventListener("ai-quota-warning", handleQuotaWarning);
    };
  }, []);

  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Supabase dynamic auth credentials inside modal
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState<{ success: boolean; message: string } | null>(null);
  const [activeProvider, setActiveProvider] = useState<string>("gemini");

  // Sync Log list
  const [syncLogs, setSyncLogs] = useState<string[]>([
    "Sistema inicializado com sucesso.",
    "Módulo de conformidade regulatória pronto."
  ]);

  // Modal preview states
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewData, setPreviewData] = useState<{
    title: string;
    markdown: string;
    type: "proposal" | "declaration";
  }>({
    title: "",
    markdown: "",
    type: "proposal"
  });

  // Clean any remnant test/fictional keys from local storage
  useEffect(() => {
    const keysToCheck = ["ai_gemini_key", "ai_openai_key", "ai_anthropic_key", "ai_deepseek_key"];
    keysToCheck.forEach(key => {
      const val = localStorage.getItem(key);
      if (val && (
        val === "AIzaSy..." || 
        val.startsWith("AIzaSy-placeholder") || 
        val === "sk-proj-..." || 
        val === "sk-ant-..." || 
        val === "sk-..." || 
        val.includes("placeholder")
      )) {
        localStorage.removeItem(key);
      }
    });
  }, []);

  // Sync provider state on load and config updates
  useEffect(() => {
    const syncActiveProvider = () => {
      setActiveProvider(localStorage.getItem("ai_active_provider") || "gemini");
    };
    syncActiveProvider();
    window.addEventListener("user-config-loaded", syncActiveProvider);
    return () => {
      window.removeEventListener("user-config-loaded", syncActiveProvider);
    };
  }, []);

  const handleGlobalProviderChange = async (newProvider: string) => {
    setActiveProvider(newProvider);
    localStorage.setItem("ai_active_provider", newProvider);
    addLogMessage(`Provedor de IA ativo alterado para: ${newProvider}`);
    window.dispatchEvent(new Event("user-config-loaded"));

    // Persist to Supabase dynamically
    if (supabaseUser) {
      try {
        const { saveUserConfigToSupabase, fetchUserConfigFromSupabase } = await import("./utils/supabaseClient");
        const currentConfig = await fetchUserConfigFromSupabase();
        
        await saveUserConfigToSupabase({
          activeProvider: newProvider,
          geminiKey: currentConfig?.gemini_key || localStorage.getItem("ai_gemini_key") || "",
          geminiModel: (currentConfig?.gemini_model === "gemini-3.6-flash" ? "gemini-3.7-flash" : currentConfig?.gemini_model) || (localStorage.getItem("ai_gemini_model") === "gemini-3.6-flash" ? "gemini-3.7-flash" : localStorage.getItem("ai_gemini_model")) || "gemini-3.7-flash",
          openaiKey: currentConfig?.openai_key || localStorage.getItem("ai_openai_key") || "",
          openaiModel: currentConfig?.openai_model || localStorage.getItem("ai_openai_model") || "gpt-4o",
          anthropicKey: currentConfig?.anthropic_key || localStorage.getItem("ai_anthropic_key") || "",
          anthropicModel: currentConfig?.anthropic_model || localStorage.getItem("ai_anthropic_model") || "claude-sonnet-5",
          deepseekKey: currentConfig?.deepseek_key || localStorage.getItem("ai_deepseek_key") || "",
          deepseekModel: currentConfig?.deepseek_model || localStorage.getItem("ai_deepseek_model") || "deepseek-chat"
        });
      } catch (err) {
        console.warn("Erro ao salvar mudança global de provedor no Supabase:", err);
      }
    }
  };

  const loadUserDataFromSupabase = async (user: any) => {
    if (!user) return;
    try {
      addLogMessage(`Carregando dados específicos do usuário do Supabase...`);
      
      // 1. Fetch Company Data
      const dbCompany = await fetchCompanyDataFromSupabase();
      if (dbCompany) {
        const loadedCompany: CompanyData = {
          razonSocial: dbCompany.razon_social || "",
          cnpj: dbCompany.cnpj || "",
          address: dbCompany.address || "",
          phone: dbCompany.phone || "",
          email: dbCompany.email || "",
          representativeName: dbCompany.representative_name || "",
          representativeCpf: dbCompany.representative_cpf || "",
          bankDetails: dbCompany.bank_details || ""
        };
        setCompanyData(loadedCompany);
        localStorage.setItem("aip_company_data", JSON.stringify(loadedCompany));
        addLogMessage("Perfil corporativo do usuário carregado com sucesso.");
      } else if (user?.user_metadata) {
        const meta = user.user_metadata;
        const loadedCompany: CompanyData = {
          razonSocial: "",
          cnpj: "",
          address: "",
          phone: meta.phone || "",
          email: user.email || "",
          representativeName: meta.full_name || "",
          representativeCpf: "",
          bankDetails: ""
        };
        setCompanyData(loadedCompany);
        localStorage.setItem("aip_company_data", JSON.stringify(loadedCompany));
        addLogMessage("Perfil corporativo inicializado a partir do cadastro.");
      }

      // 2. Fetch User AI Config / Keys
      const dbConfig = await fetchUserConfigFromSupabase();
      if (dbConfig) {
        if (dbConfig.active_provider) localStorage.setItem("ai_active_provider", dbConfig.active_provider);
        
        if (dbConfig.gemini_key && dbConfig.gemini_key.trim().length > 5) {
          localStorage.setItem("ai_gemini_key", dbConfig.gemini_key);
        }
        if (dbConfig.gemini_model) localStorage.setItem("ai_gemini_model", dbConfig.gemini_model);

        if (dbConfig.openai_key && dbConfig.openai_key.trim().length > 5) {
          localStorage.setItem("ai_openai_key", dbConfig.openai_key);
        }
        if (dbConfig.openai_model) localStorage.setItem("ai_openai_model", dbConfig.openai_model);

        if (dbConfig.anthropic_key && dbConfig.anthropic_key.trim().length > 5) {
          localStorage.setItem("ai_anthropic_key", dbConfig.anthropic_key);
        }
        if (dbConfig.anthropic_model) localStorage.setItem("ai_anthropic_model", dbConfig.anthropic_model);

        if (dbConfig.deepseek_key && dbConfig.deepseek_key.trim().length > 5) {
          localStorage.setItem("ai_deepseek_key", dbConfig.deepseek_key);
        }
        if (dbConfig.deepseek_model) localStorage.setItem("ai_deepseek_model", dbConfig.deepseek_model);

        addLogMessage("Configurações de chaves de API do usuário carregadas.");
      }
      window.dispatchEvent(new Event("user-config-loaded"));
    } catch (e: any) {
      console.error("Erro ao carregar dados do usuário do Supabase:", e);
    }
  };

  // Load persistence and sync profile to Supabase
  useEffect(() => {
    if (companyData && companyData !== DEFAULT_COMPANY_DATA) {
      localStorage.setItem("aip_company_data", JSON.stringify(companyData));
      if (supabaseUser) {
        saveCompanyDataToSupabase(companyData).catch((e) =>
          console.warn("Erro ao salvar perfil corporativo no Supabase:", e)
        );
      }
    }
  }, [companyData, supabaseUser]);

  useEffect(() => {
    if (activeEdital) {
      localStorage.setItem("aip_active_edital", JSON.stringify(activeEdital));
    } else {
      localStorage.removeItem("aip_active_edital");
    }
  }, [activeEdital]);

  useEffect(() => {
    // Read synced items list
    setSyncedItems(getSyncedItems());
    setGoogleConnected(isGoogleConnected());

    const unsubscribe = initAuth(
      (user) => {
        setGoogleConnected(true);
        setUserEmail(user.email);
        addLogMessage(`Sincronismo com Google Workspace ativo: ${user.email}`);
      },
      () => {
        setGoogleConnected(false);
        setUserEmail(null);
      }
    );

    const handleSyncUpdate = () => {
      setSyncedItems(getSyncedItems());
      setGoogleConnected(isGoogleConnected());
    };
    window.addEventListener("gdrive-sync-updated", handleSyncUpdate);

    return () => {
      unsubscribe();
      window.removeEventListener("gdrive-sync-updated", handleSyncUpdate);
    };
  }, []);

  // Sync Supabase user session on mount
  useEffect(() => {
    const config = getSupabaseConfig();
    const isConn = !!config.url && !!config.anonKey;
    setSupabaseConnected(isConn);

    if (isConn) {
      const client = getSupabaseClient();
      if (client) {
        client.auth.getUser().then(({ data }) => {
          if (data?.user) {
            setSupabaseUser(data.user);
            addLogMessage(`Sessão SaaS Supabase carregada: ${data.user.email}`);
            loadUserDataFromSupabase(data.user);
          }
        }).catch(() => {});

        // Listen for Auth changes in realtime
        const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
          if (session?.user) {
            setSupabaseUser(session.user);
            loadUserDataFromSupabase(session.user);
          } else {
            setSupabaseUser(null);
          }
        });

        return () => {
          subscription.unsubscribe();
        };
      }
    }
  }, [supabaseModalOpen]);

  const addLogMessage = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setSyncLogs(prev => [`[${timestamp}] ${msg}`, ...prev.slice(0, 8)]);
    // Re-trigger synced list refreshing
    setSyncedItems(getSyncedItems());
  };

  // Client side Google OAuth loader using Firebase SDK
  const handleGoogleLogin = async () => {
    try {
      addLogMessage("Iniciando fluxo de login do Google...");
      const result = await googleSignIn();
      if (result) {
        setGoogleConnected(true);
        setUserEmail(result.user.email);
        addLogMessage(`Conectado com sucesso à sua conta Google: ${result.user.email}`);
        addLogMessage("Pronto para sincronizar arquivos com o Google Drive e Sheets real!");
      }
    } catch (err: any) {
      console.error(err);
      addLogMessage(`Erro ao autenticar com o Google: ${err.message || err}`);
    }
  };

  const handleGoogleLogout = async () => {
    try {
      await logout();
      setGoogleConnected(false);
      setUserEmail(null);
      addLogMessage("Desconectado da conta Google Workspace.");
    } catch (err: any) {
      console.error(err);
      addLogMessage(`Erro ao fazer logout: ${err.message || err}`);
    }
  };

  const handleSaaSAuthAction = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthMessage(null);
    try {
      if (authMode === "signup") {
        const res = await signUpWithSupabase(authEmail, authPassword);
        setAuthMessage(res);
        if (res.success && res.user) {
          setSupabaseUser(res.user);
          addLogMessage(`Nova conta SaaS criada no Supabase Auth: ${res.user.email}`);
        }
      } else {
        const res = await signInWithSupabase(authEmail, authPassword);
        setAuthMessage(res);
        if (res.success && res.session?.user) {
          setSupabaseUser(res.session.user);
          loadUserDataFromSupabase(res.session.user);
          addLogMessage(`Sessão SaaS Supabase autenticada: ${res.session.user.email}`);
          setTimeout(() => setSupabaseModalOpen(false), 1500);
        }
      }
    } catch (err: any) {
      setAuthMessage({ success: false, message: err.message || "Erro no processamento da autenticação." });
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSaaSSignOut = async () => {
    try {
      await signOutWithSupabase();
      
      // Clear user-specific data from localStorage for complete multi-user privacy
      localStorage.removeItem("aip_company_data");
      localStorage.removeItem("aip_active_edital");
      localStorage.removeItem("aip_certificates");
      localStorage.removeItem("aip_edital_history");
      localStorage.removeItem("aip_competitors_history");
      localStorage.removeItem("aip_chat_sessions");
      localStorage.removeItem("ai_active_provider");
      localStorage.removeItem("ai_gemini_key");
      localStorage.removeItem("ai_gemini_model");
      localStorage.removeItem("ai_openai_key");
      localStorage.removeItem("ai_openai_model");
      localStorage.removeItem("ai_anthropic_key");
      localStorage.removeItem("ai_anthropic_model");
      localStorage.removeItem("ai_deepseek_key");
      localStorage.removeItem("ai_deepseek_model");
      localStorage.removeItem("aip_comprasnet_token");
      localStorage.removeItem("aip_comprasnet_cookie");
      localStorage.removeItem("aip_pricing_simulations");
      
      // Reset state variables
      setCompanyData(DEFAULT_COMPANY_DATA);
      setActiveEdital(null);
      setSyncedItems([]);
      setSupabaseUser(null);

      addLogMessage("Sessão SaaS encerrada. Todos os dados locais e cache foram apagados.");
      setSupabaseModalOpen(false);
    } catch (err: any) {
      console.error(err);
      addLogMessage(`Erro ao encerrar sessão: ${err.message || err}`);
    }
  };

  const handleChangePlan = (newPlan: string) => {
    setSaasPlan(newPlan);
    localStorage.setItem("supabase_saas_plan", newPlan);
    addLogMessage(`Plano SaaS atualizado para: ${newPlan}`);
  };

  const handleOpenDocPreview = (title: string, markdown: string, type: "proposal" | "declaration") => {
    setPreviewData({ title, markdown, type });
    setPreviewModalOpen(true);
    addLogMessage(`Criado documento "${title}" via IA Gemini 3.5-flash.`);
  };
  
  if (!supabaseUser) {
    return (
      <SupabaseLoginScreen 
        onLoginSuccess={(user) => {
          setSupabaseUser(user);
          setSupabaseConnected(true);
          addLogMessage(`Sessão SaaS autenticada: ${user.email}`);
          loadUserDataFromSupabase(user);
        }} 
      />
    );
  }

  return (
    <div id="application-container" className="min-h-screen lg:h-screen lg:h-[100dvh] lg:overflow-hidden bg-[#F8F9FA] dark:bg-[#000000] text-[#111827] dark:text-[#FAFAFA] flex flex-col lg:flex-row font-sans select-text relative">
      
      {/* Desktop Sidebar (Persistent 260px) & Mobile Sidebar Drawer */}
      <aside 
        className={`
          fixed inset-y-0 left-0 z-50 lg:sticky lg:top-0 h-screen bg-white dark:bg-[#09090B] border-r border-gray-100 dark:border-zinc-800/40 p-4 flex flex-col justify-between shadow-xs dark:shadow-none transition-all duration-300 ease-in-out lg:translate-x-0
          ${sidebarCollapsed ? "lg:w-20 lg:p-3" : "lg:w-[260px] w-[260px]"}
          ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}
      >
        <div className="flex flex-col h-full gap-3.5">
          
          {/* Logo Brand info inside Sidebar */}
          <div className="flex flex-col border-b border-gray-100 dark:border-zinc-800/40 pb-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="bg-gradient-to-br from-[#FF6B1A] to-[#FF5A00] text-white p-2 rounded-xl shrink-0 shadow-xs">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                {(!sidebarCollapsed || mobileMenuOpen) && (
                  <div className="transition-opacity duration-200">
                    <h1 className="text-sm font-black tracking-wider text-gray-900 dark:text-white uppercase font-mono leading-none">
                      HORASIS
                    </h1>
                    <p className="text-[10.5px] text-gray-500 dark:text-zinc-400 mt-0.5 font-semibold truncate">
                      Enterprise SaaS v3.0
                    </p>
                  </div>
                )}
              </div>
              
              {/* Collapse toggle button for desktop */}
              <button
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="hidden lg:flex p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white transition-colors cursor-pointer shrink-0"
                title={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
              >
                {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
              </button>

              {/* Close button for Mobile drawer only */}
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="lg:hidden p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Navigation Links with Micro Group Headers (CORE, OPERATIONS, SETTINGS) */}
          <nav className="flex-1 space-y-4 overflow-y-auto pr-1 scrollbar-none">
            
            {/* CORE GROUP */}
            <div>
              {(!sidebarCollapsed || mobileMenuOpen) && (
                <div className="text-[10px] font-extrabold text-gray-400 dark:text-zinc-500 uppercase tracking-widest px-2.5 mb-1.5">
                  CORE
                </div>
              )}
              <div className="space-y-1">
                {[
                  { id: "analyzer", label: "Análise de Edital", icon: FileText },
                  { id: "radar", label: "Radar de Oportunidades", icon: Search },
                  { id: "disputasSheet", label: "Planilha de Disputas", icon: FileSpreadsheet }
                ].map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      id={`tab-btn-${item.id}`}
                      onClick={() => { setActiveTab(item.id as any); setMobileMenuOpen(false); }}
                      className={`group w-full py-2 px-2.5 rounded-lg text-[12.5px] flex items-center transition-all cursor-pointer text-left ${
                        sidebarCollapsed ? "lg:justify-center lg:px-0 px-2.5 gap-2.5" : "gap-2.5"
                      } ${
                        isActive
                          ? "bg-[#FFF0E5] dark:bg-[#FF5A00]/15 text-[#E65000] dark:text-[#FF5A00] font-bold shadow-2xs border-l-3 border-[#FF5A00]"
                          : "text-gray-700 dark:text-zinc-300 font-medium hover:bg-gray-100/80 dark:hover:bg-zinc-800/70 hover:text-gray-900 dark:hover:text-white"
                      }`}
                      title={item.label}
                    >
                      <Icon className={`w-4 h-4 shrink-0 transition-colors ${
                        isActive 
                          ? "text-[#FF5A00]" 
                          : "text-gray-500 dark:text-zinc-400 group-hover:text-gray-800 dark:group-hover:text-zinc-200"
                      }`} />
                      <span className={`${sidebarCollapsed ? "lg:hidden block" : "block"}`}>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* OPERATIONS GROUP */}
            <div>
              {(!sidebarCollapsed || mobileMenuOpen) && (
                <div className="text-[10px] font-extrabold text-gray-400 dark:text-zinc-500 uppercase tracking-widest px-2.5 mb-1.5">
                  OPERATIONS
                </div>
              )}
              <div className="space-y-1">
                {[
                  { id: "createDoc", label: "Criar Documentos", icon: FileEdit },
                  { id: "documents", label: "Gestão de Certidões", icon: ListTodo },
                  { id: "calculator", label: "Calculadora de Preços", icon: Calculator },
                  { id: "comparator", label: "Comparador de Produtos", icon: Sparkles },
                  { id: "bot", label: "Robô de Lances", icon: Cpu },
                  { id: "competitors", label: "Analisar Concorrentes", icon: Users }
                ].map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      id={`tab-btn-${item.id}`}
                      onClick={() => { setActiveTab(item.id as any); setMobileMenuOpen(false); }}
                      className={`group w-full py-2 px-2.5 rounded-lg text-[12.5px] flex items-center transition-all cursor-pointer text-left ${
                        sidebarCollapsed ? "lg:justify-center lg:px-0 px-2.5 gap-2.5" : "gap-2.5"
                      } ${
                        isActive
                          ? "bg-[#FFF0E5] dark:bg-[#FF5A00]/15 text-[#E65000] dark:text-[#FF5A00] font-bold shadow-2xs border-l-3 border-[#FF5A00]"
                          : "text-gray-700 dark:text-zinc-300 font-medium hover:bg-gray-100/80 dark:hover:bg-zinc-800/70 hover:text-gray-900 dark:hover:text-white"
                      }`}
                      title={item.label}
                    >
                      <Icon className={`w-4 h-4 shrink-0 transition-colors ${
                        isActive 
                          ? "text-[#FF5A00]" 
                          : "text-gray-500 dark:text-zinc-400 group-hover:text-gray-800 dark:group-hover:text-zinc-200"
                      }`} />
                      <span className={`${sidebarCollapsed ? "lg:hidden block" : "block"}`}>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* SETTINGS GROUP */}
            <div>
              {(!sidebarCollapsed || mobileMenuOpen) && (
                <div className="text-[10px] font-extrabold text-gray-400 dark:text-zinc-500 uppercase tracking-widest px-2.5 mb-1.5">
                  SETTINGS
                </div>
              )}
              <div className="space-y-1">
                <button
                  id="tab-btn-ai-config"
                  onClick={() => { setActiveTab("aiConfig"); setMobileMenuOpen(false); }}
                  className={`group w-full py-2 px-2.5 rounded-lg text-[12.5px] flex items-center transition-all cursor-pointer text-left ${
                    sidebarCollapsed ? "lg:justify-center lg:px-0 px-2.5 gap-2.5" : "gap-2.5"
                  } ${
                    activeTab === "aiConfig"
                      ? "bg-[#FFF0E5] dark:bg-[#FF5A00]/15 text-[#E65000] dark:text-[#FF5A00] font-bold shadow-2xs border-l-3 border-[#FF5A00]"
                      : "text-gray-700 dark:text-zinc-300 font-medium hover:bg-gray-100/80 dark:hover:bg-zinc-800/70 hover:text-gray-900 dark:hover:text-white"
                  }`}
                  title="IA & Modelos"
                >
                  <Settings className={`w-4 h-4 shrink-0 transition-colors ${
                    activeTab === "aiConfig" 
                      ? "text-[#FF5A00]" 
                      : "text-gray-500 dark:text-zinc-400 group-hover:text-gray-800 dark:group-hover:text-zinc-200"
                  }`} />
                  <span className={`${sidebarCollapsed ? "lg:hidden block" : "block"}`}>IA & Modelos</span>
                </button>
              </div>
            </div>

          </nav>

          {/* Bottom Sidebar area (Plan Usage, Upgrade Button, Profile) */}
          <div className={`border-t border-gray-100 dark:border-zinc-800/40 pt-3 space-y-2.5 ${sidebarCollapsed ? "lg:hidden block" : "block"}`}>
            
            {/* Plan usage progress bar (Tokens / Quota Card) */}
            <div className="bg-slate-50/80 dark:bg-zinc-900/90 border border-slate-200/50 dark:border-zinc-800/40 text-gray-900 dark:text-white p-3 rounded-xl space-y-2 shadow-2xs">
              <div className="flex justify-between items-center text-[11px] font-bold text-slate-700 dark:text-zinc-300">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#FF5A00]" />
                  Tokens / Cota IA
                </span>
                <span className="text-[#FF5A00] font-mono font-black text-xs">40%</span>
              </div>
              <div className="w-full bg-slate-200/70 dark:bg-zinc-800 h-2 rounded-full overflow-hidden">
                <div className="bg-gradient-to-r from-[#FF6B1A] to-[#FF5A00] h-full rounded-full w-[40%]" />
              </div>
            </div>

            {/* Upgrade Plan Secondary Button */}
            <button
              onClick={() => setActiveTab("aiConfig")}
              className="w-full py-2.5 px-3 rounded-xl bg-white dark:bg-zinc-900 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-zinc-800/90 border border-gray-200/60 dark:border-zinc-800/40 text-xs font-bold transition-all cursor-pointer shadow-2xs hover:border-[#FF5A00]/40 flex items-center justify-center gap-2 group"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#FF5A00] group-hover:scale-110 transition-transform" />
              <span>Upgrade Plan</span>
            </button>

            {/* Active AI Selector */}
            <div className="relative" ref={modelDropdownRef}>
              <button
                type="button"
                onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                className="w-full bg-white dark:bg-zinc-900 hover:bg-gray-50 dark:hover:bg-zinc-800/90 border border-gray-200/60 dark:border-zinc-800/40 rounded-xl px-3 py-2 flex items-center justify-between text-left transition-all cursor-pointer shadow-2xs"
              >
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#FF5A00] animate-pulse" />
                  <span className="text-xs font-bold text-gray-900 dark:text-white">
                    {activeProvider === "gemini" && "Gemini 3.5"}
                    {activeProvider === "openai" && "GPT-4o"}
                    {activeProvider === "anthropic" && "Claude 3.7"}
                    {activeProvider === "deepseek" && "DeepSeek V3"}
                  </span>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-gray-500 dark:text-zinc-400 transition-transform ${modelDropdownOpen ? "rotate-180" : ""}`} />
              </button>

              {modelDropdownOpen && (
                <div className="absolute bottom-full left-0 right-0 mb-1.5 bg-white dark:bg-zinc-900 border border-gray-200/60 dark:border-zinc-800/40 rounded-xl shadow-xl dark:shadow-2xl p-1.5 space-y-1 z-50 animate-scale-up">
                  {[
                    { id: "gemini", name: "Gemini 3.5", desc: "Google AI" },
                    { id: "openai", name: "GPT-4o", desc: "OpenAI" },
                    { id: "anthropic", name: "Claude 3.7", desc: "Anthropic" },
                    { id: "deepseek", name: "DeepSeek V3", desc: "DeepSeek" }
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        handleGlobalProviderChange(p.id);
                        setModelDropdownOpen(false);
                      }}
                      className={`w-full text-left p-2 rounded-lg flex items-center justify-between text-xs transition-all cursor-pointer ${
                        activeProvider === p.id 
                          ? "bg-[#FFF0E5] dark:bg-[#FF5A00]/15 text-[#E65000] dark:text-[#FF5A00] font-bold" 
                          : "hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-700 dark:text-zinc-300 font-medium"
                      }`}
                    >
                      <span>{p.name}</span>
                      {activeProvider === p.id && <Check className="w-3.5 h-3.5 text-[#FF5A00]" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            {/* User Profile Menu */}
            <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-zinc-800/40">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#FF6B1A] to-[#FF5A00] text-white flex items-center justify-center font-black text-xs shadow-2xs shrink-0">
                  {supabaseUser?.email ? supabaseUser.email[0].toUpperCase() : "U"}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-gray-900 dark:text-white truncate">
                    {supabaseUser?.email?.split('@')[0] || "Usuário"}
                  </div>
                  <div className="text-[10.5px] font-semibold text-gray-500 dark:text-zinc-400 truncate">
                    Plano {saasPlan}
                  </div>
                </div>
              </div>
              <button
                onClick={handleSaaSSignOut}
                className="p-2 rounded-lg text-gray-500 dark:text-zinc-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
                title="Sair"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>

          </div>

        </div>
      </aside>

      {/* Backdrop for Mobile Sidebar Drawer */}
      {mobileMenuOpen && (
        <div 
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-0 bg-black/40 backdrop-blur-xs z-40 lg:hidden"
        />
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 h-auto lg:h-full lg:overflow-hidden bg-[#F8F9FA] dark:bg-[#000000]">
        
        {/* Top Bar Header (Sticky Top, Flex row, border-bottom 1px solid #E5E7EB, white background) */}
        <header className="bg-white dark:bg-[#09090B] border-b border-[#E5E7EB] dark:border-[#27272A] shrink-0 px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-30">
          
          {/* Left: Mobile Menu Toggle + Breadcrumbs / Title */}
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-1.5 rounded-md bg-[#F3F4F6] dark:bg-[#18181B] hover:bg-[#E5E7EB] dark:hover:bg-[#27272A] text-[#374151] dark:text-[#FAFAFA] transition-colors cursor-pointer shrink-0"
              title={mobileMenuOpen ? "Fechar menu" : "Abrir menu"}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <div className="bg-[#FF5A00] text-white p-1 rounded-md shrink-0 lg:hidden flex items-center justify-center">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold text-[#111827] dark:text-[#FAFAFA] font-mono tracking-tight shrink-0">HORASIS</span>
              <span className="text-xs text-[#D1D5DB] dark:text-[#3F3F46] shrink-0">/</span>
              <span className="text-xs font-bold text-[#111827] dark:text-[#FAFAFA] uppercase truncate">
                {activeTab === "analyzer" ? "Análise de Edital" :
                 activeTab === "radar" ? "Radar de Oportunidades" :
                 activeTab === "disputasSheet" ? "Planilha de Disputas" :
                 activeTab === "createDoc" ? "Criar Documentos" :
                 activeTab === "documents" ? "Gestão de Certidões" :
                 activeTab === "calculator" ? "Calculadora de Preços" :
                 activeTab === "comparator" ? "Comparador de Produtos" :
                 activeTab === "bot" ? "Robô de Lances" :
                 activeTab === "aiConfig" ? "IA & Modelos" : "Analisar Concorrentes"}
              </span>
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              onClick={() => setActiveTab("analyzer")}
              className="bg-[#FF5A00] hover:bg-[#E65000] text-white text-xs font-medium px-2.5 sm:px-4 py-2 rounded-lg transition-all shadow-xs dark:shadow-none flex items-center gap-1.5 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">Analisar Novo Edital</span>
              <span className="sm:hidden text-[11px]">Novo Edital</span>
            </button>

            <button 
              className="p-1.5 text-[#6B7280] dark:text-[#A1A1AA] hover:bg-[#F3F4F6] dark:hover:bg-[#18181B] hover:text-[#111827] dark:hover:text-[#FAFAFA] rounded-md transition-colors cursor-pointer relative"
              title="Notificações e Suporte"
            >
              <HelpCircle className="w-4 h-4" />
            </button>

            <ThemeToggle />
          </div>

        </header>

        {/* Content Stage Area */}
        <main className="flex-1 p-6 overflow-y-auto relative z-10 bg-[#F8F9FA] dark:bg-[#000000]">
          <div className="max-w-7xl mx-auto space-y-6">

            {/* Render Active View Tab */}
            <div className="select-text w-full">
              {activeTab === "analyzer" ? (
                <EditalAnalyzerTab 
                  companyData={companyData} 
                  activeEdital={activeEdital}
                  setActiveEdital={setActiveEdital}
                  onOpenDocPreview={handleOpenDocPreview}
                  onNavigateToCreateDoc={() => setActiveTab("createDoc")}
                />
              ) : activeTab === "radar" ? (
                <RadarOportunidadesTab 
                  onSelectForAnalysis={(text) => {
                    localStorage.setItem("aip_auto_analyze_text", text);
                    setActiveTab("analyzer");
                    setTimeout(() => {
                      window.dispatchEvent(new Event("aip_trigger_external_text"));
                    }, 50);
                  }}
                />
              ) : activeTab === "disputasSheet" ? (
                <DisputasSheetTab
                  activeEdital={activeEdital}
                  onNavigateToAnalyzer={() => setActiveTab("analyzer")}
                />
              ) : activeTab === "createDoc" ? (
                <CreateDocTab
                  companyData={companyData}
                  activeEdital={activeEdital}
                  onOpenDocPreview={handleOpenDocPreview}
                />
              ) : activeTab === "documents" ? (
                <CompanyDocsTab 
                  companyData={companyData} 
                  setCompanyData={setCompanyData}
                  activeEdital={activeEdital}
                />
              ) : activeTab === "calculator" ? (
                <PricingCalculatorTab
                  companyData={companyData}
                  activeEdital={activeEdital}
                />
              ) : activeTab === "comparator" ? (
                <ProductComparatorTab
                  activeEdital={activeEdital}
                />
              ) : activeTab === "bot" ? (
                <LanceBotTab
                  activeEdital={activeEdital}
                />
              ) : activeTab === "aiConfig" ? (
                <AiConfigTab />
              ) : (
                <CompetitorAnalyzerTab
                  activeEdital={activeEdital}
                />
              )}
            </div>

          </div>
        </main>

      </div>

      {/* Dynamic Modal Previews */}
      <DocPreviewModal
        isOpen={previewModalOpen}
        onClose={() => setPreviewModalOpen(false)}
        title={previewData.title}
        initialMarkdown={previewData.markdown}
        type={previewData.type}
        onAddLog={addLogMessage}
      />

      {/* Supabase SaaS Authentication & Account Switcher Modal */}
      {supabaseModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/60 dark:bg-black/80 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="w-full max-w-md bg-white dark:bg-[#121212] border border-gray-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-2xl relative my-auto max-h-[92vh] sm:max-h-[88vh] flex flex-col">
            
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-[#18181B] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5 min-w-0 pr-2">
                <div className="p-2 bg-[#FFF0E5] dark:bg-[#2A170A] text-[#FF5A00] rounded-xl border border-[#FF5A00]/20 shrink-0">
                  <Users className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-[#1C1C1E] dark:text-zinc-100 text-sm truncate">Portal de Clientes SaaS</h3>
                  <p className="text-[10px] text-[#595959] dark:text-zinc-400 font-medium truncate">Supabase Auth Multi-tenant</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setSupabaseModalOpen(false);
                  setAuthMessage(null);
                }}
                className="p-1.5 rounded-lg bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-[#595959] dark:text-zinc-400 hover:text-[#1C1C1E] dark:hover:text-white transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto flex-1">
              
              {!supabaseConnected ? (
                // Supabase not configured warning
                <div className="space-y-4 text-center py-4">
                  <div className="w-12 h-12 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded-full flex items-center justify-center mx-auto border border-amber-200 dark:border-amber-800">
                    <CloudLightning className="w-6 h-6 animate-pulse" />
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-bold text-[#1C1C1E] dark:text-zinc-100 text-sm">Credenciais não configuradas</h4>
                    <p className="text-[#595959] dark:text-zinc-400 text-xs leading-relaxed max-w-sm mx-auto">
                      Para usar a Autenticação SaaS real e isolar dados de múltiplos usuários, configure sua <strong>URL</strong> e <strong>Anon Key</strong> do Supabase primeiro.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setSupabaseModalOpen(false);
                      setActiveTab("aiConfig");
                    }}
                    className="px-4 py-2 bg-[#FF5A00] hover:bg-[#E65000] text-white font-bold rounded-xl text-xs transition-colors cursor-pointer shadow-sm"
                  >
                    Configurar Provedores de IA
                  </button>
                </div>
              ) : supabaseUser ? (
                // Active User Session panel
                <div className="space-y-4 sm:space-y-5">
                  <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 p-3.5 sm:p-4 rounded-xl space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="font-bold text-emerald-800 dark:text-emerald-300 text-xs">Sessão Ativa no Supabase</span>
                    </div>
                    
                    <div className="space-y-1.5 font-mono text-[11px] text-[#1C1C1E] dark:text-zinc-200">
                      <div className="flex justify-between border-b border-emerald-200/60 dark:border-emerald-800/40 pb-1 text-[#595959] dark:text-zinc-400">
                        <span>Usuário</span>
                        <span className="font-bold text-[#1C1C1E] dark:text-zinc-100 truncate max-w-[200px]">{supabaseUser.email}</span>
                      </div>
                      <div className="flex justify-between border-b border-emerald-200/60 dark:border-emerald-800/40 pb-1 text-[#595959] dark:text-zinc-400">
                        <span>UUID</span>
                        <span className="font-bold text-[#595959] dark:text-zinc-400 truncate max-w-[180px]" title={supabaseUser.id}>
                          {supabaseUser.id}
                        </span>
                      </div>
                      <div className="flex justify-between text-[#595959] dark:text-zinc-400">
                        <span>Plano Escolhido</span>
                        <span className="font-bold text-[#FF5A00]">{saasPlan}</span>
                      </div>
                    </div>
                  </div>

                  {/* Plan Switcher */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-[#595959] dark:text-zinc-400 uppercase tracking-wider block">Escolha o Plano SaaS da Conta</label>
                    <div className="grid grid-cols-3 gap-2">
                      {["Free", "Pro", "Enterprise"].map((plan) => {
                        const isActive = saasPlan === plan;
                        return (
                          <button
                            key={plan}
                            onClick={() => handleChangePlan(plan)}
                            className={`py-2 px-1.5 rounded-xl text-[10px] font-bold border transition-all cursor-pointer ${
                              isActive 
                                ? "bg-[#FFF0E5] dark:bg-[#2A170A] border-[#FF5A00] text-[#FF5A00]" 
                                : "bg-white dark:bg-zinc-800 border-gray-200 dark:border-zinc-700 text-[#595959] dark:text-zinc-400 hover:text-[#1C1C1E] dark:hover:text-white hover:bg-gray-50 dark:hover:bg-zinc-700/80"
                            }`}
                          >
                            {plan === "Free" ? "Gratuito" : plan === "Pro" ? "SaaS Pro" : "Enterprise"}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-[#595959] dark:text-zinc-400 leading-normal">
                      Ao trocar de plano, os limites e volume de análises são recalculados para este e-mail.
                    </p>
                  </div>

                  <div className="border-t border-gray-200 dark:border-zinc-800 pt-3 sm:pt-4 flex flex-col gap-2">
                    <button
                      onClick={handleSaaSSignOut}
                      className="w-full py-2.5 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Encerrar Sessão (Sign Out)
                    </button>
                    
                    <button
                      type="button"
                      onClick={() => {
                        setSupabaseUser(null);
                        setAuthMode("signin");
                        setAuthMessage(null);
                      }}
                      className="w-full py-2.5 bg-white dark:bg-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-700 text-[#1C1C1E] dark:text-zinc-100 border border-gray-300 dark:border-zinc-700 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Users className="w-3.5 h-3.5 text-[#595959] dark:text-zinc-400" />
                      Entrar com Outro Usuário
                    </button>
                  </div>
                </div>
              ) : (
                // Authentication Form (Login / Register)
                <form onSubmit={handleSaaSAuthAction} className="space-y-4">
                  {/* Selector */}
                  <div className="flex bg-gray-100 dark:bg-zinc-800 p-1 rounded-xl border border-gray-200 dark:border-zinc-700">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode("signin");
                        setAuthMessage(null);
                      }}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        authMode === "signin"
                          ? "bg-white dark:bg-zinc-700 text-[#1C1C1E] dark:text-white shadow-xs"
                          : "text-[#595959] dark:text-zinc-400 hover:text-[#1C1C1E] dark:hover:text-white"
                      }`}
                    >
                      Acessar Conta
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode("signup");
                        setAuthMessage(null);
                      }}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        authMode === "signup"
                          ? "bg-white dark:bg-zinc-700 text-[#1C1C1E] dark:text-white shadow-xs"
                          : "text-[#595959] dark:text-zinc-400 hover:text-[#1C1C1E] dark:hover:text-white"
                      }`}
                    >
                      Criar Nova Conta
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-[#595959] dark:text-zinc-400 uppercase tracking-wider block">Endereço de E-mail</label>
                      <input
                        type="email"
                        required
                        placeholder="seu-email@exemplo.com"
                        value={authEmail}
                        onChange={(e) => setAuthEmail(e.target.value)}
                        className="w-full bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 rounded-xl p-2.5 text-xs text-[#1C1C1E] dark:text-zinc-100 placeholder:text-[#9CA3AF] dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#FF5A00] focus:border-transparent font-medium"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-[#595959] dark:text-zinc-400 uppercase tracking-wider block">Senha Secreta</label>
                      <input
                        type="password"
                        required
                        placeholder="••••••••"
                        value={authPassword}
                        onChange={(e) => setAuthPassword(e.target.value)}
                        className="w-full bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 rounded-xl p-2.5 text-xs text-[#1C1C1E] dark:text-zinc-100 placeholder:text-[#9CA3AF] dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#FF5A00] focus:border-transparent font-mono"
                      />
                    </div>
                  </div>

                  {authMessage && (
                    <div className={`p-3 rounded-xl text-[11px] leading-relaxed border ${
                      authMessage.success
                        ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300"
                        : "bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300"
                    }`}>
                      {authMessage.message}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={authLoading}
                    className="w-full py-2.5 bg-[#FF5A00] hover:bg-[#E65000] disabled:opacity-50 text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                  >
                    {authLoading ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Autenticando...</span>
                      </>
                    ) : authMode === "signup" ? (
                      <>
                        <Users className="w-3.5 h-3.5" />
                        <span>Criar Conta SaaS</span>
                      </>
                    ) : (
                      <>
                        <LogIn className="w-3.5 h-3.5" />
                        <span>Entrar na Plataforma</span>
                      </>
                    )}
                  </button>
                </form>
              )}

              <div className="text-[10px] text-[#595959] dark:text-zinc-400 bg-gray-50 dark:bg-zinc-900 p-3 rounded-xl border border-gray-200 dark:border-zinc-800 leading-relaxed">
                ℹ️ <strong>Isolamento Multi-tenant:</strong> Ao logar com e-mails diferentes, o Supabase Auth atribui IDs únicos (UUIDs) para cada usuário. Suas análises e documentos são segregados automaticamente, permitindo simular perfeitamente um SaaS em produção!
              </div>

            </div>

          </div>
        </div>
      )}

      {/* Bottom Floating Interactive Chat popup */}
      <FloatingAiChat 
        companyData={companyData} 
        activeEdital={activeEdital}
      />

    </div>
  );
}
