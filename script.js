// ============================================================
// CONFIGURATION
// ============================================================

const DATA_URL = "data.json";
const HISTORY_URL = "historique_supprimees.json";

const STORAGE_KEY_STATUTS = "forem_electromecanicien_statuts";

const OPTIONS_STATUT = [
    { value: "", label: "—" },
    { value: "interesse", label: "Intéressé" },
    { value: "pas_interesse", label: "Pas intéressé" },
    { value: "postule", label: "Postulé" },
    { value: "contacte", label: "Contacté" },
    { value: "refuse", label: "Refusé" },
    { value: "rdv", label: "RDV prévu" },
];


// ============================================================
// STOCKAGE LOCAL (statuts uniquement)
// ============================================================

function chargerStatuts() {
    try {
        const valeur = localStorage.getItem(STORAGE_KEY_STATUTS);
        if (!valeur) return {};
        const parse = JSON.parse(valeur);
        return parse && typeof parse === "object" ? parse : {};
    } catch (e) {
        console.error("Impossible de charger les statuts", e);
        return {};
    }
}

function sauvegarderStatuts() {
    try {
        localStorage.setItem(STORAGE_KEY_STATUTS, JSON.stringify(statuts));
    } catch (e) {
        console.error("Impossible de sauvegarder les statuts", e);
    }
}

function obtenirStatut(numero) {
    return statuts[numero] || "";
}

function definirStatut(numero, valeur) {
    if (valeur) {
        statuts[numero] = valeur;
    } else {
        delete statuts[numero];
    }
    sauvegarderStatuts();
}

function nettoyerStatuts(numerosActuels) {
    let modifie = false;
    Object.keys(statuts).forEach(numero => {
        if (!numerosActuels.has(numero)) {
            delete statuts[numero];
            modifie = true;
        }
    });
    if (modifie) {
        sauvegarderStatuts();
    }
}

let statuts = chargerStatuts();


// ============================================================
// STOCKAGE LOCAL (remarques)
// ============================================================

const STORAGE_KEY_REMARQUES = "forem_electromecanicien_remarques";

function chargerRemarques() {
    try {
        const valeur = localStorage.getItem(STORAGE_KEY_REMARQUES);
        if (!valeur) return {};
        const parse = JSON.parse(valeur);
        return parse && typeof parse === "object" ? parse : {};
    } catch (e) {
        console.error("Impossible de charger les remarques", e);
        return {};
    }
}

function sauvegarderRemarques() {
    try {
        localStorage.setItem(STORAGE_KEY_REMARQUES, JSON.stringify(remarques));
    } catch (e) {
        console.error("Impossible de sauvegarder les remarques", e);
    }
}

function obtenirRemarque(numero) {
    return remarques[numero] || "";
}

function definirRemarque(numero, valeur) {
    if (valeur) {
        remarques[numero] = valeur;
    } else {
        delete remarques[numero];
    }
    sauvegarderRemarques();
}

function nettoyerRemarques(numerosActuels) {
    let modifie = false;
    Object.keys(remarques).forEach(numero => {
        if (!numerosActuels.has(numero)) {
            delete remarques[numero];
            modifie = true;
        }
    });
    if (modifie) {
        sauvegarderRemarques();
    }
}

let remarques = chargerRemarques();


// ============================================================
// STOCKAGE LOCAL (favoris)
// ============================================================

const STORAGE_KEY_FAVORIS = "forem_electromecanicien_favoris";

function chargerFavoris() {
    try {
        const valeur = localStorage.getItem(STORAGE_KEY_FAVORIS);
        if (!valeur) return {};
        const parse = JSON.parse(valeur);
        return parse && typeof parse === "object" ? parse : {};
    } catch (e) {
        console.error("Impossible de charger les favoris", e);
        return {};
    }
}

function sauvegarderFavoris() {
    try {
        localStorage.setItem(STORAGE_KEY_FAVORIS, JSON.stringify(favoris));
    } catch (e) {
        console.error("Impossible de sauvegarder les favoris", e);
    }
}

function obtenirFavori(numero) {
    return favoris[numero] === true;
}

function definirFavori(numero, actif) {
    if (actif) {
        favoris[numero] = true;
    } else {
        delete favoris[numero];
    }
    sauvegarderFavoris();
}

function nettoyerFavoris(numerosActuels) {
    let modifie = false;
    Object.keys(favoris).forEach(numero => {
        if (!numerosActuels.has(numero)) {
            delete favoris[numero];
            modifie = true;
        }
    });
    if (modifie) {
        sauvegarderFavoris();
    }
}

let favoris = chargerFavoris();


// ============================================================
// AFFICHAGE
// ============================================================

function creerSelectStatut(numero) {
    const select = document.createElement("select");
    select.className = "select-statut";
    select.dataset.numero = numero;
    select.title = "Statut de la candidature";

    OPTIONS_STATUT.forEach(({ value, label }) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
    });

    select.value = obtenirStatut(numero);

    select.addEventListener("change", function () {
        definirStatut(this.dataset.numero, this.value);
        appliquerFiltres();
    });

    return select;
}

function creerLienOffre(offre) {
    const lien = document.createElement("a");
    lien.href = offre.url || "#";
    lien.target = "_blank";
    lien.rel = "noopener noreferrer";
    lien.textContent = offre.nom_offre || "(Sans titre)";
    lien.addEventListener("click", function () {
        marquerLigneCliquee(lien);
    });
    return lien;
}

let numeroLigneCliquee = null;

function marquerLigneCliquee(lien) {
    const tr = lien.closest("tr");
    if (!tr) return;

    const numero = tr.dataset.numero || null;

    if (numeroLigneCliquee !== null && numeroLigneCliquee !== numero) {
        const precedente = document.querySelector(
            `tr[data-numero="${numeroLigneCliquee}"]`
        );
        if (precedente) {
            precedente.classList.remove("ligne-cliquee");
        }
    }

    if (numeroLigneCliquee === numero) {
        numeroLigneCliquee = null;
        tr.classList.remove("ligne-cliquee");
        return;
    }

    numeroLigneCliquee = numero;
    tr.classList.add("ligne-cliquee");
}

function creerBlocDescription(offre) {
    const conteneur = document.createElement("div");

    const titre = creerLienOffre(offre);
    conteneur.appendChild(titre);

    if (offre.description) {
        const description = document.createElement("div");
        description.className = "description-offre";
        description.textContent = offre.description;
        conteneur.appendChild(description);

        const bouton = document.createElement("button");
        bouton.type = "button";
        bouton.className = "desc-toggle";
        bouton.textContent = "Afficher plus";
        bouton.addEventListener("click", function () {
            const etendue = description.classList.toggle("etendue");
            this.textContent = etendue ? "Afficher moins" : "Afficher plus";
        });
        conteneur.appendChild(bouton);
    }

    return conteneur;
}

function creerCelluleStar(numero) {
    const numeroStr = String(numero);
    const td = document.createElement("td");
    td.className = "col-star";

    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = "bouton-star";
    bouton.title = "Marquer comme favori";
    bouton.setAttribute("aria-pressed", obtenirFavori(numeroStr) ? "true" : "false");
    bouton.textContent = obtenirFavori(numeroStr) ? "★" : "☆";

    bouton.addEventListener("click", function () {
        const actif = !obtenirFavori(numeroStr);
        definirFavori(numeroStr, actif);
        this.textContent = actif ? "★" : "☆";
        this.setAttribute("aria-pressed", actif ? "true" : "false");
        this.classList.toggle("actif", actif);
    });

    td.appendChild(bouton);
    return td;
}

function creerCelluleRemarque(numero) {
    const td = document.createElement("td");
    td.className = "cellule-remarque";

    const textarea = document.createElement("textarea");
    textarea.rows = 1;
    textarea.placeholder = "…";
    textarea.value = obtenirRemarque(String(numero));
    textarea.title = "Remarque personnelle";
    textarea.addEventListener("input", function () {
        definirRemarque(String(numero), this.value);
        this.style.height = "auto";
        this.style.height = this.scrollHeight + "px";
    });

    td.appendChild(textarea);
    return td;
}

function creerCelluleDetails(valeurs) {
    const td = document.createElement("td");
    td.className = "col-details";

    [
        ["Contrat", valeurs.type_contrat],
        ["Horaire", valeurs.horaire],
        ["Rémunération", valeurs.remuneration],
        ["Salaire", valeurs.salaire],
    ].forEach(([etiquette, valeur]) => {
        if (!valeur) return;
        const ligne = document.createElement("div");
        ligne.className = "detail-ligne";

        const label = document.createElement("span");
        label.className = "detail-etiquette";
        label.textContent = etiquette + " : ";
        ligne.appendChild(label);

        ligne.appendChild(document.createTextNode(valeur));
        td.appendChild(ligne);
    });

    return td;
}

function creerLigneActuelle(offre) {
    const numero = String(offre.numero);
    const tr = document.createElement("tr");
    tr.dataset.numero = numero;

    const celluleTextes = (infos, className) => {
        const td = document.createElement("td");
        td.className = className;
        infos.forEach(info => td.appendChild(info));
        return td;
    };

    tr.appendChild(creerCelluleStar(numero));

    const tdStatut = document.createElement("td");
    tdStatut.className = "col-statut";
    tdStatut.appendChild(creerSelectStatut(numero));
    tr.appendChild(tdStatut);

    tr.appendChild(celluleTextes([document.createTextNode(offre.publication || "")], "col-publication"));
    tr.appendChild(celluleTextes([document.createTextNode(numero)], "col-id-forem"));
    tr.appendChild(celluleTextes([creerBlocDescription(offre)], "col-offre"));
    tr.appendChild(celluleTextes([document.createTextNode(offre.societe || "")], "col-societe"));
    tr.appendChild(creerCelluleDetails(offre));
    tr.appendChild(celluleTextes([document.createTextNode(offre.lieu || "")], "col-lieu"));
    tr.appendChild(creerCelluleRemarque(numero));

    return tr;
}

function creerLigneSeparation(texte) {
    const ligne = document.createElement("tr");
    ligne.className = "ligne-separation";
    ligne.dataset.separation = "true";

    const cellule = document.createElement("td");
    cellule.colSpan = 9;
    cellule.textContent = texte;

    ligne.appendChild(cellule);
    return ligne;
}

function creerLigneSupprimee(offre) {
    const tr = document.createElement("tr");
    tr.dataset.numero = String(offre.numero);

    const celluleTextes = (infos, className) => {
        const td = document.createElement("td");
        td.className = className;
        infos.forEach(info => td.appendChild(info));
        return td;
    };

    tr.appendChild(creerCelluleStar(String(offre.numero)));
    tr.appendChild(celluleTextes([document.createTextNode(String(offre.numero))], "col-id-forem"));
    tr.appendChild(celluleTextes([creerLienOffre(offre)], "col-offre"));
    tr.appendChild(celluleTextes([document.createTextNode(offre.societe || "")], "col-societe"));
    tr.appendChild(creerCelluleDetails(offre));
    tr.appendChild(celluleTextes([document.createTextNode(offre.lieu || "")], "col-lieu"));
    tr.appendChild(celluleTextes([document.createTextNode(formaterDate(offre.date_suppression))], "col-date-suppression"));
    tr.appendChild(creerCelluleRemarque(String(offre.numero)));

    return tr;
}

function afficherActuelles(offres, dateScrape) {
    const nouvelles = offres.filter(o => o.nouvelle === true);
    const anciennes = offres.filter(o => o.nouvelle !== true);

    document.getElementById("statTotal").textContent = offres.length;
    document.getElementById("statNouvelles").textContent = nouvelles.length;
    document.getElementById("statAnciennes").textContent = anciennes.length;
    document.getElementById("statDate").textContent = dateScrape ? formaterDate(dateScrape) : "—";

    const tbody = document.getElementById("corpsActuelles");
    tbody.innerHTML = "";

    if (offres.length === 0) {
        tbody.appendChild(creerLigneInfo("Aucune annonce trouvée."));
        return;
    }

    if (nouvelles.length > 0) {
        tbody.appendChild(creerLigneSeparation(`Nouvelles annonces (${nouvelles.length})`));
        nouvelles.forEach(offre => tbody.appendChild(creerLigneActuelle(offre)));
    }

    if (anciennes.length > 0) {
        tbody.appendChild(creerLigneSeparation(`Anciennes annonces (${anciennes.length})`));
        anciennes.forEach(offre => tbody.appendChild(creerLigneActuelle(offre)));
    }
}

function afficherSupprimees(offres) {
    const tbody = document.getElementById("corpsSupprimees");
    tbody.innerHTML = "";

    const statutCount = document.getElementById("statSupprimees");
    if (statutCount) {
        statutCount.textContent = String(offres.length);
    }

    const triees = offres.slice().sort((a, b) => {
        const da = new Date(a.date_suppression || "1970-01-01T00:00:00").getTime();
        const db = new Date(b.date_suppression || "1970-01-01T00:00:00").getTime();
        return db - da;
    });

    if (triees.length === 0) {
        tbody.appendChild(creerLigneInfo("Aucune annonce supprimée.", 8));
        return;
    }

    triees.forEach(offre => tbody.appendChild(creerLigneSupprimee(offre)));
}


// ============================================================
// OUTILS D'AFFICHAGE
// ============================================================

function formaterDate(valeur) {
    if (!valeur) return "—";
    const d = new Date(valeur);
    if (isNaN(d.getTime())) return valeur;
    const p = n => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}


// ============================================================
// FILTRES (STATUT + RECHERCHE)
// ============================================================

function normaliserTexte(texte) {
    return (texte || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

function obtenirMotsCles(valeur) {
    return normaliserTexte(valeur).split(/\s+/).filter(Boolean);
}

function appliquerFiltres() {
    const filtre = document.getElementById("filtreStatut");
    const valeurStatut = filtre ? filtre.value : "";

    appliquerFiltresTable(
        "corpsActuelles",
        "rechercheActuelles",
        function (ligne) {
            if (valeurStatut === "") return true;
            const statut = obtenirStatut(String(ligne.dataset.numero));
            if (valeurStatut === "non_trie") return statut === "";
            return statut === valeurStatut;
        }
    );

    appliquerFiltresTable("corpsSupprimees", "rechercheSupprimees", function () {
        return true;
    });
}

function appliquerFiltresTable(corpsId, rechercheId, passeAutresFiltres) {
    const tbody = document.getElementById(corpsId);
    const entree = document.getElementById(rechercheId);
    const motsCles = entree ? obtenirMotsCles(entree.value) : [];

    const lignes = Array.from(tbody.children);

    // On découpe le tbody en groupes délimités par les lignes de séparation.
    let groupeActuel = [];
    const groupes = [];

    lignes.forEach(ligne => {
        if (ligne.dataset && ligne.dataset.separation === "true") {
            groupes.push({ separation: ligne, lignes: groupeActuel });
            groupeActuel = [];
        } else {
            groupeActuel.push(ligne);
        }
    });
    groupes.push({ separation: null, lignes: groupeActuel });

    groupes.forEach(groupe => {
        let visibles = 0;

        groupe.lignes.forEach(ligne => {
            const numero = ligne.dataset && ligne.dataset.numero;

            if (!numero) {
                ligne.style.display = "";
                return;
            }

            let affiche = passeAutresFiltres(ligne);

            if (affiche && motsCles.length > 0) {
                const texte = normaliserTexte(ligne.textContent);
                affiche = motsCles.every(mot => texte.includes(mot));
            }

            ligne.style.display = affiche ? "" : "none";
            if (affiche) visibles++;
        });

        // On masque une ligne de séparation si aucun de ses éléments n'est visible.
        if (groupe.separation) {
            groupe.separation.style.display = visibles > 0 ? "" : "none";
        }
    });
}


// ============================================================
// ONGLETS
// ============================================================

function configurerOnglets() {
    const boutons = Array.from(document.querySelectorAll(".onglet-btn"));

    boutons.forEach(bouton => {
        bouton.addEventListener("click", function () {
            const cible = this.dataset.cible;

            boutons.forEach(b => {
                const actif = b === this;
                b.classList.toggle("actif", actif);
                b.setAttribute("aria-selected", actif ? "true" : "false");
            });

            document.getElementById("onglet-actuelles").classList.toggle(
                "cache", cible !== "actuelles"
            );
            document.getElementById("onglet-supprimees").classList.toggle(
                "cache", cible !== "supprimees"
            );
        });
    });
}


// ============================================================
// INITIALISATION
// ============================================================

function creerLigneInfo(texte, colSpan) {
    const tr = document.createElement("tr");
    tr.className = "ligne-info";
    const td = document.createElement("td");
    td.colSpan = colSpan || 9;
    td.textContent = texte;
    tr.appendChild(td);
    return tr;
}

async function chargerJson(url) {
    const reponse = await fetch(url, { cache: "no-store" });
    if (!reponse.ok) {
        throw new Error(`HTTP ${reponse.status} : ${url}`);
    }
    return reponse.json();
}

function extraireOffres(donnees) {
    if (Array.isArray(donnees)) return donnees;
    if (donnees && Array.isArray(donnees.offres)) return donnees.offres;
    return [];
}

function afficherErreur(tbody, message, colSpan) {
    if (!tbody) {
        console.error(message);
        return;
    }
    tbody.innerHTML = "";
    tbody.appendChild(creerLigneInfo(message, colSpan));
}

async function chargerJsonAvecRetour(url, tbody, messageEchec, colSpan) {
    try {
        return await chargerJson(url);
    } catch (e) {
        console.error(e);
        afficherErreur(tbody, `${messageEchec} (${e.message})`, colSpan);
        return null;
    }
}

async function initialiser() {
    // Sous file://, fetch() est bloqué par le navigateur.
    if (window.location.protocol === "file:") {
        afficherErreur(
            document.getElementById("corpsActuelles"),
            "Page ouverte directement depuis le disque. Lancez un serveur HTTP local " +
            "(python -m http.server 8000) et ouvrez http://localhost:8000/."
        );
        return;
    }

    const tbodyActuelles = document.getElementById("corpsActuelles");
    const tbodySupprimees = document.getElementById("corpsSupprimees");

    const donnees = await chargerJsonAvecRetour(
        DATA_URL,
        tbodyActuelles,
        "Impossible de charger data.json"
    );

    const historique = await chargerJsonAvecRetour(
        HISTORY_URL,
        tbodySupprimees,
        "Impossible de charger historique_supprimees.json",
        7
    );

    if (!donnees) {
        return;
    }

    const offres = extraireOffres(donnees);
    const supprimees = historique ? extraireOffres(historique) : [];
    const dateScrape = donnees && donnees.scrape_timestamp ? donnees.scrape_timestamp : "";

    const numerosActuels = new Set(offres.map(o => String(o.numero)));
    nettoyerStatuts(numerosActuels);
    nettoyerRemarques(numerosActuels);
    nettoyerFavoris(numerosActuels);

    try {
        afficherActuelles(offres, dateScrape);
        afficherSupprimees(supprimees);
        configurerOnglets();

        const filtre = document.getElementById("filtreStatut");
        if (filtre) {
            filtre.addEventListener("change", appliquerFiltres);
        }

        ["rechercheActuelles", "rechercheSupprimees"].forEach(id => {
            const entree = document.getElementById(id);
            if (entree) {
                entree.addEventListener("input", appliquerFiltres);
            }
        });

        appliquerFiltres();
    } catch (e) {
        console.error("Erreur lors de l'affichage", e);
        afficherErreur(
            tbodyActuelles,
            "Erreur lors de l'affichage des annonces : " + e.message
        );
    }
}

document.addEventListener("DOMContentLoaded", initialiser);