import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("collector", Path(__file__).resolve().parents[1] / "scripts/collect_world.py")
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


class CollectorTests(unittest.TestCase):
    def test_json_does_not_execute_expressions(self):
        self.assertEqual(c.json_assignment('window.UWO={"name":"a; } b"};', "UWO"), {"name": "a; } b"})
        for source in ['const X = [1].map(alert);', 'const X = (() => 1)();', 'const X = {a:1};']:
            with self.assertRaises(ValueError):
                c.json_assignment(source, "X")

    def test_html_entities_tables_and_levels(self):
        parsed, links = c.parse_page('''<div class="sk-card"><span>기술</span>
        <table><tr><th>레벨</th><th>효과</th></tr><tr><td>2</td><td>+5%</td></tr></table>
        <button data-cb-type="skill" data-cb-id="7" data-cb-name="기술"
        data-cb-vals="{&quot;description&quot;:&quot;A &amp; B&quot;}"></button></div>
        <a href="?page=24">마지막</a><li class="disabled"><a href="?page=25">다음</a></li>
        <script>doNotExecute()</script>''')
        self.assertEqual(parsed["records"][0]["fields"]["description"], "A & B")
        self.assertEqual(parsed["tables"][0]["rows"][1], ["2", "+5%"])
        self.assertIn("+5%", parsed["blocks"][0]["text"])
        self.assertEqual(c.pagination(links + ["https://evil.test/?page=5", "?page=0"], "https://example.test/"), [24])

    def test_new_city_and_coordinate_spaces(self):
        merged = c.merge_cities([{"name": "A", "type": "town", "code": "town_1", "latitude": 30, "longitude": 20}],
                               {"UWO": {"cities": {"a": {"name": "A", "location": [5, 6]},
                                                          "b": {"name": "신도시", "location": [7, 8]}}}})
        self.assertEqual(merged["community_only"], ["신도시"])
        self.assertEqual(merged["cities"][0]["fields"]["latitude"], 30)
        self.assertEqual(merged["cities"][0]["fields"]["tips_map_percent_xy"], [5, 6])
        self.assertNotIn("latitude", merged["cities"][1]["fields"])

    def test_offline_cache_integrity_and_missing(self):
        with tempfile.TemporaryDirectory(dir=c.ROOT) as folder:
            folder = Path(folder)
            url = "https://example.test/data"
            payload = b'{"a":1}'
            meta = {"file": "body.txt", "sha256": c.digest(payload)}
            key = c.digest(json.dumps([url, None], sort_keys=True).encode())
            c.save(folder / (key + ".json"), meta)
            (folder / "body.txt").write_bytes(payload)
            client = c.Client(folder, offline=True)
            with patch.object(c, "urlopen", side_effect=AssertionError("network forbidden")):
                self.assertEqual(client.request(url)[0], payload.decode())
                (folder / "body.txt").write_bytes(b"changed")
                with self.assertRaisesRegex(c.CollectionError, "checksum"):
                    client.request(url)
                with self.assertRaisesRegex(c.CollectionError, "offline cache missing"):
                    client.request(url + "2")

    def test_explicit_alias_does_not_create_duplicate_city(self):
        result = c.merge_cities([{"name": "타마타브", "type": "town", "code": "town_1"}], {
            "UWO": {"cities": {"t": {"name": "타마바브", "location": [1, 2]}}},
            "PORT_ALIAS": {"타마바브": "토아마시나"}, "PORT_RENAME": {"토아마시나": "타마타브"}})
        self.assertEqual(len(result["cities"]), 1)
        self.assertEqual(result["community_only"], [])

    def test_robots_blocks_api_without_request(self):
        client = c.Client(Path("unused"))
        with patch.object(client, "request", return_value=("User-agent: *\nAllow: /\nDisallow: /api/", {})) as request:
            with self.assertRaisesRegex(c.CollectionError, "disallows"):
                client.get("https://uwohelper.co.kr/api/markers.php")
            self.assertEqual(request.call_count, 1)
            self.assertTrue(request.call_args.args[0].endswith("robots.txt"))


if __name__ == "__main__":
    unittest.main()
