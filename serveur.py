"""Point de démarrage du programme.

    python serveur.py

Le serveur web lui-même est dans :mod:`python.server` ; ce fichier n'existe
que pour que la commande ci-dessus marche depuis la racine du projet, sans
demander à l'utilisateur de connaître le nom du paquet.
"""

import sys
from pathlib import Path

# Rend le paquet importable même si le projet est lancé d'un autre dossier.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from python.server import main  # noqa: E402

if __name__ == "__main__":
    main()
