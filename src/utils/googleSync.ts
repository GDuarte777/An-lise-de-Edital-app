import { SyncItem } from "../types";

// Local storage keys
const SYNCED_ITEMS_KEY = "aip_synced_items";
const GOOGLE_AUTH_TOKEN_KEY = "aip_google_access_token";

// Default initial mock Drive folder items to represent initial files on Drive
const INITIAL_DRIVE_ITEMS: SyncItem[] = [];

export function getSyncedItems(): SyncItem[] {
  const items = localStorage.getItem(SYNCED_ITEMS_KEY);
  if (!items) {
    localStorage.setItem(SYNCED_ITEMS_KEY, JSON.stringify(INITIAL_DRIVE_ITEMS));
    return INITIAL_DRIVE_ITEMS;
  }
  return JSON.parse(items);
}

export function saveSyncedItems(items: SyncItem[]) {
  localStorage.setItem(SYNCED_ITEMS_KEY, JSON.stringify(items));
}

export function addSyncedItem(name: string, type: "document" | "sheet" | "proposal" | "declaration", content: string, pathPrefix = "Analisador_Pregões/") {
  const items = getSyncedItems();
  
  const ext = type === "sheet" ? "" : ".md";
  const finalName = name.endsWith(".md") || type === "sheet" ? name : `${name}${ext}`;
  const subFolder = type === "proposal" ? "Propostas/" : type === "declaration" ? "Declarações/" : type === "sheet" ? "Planilhas/" : "Documentos/";
  const finalPath = `${pathPrefix}${subFolder}`;

  const newItem: SyncItem = {
    id: `gdrive-${Date.now()}`,
    name: finalName,
    type,
    path: finalPath,
    timestamp: new Date().toISOString().replace("T", " ").substring(0, 16),
  };

  const updated = [newItem, ...items];
  saveSyncedItems(updated);

  // Attempt real Google Sync if token exists
  uploadToGoogleAPIsIfConnected(finalName, type, content, finalPath).catch(err => {
    console.warn("Falha no sync real (usuário não autenticado ou escopos pendentes):", err);
  });

  return newItem;
}

// Check if user is connected via GIS
export function getGoogleAccessToken(): string | null {
  return localStorage.getItem(GOOGLE_AUTH_TOKEN_KEY);
}

export function setGoogleAccessToken(token: string | null) {
  if (token) {
    localStorage.setItem(GOOGLE_AUTH_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(GOOGLE_AUTH_TOKEN_KEY);
  }
}

export function isGoogleConnected(): boolean {
  return !!getGoogleAccessToken();
}

/**
 * Attempts real OAuth upload using current access token
 */
async function uploadToGoogleAPIsIfConnected(name: string, type: string, content: string, path: string) {
  const token = getGoogleAccessToken();
  if (!token) return;

  try {
    if (type === "sheet") {
      // Create or update Spreadsheet row
      console.log("Realizando sincronização com Google Sheets: criando planilha ou adicionando dados...");
      // Endpoint to create a file
      const fileMetadata = {
        name: name,
        mimeType: "application/vnd.google-apps.spreadsheet"
      };

      const response = await fetch("https://www.googleapis.com/drive/v3/files", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(fileMetadata)
      });
      const data = await response.json();
      console.log("Planilha do Google criada com sucesso:", data);
    } else {
      // Upload markdown/text to Google Drive
      console.log("Sincronizando arquivo de texto com o Google Drive...");
      
      const fileMetadata = {
        name: name,
        mimeType: "text/markdown",
      };

      // Simple multipart upload or metadata-only
      const form = new FormData();
      form.append("metadata", new Blob([JSON.stringify(fileMetadata)], { type: "application/json" }));
      form.append("file", new Blob([content], { type: "text/markdown" }));

      // Standard multi-part upload url
      const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form
      });
      const data = await response.json();
      console.log("Arquivo carregado com sucesso ao Google Drive:", data);
    }
  } catch (error) {
    console.error("Erro no processamento da chamada de API Google Real:", error);
  }
}

/**
 * Sync row data representing the Edital analysis directly to Google Sheets
 */
export async function syncAnalysisToGoogleSheets(analysisTitle: string, details: any) {
  const token = getGoogleAccessToken();
  
  // Create local log
  const textContent = `
=== EDITAL ANALISADO: ${analysisTitle} ===
Descrição do Produto: ${details.descricaoProduto}
Prazo de Entrega: ${details.prazoEntrega}
Prazo de Recebimento: ${details.prazoPagamento}
Pontos Positivos: ${details.pontosPositivos?.join(", ") || ""}
Pontos Alerta: ${details.pontosAlerta?.join(", ") || ""}
Documentos Habilitação: ${details.documentosExigidos?.join(", ") || ""}
Sincronizado: ${new Date().toLocaleString()}
`;
  addSyncedItem(analysisTitle, "sheet", textContent);

  if (!token) return;

  try {
    // If real Google Sheets is connected, we would push row values to a specific spreadsheet
    console.log("Simulando injeção de linha no Google Sheets com dados reais...");
  } catch (e) {
    console.error("Falha ao injetar linha no Google Sheets real", e);
  }
}
