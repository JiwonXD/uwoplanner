"""Collect public UWO reference data without executing downloaded JavaScript.

Python 3.10+, standard library only. See docs/world-collection.md.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit, parse_qs, urlencode
from urllib.request import Request, urlopen
from urllib.robotparser import RobotFileParser

ROOT = Path(__file__).resolve().parents[1]
SITES = {"official": "https://uwogl.line.games/map",
         "helper": "https://uwohelper.co.kr/",
         "tips": "https://uwo-tips.netlify.app/",
         "compass": "https://uwo-compass.lifebefore.co.kr/"}
USER_AGENT = "UWOPlanner-Collector/1.0 (+https://github.com/JiwonXD/uwoplanner)"
SECTIONS = ("navigators", "production", "ships", "equipment", "parts", "barter", "investment", "skills")
TIP_TABLES = ("UWO", "PORTS", "VILLAGE_INFO", "SALE", "BASEPTS", "PORT_ALIAS",
              "TITLES", "CHRONICLES", "VSAMP", "SHIPS", "STAFF", "PORT_RENAME",
              "ADMIRAL", "LAND", "PROD", "BUY_EXTRA", "CONSTEL", "VSHEET", "STK_NAME")


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def digest(value):
    return hashlib.sha256(value).hexdigest()


class CollectionError(Exception):
    pass


def robots_allowed(parser, url):
    # urllib.robotparser uses first-match order; public sites commonly put
    # Allow: / before narrower exclusions. Apply longest-match precedence.
    agent = USER_AGENT.split('/')[0].lower()
    groups = [e for e in parser.entries if any(a.lower() in agent for a in e.useragents)]
    if groups:
        specificity = max(len(a) for e in groups for a in e.useragents if a.lower() in agent)
        groups = [e for e in groups if any(len(a) == specificity and a.lower() in agent for a in e.useragents)]
    elif parser.default_entry:
        groups = [parser.default_entry]
    target = urlsplit(url).path or "/"
    if urlsplit(url).query:
        target += "?" + urlsplit(url).query
    matches = []
    for group in groups:
        for rule in group.rulelines:
            pattern = re.escape(rule.path).replace(r"\*", ".*")
            if pattern.endswith(r"\$"):
                pattern = pattern[:-2] + "$"
            if re.match(pattern, target):
                matches.append((len(rule.path.replace("*", "").rstrip("$")), rule.allowance))
    return max(matches, default=(0, True))[1]


class Client:
    def __init__(self, cache, offline=False, refresh=False, delay=1.0):
        self.cache, self.offline, self.refresh, self.delay = cache, offline, refresh, delay
        self.robots, self.last = {}, 0
        self.used = {}

    def request(self, url, form=None):
        key = digest(json.dumps([url, form], sort_keys=True).encode())
        meta_path = self.cache / (key + ".json")
        if meta_path.exists() and (self.offline or not self.refresh):
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            payload = (self.cache / meta["file"]).read_bytes()
            if digest(payload) != meta["sha256"]:
                raise CollectionError("cache checksum mismatch: " + url)
            self.used[key] = meta
            return payload.decode("utf-8-sig"), meta
        if self.offline:
            raise CollectionError("offline cache missing: " + url)
        time.sleep(max(0, self.delay - (time.monotonic() - self.last)))
        data = urlencode(form).encode() if form is not None else None
        req = Request(url, data=data, headers={"User-Agent": USER_AGENT,
                      "Referer": urlsplit(url)._replace(path="/", query="", fragment="").geturl()})
        try:
            with urlopen(req, timeout=30) as response:
                if urlsplit(response.url).netloc != urlsplit(url).netloc:
                    raise CollectionError("cross-host redirect: " + url)
                payload = response.read(16 * 1024 * 1024 + 1)
                if len(payload) > 16 * 1024 * 1024:
                    raise CollectionError("response exceeds 16 MiB: " + url)
                meta = {"url": url, "form": form, "fetched_at": datetime.now(timezone.utc).isoformat(),
                        "last_modified": response.headers.get("Last-Modified"),
                        "etag": response.headers.get("ETag"), "sha256": digest(payload),
                        "file": digest(payload) + ".txt"}
        except (HTTPError, URLError, TimeoutError) as exc:
            raise CollectionError(f"{url}: {exc}") from exc
        finally:
            self.last = time.monotonic()
        self.cache.mkdir(parents=True, exist_ok=True)
        (self.cache / meta["file"]).write_bytes(payload)
        save(meta_path, meta)
        self.used[key] = meta
        return payload.decode("utf-8-sig"), meta

    def get(self, url, form=None):
        origin = urlsplit(url)._replace(path="", query="", fragment="").geturl()
        if origin not in self.robots:
            robots_url = origin + "/robots.txt"
            try:
                text, _ = self.request(robots_url)
            except CollectionError as exc:
                # Only a real HTTP 404 means no robots file. Other failures stop this source.
                if isinstance(exc.__cause__, HTTPError) and exc.__cause__.code == 404:
                    text = "User-agent: *\nAllow: /"
                    payload = text.encode()
                    key = digest(json.dumps([robots_url, None], sort_keys=True).encode())
                    meta = {"url": robots_url, "form": None, "http_status": 404,
                            "fetched_at": datetime.now(timezone.utc).isoformat(),
                            "sha256": digest(payload), "file": digest(payload) + ".txt"}
                    self.cache.mkdir(parents=True, exist_ok=True)
                    (self.cache / meta["file"]).write_bytes(payload)
                    save(self.cache / (key + ".json"), meta)
                    self.used[key] = meta
                else:
                    raise
            parser = RobotFileParser(robots_url)
            parser.parse(text.splitlines())
            self.robots[origin] = parser
        if not robots_allowed(self.robots[origin], url):
            raise CollectionError("robots.txt disallows: " + url)
        return self.request(url, form)


def json_assignment(text, name):
    pattern = r"(?:\b(?:const|let|var)\s+|\bwindow\.)" + re.escape(name) + r"\s*=\s*"
    match = re.search(pattern, text)
    if not match:
        raise ValueError("assignment missing: " + name)
    value, end = json.JSONDecoder().raw_decode(text[match.end():])
    # Reject JSON prefixes of expressions such as [1].map(...), never eval them.
    tail = text[match.end() + end:].lstrip()
    if not tail.startswith((";", "</script>")):
        raise ValueError("not a standalone JSON literal: " + name)
    return value


class Node:
    def __init__(self, tag="root", attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []
        self.disabled = "disabled" in self.attrs.get("class", "").split() or self.attrs.get("aria-disabled") == "true"

    def walk(self):
        pending = [self]
        while pending:
            node = pending.pop()
            yield node
            pending.extend(c for c in reversed(node.children) if isinstance(c, Node))

    def text(self):
        parts, pending = [], [self]
        while pending:
            item = pending.pop()
            if isinstance(item, str):
                parts.append(item.strip())
            elif item.tag not in ("script", "style"):
                pending.extend(reversed(item.children))
        return " ".join(p for p in parts if p)


class Document(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        node.disabled = node.disabled or self.stack[-1].disabled
        self.stack[-1].children.append(node)
        if tag not in {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def parse_page(text):
    nodes = list(Document(text).root.walk())
    records, tables, blocks = [], [], []
    for n in nodes:
        a = n.attrs
        if a.get("data-cb-id") and a.get("data-cb-vals"):
            records.append({"kind": a.get("data-cb-type"), "id": a["data-cb-id"],
                            "name": a.get("data-cb-name"), "fields": json.loads(a["data-cb-vals"])})
        if n.tag == "table":
            rows = []
            for row in n.walk():
                if row.tag == "tr":
                    cells = [c.text() for c in row.children if isinstance(c, Node) and c.tag in ("th", "td")]
                    if cells:
                        rows.append(cells)
            if rows:
                tables.append({"attributes": a, "rows": rows})
        # Retain skill level text and ship values omitted from contribution fields.
        if set(a.get("class", "").split()) & {"sk-card", "ship-col", "dp-src"}:
            blocks.append({"attributes": a, "text": n.text(),
                           "fields": [{"class": c.attrs.get("class"), "text": c.text()}
                                      for c in n.walk() if c.tag in ("td", "th", "span")]})
    links = [n.attrs.get("href") or n.attrs.get("data-href") for n in nodes
             if not n.disabled and (n.attrs.get("href") or n.attrs.get("data-href"))]
    return {"records": records, "tables": tables, "blocks": blocks}, links


def pagination(links, base):
    pages = set()
    for link in links:
        url = urljoin(base, link)
        if urlsplit(url).path != urlsplit(base).path or urlsplit(url).netloc != urlsplit(base).netloc:
            continue
        page = parse_qs(urlsplit(url).query).get("page", [""])[0]
        if page.isdigit() and 1 <= int(page) <= 200:
            pages.add(int(page))
    return sorted(pages)


def merge_cities(official, tips):
    """Prefer community names/attributes, preserving official geographic coordinates.

    Coordinate spaces are separate fields. Conflicts retain both candidates.
    No fuzzy matching, and no claim that fetch time proves data freshness.
    """
    cities = {}
    conflicts = []
    def canonical_name(name):
        renamed = tips.get("PORT_RENAME", {})
        alias = tips.get("PORT_ALIAS", {}).get(name, name)
        return renamed.get(name, renamed.get(alias, name))
    def add(name, field, value, source):
        city = cities.setdefault(name, {"name": name, "fields": {}, "provenance": {}})
        if field in city["fields"] and city["fields"][field] != value:
            conflicts.append({"name": name, "field": field, "previous": city["fields"][field],
                              "previous_source": city["provenance"][field], "selected": value, "source": source})
        city["fields"][field] = value
        city["provenance"][field] = source
    for row in official:
        if row.get("type") == "town":
            for k, v in row.items():
                if k != "name":
                    add(row["name"], k, v, "official.dbMap")
    for key, row in tips.get("UWO", {}).get("cities", {}).items():
        name = canonical_name(row["name"])
        add(name, "tips_id", key, "tips.UWO.cities")
        for k, v in row.items():
            if k == "location":
                add(name, "tips_map_percent_xy", v, "tips.UWO.cities")
            elif k != "name":
                add(name, k, v, "tips.UWO.cities")
        if name != row["name"]:
            add(name, "tips_city_name", row["name"], "tips.PORT_ALIAS/PORT_RENAME")
    for row in tips.get("PORTS", []):
        name = canonical_name(row["name"])
        for k, v in row.items():
            if k not in ("name", "code"):
                add(name, "port_type" if k == "type" else k, v, "tips.PORTS")
        add(name, "tips_port_code", row.get("code"), "tips.PORTS")
        if name != row["name"]:
            add(name, "tips_port_name", row["name"], "tips.PORT_RENAME")
    return {"policy": "community supplement; explicit PORT_RENAME aliases; freshness unverified",
            "cities": list(cities.values()), "conflicts": conflicts,
            "community_only": [n for n, c in cities.items() if "code" not in c["fields"]]}


def collect(args):
    client = Client(args.cache, args.offline, args.refresh, args.delay)
    report = {"schema_version": 1, "sources": {}, "issues": [], "external_requirements": [
        "도시별 판매 수량: 게임 화면 OCR 또는 사용자 제보",
        "부양 일정: 게임 내 교역 이벤트 일정 화면", "부양 상승률: 게임 내 도움말",
        "바닷길 거리: 좌표·해안선·게임 통항 조건으로 별도 계산 (직선거리 대체 금지)"]}
    collected = {}
    def fetch(source, url, form=None):
        try:
            return client.get(url, form)[0]
        except (CollectionError, UnicodeError) as exc:
            report["issues"].append({"source": source, "url": url, "error": str(exc)})
            return None

    for source in args.sources:
        base = SITES[source]
        text = fetch(source, base)
        result = {"datasets": {}, "pages": []}
        collected[source] = result
        if text is None:
            report["sources"][source] = {"status": "unavailable"}
            continue
        names = ("dbMap", "searchList") if source == "official" else TIP_TABLES if source == "tips" else ()
        for name in names:
            try:
                result["datasets"][name] = json_assignment(text, name)
            except (ValueError, RecursionError) as exc:
                report["issues"].append({"source": source, "dataset": name, "error": str(exc)})
        if source == "helper":
            for section in SECTIONS:
                section_url = urljoin(base, section + "/")
                first = fetch(source, section_url)
                if first is None:
                    continue
                page, links = parse_page(first)
                result["pages"].append({"url": section_url, **page})
                for name in ("EQ_DATA", "PART_DATA"):
                    if re.search(r"\b" + name + r"\s*=", first):
                        result["datasets"][name] = json_assignment(first, name)
                last = max(pagination(links, section_url), default=1)
                all_links = list(links)
                if not args.quick:
                    pending, visited = set(range(2, last + 1)), {1}
                    while pending:
                        number = min(pending)
                        pending.remove(number)
                        visited.add(number)
                        url = section_url + "?page=" + str(number)
                        body = fetch(source, url)
                        if body is not None:
                            page, links = parse_page(body)
                            result["pages"].append({"url": url, **page})
                            all_links.extend(links)
                            pending.update(set(pagination(links, section_url)) - visited)
                elif last > 1:
                    report["issues"].append({"source": source, "section": section, "error": f"quick mode: pages 2..{last} skipped"})
                if args.details and section == "navigators":
                    urls = sorted({urljoin(section_url, link) for link in all_links
                                   if re.fullmatch(r"view\.php\?id=\d+(?:&view=\w+)?", link)})
                    for url in urls:
                        body = fetch(source, url)
                        if body is not None:
                            page, _ = parse_page(body)
                            result["pages"].append({"url": url, **page})
            # Deliberately check the policy, do not fetch these if disallowed.
            for endpoint in ("markers.php", "adventures.php", "barter.php", "production.php"):
                body = fetch(source, urljoin(base, "api/" + endpoint))
                if body is not None:
                    try:
                        result["datasets"][endpoint] = json.loads(body)
                    except ValueError as exc:
                        report["issues"].append({"source": source, "dataset": endpoint, "error": str(exc)})
        if source == "official" and args.details:
            for row in result["datasets"].get("searchList", []):
                if row.get("type") not in ("town", "tradeGoods"):
                    continue
                form = {"type": row["type"], "typeSub": "", "seq": row["seq"]}
                body = fetch(source, "https://uwogl.line.games/map/searchInfo", form)
                if body is None:
                    break  # Stop on denied access; never repeatedly hit a blocked endpoint.
                page, _ = parse_page(body)
                result["pages"].append({"url": "https://uwogl.line.games/map/searchInfo", "query": form, **page})
        if source == "compass":
            page, _ = parse_page(text)
            result["pages"].append({"url": base, **page})
            result["assets"] = []
            for node in Document(text).root.walk():
                src = node.attrs.get("src", "")
                if node.tag == "script" and src.startswith("/_next/static/") and ".js" in src:
                    asset_url = urljoin(base, src)
                    body = fetch(source, asset_url)
                    if body is not None:
                        result["assets"].append({"url": asset_url, "sha256": digest(body.encode()), "status": "archived_not_executed"})
            report["issues"].append({"source": source, "error": "route bundle needs a source-specific parser; HTML and static JS archived only"})
        report["sources"][source] = {"status": "collected", "datasets": {k: len(v) for k, v in result["datasets"].items()},
                                     "pages": len(result["pages"])}

    merged = merge_cities(collected.get("official", {}).get("datasets", {}).get("dbMap", []),
                          collected.get("tips", {}).get("datasets", {}))
    report["city_count"] = len(merged["cities"])
    report["community_only_cities"] = merged["community_only"]
    report["limitations"] = ["수집 시각/HTTP Last-Modified는 게임 데이터 최신성의 증명이 아님",
        "이미지 파일은 다운로드하지 않음. URL·아이콘 식별자는 재사용 허가가 아님",
        "지도 좌표계는 출처별로 보존. 이미지 좌표를 위도·경도로 변환하지 않음",
        "계산식과 동적 동선은 원본 스냅샷에 보존하며 실행·정규화하지 않음",
        "HTML 표/카드 필드는 원문 구조. 빈 문자열·누락을 0으로 해석하지 않음",
        "정규화된 도시는 이름 일치 및 도우미의 명시적 PORT_ALIAS/PORT_RENAME만 병합; 나머지 별칭은 검토 필요"]
    report["detail_mode"] = args.details
    report["complete"] = False  # Runtime formulas and external game observations remain unverified.
    for source, value in collected.items():
        summary = report["sources"][source]
        summary["record_counts"] = dict(Counter(kind for kind, _ in sorted({
            (r["kind"], r["id"]) for page in value["pages"] for r in page["records"]})))
        if summary["status"] == "collected" and any(i["source"] == source for i in report["issues"]):
            summary["status"] = "partial"
        save(args.output / (source + ".json"), value)
    save(args.output / "cities.json", merged)
    save(args.output / "manifest.json", {"requests": list(client.used.values())})
    save(args.output / "report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 2 if report["issues"] else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=ROOT / "data/site-source/world")
    parser.add_argument("--output", type=Path, default=ROOT / "data/world")
    parser.add_argument("--sources", nargs="+", choices=SITES, default=list(SITES))
    parser.add_argument("--offline", action="store_true", help="Reparse cached snapshots without network")
    parser.add_argument("--refresh", action="store_true", help="Fetch new snapshots instead of reusing cache")
    parser.add_argument("--quick", action="store_true", help="Only first listing page (reported as partial)")
    parser.add_argument("--details", action="store_true", help="Also collect linked navigator/official details; may take many minutes")
    parser.add_argument("--delay", type=float, default=1.0, help="Minimum interval between requests in seconds (>=1)")
    args = parser.parse_args()
    if args.delay < 1 or (args.offline and args.refresh):
        parser.error("delay must be >=1; offline and refresh are mutually exclusive")
    raise SystemExit(collect(args))


if __name__ == "__main__":
    main()
