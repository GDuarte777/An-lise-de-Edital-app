import { useState, useEffect, lazy, Suspense } from "react";
import {
  FileText, ShieldCheck, FileSpreadsheet,
  Settings, LogOut, ListTodo, Calculator, Sparkles, Cpu, Users,
  Search, Check, FileEdit, ChevronsUpDown, ClipboardCheck,
  NotebookPen, MessageSquare, Loader2, Scale
} from "lucide-react";
import { CompanyData, EditalAnalysis } from "./types";
import EditalAnalyzerTab from "./components/EditalAnalyzerTab";
import { resetEditalHistory } from "./utils/editalHistory";
import FloatingAiChat from "./components/FloatingAiChat";
import DocPreviewModal from "./components/DocPreviewModal";
import {
  getSupabaseConfig,
  getSupabaseClient,
  signOutWithSupabase,
  fetchCompanyDataFromSupabase,
  fetchUserConfigFromSupabase,
  saveCompanyDataToSupabase
} from "./utils/supabaseClient";
import SupabaseLoginScreen from "./components/SupabaseLoginScreen";
import ThemeToggle from "./components/ThemeToggle";
import { Button } from "./components/ui/button";
import { Separator } from "./components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "./components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "./components/ui/sidebar";

const RadarOportunidadesTab = lazy(() => import("./components/RadarOportunidadesTab"));
const CapagSearchTab = lazy(() => import("./components/CapagSearchTab"));
const DisputasSheetTab = lazy(() => import("./components/DisputasSheetTab"));
const HabilitacaoChecklistTab = lazy(() => import("./components/HabilitacaoChecklistTab"));
const CompanyDocsTab = lazy(() => import("./components/CompanyDocsTab"));
const CreateDocTab = lazy(() => import("./components/CreateDocTab"));
const PricingCalculatorTab = lazy(() => import("./components/PricingCalculatorTab"));
const ProductComparatorTab = lazy(() => import("./components/ProductComparatorTab"));
const LanceBotTab = lazy(() => import("./components/LanceBotTab"));
const CompetitorAnalyzerTab = lazy(() => import("./components/CompetitorAnalyzerTab"));
const NotepadTab = lazy(() => import("./components/NotepadTab"));
const AiConfigTab = lazy(() => import("./components/AiConfigTab"));

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

type TabId =
  | "analyzer"
  | "radar"
  | "capag"
  | "disputasSheet"
  | "documents"
  | "calculator"
  | "createDoc"
  | "competitors"
  | "bot"
  | "notepad"
  | "aiConfig";

const CORE_NAV: { id: TabId; label: string; icon: typeof FileText }[] = [
  { id: "analyzer", label: "Análise de Edital", icon: FileText },
  { id: "radar", label: "Radar de Oportunidades", icon: Search },
  { id: "capag", label: "Consulta CAPAG", icon: Scale },
  { id: "disputasSheet", label: "Gestão de Disputas", icon: FileSpreadsheet },
];

const OPERATIONS_NAV: { id: TabId; label: string; icon: typeof FileText }[] = [
  { id: "documents", label: "Certidões & Habilitação", icon: ClipboardCheck },
  { id: "calculator", label: "Cotação & Calculadora", icon: Calculator },
  { id: "createDoc", label: "Criar Documentos", icon: FileEdit },
  { id: "competitors", label: "Auditar Concorrentes", icon: Users },
  { id: "bot", label: "Robô de Lances", icon: Cpu },
  { id: "notepad", label: "Bloco de Notas", icon: NotebookPen },
];

const TAB_LABELS: Record<TabId, string> = {
  analyzer: "Análise de Edital",
  radar: "Radar de Oportunidades",
  capag: "Consulta CAPAG & Risco Pagador (Tesouro Nacional)",
  disputasSheet: "Gestão de Disputas (Painel, Kanban & Calendário)",
  documents: "Certidões & Habilitação",
  calculator: "Cotação & Calculadora",
  createDoc: "Criar Documentos",
  competitors: "Auditar Concorrentes",
  bot: "Robô de Lances",
  notepad: "Bloco de Notas",
  aiConfig: "IA & Modelos",
};

const AI_PROVIDER_LABELS: Record<string, string> = {
  gemini: "Gemini 3.8",
  openai: "GPT-4o",
  anthropic: "Claude 3.7",
  deepseek: "DeepSeek V3",
};

const AI_PROVIDERS = [
  { id: "gemini", name: "Gemini 3.8", desc: "Google AI" },
  { id: "openai", name: "GPT-4o", desc: "OpenAI" },
  { id: "anthropic", name: "Claude 3.7", desc: "Anthropic" },
  { id: "deepseek", name: "DeepSeek V3", desc: "DeepSeek" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("analyzer");
  const [docsSubView, setDocsSubView] = useState<"certs" | "checklist">("certs");
  const [calcSubView, setCalcSubView] = useState<"pricing" | "comparator">("pricing");
  const [capagFocusQuery, setCapagFocusQuery] = useState<{
    uf?: string;
    municipio?: string;
    orgao?: string;
  } | null>(null);

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

  // Supabase Auth state
  const [supabaseUser, setSupabaseUser] = useState<any | null>(null);
  const [activeProvider, setActiveProvider] = useState<string>("gemini");

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

  const normalizeClientGeminiModel = (m?: string | null) => {
    const clean = (m || "").trim().toLowerCase();
    if (
      !clean ||
      clean.startsWith("gemini-1.") ||
      clean.startsWith("gemini-2.0") ||
      clean.startsWith("gemini-2.5") ||
      clean === "gemini-flash-latest" ||
      clean === "gemini-flash-lite-latest" ||
      clean === "gemini-pro" ||
      clean === "gemini-pro-latest"
    ) {
      return "gemini-3.5-flash-lite";
    }
    return clean;
  };

  const handleGlobalProviderChange = async (newProvider: string) => {
    setActiveProvider(newProvider);
    localStorage.setItem("ai_active_provider", newProvider);
    window.dispatchEvent(new Event("user-config-loaded"));

    // Persist to Supabase dynamically
    if (supabaseUser) {
      try {
        const { saveUserConfigToSupabase, fetchUserConfigFromSupabase } = await import("./utils/supabaseClient");
        const currentConfig = await fetchUserConfigFromSupabase();

        await saveUserConfigToSupabase({
          activeProvider: newProvider,
          geminiKey: localStorage.getItem("ai_gemini_key") || currentConfig?.gemini_key || "",
          geminiModel: normalizeClientGeminiModel(localStorage.getItem("ai_gemini_model") || currentConfig?.gemini_model),
          openaiKey: localStorage.getItem("ai_openai_key") || currentConfig?.openai_key || "",
          openaiModel: currentConfig?.openai_model || localStorage.getItem("ai_openai_model") || "gpt-4o",
          anthropicKey: localStorage.getItem("ai_anthropic_key") || currentConfig?.anthropic_key || "",
          anthropicModel: currentConfig?.anthropic_model || localStorage.getItem("ai_anthropic_model") || "claude-sonnet-5",
          deepseekKey: localStorage.getItem("ai_deepseek_key") || currentConfig?.deepseek_key || "",
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
      }

      // 2. Fetch User AI Config / Keys
      const dbConfig = await fetchUserConfigFromSupabase();
      const sincronizarChaveDoBanco = (storageKey: string, dbVal?: string | null) => {
        const banco = (dbVal || "").trim();
        if (banco.length <= 5) return;
        const localAtual = (localStorage.getItem(storageKey) || "").trim();
        const localEhTextoPuroValido = localAtual.length > 10 && !localAtual.startsWith("enc:v1:");
        const bancoEhCifrado = banco.startsWith("enc:v1:");
        // Preserva a chave em texto puro já salva neste navegador para que a execução
        // direta e a exibição de status funcionem sem depender de descriptografia remota.
        if (localEhTextoPuroValido && bancoEhCifrado) {
          return;
        }
        localStorage.setItem(storageKey, banco);
      };

      if (dbConfig) {
        if (dbConfig.active_provider) localStorage.setItem("ai_active_provider", dbConfig.active_provider);

        sincronizarChaveDoBanco("ai_gemini_key", dbConfig.gemini_key);
        localStorage.setItem("ai_gemini_model", normalizeClientGeminiModel(dbConfig.gemini_model || localStorage.getItem("ai_gemini_model")));

        sincronizarChaveDoBanco("ai_openai_key", dbConfig.openai_key);
        if (dbConfig.openai_model) localStorage.setItem("ai_openai_model", dbConfig.openai_model);

        sincronizarChaveDoBanco("ai_anthropic_key", dbConfig.anthropic_key);
        if (dbConfig.anthropic_model) localStorage.setItem("ai_anthropic_model", dbConfig.anthropic_model);

        sincronizarChaveDoBanco("ai_deepseek_key", dbConfig.deepseek_key);
        if (dbConfig.deepseek_model) localStorage.setItem("ai_deepseek_model", dbConfig.deepseek_model);
      } else {
        localStorage.setItem("ai_gemini_model", normalizeClientGeminiModel(localStorage.getItem("ai_gemini_model")));
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

  // Sync Supabase user session on mount
  useEffect(() => {
    const config = getSupabaseConfig();
    const isConn = !!config.url && !!config.anonKey;

    if (isConn) {
      const client = getSupabaseClient();
      if (client) {
        client.auth.getUser().then(({ data }) => {
          if (data?.user) {
            setSupabaseUser(data.user);
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
  }, []);

  const handleSaaSSignOut = async () => {
    try {
      await signOutWithSupabase();

      // Clear user-specific data from localStorage for complete multi-user privacy
      localStorage.removeItem("aip_company_data");
      localStorage.removeItem("aip_active_edital");
      localStorage.removeItem("aip_certificates");
      resetEditalHistory();
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
      setSupabaseUser(null);
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleOpenDocPreview = (title: string, markdown: string, type: "proposal" | "declaration") => {
    setPreviewData({ title, markdown, type });
    setPreviewModalOpen(true);
  };

  if (!supabaseUser) {
    return (
      <SupabaseLoginScreen
        onLoginSuccess={(user) => {
          setSupabaseUser(user);
          loadUserDataFromSupabase(user);
        }}
      />
    );
  }

  const userInitial = supabaseUser?.email ? supabaseUser.email[0].toUpperCase() : "U";
  const userHandle = supabaseUser?.email?.split("@")[0] || "Usuário";

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" className="cursor-default hover:bg-transparent active:bg-transparent">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shrink-0">
                  <ShieldCheck className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold font-mono tracking-wide">HORASIS</span>
                  <span className="truncate text-xs text-muted-foreground">Licitações Inteligentes</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Principal</SidebarGroupLabel>
            <SidebarMenu>
              {CORE_NAV.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    id={`tab-btn-${item.id}`}
                    tooltip={item.label}
                    isActive={activeTab === item.id}
                    onClick={() => setActiveTab(item.id)}
                    className="cursor-pointer"
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>Operações</SidebarGroupLabel>
            <SidebarMenu>
              {OPERATIONS_NAV.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    id={`tab-btn-${item.id}`}
                    tooltip={item.label}
                    isActive={activeTab === item.id}
                    onClick={() => setActiveTab(item.id)}
                    className="cursor-pointer"
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>Configurações</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  id="tab-btn-ai-config"
                  tooltip="IA & Modelos"
                  isActive={activeTab === "aiConfig"}
                  onClick={() => setActiveTab("aiConfig")}
                  className="cursor-pointer"
                >
                  <Settings />
                  <span>IA &amp; Modelos</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <div className="group-data-[collapsible=icon]:hidden space-y-2 px-1 pb-1">
            {/* Active AI Selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="w-full cursor-pointer justify-between font-normal">
                  <span className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-primary animate-pulse" />
                    {AI_PROVIDER_LABELS[activeProvider] || activeProvider}
                  </span>
                  <ChevronsUpDown className="size-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
                {AI_PROVIDERS.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onClick={() => handleGlobalProviderChange(p.id)}
                    className="cursor-pointer justify-between"
                  >
                    <span>{p.name}</span>
                    {activeProvider === p.id && <Check className="size-3.5" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg" className="cursor-pointer data-[state=open]:bg-sidebar-accent">
                    <Avatar className="size-8 rounded-lg">
                      <AvatarFallback className="rounded-lg bg-primary text-primary-foreground font-semibold text-xs">
                        {userInitial}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">{userHandle}</span>
                      <span className="truncate text-xs text-muted-foreground">{supabaseUser?.email}</span>
                    </div>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                  side="top"
                  align="end"
                  sideOffset={4}
                >
                  <DropdownMenuLabel className="p-0 font-normal">
                    <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                      <Avatar className="size-8 rounded-lg">
                        <AvatarFallback className="rounded-lg bg-primary text-primary-foreground font-semibold text-xs">
                          {userInitial}
                        </AvatarFallback>
                      </Avatar>
                      <div className="grid flex-1 text-left text-sm leading-tight">
                        <span className="truncate font-medium">{userHandle}</span>
                        <span className="truncate text-xs text-muted-foreground">{supabaseUser?.email}</span>
                      </div>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => setActiveTab("aiConfig")} className="cursor-pointer">
                      <Settings />
                      IA &amp; Modelos
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSaaSSignOut} className="cursor-pointer text-destructive focus:text-destructive">
                    <LogOut />
                    Sair da Conta
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        {/* Top Bar Header */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b sticky top-0 z-30 bg-background">
          <div className="flex w-full items-center gap-2 px-4 lg:px-6">
            <SidebarTrigger className="-ml-1 cursor-pointer" />
            <Separator orientation="vertical" className="mx-1 h-4" />

            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-semibold font-mono tracking-tight shrink-0">HORASIS</span>
              <span className="text-sm text-muted-foreground shrink-0">/</span>
              <span className="text-sm font-medium text-foreground truncate">
                {TAB_LABELS[activeTab]}
              </span>
            </div>

            <div className="ml-auto flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer gap-1.5"
                onClick={() => window.dispatchEvent(new CustomEvent("aip_open_ai_chat", { detail: { editalId: activeEdital ? "active" : undefined } }))}
                title="Abrir Assessor IA"
              >
                <MessageSquare className="size-3.5 text-primary" />
                <span className="hidden sm:inline">Assessor IA</span>
              </Button>

              <Button
                size="sm"
                className="cursor-pointer"
                onClick={() => setActiveTab("analyzer")}
              >
                <FileText />
                <span className="hidden sm:inline">Analisar Novo Edital</span>
                <span className="sm:hidden">Novo Edital</span>
              </Button>

              <ThemeToggle />
            </div>
          </div>
        </header>

        {/* Content Stage Area */}
        <main className="flex-1 p-4 md:p-6">
          <div className="max-w-7xl mx-auto space-y-6">
            <div className="select-text w-full">
              <Suspense
                fallback={
                  <div className="flex items-center justify-center py-20 text-muted-foreground gap-2 text-sm">
                    <Loader2 className="size-5 animate-spin text-primary" />
                    <span>Carregando módulo...</span>
                  </div>
                }
              >
                {activeTab === "analyzer" ? (
                  <EditalAnalyzerTab
                    companyData={companyData}
                    activeEdital={activeEdital}
                    setActiveEdital={setActiveEdital}
                    onOpenDocPreview={handleOpenDocPreview}
                    onNavigateToCreateDoc={() => setActiveTab("createDoc")}
                    onNavigateToDisputas={() => setActiveTab("disputasSheet")}
                    onNavigateToHabilitacao={() => {
                      setDocsSubView("checklist");
                      setActiveTab("documents");
                    }}
                    onNavigateToCalculator={() => {
                      setCalcSubView("pricing");
                      setActiveTab("calculator");
                    }}
                    onNavigateToCapag={(focus) => {
                      setCapagFocusQuery(focus);
                      setActiveTab("capag");
                    }}
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
                    onNavigateToCapag={(focus) => {
                      setCapagFocusQuery(focus);
                      setActiveTab("capag");
                    }}
                  />
                ) : activeTab === "capag" ? (
                  <CapagSearchTab
                    initialFocusQuery={capagFocusQuery}
                    onClearInitialFocus={() => setCapagFocusQuery(null)}
                  />
                ) : activeTab === "disputasSheet" ? (
                  <DisputasSheetTab
                    activeEdital={activeEdital}
                    onNavigateToAnalyzer={() => setActiveTab("analyzer")}
                  />
                ) : activeTab === "documents" ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
                      <div className="flex items-center gap-2">
                        <ClipboardCheck className="size-4 text-primary" />
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          Central de Documentação &amp; Conformidade
                        </span>
                      </div>
                      <div className="flex items-center rounded-lg border border-border bg-muted p-1">
                        <Button
                          type="button"
                          variant={docsSubView === "certs" ? "default" : "ghost"}
                          size="sm"
                          onClick={() => setDocsSubView("certs")}
                          className="h-7 gap-1.5 px-3 text-xs font-semibold cursor-pointer"
                        >
                          <ListTodo className="size-3.5" />
                          Gestão de Certidões &amp; Empresa
                        </Button>
                        <Button
                          type="button"
                          variant={docsSubView === "checklist" ? "default" : "ghost"}
                          size="sm"
                          onClick={() => setDocsSubView("checklist")}
                          className="h-7 gap-1.5 px-3 text-xs font-semibold cursor-pointer"
                        >
                          <ClipboardCheck className="size-3.5" />
                          Checklist do Edital Ativo
                        </Button>
                      </div>
                    </div>

                    {docsSubView === "checklist" ? (
                      <HabilitacaoChecklistTab
                        activeEdital={activeEdital}
                        onNavigateToDocs={() => setDocsSubView("certs")}
                        onNavigateToCreateDoc={() => setActiveTab("createDoc")}
                        onNavigateToAnalyzer={() => setActiveTab("analyzer")}
                      />
                    ) : (
                      <CompanyDocsTab
                        companyData={companyData}
                        setCompanyData={setCompanyData}
                        activeEdital={activeEdital}
                      />
                    )}
                  </div>
                ) : activeTab === "calculator" ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
                      <div className="flex items-center gap-2">
                        <Calculator className="size-4 text-primary" />
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          Precificação &amp; Aderência Técnica
                        </span>
                      </div>
                      <div className="flex items-center rounded-lg border border-border bg-muted p-1">
                        <Button
                          type="button"
                          variant={calcSubView === "pricing" ? "default" : "ghost"}
                          size="sm"
                          onClick={() => setCalcSubView("pricing")}
                          className="h-7 gap-1.5 px-3 text-xs font-semibold cursor-pointer"
                        >
                          <Calculator className="size-3.5" />
                          Calculadora de Preços
                        </Button>
                        <Button
                          type="button"
                          variant={calcSubView === "comparator" ? "default" : "ghost"}
                          size="sm"
                          onClick={() => setCalcSubView("comparator")}
                          className="h-7 gap-1.5 px-3 text-xs font-semibold cursor-pointer"
                        >
                          <Sparkles className="size-3.5" />
                          Comparador Técnico de Produtos
                        </Button>
                      </div>
                    </div>

                    {calcSubView === "comparator" ? (
                      <ProductComparatorTab activeEdital={activeEdital} />
                    ) : (
                      <PricingCalculatorTab companyData={companyData} activeEdital={activeEdital} />
                    )}
                  </div>
                ) : activeTab === "createDoc" ? (
                  <CreateDocTab
                    companyData={companyData}
                    activeEdital={activeEdital}
                    onOpenDocPreview={handleOpenDocPreview}
                  />
                ) : activeTab === "notepad" ? (
                  <NotepadTab />
                ) : activeTab === "bot" ? (
                  <LanceBotTab activeEdital={activeEdital} />
                ) : activeTab === "aiConfig" ? (
                  <AiConfigTab />
                ) : (
                  <CompetitorAnalyzerTab activeEdital={activeEdital} />
                )}
              </Suspense>
            </div>
          </div>
        </main>
      </SidebarInset>

      {/* Dynamic Modal Previews */}
      <DocPreviewModal
        isOpen={previewModalOpen}
        onClose={() => setPreviewModalOpen(false)}
        title={previewData.title}
        initialMarkdown={previewData.markdown}
        type={previewData.type}
        onAddLog={() => {}}
      />

      {/* Bottom Floating Interactive Chat popup */}
      <FloatingAiChat
        companyData={companyData}
        activeEdital={activeEdital}
      />
    </SidebarProvider>
  );
}
