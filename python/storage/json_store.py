"""JSON file storage implementation (legacy behaviour)."""
from __future__ import annotations

import json
import os
import shutil
from typing import Any, Dict, List, Optional, Tuple

from python import config
from python import jsonio
from python.jsonio import read_details as _read_details_json
from python.jsonio import read_json, write_json_atomically
from python.storage.base import Storage


def _details_map_to_payload(details: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "version": config.VERSION,
        "updated_timestamp": jsonio.now_iso_timestamp(),
        "details": details,
    }


class JsonStorage(Storage):
    def get_scraping_names(self) -> List[str]:
        names: List[str] = []
        data_dir = config.DATA_DIR
        if not os.path.isdir(data_dir):
            return names
        for file_name in sorted(os.listdir(data_dir)):
            if file_name.startswith("data_") and file_name.endswith(".json"):
                name = file_name[5:-5]
                names.append(name)
        return names

    def read_scraping(self, name: str) -> Optional[Dict[str, Any]]:
        path = config.data_file(name)
        return read_json(path, None)

    def write_scraping(self, name: str, payload: Dict[str, Any]) -> None:
        path = config.data_file(name)
        write_json_atomically(path, payload)

    def read_details(self, base_name: str) -> Dict[str, Any]:
        path = config.details_file(base_name)
        return _read_details_json(path)

    def write_details(self, base_name: str, details: Dict[str, Any]) -> None:
        path = config.details_file(base_name)
        write_json_atomically(path, _details_map_to_payload(details))

    def read_history_scrapes(self) -> List[Dict[str, Any]]:
        path = config.scrapes_file()
        data = read_json(path, None)
        if isinstance(data, dict) and isinstance(data.get("scrapes"), list):
            return list(data.get("scrapes"))
        return []

    def write_history_scrapes(self, scrapes: List[Dict[str, Any]]) -> None:
        path = config.scrapes_file()
        write_json_atomically(path, {"scrapes": scrapes})

    def read_history_modifications(self) -> Dict[str, Any]:
        path = config.modifications_file()
        data = read_json(path, None)
        if isinstance(data, dict):
            return data
        return {}

    def write_history_modifications(self, payload: Dict[str, Any]) -> None:
        path = config.modifications_file()
        write_json_atomically(path, payload)

    def read_blacklist(self) -> Dict[str, Any]:
        data = read_json(config.blacklist_file(), None)
        if isinstance(data, dict):
            return data
        return {}

    def write_blacklist(self, blacklist: Dict[str, Any]) -> None:
        write_json_atomically(config.blacklist_file(), blacklist)

    def read_companies(self) -> Dict[str, Any]:
        path = config.companies_file()
        data = read_json(path, None)
        if isinstance(data, dict):
            return data
        return {}

    def write_companies(self, payload: Dict[str, Any]) -> None:
        path = config.companies_file()
        write_json_atomically(path, payload)

    def read_history_offers(self, base_name: str) -> Dict[str, Any]:
        path = config.history_file(base_name)
        data = read_json(path, None)
        if isinstance(data, dict):
            return data
        return {}

    def write_history_offers(self, base_name: str, history: Dict[str, Any]) -> None:
        path = config.history_file(base_name)
        write_json_atomically(path, history)

    def read_scrape_state(self) -> Optional[Dict[str, Any]]:
        path = config.scrape_state_file()
        data = read_json(path, None)
        if isinstance(data, dict):
            return data
        return None

    def write_scrape_state(self, payload: Dict[str, Any]) -> None:
        path = config.scrape_state_file()
        write_json_atomically(path, payload)

    def delete_scrape_state(self) -> None:
        path = config.scrape_state_file()
        try:
            if os.path.exists(path):
                os.remove(path)
        except OSError:
            pass

    def delete_scraping(self, name: str) -> List[str]:
        moved: List[str] = []
        trash = config.trash_dir()
        os.makedirs(trash, exist_ok=True)
        for src in (
            config.data_file(name),
            config.history_file(name),
            config.details_file(name),
        ):
            if not os.path.exists(src):
                continue
            file_name = os.path.basename(src)
            try:
                shutil.move(src, os.path.join(trash, file_name))
                moved.append(file_name)
            except OSError:
                continue
        return moved

    def list_data_files(self) -> List[str]:
        files: List[str] = []
        data_dir = config.DATA_DIR
        if not os.path.isdir(data_dir):
            return files
        for file_name in sorted(os.listdir(data_dir)):
            files.append(file_name)
        return files

    def list_all_offers(self, base_name: str) -> List[Tuple[str, Dict[str, Any]]]:
        payload = self.read_scraping(base_name)
        offers: List[Tuple[str, Dict[str, Any]]] = []
        if not payload:
            return offers
        raw = payload.get("offers", [])
        if not isinstance(raw, list):
            return offers
        for offer in raw:
            if not isinstance(offer, dict):
                continue
            offer_id = str(
                offer.get("number")
                or offer.get("id")
                or offer.get("idOffreEmploi")
                or offer.get("numero")
                or ""
            )
            if offer_id:
                offers.append((offer_id, offer))
        return offers

    def get_offer_details(self, base_name: str, offer_id: str) -> Optional[Dict[str, Any]]:
        details = self.read_details(base_name)
        if offer_id in details and isinstance(details[offer_id], dict):
            return details[offer_id]
        return None

    def exists(self, kind: str, **kwargs: Any) -> bool:
        if kind == "scraping":
            name = kwargs.get("name", "")
            return os.path.exists(config.data_file(name))
        if kind == "details":
            base_name = kwargs.get("base_name", "")
            return os.path.exists(config.details_file(base_name))
        return False
