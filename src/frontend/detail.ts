/**
 * Detail page - Offer detail view
 * Converted from detail.js
 */

import { parseForemDate, formatDate, formatRelative, cleanNumber } from "../shared";

const API_SCRAPINGS = "/api/scrapings";

let currentOffer: any = null;
let currentScrape: string = "";

async function init(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const number = params.get("number");
  const base = params.get("base");

  if (!number) {
    document.body.innerHTML = "<p>Aucun numéro d'offre spécifié.</p>";
    return;
  }

  // Load scraping list
  const scrapings = await fetch(API_SCRAPINGS, { cache: "no-store" }).then(r => r.json());
  currentScrape = base || scrapings[0]?.name || "";

  // Load offer data
  const scraping = base ? 
    (await fetch(`/api/scrapings`).then(r => r.json())).find((s: any) => s.name === base) :
    (await fetch("/api/scrapings").then(r => r.json()))[0];

  if (!scraping) {
    document.body.innerHTML = "<p>Scraping non trouvé.</p>";
    return;
  }

  const data = await fetch(scraping.file).then(r => r.json());
  const offer = data.offers?.find((o: any) => String(o.number) === number);

  if (!offer) {
    document.body.innerHTML = "<p>Offre non trouvée.</p>";
    return;
  }

  currentOffer = offer;
  renderOffer(offer);
}

function renderOffer(offer: any): void {
  const container = document.getElementById("offerDetail")!;
  container.innerHTML = "";

  const header = document.createElement("div");
  header.className = "detail-header";

  const title = document.createElement("h1");
  title.textContent = offer.offer_title || "Sans titre";
  header.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "detail-meta";
  meta.innerHTML = `
    <div><strong>Entreprise:</strong> ${offer.company || "—"}</div>
    <div><strong>Lieu:</strong> ${offer.location || "—"}</div>
    <div><strong>Contrat:</strong> ${offer.contract_type || "—"}</div>
    <div><strong>Publiée le:</strong> ${formatDate(offer.published_on)}</div>
    <div><strong>Métier:</strong> ${offer.metier || "—"}</div>
  `;
  header.appendChild(meta);
  container.appendChild(header);

  if (offer.description) {
    const desc = document.createElement("div");
    desc.className = "detail-description";
    desc.innerHTML = offer.description;
    container.appendChild(desc);
  }

  if (offer.url) {
    const link = document.createElement("a");
    link.href = offer.url;
    link.target = "_blank";
    link.textContent = "Voir l'offre sur LeForem.be";
    link.className = "btn-primary";
    container.appendChild(link);
  }
}

document.addEventListener("DOMContentLoaded", init);