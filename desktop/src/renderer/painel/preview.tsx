/**
 * Pré-visualização do painel sem Electron.
 *
 * Monta só o painel, alimentado pela demonstração, para olhar o desenho em navegador
 * comum (`npm run painel:preview`). Nenhum código de produção depende deste arquivo.
 */
import { createRoot } from "react-dom/client";
import Painel from "./Painel.js";
import { criarDemonstracao } from "./demonstracao.js";
import "../styles.css";

const alvo = document.getElementById("root");
if (!alvo) throw new Error("Elemento #root não encontrado.");
createRoot(alvo).render(<Painel fonte={criarDemonstracao()} />);
