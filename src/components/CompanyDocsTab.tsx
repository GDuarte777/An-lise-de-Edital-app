import { useState, useEffect } from "react";
import { Certificate, EditalAnalysis, CompanyData } from "../types";
import { 
  fetchCertificatesFromSupabase,
  saveCertificateToSupabase,
  deleteCertificateFromSupabase,
  subscribeToSupabaseTable
} from "../utils/supabaseClient";
import { 
  FileText, Plus, Calendar, AlertTriangle, CheckCircle, Trash2, Edit2, ShieldCheck, 
  HelpCircle, RefreshCw, Layers, CheckSquare, Search, Building2, Landmark, Clock, FileWarning,
  FileUp, Loader2, GripVertical, SlidersHorizontal, Sparkles
} from "lucide-react";
import confetti from "canvas-confetti";
import { getActiveAiConfig, apiFetch, prepareAttachmentForServer, formatAiError } from "../utils/aiClientHelper";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./ui/table";

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
    name: "Documento de Identidade / CNH dos Sócios",
    emissionDate: "",
    expirationDate: "",
    status: "expired",
    notes: "Cópia da CNH, RG, CPF, comprovante de residência e estado civil dos sócios/representante.",
    fileUploaded: false
  },
  {
    id: "declaracao-simples-mei",
    name: "Declaração de Optante pelo Simples / MEI",
    emissionDate: "",
    expirationDate: "",
    status: "expired",
    notes: "Declaração ou Comprovante de Opção pelo Simples Nacional e Enquadramento como MEI.",
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

        // Apply default sorting if not manually ordered yet
        const isManuallyOrdered = localStorage.getItem("aip_certificates_manually_ordered") === "true";
        if (!isManuallyOrdered) {
          const uploaded = evaluatedCerts.filter(c => !!c.fileUploaded);
          const empty = evaluatedCerts.filter(c => !c.fileUploaded);
          return [...uploaded, ...empty];
        }

        return evaluatedCerts;
      } catch (e) {
        return INITIAL_CERTIFICATES;
      }
    }
    return INITIAL_CERTIFICATES;
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [hasManuallyOrdered, setHasManuallyOrdered] = useState<boolean>(() => {
    return localStorage.getItem("aip_certificates_manually_ordered") === "true";
  });

  useEffect(() => {
    localStorage.setItem("aip_certificates_manually_ordered", String(hasManuallyOrdered));
  }, [hasManuallyOrdered]);

  // Auto-sort certs if they have not been manually ordered
  useEffect(() => {
    if (!hasManuallyOrdered && certs.length > 0) {
      // Check if they are already correctly grouped (all fileUploaded === true are before fileUploaded === false)
      let isSorted = true;
      let seenEmpty = false;
      for (const c of certs) {
        const hasFile = !!c.fileUploaded;
        if (hasFile) {
          if (seenEmpty) {
            isSorted = false;
            break;
          }
        } else {
          seenEmpty = true;
        }
      }

      if (!isSorted) {
        const uploaded = certs.filter(c => !!c.fileUploaded);
        const empty = certs.filter(c => !c.fileUploaded);
        setCerts([...uploaded, ...empty]);
      }
    }
  }, [certs, hasManuallyOrdered]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingCert, setEditingCert] = useState<Certificate | null>(null);
  
  // Extra loading/feedback states for IA document analysis
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const triggerAlert = (msg: string) => {
    setErrorMessage(msg);
    // Auto dismiss after 8 seconds
    setTimeout(() => {
      setErrorMessage(prev => prev === msg ? null : prev);
    }, 8000);
  };

  const triggerConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmDialog({
      title,
      message,
      onConfirm
    });
  };

  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [rowDraggingIndex, setRowDraggingIndex] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "expired" | "expiring_soon" | "valid" | "mismatched" | "pending">("all");
  const [isGeneratingNotes, setIsGeneratingNotes] = useState(false);

  const generateNotesWithAi = async (nameToUse?: string) => {
    const title = nameToUse || formData.name;
    if (!title || !title.trim()) return;

    setIsGeneratingNotes(true);
    try {
      const response = await apiFetch("/api/generate-cert-description", {
        method: "POST",
        body: { name: title }
      });
      if (response.ok) {
        const data = await response.json();
        if (data.description) {
          setFormData(prev => ({
            ...prev,
            notes: data.description
          }));
        }
      }
    } catch (error) {
      console.warn("Erro ao gerar descrição com IA:", error);
    } finally {
      setIsGeneratingNotes(false);
    }
  };

  const handleNameBlur = () => {
    if (formData.name && formData.name.trim() && !formData.notes.trim()) {
      generateNotesWithAi(formData.name);
    }
  };

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

  // Load from Supabase on mount and listen to realtime updates
  useEffect(() => {
    async function loadCerts() {
      try {
        const dbCerts = await fetchCertificatesFromSupabase();
        if (dbCerts && Array.isArray(dbCerts)) {
          setCerts(prev => {
            // Build a map of DB certs for quick lookup
            const dbMap = new Map(dbCerts.map(d => [d.id, d]));

            // Reupload local certs that are NOT in DB (created offline)
            prev.forEach(local => {
              if (!dbMap.has(local.id)) {
                saveCertificateToSupabase(local).catch(() => {});
              }
            });

            // Build final list: DB rows as source of truth, preserving local file data if present
            const prevMap = new Map(prev.map(c => [c.id, c]));
            const finalCerts = dbCerts.map(db => {
              const local = prevMap.get(db.id);
              return {
                ...db,
                // Preserve local file reference if the db doesn't have it
                fileUploaded: db.fileUploaded !== undefined ? !!db.fileUploaded : !!local?.fileUploaded,
                fileName: db.fileName || local?.fileName || "",
                status: db.expirationDate ? evaluateStatus(db.expirationDate) : (db.status || "valid")
              };
            });

            return finalCerts;
          });
        }
      } catch (e) {
        console.warn("Erro ao carregar certidões do Supabase:", e);
      }
    }
    loadCerts();

    const unsubscribe = subscribeToSupabaseTable("certidoes_fiscais", () => {
      loadCerts();
    });

    const handleFocus = () => loadCerts();
    window.addEventListener("focus", handleFocus);

    return () => {
      unsubscribe();
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  // Persistence
  useEffect(() => {
    localStorage.setItem("aip_certificates", JSON.stringify(certs));
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

  const compressImageIfNeeded = (file: File): Promise<File | Blob> => {
    return new Promise((resolve) => {
      if (!file.type || !file.type.startsWith("image/")) {
        resolve(file);
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1600;
          let width = img.width;
          let height = img.height;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => {
              if (blob) {
                resolve(blob);
              } else {
                resolve(file);
              }
            }, "image/jpeg", 0.85);
          } else {
            resolve(file);
          }
        };
        img.onerror = () => resolve(file);
        img.src = e.target?.result as string;
      };
      reader.onerror = () => resolve(file);
      reader.readAsDataURL(file);
    });
  };

  const processCertFile = async (certId: string, file: File) => {
    setAnalyzingId(certId);
    setInfoMessage(null);

    try {
      const processedFile = await compressImageIfNeeded(file);
      const reader = new FileReader();
      
      reader.onload = async (e) => {
        try {
          const base64String = (e.target?.result as string).split(",")[1];
          const resolvedFileType = file.type.startsWith("image/") ? "image/jpeg" : (file.type || "application/pdf");
          const prepared = await prepareAttachmentForServer({
            base64: base64String,
            name: file.name,
            type: resolvedFileType
          });

          const response = await apiFetch("/api/analyze-cert", {
            method: "POST",
            body: {
              ...prepared,
              fileBase64: base64String,
              fileName: file.name,
              fileType: resolvedFileType,
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
            
            const targetCert = certs.find(c => c.id === certId);
            const updatedCert = {
              ...targetCert,
              id: certId,
              name: targetCert?.name || "",
              notes: targetCert?.notes || "",
              expirationDate,
              fileUploaded: true,
              fileName: file.name,
              documentMatchesRow: result.documentMatchesRow !== undefined ? result.documentMatchesRow : true,
              validationFeedback: result.validationFeedback || "Documento analisado.",
              status: expirationDate ? evaluateStatus(expirationDate) : "valid"
            };

            // Update cert state
            setCerts(prev => prev.map(c => c.id === certId ? updatedCert : c));

            // Sync instantly to Supabase
            saveCertificateToSupabase(updatedCert).catch(err => console.warn("Erro ao salvar anexo no Supabase:", err));

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
            triggerAlert("A IA analisou o arquivo, mas não retornou um formato de dados esperado.");
          }
        } catch (err: any) {
          console.error(err);
          const errMsg = formatAiError(err);
          triggerAlert(`Erro na análise da IA: ${errMsg}\n\nO arquivo foi salvo com sucesso — preencha os dados manualmente.`);
          // Fallback: mark as uploaded but allow user to specify a date manually by editing
          const targetCert = certs.find(c => c.id === certId);
          const fallbackCert = {
            ...targetCert,
            id: certId,
            name: targetCert?.name || "",
            notes: targetCert?.notes || "",
            fileUploaded: true,
            fileName: file.name,
            documentMatchesRow: undefined,
            validationFeedback: undefined,
            status: targetCert?.status || "valid"
          };
          setCerts(prev => prev.map(c => c.id === certId ? fallbackCert : c));
          saveCertificateToSupabase(fallbackCert).catch(err => console.warn("Erro ao salvar anexo fallback no Supabase:", err));
        } finally {
          setAnalyzingId(null);
        }
      };

      reader.onerror = () => {
        triggerAlert("Falha ao carregar arquivo de certidão.");
        setAnalyzingId(null);
      };

      reader.readAsDataURL(processedFile as File);
    } catch (compressErr) {
      console.warn("Error compressing image client-side:", compressErr);
      // fallback to original file if compression fails
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
          if (!response.ok) throw new Error("Erro de processamento.");
          const data = await response.json();
          const result = data.result;
          if (result) {
            const expirationDate = result.expirationDate || "";
            const targetCert = certs.find(c => c.id === certId);
            const updatedCert = {
              ...targetCert,
              id: certId,
              name: targetCert?.name || "",
              notes: targetCert?.notes || "",
              expirationDate,
              fileUploaded: true,
              fileName: file.name,
              documentMatchesRow: result.documentMatchesRow !== undefined ? result.documentMatchesRow : true,
              validationFeedback: result.validationFeedback || "Documento analisado.",
              status: expirationDate ? evaluateStatus(expirationDate) : "valid"
            };
            setCerts(prev => prev.map(c => c.id === certId ? updatedCert : c));
            saveCertificateToSupabase(updatedCert).catch(err => console.warn(err));
          }
        } catch (err) {
          console.error(err);
        } finally {
          setAnalyzingId(null);
        }
      };
      reader.readAsDataURL(file);
    }
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
      setHasManuallyOrdered(true);
      setCerts(updated);
    }
    
    setRowDraggingIndex(null);
  };

  const handleAddOrEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.name.trim()) {
      triggerAlert("Por favor preencha ao menos o Nome Oficial da Certidão.");
      return;
    }

    let finalNotes = formData.notes;
    let finalExpirationDate = formData.expirationDate || "";
    let finalEmissionDate = formData.emissionDate || "";

    setIsGeneratingNotes(true);
    // If notes is empty, generate notes automatically with IA
    if (!finalNotes || !finalNotes.trim()) {
      try {
        const response = await apiFetch("/api/generate-cert-description", {
          method: "POST",
          body: { name: formData.name }
        });
        if (response.ok) {
          const data = await response.json();
          if (data.description) {
            finalNotes = data.description;
          }
        }
      } catch (err) {
        console.warn("Erro ao gerar descrição automática com IA no submit:", err);
      }
    }
    setIsGeneratingNotes(false);

    if (!finalNotes || !finalNotes.trim()) {
      finalNotes = `Documento ou certidão para comprovar os requisitos de "${formData.name}" no processo licitatório.`;
    }

    const calculatedStatus = evaluateStatus(finalExpirationDate);

    if (editingCert) {
      // Edit
      const updatedItem = { 
        ...editingCert, 
        name: formData.name, 
        emissionDate: finalEmissionDate, 
        expirationDate: finalExpirationDate,
        notes: finalNotes,
        status: calculatedStatus,
        documentMatchesRow: undefined,
        validationFeedback: undefined
      };
      
      const updated = certs.map(c => 
        c.id === editingCert.id ? updatedItem : c
      );
      setCerts(updated);
      setEditingCert(null);
      
      // Sync instantly
      saveCertificateToSupabase(updatedItem).catch(err => console.warn("Erro ao salvar edição no Supabase:", err));
    } else {
      // Add
      const newCert: Certificate = {
        id: `cert-${Date.now()}`,
        name: formData.name,
        emissionDate: finalEmissionDate,
        expirationDate: finalExpirationDate,
        notes: finalNotes,
        status: calculatedStatus,
        fileUploaded: false
      };
      setCerts([newCert, ...certs]);
      
      // Sync instantly
      saveCertificateToSupabase(newCert).catch(err => console.warn("Erro ao salvar nova certidão no Supabase:", err));
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
    triggerConfirm(
      "Confirmar Exclusão",
      "Tem certeza que deseja excluir esta certidão personalizada?",
      () => {
        deleteCertificateFromSupabase(id).catch(e => console.warn("Erro ao deletar certidão do Supabase:", e));
        setCerts(prev => prev.filter(c => c.id !== id));
      }
    );
  };

  const handleDeleteAttachment = async (certId: string) => {
    const isStandard = INITIAL_CERTIFICATES.some(c => c.id === certId);
    
    if (isStandard) {
      triggerConfirm(
        "Remover Anexo",
        "Deseja remover o arquivo anexo deste documento?",
        async () => {
          const updatedCerts = certs.map(c => 
            c.id === certId 
              ? { 
                  ...c, 
                  fileUploaded: false, 
                  fileName: undefined, 
                  expirationDate: "", 
                  emissionDate: "", 
                  status: "expired" as const, 
                  documentMatchesRow: undefined, 
                  validationFeedback: undefined 
                } 
              : c
          );
          setCerts(updatedCerts);

          // Instantly sync this deleted/cleared state to Supabase so that it is updated immediately
          const certToUpdate = updatedCerts.find(c => c.id === certId);
          if (certToUpdate) {
            try {
              const res = await saveCertificateToSupabase(certToUpdate);
              if (res.success) {
                setInfoMessage("Anexo removido e sincronizado no Supabase com sucesso!");
                setTimeout(() => setInfoMessage(null), 5000);
              } else {
                console.warn("Erro ao salvar exclusão no Supabase:", res.message);
              }
            } catch (e) {
              console.error("Erro técnico ao salvar exclusão no Supabase:", e);
            }
          }
        }
      );
    } else {
      triggerConfirm(
        "Excluir Certidão",
        "Deseja excluir esta certidão personalizada por completo?",
        async () => {
          try {
            const success = await deleteCertificateFromSupabase(certId);
            if (success) {
              setCerts(prev => prev.filter(c => c.id !== certId));
              setInfoMessage("Certidão personalizada removida do Supabase com sucesso!");
              setTimeout(() => setInfoMessage(null), 5000);
            } else {
              // Fallback local deletion if Supabase delete fails or isn't fully configured
              setCerts(prev => prev.filter(c => c.id !== certId));
              console.warn("Erro ao deletar certidão do Supabase, removido localmente.");
            }
          } catch (e) {
            console.error("Erro ao deletar certidão:", e);
            setCerts(prev => prev.filter(c => c.id !== certId));
          }
        }
      );
    }
  };

  const handleManualApprove = async (certId: string) => {
    const updatedCerts = certs.map(c => 
      c.id === certId 
        ? { 
            ...c, 
            documentMatchesRow: true, 
            validationFeedback: "Aprovado manualmente pelo usuário como compatível." 
          } 
        : c
    );
    setCerts(updatedCerts);
    
    const certToUpdate = updatedCerts.find(c => c.id === certId);
    if (certToUpdate) {
      try {
        const res = await saveCertificateToSupabase(certToUpdate);
        if (res.success) {
          setInfoMessage("Documento aprovado manualmente com sucesso!");
          setTimeout(() => setInfoMessage(null), 4000);
        }
      } catch (err) {
        console.warn("Erro ao salvar aprovação manual no Supabase:", err);
      }
    }
  };

  // Perform Gemini-driven Compatibility Analysis!
  const runCompatibilityAnalysis = async () => {
    if (!activeEdital) {
      triggerAlert("Por favor, faça primeiro o upload e análise de um edital na aba 'Análise de Edital'!");
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
      const response = await apiFetch("/api/chat", {
        method: "POST",
        body: {
          messages: [
            {
              role: "user",
              content: `
Aja como uma auditoria automatizada de licitações. Com base nas certidões que eu possuo atualmente, cruze os dados com as exigências técnicas e habilitatórias do Edital Analisado nesta sessão.
Verifique se a minha empresa está APTA ("Aprovada"), se há Pendências Contornáveis ou se a candidatura é INVIÁVEL ("Desqualificada") devido a certidões vencidas ou ausentes.

Nossas Certidões Cadastradas:
${certs.map(c => `- Nome: "${c.name}" | Status: ${c.status === "expired" ? "VENCIDA em " + c.expirationDate : c.status === "expiring_soon" ? "VENCENDO em " + c.expirationDate : "VÁLIDA até " + c.expirationDate}`).join("\n")}

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
        }
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
    <div id="company-docs-tab" className="space-y-6 font-sans">
      
      {/* Col 1 & 2: Document Index */}
      <div className="w-full min-w-0 space-y-6">
        
        {/* Company Identity Profile */}
        <Card id="company-profile" className="block p-5 gap-0 relative overflow-hidden group">

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-4 border-b">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 text-primary border border-primary/20 p-2.5 rounded-lg">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground text-base">Dados Cadastrais da Empresa</h3>
                <p className="text-muted-foreground text-xs">Informações jurídicas para auto-preenchimento de contratos e declarações</p>
              </div>
            </div>

            <div className="bg-primary/10 border border-primary/20 text-primary rounded-full px-3 py-1 text-[11px] font-semibold flex items-center gap-1.5 self-start sm:self-auto shrink-0 shadow-xs">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              Auto-preenchimento por IA Ativo
            </div>
          </div>

          <div className="bg-primary/5 border border-primary/20 rounded-xl p-3.5 mb-5 text-xs text-foreground leading-relaxed flex items-start gap-3">
            <span className="text-primary text-lg select-none">✨</span>
            <div>
              <p className="font-semibold text-primary mb-0.5">Dica de Produtividade:</p>
              Ao fazer o upload de documentos como <strong className="text-foreground font-medium">Contrato Social</strong>, <strong className="text-foreground font-medium">CNPJ</strong> ou <strong className="text-foreground font-medium">Inscrição Estadual</strong> na tabela abaixo, a IA irá ler o arquivo, extrair as informações oficiais da sua empresa e <strong className="text-primary">preencher estes campos automaticamente</strong> em tempo real!
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <Label className="block text-xs font-medium text-muted-foreground mb-1">Razão Social / Nome da Empresa</Label>
              <Textarea
                rows={1}
                value={companyData.razonSocial}
                onChange={(e) => handleCompanyChange("razonSocial", e.target.value)}
                className="font-medium resize-none min-h-[40px] leading-relaxed"
                placeholder="Exemplo Ltda"
              />
            </div>
            <div>
              <Label className="block text-xs font-medium text-muted-foreground mb-1">CNPJ</Label>
              <Input
                type="text"
                value={companyData.cnpj}
                onChange={(e) => handleCompanyChange("cnpj", e.target.value)}
                className="font-mono"
                placeholder="12.345.678/0001-90"
              />
            </div>
            <div>
              <Label className="block text-xs font-medium text-muted-foreground mb-1">Representante Legal (Sócio / Diretor)</Label>
              <Input
                type="text"
                value={companyData.representativeName}
                onChange={(e) => handleCompanyChange("representativeName", e.target.value)}
                placeholder="Nome do outorgado ou responsável"
              />
            </div>
            <div>
              <Label className="block text-xs font-medium text-muted-foreground mb-1">CPF do Representante</Label>
              <Input
                type="text"
                value={companyData.representativeCpf}
                onChange={(e) => handleCompanyChange("representativeCpf", e.target.value)}
                className="font-mono"
                placeholder="123.456.789-00"
              />
            </div>
            <div className="md:col-span-2">
              <Label className="block text-xs font-medium text-muted-foreground mb-1">Endereço da Empresa</Label>
              <Textarea
                rows={2}
                value={companyData.address}
                onChange={(e) => handleCompanyChange("address", e.target.value)}
                className="resize-none min-h-[60px] leading-relaxed"
                placeholder="Av. Paulista, 1000 - Bela Vista, São Paulo - SP"
              />
            </div>
          </div>
        </Card>

        {/* Certificate management */}
        <Card className="block p-5 pr-8 md:pr-10 lg:pr-12 gap-0 min-w-0 w-full overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="bg-success/10 text-success border border-success/30 p-2.5 rounded-lg font-bold">
                <Landmark className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground text-base">Certidões e Regularidade Fiscal</h3>
                <p className="text-muted-foreground text-xs">Gestão temporal e controle automático de vencimento de certidões públicas</p>
              </div>
            </div>

            <Button
              onClick={() => {
                setEditingCert(null);
                setFormData({ name: "", emissionDate: "", expirationDate: "", notes: "" });
                setShowAddForm(!showAddForm);
              }}
              className="cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Nova Certidão
            </Button>
          </div>

          {/* Add Form Accordion */}
          {showAddForm && (
            <form onSubmit={handleAddOrEdit} className="bg-muted/40 rounded-xl border p-4 mb-6 space-y-4 animate-fade-in text-xs">
              <h4 className="font-semibold text-foreground text-sm flex items-center gap-2 border-b pb-2">
                <FileText className="w-4.5 h-4.5 text-primary" />
                {editingCert ? "Editar Certidão Cadastrada" : "Adicionar Nova Certidão ao Cadastro"}
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <Label className="block text-xs font-medium text-muted-foreground mb-1 font-sans">Nome Oficial da Certidão / Certificado</Label>
                  <Input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    onBlur={handleNameBlur}
                    className="bg-background"
                    placeholder="Ex: Certidão Negativa de Tributos Estaduais - SEFAZ"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Ao sair deste campo ou salvar, a IA definirá a descrição automaticamente se deixada em branco.</p>
                </div>

                <div>
                  <Label className="block text-xs font-medium text-muted-foreground mb-1 font-sans">Data de Emissão (Opcional)</Label>
                  <Input
                    type="date"
                    value={formData.emissionDate}
                    onChange={(e) => setFormData({ ...formData, emissionDate: e.target.value })}
                    className="bg-background"
                  />
                </div>

                <div>
                  <Label className="block text-xs font-medium text-muted-foreground mb-1 font-sans">Data de Vencimento (Opcional)</Label>
                  <Input
                    type="date"
                    value={formData.expirationDate}
                    onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })}
                    className="bg-background text-destructive font-medium"
                  />
                </div>

                <div className="md:col-span-2">
                  <div className="flex items-center justify-between mb-1">
                    <Label className="block text-xs font-medium text-muted-foreground font-sans">Observações / Para que serve</Label>
                    {formData.name && formData.name.trim() && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => generateNotesWithAi()}
                        disabled={isGeneratingNotes}
                        className="h-auto text-[10px] text-primary hover:text-primary/80 flex items-center gap-1 bg-primary/10 hover:bg-primary/15 px-2 py-0.5 rounded-md transition-colors cursor-pointer font-semibold"
                      >
                        <Sparkles className={`w-3 h-3 ${isGeneratingNotes ? "animate-spin" : "animate-pulse"}`} />
                        {isGeneratingNotes ? "Descrevendo..." : "Sugerir com IA"}
                      </Button>
                    )}
                  </div>
                  <Textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="bg-background"
                    rows={2}
                    placeholder="Ex: Utilizada para provar no pregão que não há débitos tributários tributos estaduais no estado sede."
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAddForm(false)}
                  className="text-xs"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  className="text-xs font-semibold"
                >
                  {editingCert ? "Salvar Alterações" : "Adicionar ao Cadastro"}
                </Button>
              </div>
            </form>
          )}

          {/* Info message for automatic AI-extracted data */}
          {infoMessage && (
            <div className="bg-success/10 border border-success/20 text-success px-4 py-3 rounded-xl mb-4 text-xs flex items-center gap-2.5 animate-pulse">
              <CheckCircle className="w-4 h-4 shrink-0 text-success" />
              <span>{infoMessage}</span>
            </div>
          )}

          {/* Error message for alerts/failures */}
          {errorMessage && (
            <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-xl mb-4 text-xs flex items-center justify-between gap-2.5">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 text-destructive" />
                <span>{errorMessage}</span>
              </div>
              <button
                onClick={() => setErrorMessage(null)}
                className="text-destructive hover:text-destructive/80 text-[10px] uppercase tracking-wider font-semibold cursor-pointer"
              >
                Fechar
              </button>
            </div>
          )}

          {/* Quick Status Filters */}
          <div className="mb-4">
            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider font-mono">Organizar e Filtrar Certidões:</p>
            <div className="flex flex-wrap gap-1.5 p-1 bg-muted/40 border rounded-xl">
              <button
                type="button"
                onClick={() => setStatusFilter("all")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all flex items-center gap-1.5 ${
                  statusFilter === "all"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground hover:bg-card"
                }`}
              >
                <span>Todas</span>
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                  statusFilter === "all" ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}>
                  {certs.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter("expired")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all flex items-center gap-1.5 ${
                  statusFilter === "expired"
                    ? "bg-destructive text-white shadow-xs"
                    : "text-destructive hover:bg-destructive/10"
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Vencidas / Alertas</span>
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                  statusFilter === "expired" ? "bg-white/20 text-white" : "bg-destructive/10 text-destructive"
                }`}>
                  {certs.filter(c => c.fileUploaded && (evaluateStatus(c.expirationDate) === "expired" || c.documentMatchesRow === false)).length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter("valid")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all flex items-center gap-1.5 ${
                  statusFilter === "valid"
                    ? "bg-success text-success-foreground shadow-xs"
                    : "text-success hover:bg-success/10"
                }`}
              >
                <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Válidas</span>
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                  statusFilter === "valid" ? "bg-success-foreground/20 text-success-foreground" : "bg-success/10 text-success"
                }`}>
                  {certs.filter(c => c.fileUploaded && evaluateStatus(c.expirationDate) === "valid" && c.documentMatchesRow !== false).length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter("expiring_soon")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all flex items-center gap-1.5 ${
                  statusFilter === "expiring_soon"
                    ? "bg-warning text-warning-foreground shadow-xs"
                    : "text-warning hover:bg-warning/10"
                }`}
              >
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>Vencendo</span>
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                  statusFilter === "expiring_soon" ? "bg-warning-foreground/20 text-warning-foreground" : "bg-warning/10 text-warning"
                }`}>
                  {certs.filter(c => c.fileUploaded && evaluateStatus(c.expirationDate) === "expiring_soon").length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter("mismatched")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all flex items-center gap-1.5 ${
                  statusFilter === "mismatched"
                    ? "bg-foreground text-background shadow-xs"
                    : "text-foreground hover:bg-accent"
                }`}
              >
                <HelpCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Incompatíveis</span>
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                  statusFilter === "mismatched" ? "bg-background/20 text-background" : "bg-muted text-foreground"
                }`}>
                  {certs.filter(c => c.fileUploaded && c.documentMatchesRow === false).length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter("pending")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all flex items-center gap-1.5 ${
                  statusFilter === "pending"
                    ? "bg-secondary text-secondary-foreground shadow-xs"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                <FileWarning className="w-3.5 h-3.5 shrink-0" />
                <span>Não Enviadas</span>
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                  statusFilter === "pending" ? "bg-secondary-foreground/20 text-secondary-foreground" : "bg-muted text-muted-foreground"
                }`}>
                  {certs.filter(c => !c.fileUploaded).length}
                </span>
              </button>
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-2.5 h-4.5 w-4.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Buscar em minhas certidões pelo nome ou observação..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 bg-background"
            />
          </div>

          {hasManuallyOrdered && (
            <div className="flex items-center justify-between bg-primary/10 border border-primary/20 text-primary px-3 py-2 rounded-xl mb-4 text-[11px] animate-in fade-in duration-200 font-medium">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-3.5 h-3.5 text-primary shrink-0" />
                <span>Posição personalizada ativa (ordem manual via arrastar).</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setHasManuallyOrdered(false);
                  const uploaded = certs.filter(c => !!c.fileUploaded);
                  const empty = certs.filter(c => !c.fileUploaded);
                  setCerts([...uploaded, ...empty]);
                }}
                className="text-primary hover:underline text-[10px] uppercase tracking-wider font-semibold cursor-pointer"
              >
                Organizar por anexos
              </button>
            </div>
          )}

          {/* Certificates List / Table Container */}
          <div id="certificates-table-wrapper" className="w-full min-w-0">
            
            {/* Mobile Card View (Hidden on medium/large screens) */}
            <div className="block md:hidden space-y-4">
              {filteredCerts.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-xs bg-muted/40 border rounded-xl">
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
                          ? "opacity-40 bg-primary/10 border-dashed border-primary"
                          : isDraggingOver
                          ? "bg-primary/10 border-dashed border-primary scale-[1.01] shadow-md"
                          : isUploaded
                          ? "bg-card border-border hover:border-muted-foreground/30"
                          : "bg-muted/40 border-border"
                      }`}
                    >
                      {/* Top bar with drag position and main tag info */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          {/* Drag Handle button */}
                          <div
                            className="flex items-center gap-1.5 bg-muted border px-2 py-1 rounded-md text-[10px] font-mono text-muted-foreground cursor-grab active:cursor-grabbing hover:bg-muted/70 shrink-0"
                            title="Arraste para reordenar"
                          >
                            <GripVertical className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span>#{index + 1}</span>
                          </div>

                          <div className="min-w-0">
                            <h4 className={`font-semibold leading-snug text-xs sm:text-sm ${
                              isDraggingOver ? "text-primary animate-pulse" :
                              isUploaded ? "text-foreground" : "text-muted-foreground"
                            }`}>
                              {isDraggingOver ? "✨ Solte o documento aqui!" : cert.name}
                            </h4>
                            {cert.notes && !isDraggingOver && (
                              <p className="text-muted-foreground text-[11px] mt-1 leading-normal">{cert.notes}</p>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Attached Document Detail */}
                      {isUploaded && cert.fileName && !isDraggingOver && (
                        <div className="space-y-1.5 pt-0.5">
                          <div className="flex items-center gap-2 bg-success/10 border border-success/30 rounded-lg p-2.5 text-[10.5px] text-success font-mono truncate">
                            <FileText className="w-3.5 h-3.5 text-success shrink-0" />
                            <span className="truncate">{cert.fileName}</span>
                          </div>
                          {cert.documentMatchesRow === false && cert.validationFeedback && (
                            <div className="text-[11px] text-warning bg-warning/10 border border-warning/40 rounded-lg p-2.5 flex flex-col gap-2 leading-normal">
                              <div className="flex items-start gap-2">
                                <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
                                <span>{cert.validationFeedback}</span>
                              </div>
                              <button
                                onClick={() => handleManualApprove(cert.id)}
                                className="text-[10px] w-full text-center font-semibold text-success hover:bg-success/20 bg-success/10 px-2.5 py-1 rounded-lg border border-success/40 transition-colors cursor-pointer mt-1"
                              >
                                ✓ Forçar aprovação deste documento
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Status badges, expiration date, actions bar */}
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t">
                        {/* Status indicators */}
                        <div className="flex items-center gap-2">
                          {isAnalyzing ? (
                            <Badge variant="outline" className="gap-1 text-primary border-primary/30 bg-primary/10 animate-pulse">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Lendo...
                            </Badge>
                          ) : !isUploaded ? (
                            <Badge variant="secondary">
                              Pendente
                            </Badge>
                          ) : (
                            <>
                              {cert.documentMatchesRow === false ? (
                                <Badge variant="outline" className="gap-1">
                                  <AlertTriangle className="w-3 h-3" />
                                  Tipo Errado
                                </Badge>
                              ) : (
                                <>
                                  {status === "expired" && (
                                    <Badge variant="destructive">
                                      Vencida
                                    </Badge>
                                  )}
                                  {status === "expiring_soon" && (
                                    <Badge variant="warning">
                                      Vencendo
                                    </Badge>
                                  )}
                                  {status === "valid" && (
                                    <Badge variant="success">
                                      Válida
                                    </Badge>
                                  )}
                                </>
                              )}
                            </>
                          )}
                        </div>

                        {/* Expiration date metadata */}
                        <div className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground">
                          <span className="text-muted-foreground/70">Vencimento:</span>
                          <span className={isUploaded && status === "expired" ? "text-destructive font-bold" : isUploaded && status === "expiring_soon" ? "text-warning font-semibold" : "text-foreground"}>
                            {isAnalyzing ? "-" : !isUploaded ? "Pendente" : cert.expirationDate ? new Date(cert.expirationDate).getUTCDate() ? new Date(cert.expirationDate).getUTCDate().toString().padStart(2, '0') + '/' + (new Date(cert.expirationDate).getUTCMonth() + 1).toString().padStart(2, '0') + '/' + new Date(cert.expirationDate).getUTCFullYear() : new Date(cert.expirationDate).toLocaleDateString("pt-BR") : "Sem Vencimento"}
                          </span>
                        </div>

                        {/* Unified Action Button list */}
                        <div className="w-full sm:w-auto flex items-center justify-end gap-2 pt-2.5 sm:pt-0 border-t sm:border-t-0">
                          {isAnalyzing ? (
                            <span className="text-[11px] text-primary animate-pulse font-medium">Processando arquivo...</span>
                          ) : !isUploaded ? (
                            <label className="w-full sm:w-auto flex items-center justify-center gap-1.5 bg-primary/10 hover:bg-primary/15 border border-primary/30 text-primary font-semibold rounded-lg px-3.5 py-2 text-[11px] transition duration-150 cursor-pointer shadow-xs">
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
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => startEdit(cert)}
                                className="gap-1 text-[11px] h-auto px-3 py-1.5"
                              >
                                <Edit2 className="w-3 h-3" />
                                <span>Editar</span>
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDeleteAttachment(cert.id)}
                                className="gap-1 text-[11px] h-auto px-3 py-1.5 bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive/20 hover:text-destructive"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Excluir</span>
                              </Button>
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
            <div className="hidden md:block rounded-xl border w-full bg-card shadow-xs overflow-hidden">
              <Table className="min-w-[700px] text-left text-sm whitespace-normal table-fixed">
                <TableHeader className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider font-semibold [&_tr]:border-b">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="p-2.5 h-auto w-[50px] text-center whitespace-nowrap shrink-0">Pos.</TableHead>
                    <TableHead className="p-2.5 h-auto whitespace-normal">Nome do Documento / Propósito</TableHead>
                    <TableHead className="p-2.5 h-auto w-[110px] text-center whitespace-nowrap shrink-0">Status</TableHead>
                    <TableHead className="p-2.5 h-auto w-[100px] text-center whitespace-nowrap shrink-0">Vencimento</TableHead>
                    <TableHead className="p-2.5 pl-2.5 pr-4 h-auto w-[130px] text-center whitespace-nowrap shrink-0">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y">
                  {filteredCerts.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={5} className="p-8 text-center text-muted-foreground text-xs whitespace-normal">
                        Nenhuma certidão encontrada correspondendo aos critérios de busca.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredCerts.map((cert, index) => {
                      const status = evaluateStatus(cert.expirationDate);
                      const isUploaded = !!cert.fileUploaded;
                      const isAnalyzing = analyzingId === cert.id;
                      const isDraggingOver = dragOverId === cert.id;
                      const isRowBeingDragged = rowDraggingIndex === index;

                      return (
                        <TableRow
                          key={cert.id}
                          draggable={true}
                          onDragStart={(e) => handleRowDragStart(e, index)}
                          onDragOver={(e) => handleRowDragOver(e, index)}
                          onDrop={(e) => handleRowDrop(e, index)}
                          className={`transition-all duration-200 relative ${
                            isRowBeingDragged
                              ? "opacity-40 bg-primary/10 border-2 border-dashed border-primary hover:bg-primary/10"
                              : isDraggingOver
                              ? "bg-primary/10 border-y-2 border-dashed border-primary scale-[1.005] shadow-sm hover:bg-primary/10"
                              : isUploaded
                              ? "bg-card hover:bg-muted/40"
                              : "bg-muted/20 hover:bg-muted/40"
                          }`}
                        >
                          {/* Drag Handle Column */}
                          <TableCell className="p-2.5 w-[50px] text-center cursor-grab active:cursor-grabbing hover:bg-muted/60 transition-colors group/drag" title="Clique e arraste para reordenar esta certidão">
                            <div className="flex items-center justify-center text-muted-foreground group-hover/drag:text-primary">
                              <GripVertical className="w-4.5 h-4.5 shrink-0" />
                            </div>
                          </TableCell>

                          <TableCell className="p-2.5 min-w-0 whitespace-normal">
                            <div className="flex items-start gap-2">
                              <FileText className={`w-4 items-start shrink-0 mt-0.5 ${
                                isDraggingOver ? "text-primary animate-bounce" :
                                !isUploaded ? "text-muted-foreground" :
                                cert.documentMatchesRow === false ? "text-foreground" :
                                status === "expired" ? "text-destructive" :
                                status === "expiring_soon" ? "text-warning" : "text-success"
                              }`} />
                              <div className="min-w-0">
                                <p className={`font-medium leading-tight text-xs md:text-sm truncate ${
                                  isDraggingOver ? "text-primary font-semibold" :
                                  isUploaded ? "text-foreground" : "text-muted-foreground font-normal"
                                }`}>
                                  {isDraggingOver ? "✨ Solte o documento aqui!" : cert.name}
                                </p>
                                {isDraggingOver ? (
                                  <p className="text-primary font-normal text-[10px] mt-0.5 animate-pulse font-sans">
                                    Aceita PDF, imagens ou txt.
                                  </p>
                                ) : (
                                  cert.notes && <p className="text-muted-foreground font-normal text-[11px] mt-0.5 md:leading-normal truncate">{cert.notes}</p>
                                )}
                                {isUploaded && cert.fileName && !isDraggingOver && (
                                  <div className="mt-1 space-y-1">
                                    <p className="text-[10px] text-success font-mono flex items-center gap-1 bg-success/10 border border-success/30 rounded px-1.5 py-0.5 w-max truncate max-w-full">
                                      <span>📄 {cert.fileName}</span>
                                    </p>
                                    {cert.documentMatchesRow === false && cert.validationFeedback && (
                                      <div className="text-[10px] text-warning bg-warning/10 border border-warning/40 rounded-lg p-1.5 flex flex-col gap-1.5 leading-normal max-w-full">
                                        <div className="flex items-start gap-1">
                                          <AlertTriangle className="w-3 h-3 text-warning shrink-0 mt-0.5 animate-pulse" />
                                          <span>{cert.validationFeedback}</span>
                                        </div>
                                        <button
                                          onClick={() => handleManualApprove(cert.id)}
                                          className="text-[9px] w-max font-semibold text-success hover:bg-success/20 bg-success/10 px-2 py-0.5 rounded border border-success/40 transition-colors cursor-pointer mt-0.5"
                                          title="Ignorar incompatibilidade identificada pela IA e aprovar o documento"
                                        >
                                          ✓ Forçar aprovação deste documento
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </TableCell>

                          <TableCell className="p-2.5 w-[110px] text-center">
                            {isAnalyzing ? (
                              <Badge variant="outline" className="gap-0.5 text-[10px] text-primary border-primary/30 bg-primary/10 animate-pulse">
                                <Loader2 className="w-3 h-3 shrink-0 animate-spin" />
                                Lendo...
                              </Badge>
                            ) : !isUploaded ? (
                              <Badge variant="secondary" className="text-[10px]">
                                Pendente
                              </Badge>
                            ) : (
                              <>
                                {cert.documentMatchesRow === false ? (
                                  <Badge variant="outline" className="gap-0.5 text-[10px]" title={cert.validationFeedback}>
                                    <AlertTriangle className="w-3 h-3 shrink-0" />
                                    Incompatível
                                  </Badge>
                                ) : (
                                  <>
                                    {status === "expired" && (
                                      <Badge variant="destructive" className="gap-0.5 text-[10px]">
                                        <AlertTriangle className="w-3 h-3 shrink-0" />
                                        Vencida
                                      </Badge>
                                    )}
                                    {status === "expiring_soon" && (
                                      <Badge variant="warning" className="gap-0.5 text-[10px]">
                                        <Clock className="w-3 h-3 shrink-0 animate-pulse" />
                                        Vencendo
                                      </Badge>
                                    )}
                                    {status === "valid" && (
                                      <Badge variant="success" className="gap-0.5 text-[10px]">
                                        <CheckCircle className="w-3 h-3 shrink-0" />
                                        Válida
                                      </Badge>
                                    )}
                                  </>
                                )}
                              </>
                            )}
                          </TableCell>

                          <TableCell className="p-2.5 w-[100px] text-center whitespace-nowrap">
                            {isAnalyzing ? (
                              <span className="text-muted-foreground text-xs font-mono">-</span>
                            ) : !isUploaded ? (
                              <span className="text-muted-foreground text-[11px] font-mono font-normal">Pendente</span>
                            ) : (
                              <span className={`text-[11px] font-medium font-mono ${
                                status === "expired" ? "text-destructive font-bold" :
                                status === "expiring_soon" ? "text-warning font-semibold" : "text-foreground"
                              }`}>
                                {cert.expirationDate ? new Date(cert.expirationDate).getUTCDate() ? new Date(cert.expirationDate).getUTCDate().toString().padStart(2, '0') + '/' + (new Date(cert.expirationDate).getUTCMonth() + 1).toString().padStart(2, '0') + '/' + new Date(cert.expirationDate).getUTCFullYear() : new Date(cert.expirationDate).toLocaleDateString("pt-BR") : "Sem Venc."}
                              </span>
                            )}
                          </TableCell>

                          <TableCell className="p-2.5 pl-2.5 pr-4 w-[130px] text-center whitespace-nowrap">
                            <div className="flex items-center justify-center gap-1">
                              {isAnalyzing ? (
                                <span className="text-[10px] text-primary font-medium animate-pulse">Lendo...</span>
                              ) : !isUploaded ? (
                                <label className="flex items-center justify-center gap-1 bg-primary/10 hover:bg-primary/15 border border-primary/30 text-primary font-semibold rounded px-1.5 py-1 text-[10px] transition duration-150 cursor-pointer shadow-xs">
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
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => startEdit(cert)}
                                    className="h-7 w-7 text-muted-foreground hover:text-primary"
                                    title="Editar data ou informações de vencimento"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDeleteAttachment(cert.id)}
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                    title="Remover arquivo carregado"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

          </div>
          
          {/* Note */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-4 leading-normal">
            <span className="shrink-0 bg-muted border text-foreground w-4 h-4 rounded-full flex items-center justify-center font-bold">!</span>
            <span>A análise temporal de vigência é calculada dinamicamente com base na data do sistema consolidada em <strong>18 de Junho de 2026</strong>.</span>
          </div>

        </Card>
      </div>

      <Dialog open={!!confirmDialog} onOpenChange={(open) => { if (!open) setConfirmDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
              <span>{confirmDialog?.title}</span>
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              {confirmDialog?.message}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                confirmDialog?.onConfirm();
                setConfirmDialog(null);
              }}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
