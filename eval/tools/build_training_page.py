#!/usr/bin/env python3
"""Build the labeling practice page from the two practice cases and the training guide.

Usage (from the repository root): python3 eval/tools/build_training_page.py
Reads:
  data/practice/practice_*/bundle.json   made by eval/tools/render_case.py from each practice spec and note
  data/practice/practice_*/answer.yaml   the worked answer, written from the criteria and the routing rules only
  eval/labeling/TRAINING.md              the training guide
Writes:
  data/practice/practice_*/case_page.md  the practice record as a readable page
  eval/labeling/training.html            one self-contained page: the guide, the two practice cases, and a check

The practice page is the labeling page itself (eval/tools/build_case_pages.py), changed in a few named places:
its own title and browser storage, practice cases instead of the golden set, no download, and a "Check my
answers" button that shows the worked answer beside yours. The record, the form, and the "Policy and criteria"
panel are built by the same code as the real page, so practicing on it is practicing on the real thing.
The practice cases are not part of the golden set. The agent never runs on them, and they are never used to
tune or score it.
"""
import glob, html, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_case_pages as b  # noqa: E402
import yaml  # noqa: E402

PRACTICE_GLOB = "data/practice/practice_[a-z]"
GUIDE = "eval/labeling/TRAINING.md"
OUT = "eval/labeling/training.html"
CRIT_KEYS = ["C1_red_flag", "C2_conservative_4wk", "C3_informs_management", "C4_no_duplicate_imaging"]


def name_of(case):
    return "Practice " + case.split("_", 1)[1].upper()


def all_ids(v):
    out = [v["request"]["id"], v["patient"]["id"]]
    for s in v["sections"]:
        out += [i["id"] for i in s["items"]]
    out.append(v["note"]["id"])
    out += [p["id"] for p in v["note"]["paragraphs"]]
    return out


def load_answer(case_dir, v):
    a = yaml.safe_load(open(os.path.join(case_dir, "answer.yaml")))
    assert a["case_id"] == v["case"], f"{case_dir}: case_id is {a['case_id']}"
    assert list(a["criteria"]) == CRIT_KEYS, f"{case_dir}: criteria must be {CRIT_KEYS}"
    ok = set(all_ids(v))
    for k, c in a["criteria"].items():
        assert c["status"] in ("supported", "unsupported", "undeterminable"), f"{case_dir} {k}: status {c['status']}"
        for x in c["evidence"] + c.get("also_fine", []):
            assert x in ok, f"{case_dir} {k}: {x} is not an id on the page"
        assert not set(c["evidence"]) & set(c.get("also_fine", [])), f"{case_dir} {k}: an id is listed twice"
        assert c["why"].strip(), f"{case_dir} {k}: no explanation"
        c.setdefault("also_fine", [])
    assert a["expected_routing"] in ("approve", "request", "route"), f"{case_dir}: routing {a['expected_routing']}"
    gap = a.get("named_gap")
    assert (gap is None) == (a["expected_routing"] != "request"), f"{case_dir}: a request needs a gap, nothing else does"
    if a["expected_routing"] == "approve":
        assert a["criteria"]["C3_informs_management"]["status"] == "supported"
        assert a["criteria"]["C4_no_duplicate_imaging"]["status"] == "supported"
        assert "supported" in (a["criteria"]["C1_red_flag"]["status"], a["criteria"]["C2_conservative_4wk"]["status"])
    return {"criteria": a["criteria"], "routing": a["expected_routing"], "gap": gap,
            "routing_why": a["routing_why"].strip(), "lesson": a["lesson"].strip()}


def inline(s):
    s = html.escape(s, quote=False)
    s = re.sub(r"`([^`]+)`", r'<code class="id">\1</code>', s)
    return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)


def md_to_html(text):
    """The few markdown forms TRAINING.md uses: headings, paragraphs, bullet and numbered lists, bold, code."""
    out, para, items, kind = [], [], [], None

    def flush():
        nonlocal para, items, kind
        if para:
            out.append("<p>" + inline(" ".join(para)) + "</p>")
        if items:
            out.append(f"<{kind}>" + "".join(f"<li>{inline(i)}</li>" for i in items) + f"</{kind}>")
        para, items, kind = [], [], None

    for line in text.splitlines():
        m_h = re.match(r"(#{1,3}) (.*)", line)
        m_b = re.match(r"- (.*)", line)
        m_n = re.match(r"\d+\. (.*)", line)
        if not line.strip():
            flush()
        elif m_h:
            flush()
            level = len(m_h.group(1)) + 1  # the page already has an h1
            out.append(f"<h{level}>{inline(m_h.group(2))}</h{level}>")
        elif m_b or m_n:
            want = "ul" if m_b else "ol"
            if para or (kind and kind != want):
                flush()
            kind = want
            items.append((m_b or m_n).group(1))
        elif items:
            items[-1] += " " + line.strip()
        else:
            para.append(line.strip())
    flush()
    return "\n".join(out)


EXTRA_CSS = """
.okmark{color:var(--ok);font-weight:600}.diffmark{color:var(--warn);font-weight:600}
.guide h2{font-size:17px;margin:18px 0 6px}.guide h3{font-size:15px;margin:14px 0 4px;color:var(--fg);text-transform:none;letter-spacing:0}
.guide h4{font-size:14px;margin:12px 0 4px}.guide li{margin:3px 0}.guide p{margin:7px 0}
.practice-note{font-size:13px;color:var(--muted);margin:0}
</style>"""

GUIDE_DIV = """<div id="guidedlg" class="card" style="display:none;position:fixed;inset:60px 16px 16px 16px;z-index:11;overflow:auto;max-width:900px;margin:0 auto">
  <div style="display:flex;justify-content:space-between;align-items:center"><h2>Training guide</h2><button class="btn ghost" id="closeguide">Close</button></div>
  <div class="ref guide" id="guidebody"></div>
</div>
<script>
const CASES"""

EXTRA_JS = r"""
const ANSWERS = __ANSWERS__;
const GUIDE_HTML = __GUIDE_HTML__;
const NAMES = __NAMES__;
function LABEL(c){ return NAMES[c] || c; }
const shown = {};
function checkHtml(c){
  const a=ANSWERS[c], r=rec(c); let h='<div class="card" id="checkout"><h2>Worked answer, '+esc(LABEL(c))+'</h2>';
  CRIT.forEach(([k,label])=>{ const want=a.criteria[k], got=r.criteria[k];
    h+='<div class="crit"><div class="name">'+esc(label)+'</div><p>';
    h+=got.status===want.status?'<span class="okmark">Same as yours: '+esc(want.status)+'</span>':'<span class="diffmark">Worked answer: '+esc(want.status)+'. Yours: '+esc(got.status||"none")+'</span>';
    h+='</p>';
    if(!want.evidence.length){
      const fine=got.evidence.filter(x=>want.also_fine.includes(x)), extra=got.evidence.filter(x=>!want.also_fine.includes(x));
      h+='<p class="status">Evidence in the worked answer: empty'+(got.evidence.length?'':', and yours is empty too.')+'</p>';
      if(fine.length) h+='<p class="status">Also fine: '+fine.map(esc).join(", ")+'</p>';
      if(extra.length) h+='<p class="status">Not needed for this criterion: '+extra.map(esc).join(", ")+'</p>';
    } else {
      const miss=want.evidence.filter(x=>!got.evidence.includes(x)), fine=got.evidence.filter(x=>want.also_fine.includes(x)), extra=got.evidence.filter(x=>!want.evidence.includes(x)&&!want.also_fine.includes(x));
      h+='<p class="status">Evidence in the worked answer: '+want.evidence.map(x=>'<code class="id">'+esc(x)+'</code>'+(got.evidence.includes(x)?' &#10003;':'')).join(" ")+'</p>';
      if(miss.length) h+='<p class="status">Not ticked by you: '+miss.map(esc).join(", ")+'</p>';
      if(fine.length) h+='<p class="status">Also fine: '+fine.map(esc).join(", ")+'</p>';
      if(extra.length) h+='<p class="status">Not needed for this criterion: '+extra.map(esc).join(", ")+'</p>';
    }
    h+='<p>'+esc(want.why)+'</p></div>'; });
  h+='<div class="crit"><div class="name">Routing</div><p>'+(r.routing===a.routing?'<span class="okmark">Same as yours: '+esc(a.routing)+'</span>':'<span class="diffmark">Worked answer: '+esc(a.routing)+'. Yours: '+esc(r.routing||"none")+'</span>')+'</p>';
  if(a.gap) h+='<p class="status">Gap: '+esc(a.gap.criterion)+', '+esc(a.gap.missing)+'</p>';
  h+='<p>'+esc(a.routing_why)+'</p></div>';
  h+='<div class="crit"><div class="name">What this case teaches</div><p>'+esc(a.lesson)+'</p></div></div>';
  return h;
}
function bindCheck(c){
  const msg=document.getElementById("checkmsg");
  document.getElementById("check").onclick=()=>{
    if(!complete(c)){ msg.innerHTML='Finish every criterion and the routing first. <a href="#" id="anyway">Show the worked answer anyway</a>';
      document.getElementById("anyway").onclick=e=>{ e.preventDefault(); shown[c]=true; render(); document.getElementById("checkout").scrollIntoView(); }; return; }
    shown[c]=true; render(); document.getElementById("checkout").scrollIntoView(); };
  document.getElementById("clear").onclick=()=>{ delete store[c]; shown[c]=false; save(); render(); };
}
function openGuide(){ document.getElementById("guidebody").innerHTML=GUIDE_HTML; document.getElementById("guidedlg").style.display="block"; }
document.getElementById("showguide").onclick=openGuide;
document.getElementById("closeguide").onclick=()=>{ document.getElementById("guidedlg").style.display="none"; };
if(!CASES.some(v=>{ const r=store[v.case]; return r && (r.routing || CRIT.some(([k])=>r.criteria[k].status)); })) openGuide();
render();
</script>"""

# Each change to the labeling page is made in one named place, and must match exactly once, so a change to the
# labeling page that would silently break the practice page fails here instead.
CHANGES = [
    ("<title>Golden Set Labeling</title>", "<title>Labeling Practice</title>"),
    ("<h1>Golden Set Labeling</h1>", "<h1>Labeling Practice</h1>"),
    ('<button class="btn ghost" id="showref">Policy and criteria</button>\n    <button class="btn" id="zip">Download all labels (.zip)</button>',
     '<button class="btn ghost" id="showguide">Training guide</button>\n    <button class="btn ghost" id="showref">Policy and criteria</button>'),
    ("</style>", EXTRA_CSS),
    ("<script>\nconst CASES", GUIDE_DIV),
    ('const KEY = "golden-set-labels-v1";', 'const KEY = "labeling-practice-v1";'),
    ('b.textContent=v.case.replace("case_","Case ");', "b.textContent=LABEL(v.case);"),
    ("""let h='<div class="card"><h2>'+esc(v.case.replace("case_","Case "))+'</h2>';""",
     """let h='<div class="card"><h2>'+esc(LABEL(v.case))+'</h2><p class="practice-note">Practice case, not part of the golden set.</p>';"""),
    ("""let h='<div class="card"><h2>Your labels, '+esc(c.replace("case_","case "))+'</h2>';""",
     """let h='<div class="card"><h2>Your practice labels, '+esc(LABEL(c))+'</h2>';"""),
    ("""h+='<details><summary>Preview labels_blind.yaml</summary><pre>'+esc(yaml(c))+'</pre></details>';""",
     """h+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn" id="check">Check my answers</button><button class="btn ghost" id="clear">Clear this case</button></div><p class="status" id="checkmsg"></p>';"""),
    ('document.getElementById("formcol").innerHTML=h;',
     'if(shown[c]) h+=checkHtml(c);\n  document.getElementById("formcol").innerHTML=h; bindCheck(c);'),
    ('document.getElementById("zip").onclick=()=>{', "const unusedDownload=()=>{  // the practice page has no download"),
    ('"Complete, but this browser is not saving it; download the labels before closing the page."',
     '"Complete, but this browser is not saving it."'),
    ("\nrender();\n</script>", "\n" + EXTRA_JS),
]


def main():
    views, answers = [], {}
    for d in sorted(glob.glob(PRACTICE_GLOB)):
        v = b.case_view(d)
        page = b.page_md(v).split("\n")
        assert page[0].startswith("# Case ")
        page[0] = f"# {name_of(v['case'])} (practice case, not part of the golden set)"
        open(os.path.join(d, "case_page.md"), "w").write("\n".join(page))
        views.append(v)
        answers[v["case"]] = load_answer(d, v)
        print("wrote", os.path.join(d, "case_page.md"))
    assert views, "no practice cases found"

    def js(x):  # JSON that cannot close the script element it sits in
        return json.dumps(x, ensure_ascii=False).replace("<", "\\u003c")

    head, body = b.policy_text()
    out = b.LABELING_TEMPLATE
    for old, new in CHANGES:
        assert out.count(old) == 1, f"labeling page changed; this text was not found exactly once: {old[:70]}"
        out = out.replace(old, new)
    for ph in ("__CASES__", "__POLICY_HEAD__", "__POLICY_BODY__", "__CRITERIA__", "__OUTPUTS__", "__LEGEND__",
               "__ANSWERS__", "__GUIDE_HTML__", "__NAMES__"):
        assert out.count(ph) == 1, f"placeholder {ph} is not on the page exactly once"
    out = (out.replace("__CASES__", js(views)).replace("__POLICY_HEAD__", js(head)).replace("__POLICY_BODY__", js(body))
           .replace("__CRITERIA__", js(b.criteria_text())).replace("__OUTPUTS__", js(b.outputs_text()))
           .replace("__LEGEND__", js(b.LEGEND)).replace("__ANSWERS__", js(answers))
           .replace("__GUIDE_HTML__", js(md_to_html(open(GUIDE).read())))
           .replace("__NAMES__", js({v["case"]: name_of(v["case"]) for v in views})))
    open(OUT, "w").write(out)
    print("wrote", OUT, f"({len(views)} practice cases)")


if __name__ == "__main__":
    main()
