import { useState, useEffect } from "react";
import { Certificate, EditalAnalysis, CompanyData } from "../types";
import { 
  fetchCertificatesFromSupabase,
  saveCertificateToSupabase,
  deleteCertificateFromSupabase
} from "../utils/supabaseClient";
import { 
  FileText, Plus, Calendar, AlertTriangle, CheckCircle, Trash2, Edit2, ShieldCheck, 
  HelpCircle, RefreshCw, Layers, CheckSquare, Search, Building2, Landmark, Clock, FileWarning,
  FileUp, Loader2, GripVertical
} from "lucide-react";
import confetti from "canvas-confetti";
import { getActiveAiConfig, apiFetch } from "../utils/aiClientHelper";

// Dynamic real-time date extraction for comparative analysis (timezone-safe)
const getLocalTodayStr = (): string => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const SYSTEM_TODAY_STR = getLocalTodayStr();
const SYSTEM_TODAY = new Date();

// High-integrity timezone-safe status evaluation using local calendar days
const evaluateStatus = (expDateStr: string): "expired" | "expiring_soon" | "valid" => {
  if (!expDateStr) return "valid";
  
  const parts = expDateStr.split("-");
  if (parts.length !== 3) return "valid";
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // 0-indexed month
  const day = parseInt(parts[2], 10);
  
  // Set expiration date to the very end of that day (23:59:59.999) to cover the whole user expiration day fairly
  const expDate = new Date(year, month, day, 23, 59, 59, 999);
  
  // Set current date to the beginning of today for accurate whole-day math
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const diffTime = expDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) {
    return "expired";
  } else if (diffDays <= 15) {
    return "expiring_soon";
  } else {
    return "valid";
  }
};


// Pre-populate standard Colombian/Brazilian corporate certificates based strictly on user requirement (no fictitious dates, no uploaded state initially)
const INITIAL_CERTIFICATES: Certificate[] = [
  {
    id: "nd-estadual",
    name: "CND Estadual",
    emissionDate: "",
    expirationDate: "",
    status: "expired",
    notes: "Certidão de Regularidade Fiscal da Fazenda Estadual (SEFAZ).",
    fileUploaded: false
  },
  {
    id: "cnd-municipal",
    name: "CND Municipal",
    emissionDate: "",
    expirationDate: "",
    status: "expired",
    notes: "Certidão de Regularidade Fiscal da Fazenda Municipal (IPTU/ISS).",
    fileUploaded: false
  },
  {
    id: "cnd-falencia",
    name: "CND Falência e Concordata",
    emissionDate: "",
    expirationDate: "",
    status: "expired",
    notes: "Certidão Negativa de Falência, Recuperação Judicial e Concordata.",
    fileUploaded: false
  },
  {
    id: "cnd-receita-federal",
    name: "CND Receita Federal e INSS",
    emissionDate: "",
    expirationDate: "",
    status: "expired",
    notes: "Certidão Conjunta de Débitos Relativos a Tributos Federais e à Dívida Ativa da União e INSS.",
    fileUploaded: false
  },
  {
    id: "cnd-trabalhista",
    name: "CND Trabalhista",
    emissionDate: "",
    expirationDate: "",
    status: "expired",
    notes: "Certidão Negativa de Débitos Trabalhistas (CNDT).",
    fileUploaded: false
  },
  {
    id: "cnd-fgts",
    name: "CND FGTS",
    emissionDate: "",
    expirationDate: "",
    status: "expired",
    notes: "Certificado de Regularidade do FGTS (CRF) - Caixa Econômica Federal.",
    fileUploaded: false
  },
  {
    id: "sicaf",
    name: "SICAF",
    emissionDate: "",
    expirationDate: "",
    status: "expired",
    notes: "Certificado de Registro Cadastral (CRC) ativo no SICAF.",
    fileUploaded: false
  },
  {
    id: "cnpj",
    name: "CNPJ",
    emissionDate: "",
    expirationDate: "",
    status: "expired",
    notes: "Comprovante de Inscrição e de Situação Cadastral no CNPJ emitido pela Receita Federal.",
    fileUploaded: false
  },
  {
    id: "docs-socios",
    name: "Documentos dos Sócios",
    emissionDate: "",
    expirationDate: "",
    status: "expired",
    notes: "Cópia do RG, CPF, comprovante de residência e estado civil dos sócios/representante.",
    fileUploaded: false
  },
  {
    id: "inscricao-estadual",
    name: "Inscrição Estadual",
    emissionDate: "",
    expirationDate: "",
    status: "expired",
    notes: "Ficha de Inscrição Estadual (Sintegra / Cadastro de Contribuintes).",
    fileUploaded: false
  },
  {
    id: "ccmei",
    name: "CCMEI",
    emissionDate: "",
    expirationDate: "",
    status: "expired",
    notes: "Certificado da Condição de Microempreendedor Individual (CCMEI).",
    fileUploaded: false
  },
  {
    id: "inscricao-municipal",
    name: "Inscrição Municipal",
    emissionDate: "",
    expirationDate: "",
    status: "expired",
    notes: "Ficha de Inscrição Municipal imobilizada ou CCM.",
    fileUploaded: false
  },
  {
    id: "livro-contabil",
    name: "Livro Contábil",
    emissionDate: "",
    expirationDate: "",
    status: "expired",
    notes: "Livro Diário com balanço patrimonial assinado por contador habilitado.",
    fileUploaded: false
  },
  {
    id: "alvara",
    name: "Alvará de funcionamento",
    emissionDate: "",
    expirationDate: "",
    status: "expired",
    notes: "Licença de Funcionamento, Vigilância Sanitária e Certidão de Zoneamento se aplicável.",
    fileUploaded: false
  },
  {
    id: "atestados",
    name: "Atestados de Capacidade técnica",
    emissionDate: "",
    expirationDate: "",
    status: "expired",
    notes: "Atestado de capacidade técnica fornecido por pessoa jurídica de direito público ou privado.",
    fileUploaded: false
  }
];

interface CompanyDocsTabProps {
  companyData: CompanyData;
  setCompanyData: (data: CompanyData) => void;
  activeEdital: EditalAnalysis | null;
}

export default function CompanyDocsTab({ companyData, setCompanyData, activeEdital }: CompanyDocsTabProps) {
  const [certs, setCerts] = useState<Certificate[]>(() => {
    const saved = localStorage.getItem("aip_certificates");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Clean out any old fictional items, old contrato-social, and deleted outra-certidao
        const cleaned = parsed.filter((c: any) => 
          !c.id.startsWith("cert-") && 
          c.id !== "contrato-social" && 
          c.id !== "outra-certidao"
        );
        
        // Preserve the saved order in cleaned list
        const standardIdsInCleaned = new Set<string>();
        const orderedCerts: Certificate[] = [];

        cleaned.forEach((c: any) => {
          const standardCert = INITIAL_CERTIFICATES.find(m => m.id === c.id);
          if (standardCert) {
            orderedCerts.push({ ...standardCert, ...c });
            standardIdsInCleaned.add(c.id);
          } else {
            // Keep custom certificates
            orderedCerts.push(c);
          }
        });

        // Append any missing standard certificates that were not in the saved list yet
        INITIAL_CERTIFICATES.forEach(m => {
          if (!standardIdsInCleaned.has(m.id)) {
            orderedCerts.push(m);
          }
        });

        // RE-EVALUATE AND DYNAMICALLY UPDATE EXPIRED STATUSES OF STORED CERTS IN REAL TIME ACCORDING TO ACTUAL TODAY'S DATE!
        const evaluatedCerts = orderedCerts.map((c: any) => {
          if (c.fileUploaded && c.expirationDate) {
            return {
              ...c,
              status: evaluateStatus(c.expirationDate)
            };
          }
          return c;
        });

        return evaluatedCerts;
      } catch (e) {
        return INITIAL_CERTIFICATES;
      }
    }
    return INITIAL_CERTIFICATES;
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingCert, setEditingCert] = useState<Certificate | null>(null);
  
  // Extra loading/feedback states for IA document analysis
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [rowDraggingIndex, setRowDraggingIndex] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "expired" | "expiring_soon" | "valid" | "mismatched" | "pending">("all");

  // Form State
  const [formData, setFormData] = useState({
    name: "",
    emissionDate: "",
    expirationDate: "",
    notes: ""
  });

  // Compatibility Analysis State
  const [compatibilityResult, setCompatibilityResult] = useState<{
    score: number;
    warnings: string[];
    passes: string[];
    summary: string;
    loading: boolean;
  } | null>(null);

  // Load from Supabase on mount
  useEffect(() => {
    async function loadCerts() {
      try {
        const dbCerts = await fetchCertificatesFromSupabase();
        if (dbCerts && dbCerts.length > 0) {
          setCerts(dbCerts);
        }
      } catch (e) {
        console.warn("Erro ao carregar certidões do Supabase:", e);
      }
    }
    loadCerts();
  }, []);

  // Persistence
  useEffect(() => {
    localStorage.setItem("aip_certificates", JSON.stringify(certs));
    
    // Sync to Supabase in background
    certs.forEach(c => {
      saveCertificateToSupabase(c).catch(e => console.warn("Erro de sincronismo de certidão:", e));
    });
  }, [certs]);

  // Recalculate statuses on mount to ensure everything is perfectly in sync with the real current time
  useEffect(() => {
    setCerts(prev => {
      let changed = false;
      const updated = prev.map(c => {
        if (c.fileUploaded && c.expirationDate) {
          const currentStatus = evaluateStatus(c.expirationDate);
          if (c.status !== currentStatus) {
            changed = true;
            return { ...c, status: currentStatus };
          }
        }
        return c;
      });
      return changed ? updated : prev;
    });
  }, []);

  const handleCompanyChange = (field: keyof CompanyData, value: string) => {
    setCompanyData({ ...companyData, [field]: value });
  };

  const processCertFile = async (certId: string, file: File) => {
    setAnalyzingId(certId);
    setInfoMessage(null);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const base64String = (e.target?.result as string).split(",")[1];
        
        const response = await apiFetch("/api/analyze-cert", {
          method: "POST",
          body: {
            fileBase64: base64String,
            fileName: file.name,
            fileType: file.type || "application/pdf",
            docName: certs.find(c => c.id === certId)?.name || ""
          }
        });

        if (!response.ok) {
          throw new Error("Erro de processamento no servidor.");
        }

        const data = await response.json();
        const result = data.result;

        if (result) {
          const expirationDate = result.expirationDate || "";
          
          // Update cert state
          setCerts(prev => prev.map(c => {
            if (c.id === certId) {
              return {
                ...c,
                expirationDate,
                fileUploaded: true,
                fileName: file.name,
                documentMatchesRow: result.documentMatchesRow !== undefined ? result.documentMatchesRow : true,
                validationFeedback: result.validationFeedback || "Documento analisado.",
                status: expirationDate ? evaluateStatus(expirationDate) : "valid"
              };
            }
            return c;
          }));

          // Process and merge extracted company data
          if (result.extractedCompanyData) {
            const ext = result.extractedCompanyData;
            const updated = { ...companyData };
            let updatedKeys: string[] = [];

            if (ext.razonSocial && ext.razonSocial.trim() !== "") {
              updated.razonSocial = ext.razonSocial;
              updatedKeys.push("Razão Social");
            }
            if (ext.cnpj && ext.cnpj.trim() !== "") {
              updated.cnpj = ext.cnpj;
              updatedKeys.push("CNPJ");
            }
            if (ext.address && ext.address.trim() !== "") {
              updated.address = ext.address;
              updatedKeys.push("Endereço");
            }
            if (ext.phone && ext.phone.trim() !== "") {
              updated.phone = ext.phone;
              updatedKeys.push("Telefone");
            }
            if (ext.email && ext.email.trim() !== "") {
              updated.email = ext.email;
              updatedKeys.push("E-mail");
            }
            if (ext.representativeName && ext.representativeName.trim() !== "") {
              updated.representativeName = ext.representativeName;
              updatedKeys.push("Representante Legal");
            }
            if (ext.representativeCpf && ext.representativeCpf.trim() !== "") {
              updated.representativeCpf = ext.representativeCpf;
              updatedKeys.push("CPF Representante");
            }

            if (updatedKeys.length > 0) {
              setCompanyData(updated);
              setInfoMessage(`IA extraiu do documento e atualizou seu cadastro: ${updatedKeys.join(", ")}`);
              // Auto dismiss
              setTimeout(() => setInfoMessage(null), 10000);
            }
          }

          confetti({ particleCount: 65, spread: 60, origin: { y: 0.8 } });
        } else {
          alert("A IA analisou o arquivo, mas não retornou um formato de dados esperado.");
        }
      } catch (err: any) {
        console.error(err);
        alert("Erro na análise da IA. O arquivo foi anexado com sucesso para preenchimento manual.");
        // Fallback: mark as uploaded but allow user to specify a date manually by editing
        setCerts(prev => prev.map(c => {
          if (c.id === certId) {
            return {
              ...c,
              fileUploaded: true,
              fileName: file.name
            };
          }
          return c;
        }));
      } finally {
        setAnalyzingId(null);
      }
    };

    reader.onerror = () => {
      alert("Falha ao carregar arquivo de certidão.");
      setAnalyzingId(null);
    };

    reader.readAsDataURL(file);
  };

  const handleUploadFile = async (certId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await processCertFile(certId, file);
  };

  const handleDragOver = (e: React.DragEvent, certId: string) => {
    e.preventDefault();
    setDragOverId(certId);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverId(null);
  };

  const handleDrop = async (e: React.DragEvent, certId: string) => {
    e.preventDefault();
    setDragOverId(null);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processCertFile(certId, file);
    }
  };

  const handleRowDragStart = (e: React.DragEvent, index: number) => {
    setRowDraggingIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", index.toString());
  };

  const handleRowDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
  };

  const handleRowDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    
    // If it's a file drop, handle file upload instead of reordering
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const targetCert = filteredCerts[targetIndex];
      if (targetCert) {
        setDragOverId(null);
        const file = e.dataTransfer.files[0];
        processCertFile(targetCert.id, file);
      }
      return;
    }

    const sourceIndexStr = e.dataTransfer.getData("text/plain");
    const sourceIndex = sourceIndexStr ? parseInt(sourceIndexStr, 10) : rowDraggingIndex;
    
    if (sourceIndex === null || sourceIndex === undefined || isNaN(sourceIndex) || sourceIndex === targetIndex) {
      setRowDraggingIndex(null);
      return;
    }

    const sourceCert = filteredCerts[sourceIndex];
    const targetCert = filteredCerts[targetIndex];

    if (!sourceCert || !targetCert) {
      setRowDraggingIndex(null);
      return;
    }

    const mainSourceIdx = certs.findIndex(c => c.id === sourceCert.id);
    const mainTargetIdx = certs.findIndex(c => c.id === targetCert.id);

    if (mainSourceIdx > -1 && mainTargetIdx > -1) {
      const updated = [...certs];
      const [removed] = updated.splice(mainSourceIdx, 1);
      updated.splice(mainTargetIdx, 0, removed);
      setCerts(updated);
    }
    
    setRowDraggingIndex(null);
  };

  const handleAddOrEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.expirationDate) {
      alert("Por favor preencha ao menos Nome e Data de Vencimento.");
      return;
    }

    const calculatedStatus = evaluateStatus(formData.expirationDate);

    if (editingCert) {
      // Edit
      const updated = certs.map(c => 
        c.id === editingCert.id 
          ? { 
              ...c, 
              name: formData.name, 
              emissionDate: formData.emissionDate, 
              expirationDate: formData.expirationDate,
              notes: formData.notes,
              status: calculatedStatus 
            }
          : c
      );
      setCerts(updated);
      setEditingCert(null);
    } else {
      // Add
      const newCert: Certificate = {
        id: `cert-${Date.now()}`,
        name: formData.name,
        emissionDate: formData.emissionDate,
        expirationDate: formData.expirationDate,
        notes: formData.notes,
        status: calculatedStatus
      };
      setCerts([newCert, ...certs]);
    }

    setFormData({ name: "", emissionDate: "", expirationDate: "", notes: "" });
    setShowAddForm(false);
    confetti({ particleCount: 40, spread: 60, origin: { y: 0.8 } });
  };

  const startEdit = (cert: Certificate) => {
    setEditingCert(cert);
    setFormData({
      name: cert.name,
      emissionDate: cert.emissionDate,
      expirationDate: cert.expirationDate,
      notes: cert.notes || ""
    });
    setShowAddForm(true);
  };

  const deleteCert = (id: string) => {
    if (confirm("Tem certeza que deseja excluir esta certidão?")) {
      deleteCertificateFromSupabase(id).catch(e => console.warn("Erro ao deletar certidão do Supabase:", e));
      setCerts(certs.filter(c => c.id !== id));
    }
  };

  // Perform Gemini-driven Compatibility Analysis!
  const runCompatibilityAnalysis = async () => {
    if (!activeEdital) {
      alert("Por favor, faça primeiro o upload e análise de um edital na aba 'Análise de Edital'!");
      return;
    }

    setCompatibilityResult({
      score: 0,
      warnings: [],
      passes: [],
      summary: "",
      loading: true
    });

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: `
Aja como uma auditoria automatizada de licitações. Com base nas certidões que eu possuo atualmente, cruze os dados com as exigências técnicas e habilitatórias do Edital Analisado nesta sessão.
Verifique se a minha empresa está APTA ("Aprovada"), se há Pendências Contornáveis ou se a candidatura é INVIÁVEL ("Desqualificada") devido a certidões vencidas ou ausentes.

Nossas Certidões Cadastradas:
${certs.map(c => `- Nome: "${c.name}" | Status: ${c.status === "expired" ? "VENCIDA em " + c.expirationDate : c.status === "expiring_soon" ? "EXPIRA EM BREVE em " + c.expirationDate : "VÁLIDA até " + c.expirationDate}`).join("\n")}

Requisitos de Habilitação do Edital:
${activeEdital.documentosExigidos.map(d => `- Exigido: "${d}"`).join("\n")}

Responda em formato estruturado que possa ser exibido ao usuário. Sua resposta deve retornar rigorosamente um JSON estruturado com o seguinte esquema:
{
  "score": (número de 0 a 100 com o índice de aptidão da empresa),
  "summary": "Um resumo de 2 a 3 frases explicando a situação geral de conformidade frente ao edital.",
  "passes": [Lista de pontos de conformidade, exemplo: "Certidão de tributos federais está ativa e válida."],
  "warnings": [Lista de problemas, como documentos em falta, certidões vencidas ou vencendo em menos de 15 dias]
}

Tenha em mente que hoje é ${SYSTEM_TODAY_STR}. Se uma certidão está "Vencida" no cadastro, isso constitui um Warning urgente. Se faltar algum item clássico do edital, recomende como providenciá-lo.
Retorne exclusivamente o JSON estruturado.
`
            }
          ],
          companyData: companyData,
          activeEditalAnalysis: activeEdital
        })
      });

      const data = await response.json();
      const rawText = data.reply || "";
      
      // Extract json from markdown or raw text codeblock
      const cleanJson = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleanJson);

      setCompatibilityResult({
        score: parsed.score ?? 70,
        summary: parsed.summary || "Conformidade analisada com sucesso.",
        passes: parsed.passes || [],
        warnings: parsed.warnings || [],
        loading: false
      });

      if (parsed.score >= 80) {
        confetti({ particleCount: 80, spread: 80, colors: ["#10b981", "#3b82f6"] });
      }

    } catch (error) {
      console.error("Erro na análise de compatibilidade:", error);
      // Fallback local comparison if API fails or returns non-json
      const localWarnings: string[] = [];
      const localPasses: string[] = [];

      certs.forEach(c => {
        if (c.status === "expired") {
          localWarnings.push(`Certidão "${c.name}" expirou em ${c.expirationDate} e causará desclassificação técnica imediata.`);
        } else if (c.status === "expiring_soon") {
          localWarnings.push(`Certidão "${c.name}" expira em ${c.expirationDate} (menos de 15 dias).`);
        } else {
          localPasses.push(`Certidão "${c.name}" está válida e cobrirá eventuais exigências de seu tipo.`);
        }
      });

      // Simple heuristic check
      let missingCertsCount = 0;
      activeEdital.documentosExigidos.forEach(reqDoc => {
        const hasMatching = certs.some(c => c.name.toLowerCase().includes(reqDoc.toLowerCase()) || reqDoc.toLowerCase().includes(c.name.toLowerCase().substring(0, 15)));
        if (!hasMatching) {
          localWarnings.push(`Não encontramos em seu portfólio de certidões equivalência clara a: "${reqDoc}".`);
          missingCertsCount++;
        }
      });

      const finalScore = Math.max(10, 100 - (localWarnings.length * 20));

      setCompatibilityResult({
        score: finalScore,
        summary: `Hoje é ${SYSTEM_TODAY_STR}. Realizamos um cruzamento automatizado local de suas certidões com os requisitos exigidos no Pregão. Encontramos ${localWarnings.length} pontos de alerta críticos para sua atenção antes da habilitação.`,
        passes: localPasses.slice(0, 4),
        warnings: localWarnings,
        loading: false
      });
    }
  };

  // Filter certs
  const filteredCerts = certs.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      (c.notes && c.notes.toLowerCase().includes(searchQuery.toLowerCase()));
      
    if (!matchesSearch) return false;
    
    if (statusFilter === "all") return true;
    
    const isUploaded = !!c.fileUploaded;
    const status = evaluateStatus(c.expirationDate);
    
    if (statusFilter === "pending") {
      return !isUploaded;
    }
    if (statusFilter === "mismatched") {
      return isUploaded && c.documentMatchesRow === false;
    }
    if (statusFilter === "expired") {
      return isUploaded && (status === "expired" || c.documentMatchesRow === false);
    }
    if (statusFilter === "expiring_soon") {
      return isUploaded && status === "expiring_soon";
    }
    if (statusFilter === "valid") {
      return isUploaded && status === "valid" && c.documentMatchesRow !== false;
    }
    
    return true;
  });

  return (
    <div id="company-docs-tab" className="grid grid-cols-1 xl:grid-cols-3 gap-6 font-sans">
      
      {/* Col 1 & 2: Document Index */}
      <div className="xl:col-span-2 min-w-0 space-y-6">
        
        {/* Company Identity Profile */}
        <div id="company-profile" className="bg-white/5 border border-white/10 backdrop-blur-md rounded-xl p-5 shadow-lg relative overflow-hidden group">
          <div className="absolute top-0 right-0 h-[100px] w-[100px] bg-indigo-500/5 blur-[50px] pointer-events-none rounded-full" />
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 p-2.5 rounded-lg">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-white text-base">Dados Cadastrais da Empresa</h3>
                <p className="text-slate-400 text-xs">Informações jurídicas para auto-preenchimento de contratos e declarações</p>
              </div>
            </div>
            
            <div className="bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 rounded-full px-3 py-1 text-[11px] font-semibold flex items-center gap-1.5 self-start sm:self-auto shrink-0 shadow-inner">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
              </span>
              Auto-preenchimento por IA Ativo
            </div>
          </div>
          
          <div className="bg-gradient-to-r from-indigo-950/30 to-slate-900/40 border border-indigo-500/10 rounded-xl p-3.5 mb-5 text-xs text-slate-300 leading-relaxed flex items-start gap-3">
            <span className="text-indigo-400 text-lg select-none">✨</span>
            <div>
              <p className="font-semibold text-indigo-300 mb-0.5">Dica de Produtividade:</p>
              Ao fazer o upload de documentos como <strong className="text-white font-medium">Contrato Social</strong>, <strong className="text-white font-medium">CNPJ</strong> ou <strong className="text-white font-medium">Inscrição Estadual</strong> na tabela abaixo, a IA irá ler o arquivo, extrair as informações oficiais da sua empresa e <strong className="text-indigo-200">preencher estes campos automaticamente</strong> em tempo real!
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Razão Social / Nome da Empresa</label>
              <textarea 
                rows={1}
                value={companyData.razonSocial} 
                onChange={(e) => handleCompanyChange("razonSocial", e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-hidden focus:bg-slate-900/60 focus:ring-1 focus:ring-indigo-500 font-medium resize-none min-h-[40px] leading-relaxed"
                placeholder="Exemplo Ltda"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">CNPJ</label>
              <input 
                type="text" 
                value={companyData.cnpj} 
                onChange={(e) => handleCompanyChange("cnpj", e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-hidden focus:bg-slate-900/60 focus:ring-1 focus:ring-indigo-500 font-mono"
                placeholder="12.345.678/0001-90"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Representante Legal (Sócio / Diretor)</label>
              <input 
                type="text" 
                value={companyData.representativeName} 
                onChange={(e) => handleCompanyChange("representativeName", e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-hidden focus:bg-slate-900/60 focus:ring-1 focus:ring-indigo-500"
                placeholder="Nome do outorgado ou responsável"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">CPF do Representante</label>
              <input 
                type="text" 
                value={companyData.representativeCpf} 
                onChange={(e) => handleCompanyChange("representativeCpf", e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-hidden focus:bg-slate-900/60 focus:ring-1 focus:ring-indigo-500 font-mono"
                placeholder="123.456.789-00"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1">Endereço da Empresa</label>
              <textarea 
                rows={2}
                value={companyData.address} 
                onChange={(e) => handleCompanyChange("address", e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-hidden focus:bg-slate-900/60 focus:ring-1 focus:ring-indigo-500 resize-none min-h-[60px] leading-relaxed"
                placeholder="Av. Paulista, 1000 - Bela Vista, São Paulo - SP"
              />
            </div>
          </div>
        </div>

        {/* Certificate management */}
        <div className="bg-white/5 border border-white/10 backdrop-blur-md rounded-xl p-5 pr-8 md:pr-10 lg:pr-12 shadow-lg min-w-0 w-full overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 p-2.5 rounded-lg font-bold">
                <Landmark className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-white text-base">Certidões e Regularidade Fiscal</h3>
                <p className="text-slate-400 text-xs">Gestão temporal e controle automático de vencimento de certidões públicas</p>
              </div>
            </div>

            <button
              onClick={() => {
                setEditingCert(null);
                setFormData({ name: "", emissionDate: "", expirationDate: "", notes: "" });
                setShowAddForm(!showAddForm);
              }}
              className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-4 py-2 text-sm font-medium transition-all shadow-md shadow-emerald-950/50 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Nova Certidão
            </button>
          </div>

          {/* Add Form Accordion */}
          {showAddForm && (
            <form onSubmit={handleAddOrEdit} className="bg-white/5 rounded-xl border border-white/10 p-4 mb-6 space-y-4 animate-fade-in text-xs">
              <h4 className="font-semibold text-white text-sm flex items-center gap-2 border-b border-white/10 pb-2">
                <FileText className="w-4.5 h-4.5 text-emerald-400" />
                {editingCert ? "Editar Certidão Cadastrada" : "Adicionar Nova Certidão ao Cadastro"}
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-400 mb-1 font-sans">Nome Oficial da Certidão / Certificado</label>
                  <input 
                    type="text" 
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-hidden focus:bg-slate-900/60 focus:ring-1 focus:ring-emerald-500"
                    placeholder="Ex: Certidão Negativa de Tributos Estaduais - SEFAZ"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1 font-sans">Data de Emissão (Opcional)</label>
                  <input 
                    type="date" 
                    value={formData.emissionDate}
                    onChange={(e) => setFormData({ ...formData, emissionDate: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-hidden focus:bg-slate-900/60 focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1 font-sans">Data de Vencimento</label>
                  <input 
                    type="date" 
                    required
                    value={formData.expirationDate}
                    onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-rose-300 font-medium focus:outline-hidden focus:bg-slate-900/60 focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-400 mb-1 font-sans">Observações / Para que serve</label>
                  <textarea 
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-hidden focus:bg-slate-900/60 focus:ring-1 focus:ring-emerald-500"
                    rows={2}
                    placeholder="Ex: Utilizada para provar no pregão que não há débitos tributários tributos estaduais no estado sede."
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-4 py-2 text-xs text-slate-300 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-4 py-2 text-xs font-semibold transition-colors shadow-md shadow-emerald-950/25"
                >
                  {editingCert ? "Salvar Alterações" : "Adicionar ao Cadastro"}
                </button>
              </div>
            </form>
          )}

          {/* Info message for automatic AI-extracted data */}
          {infoMessage && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 px-4 py-3 rounded-xl mb-4 text-xs flex items-center gap-2.5 animate-pulse">
              <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{infoMessage}</span>
            </div>
          )}

          {/* Quick Status Filters */}
          <div className="mb-4">
            <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider font-mono">Organizar e Filtrar Certidões:</p>
            <div className="flex flex-wrap gap-1.5 p-1 bg-white/[0.03] border border-white/10 rounded-xl">
              <button
                type="button"
                onClick={() => setStatusFilter("all")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all flex items-center gap-1.5 ${
                  statusFilter === "all"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-950/40"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <span>Todas</span>
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                  statusFilter === "all" ? "bg-white/20 text-white" : "bg-white/5 text-slate-400"
                }`}>
                  {certs.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter("expired")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all flex items-center gap-1.5 ${
                  statusFilter === "expired"
                    ? "bg-rose-600 text-white shadow-md shadow-rose-950/40"
                    : "text-rose-400/80 hover:text-rose-300 hover:bg-rose-500/10"
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Vencidas / Alertas</span>
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                  statusFilter === "expired" ? "bg-white/20 text-white" : "bg-rose-500/10 text-rose-350"
                }`}>
                  {certs.filter(c => c.fileUploaded && (evaluateStatus(c.expirationDate) === "expired" || c.documentMatchesRow === false)).length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter("valid")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all flex items-center gap-1.5 ${
                  statusFilter === "valid"
                    ? "bg-emerald-600 text-white shadow-md shadow-emerald-950/40"
                    : "text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                }`}
              >
                <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Válidas</span>
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                  statusFilter === "valid" ? "bg-white/20 text-white" : "bg-emerald-500/10 text-emerald-350"
                }`}>
                  {certs.filter(c => c.fileUploaded && evaluateStatus(c.expirationDate) === "valid" && c.documentMatchesRow !== false).length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter("expiring_soon")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all flex items-center gap-1.5 ${
                  statusFilter === "expiring_soon"
                    ? "bg-amber-600 text-white shadow-md shadow-amber-950/40"
                    : "text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                }`}
              >
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>Expirando em Breve</span>
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                  statusFilter === "expiring_soon" ? "bg-white/20 text-white" : "bg-amber-500/10 text-amber-350"
                }`}>
                  {certs.filter(c => c.fileUploaded && evaluateStatus(c.expirationDate) === "expiring_soon").length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter("mismatched")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all flex items-center gap-1.5 ${
                  statusFilter === "mismatched"
                    ? "bg-orange-600 text-white shadow-md shadow-orange-950/40"
                    : "text-orange-400 hover:text-orange-300 hover:bg-orange-500/10"
                }`}
              >
                <HelpCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Incompatíveis</span>
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                  statusFilter === "mismatched" ? "bg-white/20 text-white" : "bg-orange-500/10 text-orange-350"
                }`}>
                  {certs.filter(c => c.fileUploaded && c.documentMatchesRow === false).length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter("pending")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all flex items-center gap-1.5 ${
                  statusFilter === "pending"
                    ? "bg-slate-700 text-white shadow-md shadow-slate-950/40"
                    : "text-slate-400 hover:text-slate-350 hover:bg-slate-500/10"
                }`}
              >
                <FileWarning className="w-3.5 h-3.5 shrink-0" />
                <span>Não Enviadas</span>
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                  statusFilter === "pending" ? "bg-white/20 text-white" : "bg-slate-500/10 text-slate-400"
                }`}>
                  {certs.filter(c => !c.fileUploaded).length}
                </span>
              </button>
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-2.5 h-4.5 w-4.5 text-slate-400" />
            <input 
              type="text" 
              placeholder="Buscar em minhas certidões pelo nome ou observação..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-white/5 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-hidden focus:bg-slate-900/60 focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Certificates List / Table Container */}
          <div id="certificates-table-wrapper" className="w-full min-w-0">
            
            {/* Mobile Card View (Hidden on medium/large screens) */}
            <div className="block md:hidden space-y-4">
              {filteredCerts.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs bg-white/5 border border-white/10 rounded-xl">
                  Nenhuma certidão encontrada correspondendo aos critérios de busca.
                </div>
              ) : (
                filteredCerts.map((cert, index) => {
                  const status = evaluateStatus(cert.expirationDate);
                  const isUploaded = !!cert.fileUploaded;
                  const isAnalyzing = analyzingId === cert.id;
                  const isDraggingOver = dragOverId === cert.id;
                  const isRowBeingDragged = rowDraggingIndex === index;

                  return (
                    <div
                      key={cert.id}
                      draggable={true}
                      onDragStart={(e) => handleRowDragStart(e, index)}
                      onDragOver={(e) => handleRowDragOver(e, index)}
                      onDrop={(e) => handleRowDrop(e, index)}
                      className={`transition-all duration-250 border rounded-xl p-4.5 space-y-3.5 relative overflow-hidden text-left ${
                        isRowBeingDragged
                          ? "opacity-40 bg-indigo-950/20 border-dashed border-indigo-500"
                          : isDraggingOver
                          ? "bg-indigo-600/15 border-dashed border-indigo-400/80 scale-[1.01] shadow-lg shadow-indigo-950/30"
                          : isUploaded
                          ? "bg-white/[0.03] border-white/10 hover:bg-white/5"
                          : "bg-transparent border-white/5 hover:bg-white/[0.01]"
                      }`}
                    >
                      {/* Top bar with drag position and main tag info */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          {/* Drag Handle button */}
                          <div 
                            className="flex items-center gap-1.5 bg-white/5 border border-white/10 px-2 py-1 rounded-md text-[10px] font-mono text-slate-400 cursor-grab active:cursor-grabbing hover:bg-white/10 shrink-0"
                            title="Arraste para reordenar"
                          >
                            <GripVertical className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            <span>#{index + 1}</span>
                          </div>
                          
                          <div className="min-w-0">
                            <h4 className={`font-semibold leading-snug text-xs sm:text-sm ${
                              isDraggingOver ? "text-indigo-300 animate-pulse" :
                              isUploaded ? "text-slate-100" : "text-slate-400"
                            }`}>
                              {isDraggingOver ? "✨ Solte o documento aqui!" : cert.name}
                            </h4>
                            {cert.notes && !isDraggingOver && (
                              <p className="text-slate-500 text-[11px] mt-1 leading-normal">{cert.notes}</p>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Attached Document Detail */}
                      {isUploaded && cert.fileName && !isDraggingOver && (
                        <div className="space-y-1.5 pt-0.5">
                          <div className="flex items-center gap-2 bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-2.5 text-[10.5px] text-emerald-400 font-mono truncate">
                            <FileText className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <span className="truncate">{cert.fileName}</span>
                          </div>
                          {cert.documentMatchesRow === false && cert.validationFeedback && (
                            <div className="text-[11px] text-orange-355 bg-orange-500/5 border border-orange-500/15 rounded-lg p-2.5 flex items-start gap-2 leading-normal">
                              <AlertTriangle className="w-3.5 h-3.5 text-orange-400 shrink-0 mt-0.5" />
                              <span>{cert.validationFeedback}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Status badges, expiration date, actions bar */}
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/10">
                        {/* Status indicators */}
                        <div className="flex items-center gap-2">
                          {isAnalyzing ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 text-indigo-300 px-2.5 py-0.5 text-[11px] font-semibold border border-indigo-500/20 animate-pulse">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Lendo...
                            </span>
                          ) : !isUploaded ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 text-slate-400 px-2.5 py-0.5 text-[11px] font-semibold border border-slate-500/20">
                              Pendente
                            </span>
                          ) : (
                            <>
                              {cert.documentMatchesRow === false ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 text-orange-355 px-2.5 py-0.5 text-[11px] font-semibold border border-orange-500/20">
                                  <AlertTriangle className="w-3 h-3 text-orange-450" />
                                  Tipo Errado
                                </span>
                              ) : (
                                <>
                                  {status === "expired" && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 text-rose-305 px-2.5 py-0.5 text-[11px] font-semibold border border-rose-500/20">
                                      Vencida
                                    </span>
                                  )}
                                  {status === "expiring_soon" && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 text-amber-305 px-2.5 py-0.5 text-[11px] font-semibold border border-amber-500/20">
                                      Expira Breve
                                    </span>
                                  )}
                                  {status === "valid" && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-305 px-2.5 py-0.5 text-[11px] font-semibold border border-emerald-500/20">
                                      Válida
                                    </span>
                                  )}
                                </>
                              )}
                            </>
                          )}
                        </div>

                        {/* Expiration date metadata */}
                        <div className="flex items-center gap-1 text-[11px] font-mono text-slate-400">
                          <span className="text-slate-500">Vencimento:</span>
                          <span className={isUploaded && status === "expired" ? "text-rose-400 font-bold" : isUploaded && status === "expiring_soon" ? "text-amber-405 font-semibold" : "text-slate-300"}>
                            {isAnalyzing ? "-" : !isUploaded ? "Pendente" : cert.expirationDate ? new Date(cert.expirationDate).getUTCDate() ? new Date(cert.expirationDate).getUTCDate().toString().padStart(2, '0') + '/' + (new Date(cert.expirationDate).getUTCMonth() + 1).toString().padStart(2, '0') + '/' + new Date(cert.expirationDate).getUTCFullYear() : new Date(cert.expirationDate).toLocaleDateString("pt-BR") : "Sem Vencimento"}
                          </span>
                        </div>

                        {/* Unified Action Button list */}
                        <div className="w-full sm:w-auto flex items-center justify-end gap-2 pt-2.5 sm:pt-0 border-t sm:border-t-0 border-white/5">
                          {isAnalyzing ? (
                            <span className="text-[11px] text-indigo-400 animate-pulse font-medium">Processando arquivo...</span>
                          ) : !isUploaded ? (
                            <label className="w-full sm:w-auto flex items-center justify-center gap-1.5 bg-indigo-600/15 hover:bg-indigo-600/25 border border-indigo-500/30 text-indigo-300 font-semibold rounded-lg px-3.5 py-2 text-[11px] transition duration-150 cursor-pointer shadow-sm">
                              <FileUp className="w-3.5 h-3.5" />
                              <span>Fazer Upload IA</span>
                              <input
                                type="file"
                                className="hidden"
                                accept=".pdf,.png,.jpg,.jpeg,.txt"
                                onChange={(e) => handleUploadFile(cert.id, e)}
                              />
                            </label>
                          ) : (
                            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                              <button
                                onClick={() => startEdit(cert)}
                                className="flex items-center justify-center gap-1 border border-white/10 hover:border-indigo-500/30 hover:bg-indigo-500/10 text-slate-300 hover:text-indigo-300 px-3 py-1.5 rounded-lg transition duration-150 cursor-pointer text-[11px]"
                              >
                                <Edit2 className="w-3 h-3" />
                                <span>Editar</span>
                              </button>
                              <button
                                onClick={() => {
                                  if (confirm("Deseja remover o arquivo e desativar este documento?")) {
                                    setCerts(prev => prev.map(c => c.id === cert.id ? { ...c, fileUploaded: false, fileName: undefined, expirationDate: "", emissionDate: "", status: "expired", documentMatchesRow: undefined, validationFeedback: undefined } : c));
                                  }
                                }}
                                className="flex items-center justify-center gap-1 bg-rose-500/10 border border-rose-500/20 text-rose-300 hover:bg-rose-500/20 px-3 py-1.5 rounded-lg transition duration-150 cursor-pointer text-[11px]"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Excluir</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Desktop Table View (Hidden on mobile/tablet) */}
            <div className="hidden md:block overflow-x-auto rounded-lg border border-white/10 w-full">
              <table className="w-full min-w-[700px] text-left text-sm whitespace-normal table-fixed">
                <thead className="bg-white/5 text-slate-300 border-b border-white/10 text-xs uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="p-2.5 w-[50px] text-center whitespace-nowrap shrink-0">Pos.</th>
                    <th className="p-2.5">Nome do Documento / Propósito</th>
                    <th className="p-2.5 w-[110px] text-center whitespace-nowrap shrink-0">Status</th>
                    <th className="p-2.5 w-[100px] text-center whitespace-nowrap shrink-0">Vencimento</th>
                    <th className="p-2.5 pl-2.5 pr-4 w-[130px] text-center whitespace-nowrap shrink-0">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {filteredCerts.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-400 text-xs">
                        Nenhuma certidão encontrada correspondendo aos critérios de busca.
                      </td>
                    </tr>
                  ) : (
                    filteredCerts.map((cert, index) => {
                      const status = evaluateStatus(cert.expirationDate);
                      const isUploaded = !!cert.fileUploaded;
                      const isAnalyzing = analyzingId === cert.id;
                      const isDraggingOver = dragOverId === cert.id;
                      const isRowBeingDragged = rowDraggingIndex === index;
                      
                      return (
                        <tr 
                          key={cert.id} 
                          draggable={true}
                          onDragStart={(e) => handleRowDragStart(e, index)}
                          onDragOver={(e) => handleRowDragOver(e, index)}
                          onDrop={(e) => handleRowDrop(e, index)}
                          className={`transition-all duration-200 relative ${
                            isRowBeingDragged
                              ? "opacity-40 bg-indigo-950/20 border-2 border-dashed border-indigo-500"
                              : isDraggingOver 
                              ? "bg-indigo-600/15 border-y-2 border-dashed border-indigo-400/80 scale-[1.005] shadow-lg shadow-indigo-950/30" 
                              : isUploaded 
                              ? "bg-white/[0.02] hover:bg-white/5 border border-transparent" 
                              : "bg-transparent hover:bg-white/[0.01] border border-transparent"
                          }`}
                        >
                          {/* Drag Handle Column */}
                          <td className="p-2.5 w-[50px] text-center cursor-grab active:cursor-grabbing hover:bg-white/5 transition-colors group/drag" title="Clique e arraste para reordenar esta certidão">
                            <div className="flex items-center justify-center text-slate-550 group-hover/drag:text-indigo-400">
                              <GripVertical className="w-4.5 h-4.5 shrink-0" />
                            </div>
                          </td>

                          <td className="p-2.5 min-w-0">
                            <div className="flex items-start gap-2">
                              <FileText className={`w-4 items-start shrink-0 mt-0.5 ${
                                isDraggingOver ? "text-indigo-400 animate-bounce" :
                                !isUploaded ? "text-slate-550" :
                                cert.documentMatchesRow === false ? "text-orange-400" :
                                status === "expired" ? "text-rose-450" :
                                status === "expiring_soon" ? "text-amber-400" : "text-emerald-450"
                              }`} />
                              <div className="min-w-0">
                                <p className={`font-medium leading-tight text-xs md:text-sm truncate ${
                                  isDraggingOver ? "text-indigo-300 font-semibold" :
                                  isUploaded ? "text-slate-100" : "text-slate-400 font-normal"
                                }`}>
                                  {isDraggingOver ? "✨ Solte o documento aqui!" : cert.name}
                                </p>
                                {isDraggingOver ? (
                                  <p className="text-indigo-400 font-normal text-[10px] mt-0.5 animate-pulse font-sans">
                                    Aceita PDF, imagens ou txt.
                                  </p>
                                ) : (
                                  cert.notes && <p className="text-slate-500 font-normal text-[11px] mt-0.5 md:leading-normal truncate">{cert.notes}</p>
                                )}
                                {isUploaded && cert.fileName && !isDraggingOver && (
                                  <div className="mt-1 space-y-1">
                                    <p className="text-[10px] text-emerald-400 font-mono flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 py-0.5 w-max truncate max-w-full">
                                      <span>📄 {cert.fileName}</span>
                                    </p>
                                    {cert.documentMatchesRow === false && cert.validationFeedback && (
                                      <div className="text-[10px] text-orange-355 bg-orange-500/10 border border-orange-500/20 rounded-lg p-1.5 flex items-start gap-1 leading-normal max-w-full">
                                        <AlertTriangle className="w-3 h-3 text-orange-400 shrink-0 mt-0.5 animate-pulse" />
                                        <span>{cert.validationFeedback}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          
                          <td className="p-2.5 w-[110px] text-center">
                            {isAnalyzing ? (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-indigo-500/10 text-indigo-300 px-1.5 py-0.5 text-[10px] font-semibold border border-indigo-500/20 animate-pulse">
                                <Loader2 className="w-3 h-3 shrink-0 animate-spin" />
                                Lendo...
                              </span>
                            ) : !isUploaded ? (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-500/10 text-slate-400 px-1.5 py-0.5 text-[10px] font-semibold border border-slate-500/20">
                                Pendente
                              </span>
                            ) : (
                              <>
                                {cert.documentMatchesRow === false ? (
                                  <span className="inline-flex items-center gap-0.5 rounded-full bg-orange-500/10 text-orange-355 px-1.5 py-0.5 text-[10px] font-semibold border border-orange-505/20" title={cert.validationFeedback}>
                                    <AlertTriangle className="w-3 h-3 shrink-0 text-orange-450" />
                                    Incompatível
                                  </span>
                                ) : (
                                  <>
                                    {status === "expired" && (
                                      <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-500/10 text-rose-305 px-1.5 py-0.5 text-[10px] font-semibold border border-rose-500/20">
                                        <AlertTriangle className="w-3 h-3 shrink-0" />
                                        Vencida
                                      </span>
                                    )}
                                    {status === "expiring_soon" && (
                                      <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/10 text-amber-305 px-1.5 py-0.5 text-[10px] font-semibold border border-amber-500/20">
                                        <Clock className="w-3 h-3 shrink-0 animate-pulse" />
                                        No Limite
                                      </span>
                                    )}
                                    {status === "valid" && (
                                      <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 text-emerald-305 px-1.5 py-0.5 text-[10px] font-semibold border border-emerald-500/20">
                                        <CheckCircle className="w-3 h-3 shrink-0" />
                                        Válida
                                      </span>
                                    )}
                                  </>
                                )}
                              </>
                            )}
                          </td>

                          <td className="p-2.5 w-[100px] text-center whitespace-nowrap">
                            {isAnalyzing ? (
                              <span className="text-slate-550 text-xs font-mono">-</span>
                            ) : !isUploaded ? (
                              <span className="text-slate-550 text-[11px] font-mono font-normal">Pendente</span>
                            ) : (
                              <span className={`text-[11px] font-medium font-mono ${
                                status === "expired" ? "text-rose-300 font-bold" :
                                status === "expiring_soon" ? "text-amber-305 font-semibold" : "text-slate-300"
                              }`}>
                                {cert.expirationDate ? new Date(cert.expirationDate).getUTCDate() ? new Date(cert.expirationDate).getUTCDate().toString().padStart(2, '0') + '/' + (new Date(cert.expirationDate).getUTCMonth() + 1).toString().padStart(2, '0') + '/' + new Date(cert.expirationDate).getUTCFullYear() : new Date(cert.expirationDate).toLocaleDateString("pt-BR") : "Sem Venc."}
                              </span>
                            )}
                          </td>

                          <td className="p-2.5 pl-2.5 pr-4 w-[130px] text-center whitespace-nowrap">
                            <div className="flex items-center justify-center gap-1">
                              {isAnalyzing ? (
                                <span className="text-[10px] text-indigo-400 font-medium animate-pulse">Lendo...</span>
                              ) : !isUploaded ? (
                                <label className="flex items-center justify-center gap-1 bg-indigo-600/15 hover:bg-indigo-600/25 border border-indigo-500/30 text-indigo-300 font-semibold rounded px-1.5 py-1 text-[10px] transition duration-150 cursor-pointer shadow-sm">
                                  <FileUp className="w-3 h-3" />
                                  <span>Upload</span>
                                  <input 
                                    type="file"
                                    className="hidden"
                                    accept=".pdf,.png,.jpg,.jpeg,.txt"
                                    onChange={(e) => handleUploadFile(cert.id, e)}
                                  />
                                </label>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => startEdit(cert)}
                                    className="text-slate-400 hover:text-indigo-400 p-1 hover:bg-white/5 rounded transition-colors cursor-pointer"
                                    title="Editar data ou informações de vencimento"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (confirm("Deseja remover o arquivo e desativar este documento?")) {
                                        setCerts(prev => prev.map(c => c.id === cert.id ? { ...c, fileUploaded: false, fileName: undefined, expirationDate: "", emissionDate: "", status: "expired", documentMatchesRow: undefined, validationFeedback: undefined } : c));
                                      }
                                    }}
                                    className="text-slate-400 hover:text-rose-450 p-1 hover:bg-rose-500/10 rounded transition-colors cursor-pointer"
                                    title="Remover arquivo carregado"
                                  >
                                    <Trash2 className="w-3.5 h-3.5 text-slate-550 hover:text-rose-400" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

          </div>
          
          {/* Note */}
          <div className="flex items-center gap-2 text-xs text-slate-400 mt-4 leading-normal">
            <span className="shrink-0 bg-white/5 border border-white/10 text-slate-300 w-4 h-4 rounded-full flex items-center justify-center font-bold">!</span>
            <span>A análise temporal de vigência é calculada dinamicamente com base na data do sistema consolidada em <strong>18 de Junho de 2026</strong>.</span>
          </div>

        </div>
      </div>

      {/* Col 3: Compatibility with active Edital */}
      <div className="space-y-6">
        
        {/* Active Edital Box Card */}
        <div className="bg-white/5 border border-white/10 backdrop-blur-md text-white rounded-xl shadow-lg p-6">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 p-2 rounded-lg">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-base">Edital em Seleção</h3>
              <p className="text-slate-400 text-xs">Exigências mapeadas</p>
            </div>
          </div>

          {activeEdital ? (
            <div className="space-y-4 font-sans">
              <div className="border-b border-white/10 pb-3">
                <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium">Pronto para Análise</span>
                <p className="font-medium text-slate-200 mt-2 text-sm leading-snug line-clamp-2">
                  {activeEdital.descricaoProduto}
                </p>
              </div>

              <div className="space-y-2.5">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                  <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
                  Habilitações Exigidas ({activeEdital.documentosExigidos.length})
                </p>
                <div className="max-h-36 overflow-y-auto space-y-1.5 text-xs text-slate-300 pr-1 select-none">
                  {activeEdital.documentosExigidos.map((doc, idx) => (
                    <div key={idx} className="flex gap-2 items-start py-0.5">
                      <span className="bg-white/10 border border-white/10 text-slate-300 rounded h-4 w-4 shrink-0 flex items-center justify-center text-[10px] font-bold">
                        {idx + 1}
                      </span>
                      <span className="leading-tight text-slate-200">{doc}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={runCompatibilityAnalysis}
                className="w-full bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 active:scale-[0.98] text-white font-semibold py-2.5 px-4 rounded-lg text-sm flex items-center justify-center gap-2 cursor-pointer transition-all shadow-md shadow-indigo-950/50 mt-2"
              >
                <ShieldCheck className="w-4.5 h-4.5" />
                Dossiê de Compatibilidade
              </button>
            </div>
          ) : (
            <div className="text-center py-6 space-y-3 font-sans">
              <FileWarning className="w-10 h-10 text-slate-600 mx-auto" />
              <p className="text-slate-400 text-xs leading-normal">
                Nenhum edital foi submetido ou analisado ainda na Aba de Análises.
              </p>
              <p className="text-[11px] text-slate-500">
                Faça o upload do documento na primeira aba para habilitar o analisador de compatibilidade de certidões corporativas.
              </p>
            </div>
          )}
        </div>

        {/* Compatibility Result Drawer */}
        {compatibilityResult && (
          <div className="bg-white/5 border border-white/10 backdrop-blur-md rounded-xl p-5 space-y-4 animate-fade-in text-white shadow-lg">
            {compatibilityResult.loading ? (
              <div className="py-8 text-center space-y-3">
                <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin mx-auto" />
                <p className="text-slate-200 text-xs font-medium">Processando certidões cadastrais no painel fiscal...</p>
                <p className="text-[11px] text-slate-400">Gemini cruzando validades tributárias com cláusulas habilitatórias.</p>
              </div>
            ) : (
              <div className="space-y-4 font-sans">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <h4 className="font-bold text-white text-sm flex items-center gap-1.5">
                    <ShieldCheck className="w-4.5 h-4.5 text-indigo-400" />
                    Resultado do Cruzamento
                  </h4>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-slate-400">Aptidão:</span>
                    <span className={`text-base font-extrabold ${
                      compatibilityResult.score >= 80 ? "text-emerald-400" :
                      compatibilityResult.score >= 50 ? "text-amber-400" : "text-rose-400"
                    }`}>
                      {compatibilityResult.score}%
                    </span>
                  </div>
                </div>

                {/* Score slider */}
                <div className="w-full bg-white/10 h-2.5 rounded-full overflow-hidden border border-white/5">
                  <div 
                    className={`h-full rounded-full transition-all duration-500 ${
                      compatibilityResult.score >= 80 ? "bg-emerald-500" :
                      compatibilityResult.score >= 50 ? "bg-amber-500" : "bg-rose-500"
                    }`}
                    style={{ width: `${compatibilityResult.score}%` }}
                  />
                </div>

                <p className="text-xs text-slate-200 leading-normal bg-white/5 rounded-lg p-3 border border-white/5">
                  {compatibilityResult.summary}
                </p>

                {/* Warnings / Reprovations */}
                {compatibilityResult.warnings.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold text-rose-300 uppercase tracking-wider flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      Alertas e Pendências ({compatibilityResult.warnings.length})
                    </p>
                    <ul className="space-y-2 text-xs text-slate-300">
                      {compatibilityResult.warnings.map((w, idx) => (
                        <li key={idx} className="flex gap-2 items-start bg-rose-500/10 p-2.5 rounded-md border border-rose-500/20">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0 mt-1.5" />
                          <span className="leading-snug text-rose-100">{w}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Passes / Approved Certs */}
                {compatibilityResult.passes.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-1">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                      Documentos em Conformidade ({compatibilityResult.passes.length})
                    </p>
                    <ul className="space-y-1.5 text-xs text-slate-300 pl-1">
                      {compatibilityResult.passes.map((p, idx) => (
                        <li key={idx} className="flex gap-2 items-start py-0.5">
                          <span className="w-1 h-1 rounded-full bg-emerald-500 shrink-0 mt-2" />
                          <span className="leading-tight text-slate-400">{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Footnote advice */}
                <div className="bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 rounded-lg p-3 text-xs leading-normal flex gap-2">
                  <HelpCircle className="w-5 h-5 text-indigo-400 shrink-0" />
                  <span>
                    Caso alguma certidão esteja vencida, você pode usar o <strong>Chat Assistente</strong> ao lado para pedir orientação de como emiti-la ou formalizar pedido de prorrogação regulamentar se aplicável.
                  </span>
                </div>

              </div>
            )}
          </div>
        )}

      </div>

    </div>
  );
}
