"""Parse downloaded public static snapshots without executing remote JavaScript.

Run after import_navigators.py. Keeps the Excel outputs unchanged and creates
data/simulator/{catalog.json,catalog.sqlite,comparison.json,manifest.json}.
"""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import tempfile

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/site-source"
OUT = ROOT / "data/simulator"
BASE = "https://uwo-fleet-simulator.web.app/"
VERSION = "260913_1137"
STAT_LABELS = dict(zip(
    ["gunnery", "ramming", "support", "boarding", "archaeology", "aesthetics", "scouting", "supply", "purchase", "sales", "negotiation", "exchange"],
    ["포격술", "충파술", "지원술", "백병술", "박물학", "심미학", "척후법", "보급법", "구매 전략", "판매 전략", "협상 전략", "교환 전략"]))
EFFECT_SLOTS = [("job", 10), ("job", 10), ("character", 30), ("character", 30),
                ("job", 50), ("job", 50), ("character", 70), ("character", 70),
                ("potential", None), ("potential", None), ("relationship", None),
                ("relationship", None), ("transcendence_3", None)]
SKILL_SLOTS = [("level_skill", 1), ("level_skill", 50), ("relationship", None)]


def uid(kind, name):
    return kind + "_" + hashlib.sha256(name.encode()).hexdigest()[:20]


def write_json(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    text = (RAW / "data.js").read_text(encoding="utf-8")
    # The downloaded data file has one JSON value per named property line.
    # Fail on a layout change instead of evaluating arbitrary JS.
    tables = {}
    for match in re.finditer(r"^  (\w+): (.*?)(?:,)?$", text, re.M):
        tables[match[1]] = json.loads(match[2])
    assert set(tables) == {"effects", "skills", "mateExtra", "jobs", "jobEffects", "languages", "tradeItems", "effectAlias"}
    text = (RAW / "mates-baked.js").read_text(encoding="utf-8")
    assignment = re.search(r"window\.FS_MATES_BAKED\s*=\s*(\[.*\]);\s*$", text, re.S)
    if not assignment:
        raise ValueError("Unsupported public snapshot format")
    mates = json.loads(assignment[1])
    assert len({m["name"] for m in mates}) == len(mates)
    excel = json.loads((ROOT / "data/navigators.json").read_text(encoding="utf-8"))
    game_rules = json.loads((ROOT / "data/game-rules.json").read_text(encoding="utf-8"))
    old = {n["name"]: n for n in excel["navigators"]}
    old_grants = {(g["navigator_id"], g["source_column"]): g for g in excel["grants"]}
    definitions, grants, navigators, changes = {}, [], [], []

    for kind, table in [("effect", "effects"), ("skill", "skills")]:
        for name, definition in tables[table].items():
            category = "combat" if kind == "skill" else definition.get("scope")
            assert category in ("adventure", "trade", "combat"), name
            scope = "ship" if category == "combat" else "fleet"
            # Source calculator aggregates these fleet-wide, but description
            # and workbook specify the embarked galley. Keep the conflict visible.
            scope_conflict = "갤리" in definition.get("desc", "") and "선박" in definition.get("desc", "")
            record = {"id": uid(kind, name), "name": name, "kind": kind,
                      "category": {"adventure": "모험", "trade": "교역", "combat": "전투"}[category],
                      "description": definition.get("desc", ""),
                      "categories": definition.get("cat", []),
                      "level_values": definition.get("lv", []),
                      "value_cap_raw": definition.get("cap") or None,
                      "simulator_level_cap": 10,
                      "simulator_aggregation_scope": scope,
                      "aggregation_scope": None if scope_conflict else scope,
                      "rule_status": "scope_conflict" if scope_conflict else "reference_simulator_not_game_verified",
                      "definition_available": True, "raw_definition": definition}
            definitions[record["id"]] = record

    for m in mates:
        mid = uid("navigator", m["name"])
        assert len(m["effects"]) == 13 and len(m["skills"]) == 3
        assert set(m["stats"]) == set(STAT_LABELS), m["name"]
        assert all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in m["stats"].values())
        extra = tables["mateExtra"].get(m["name"], {})
        record = {"id": mid, "name": m["name"], "grade": m["grade"], "type": m["type"], "job": m["job"],
                  "stats": {STAT_LABELS[k]: v for k, v in m["stats"].items()}, "stat_basis": None,
                  "portrait_id": m.get("portraitId"), "languages": m.get("langs", []),
                  "hire_condition": m.get("hireCondition") or extra.get("require"),
                  "innate": m.get("innate", []), "admiral_commands": m.get("admiralCommands", []),
                  "job_effects": tables["jobEffects"].get(m["job"], []),
                  "supplementary_source": extra, "source": "public_baked_snapshot"}
        navigators.append(record)
        previous = old.get(m["name"])
        if previous:
            for field in ["grade", "type", "job", "stats"]:
                if previous[field] != record[field]:
                    changes.append({"name": m["name"], "field": field, "excel": previous[field], "website": record[field]})
        for kind, key, slots, column_base in [("effect", "effects", EFFECT_SLOTS, 18), ("skill", "skills", SKILL_SLOTS, 30)]:
            for index, raw in enumerate(m[key]):
                assert isinstance(raw, str)
                # Compare original slots, retaining genuine additions/removals.
                col = column_base + index
                column = chr(64 + col) if col <= 26 else "A" + chr(64 + col - 26)
                before = old_grants.get((mid, column), {}).get("raw_text") if not (kind == "effect" and index == 12) else None
                if previous and (before or "") != raw:
                    changes.append({"name": m["name"], "field": f"{key}[{index}]", "excel": before, "website": raw or None})
                if not raw.strip():
                    continue
                match = re.fullmatch(r"(.*?)\s*LV\s*(\d+)", raw.strip(), re.I)
                raw_name = match[1].strip() if match else raw.strip()
                level = int(match[2]) if match else 1
                assert level > 0
                name = tables["effectAlias"].get(raw_name, raw_name)
                aid = uid(kind, name)
                if aid not in definitions:
                    definitions[aid] = {"id": aid, "name": name, "kind": kind,
                                        "category": "전투" if kind == "skill" else None,
                                        "aggregation_scope": "ship" if kind == "skill" else None,
                                        "definition_available": False, "rule_status": "missing_definition",
                                        "level_values": [], "description": None}
                grants.append({"navigator_id": mid, "ability_id": aid, "slot_index": index,
                               "kind": kind, "origin": slots[index][0], "unlock_level": slots[index][1],
                               "level": level, "level_basis": "reference_simulator_splitLevel",
                               "active": None,
                               "activation_rule": "third_transcendence_completed" if slots[index][0] == "transcendence_3" else "selected_and_equipped" if kind == "effect" else "skill_available",
                               "raw_text": raw, "alias_applied": name != raw_name})

    counts = {"navigators": len(navigators), "effects_with_definitions": len(tables["effects"]),
              "skills_with_definitions": len(tables["skills"]),
              "effect_grants": sum(g["kind"] == "effect" for g in grants),
              "skill_grants": sum(g["kind"] == "skill" for g in grants)}
    missing = [d["name"] for d in definitions.values() if not d["definition_available"]]
    conflicts = [d["name"] for d in definitions.values() if d["rule_status"] == "scope_conflict"]
    incomplete_values = [{"name": d["name"], "kind": d["kind"],
                          "missing_levels": [i + 1 for i, value in enumerate(d["level_values"]) if not value]}
                         for d in definitions.values() if d["definition_available"] and not all(d["level_values"])]
    report = {"counts": counts, "added_navigators": sorted(set(m["name"] for m in mates) - set(old)),
              "excel_only_navigators": sorted(set(old) - set(m["name"] for m in mates)),
              "changed_fields": dict(Counter(c["field"].split("[")[0] for c in changes)),
              "missing_definitions": missing, "scope_conflicts": conflicts,
              "incomplete_level_values": incomplete_values, "changes": changes}
    manifest = {"source_name": "UWO Fleet Simulator by Astraeus", "source_url": BASE,
                "page_version": VERSION, "snapshot_generated_at_utc": "2026-09-02T11:11:00Z",
                "imported_at_utc": datetime.now(timezone.utc).isoformat(),
                "source_mode": "public_static_fallback_not_live_firestore", "files": [],
                "limitations": ["Not verified against live game data", "Stats growth basis unknown",
                                "Reference simulator sums all owned effects, without active selection",
                                "Skill/effect stacking rules are source implementation, not game verification",
                                "Missing definitions and scope conflicts require review"]}
    for name, relative in [("data.js", "data.js"), ("mates-baked.js", "mates-baked.js"), ("core.js", "js/core.js"), ("calc.js", "js/calc.js"), ("app.js", "js/app.js")]:
        manifest["files"].append({"file": name, "url": BASE + relative + "?v=" + VERSION,
                                  "sha256": hashlib.sha256((RAW / name).read_bytes()).hexdigest()})
    payload = {"schema_version": 1, "source": manifest, "navigators": navigators,
               "abilities": list(definitions.values()), "grants": grants,
               "aliases": tables["effectAlias"], "jobs": tables["jobEffects"], "game_rules": game_rules,
               "review": {"missing_definitions": missing, "scope_conflicts": conflicts,
                          "incomplete_level_values": incomplete_values}}
    OUT.mkdir(exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=OUT, suffix=".sqlite", delete=False) as file:
        staging = Path(file.name)
    db = sqlite3.connect(staging)
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript("""
        CREATE TABLE navigator (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, grade TEXT NOT NULL,
          type TEXT NOT NULL, job TEXT NOT NULL, detail_json TEXT NOT NULL);
        CREATE TABLE navigator_stat (navigator_id TEXT REFERENCES navigator(id), name TEXT NOT NULL,
          value REAL NOT NULL, basis TEXT, PRIMARY KEY(navigator_id,name));
        CREATE TABLE ability (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
          category TEXT, aggregation_scope TEXT, detail_json TEXT NOT NULL, UNIQUE(kind,name));
        CREATE TABLE ability_level (ability_id TEXT REFERENCES ability(id), level INTEGER NOT NULL,
          value_text TEXT, PRIMARY KEY(ability_id,level));
        CREATE TABLE navigator_ability (navigator_id TEXT REFERENCES navigator(id), ability_id TEXT REFERENCES ability(id),
          kind TEXT NOT NULL, slot_index INTEGER NOT NULL, level INTEGER NOT NULL, origin TEXT NOT NULL,
          unlock_level INTEGER, active INTEGER, activation_rule TEXT NOT NULL, raw_text TEXT NOT NULL,
          PRIMARY KEY(navigator_id,kind,slot_index));
        CREATE INDEX ability_holders ON navigator_ability(ability_id);
        CREATE TABLE job_effect (job TEXT NOT NULL, slot_index INTEGER NOT NULL, detail_json TEXT NOT NULL, PRIMARY KEY(job,slot_index));
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
    """)
    for n in navigators:
        db.execute("INSERT INTO navigator VALUES(?,?,?,?,?,?)", tuple(n[k] for k in ["id", "name", "grade", "type", "job"]) + (json.dumps(n, ensure_ascii=False),))
        db.executemany("INSERT INTO navigator_stat VALUES(?,?,?,NULL)", [(n["id"], k, v) for k, v in n["stats"].items()])
    for a in definitions.values():
        db.execute("INSERT INTO ability VALUES(?,?,?,?,?,?)", (a["id"], a["name"], a["kind"], a.get("category"), a.get("aggregation_scope"), json.dumps(a, ensure_ascii=False)))
        db.executemany("INSERT INTO ability_level VALUES(?,?,?)", [(a["id"], i + 1, v or None) for i, v in enumerate(a["level_values"])])
    for g in grants:
        db.execute("INSERT INTO navigator_ability VALUES(?,?,?,?,?,?,?,?,?,?)", tuple(g[k] for k in ["navigator_id", "ability_id", "kind", "slot_index", "level", "origin", "unlock_level", "active", "activation_rule", "raw_text"]))
    for job, items in tables["jobEffects"].items():
        db.executemany("INSERT INTO job_effect VALUES(?,?,?)", [(job, i, json.dumps(item, ensure_ascii=False)) for i, item in enumerate(items)])
    for key, value in [("source", manifest), ("comparison", report), ("aliases", tables["effectAlias"]), ("game_rules", game_rules)]:
        db.execute("INSERT INTO metadata VALUES(?,?)", (key, json.dumps(value, ensure_ascii=False)))
    assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert not db.execute("PRAGMA foreign_key_check").fetchall()
    assert db.execute("SELECT count(*) FROM navigator_stat").fetchone()[0] == 12 * len(mates)
    assert len(grants) == sum(bool(s.strip()) for m in mates for k in ("effects", "skills") for s in m[k])
    db.commit()
    db.close()
    staging.replace(OUT / "catalog.sqlite")
    write_json("catalog.json", payload)
    write_json("comparison.json", report)
    write_json("manifest.json", manifest)
    print(json.dumps({**{k: v for k, v in report.items() if k not in ("changes", "incomplete_level_values")},
                      "incomplete_value_tables": len(incomplete_values)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
