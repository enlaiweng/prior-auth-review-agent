#!/usr/bin/env python3
"""Build the labeling practice page from the two practice cases and the training guide.

Usage (from the repository root): python3 eval/tools/build_training_page.py
Reads:
  data/practice/practice_*/bundle.json       made by eval/tools/render_case.py from each practice spec and note
  data/practice/practice_*/answer.yaml       the worked answer, written from the criteria and the routing rules only
  data/practice/practice_*/walkthrough.yaml  optional: a guided, step-by-step walkthrough of that case
  eval/labeling/TRAINING.md                  the training guide
Writes:
  data/practice/practice_*/case_page.md  the practice record as a readable page
  eval/labeling/TRAINING.md              only its "walkthrough, in writing" section, between the two marker lines
  eval/labeling/training.html            one self-contained page: the guide, the practice cases, the guided
                                         walkthrough, and a check

The practice page is the labeling page itself (eval/tools/build_case_pages.py), changed in a few named places:
its own title and browser storage, practice cases instead of the golden set, no download, a "Check my answers"
button that shows the worked answer beside yours, and a box above the form that walks through a case one step at
a time, highlighting the part of the record and the part of the form each step talks about. The record, the form,
and the "Policy and criteria" panel are built by the same code as the real page, so practicing on it is practicing
on the real thing. Each walkthrough step that tells you what to click is checked here against the worked answer.
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
# The names the form shows for each block (CRIT in the labeling page), for the written walkthrough.
FORM_NAMES = {"C1_red_flag": "C1 red flag", "C2_conservative_4wk": "C2 conservative care, four weeks",
              "C3_informs_management": "C3 informs management", "C4_no_duplicate_imaging": "C4 no duplicate imaging",
              "routing": "Routing"}
WALK_START = "<!-- walkthrough start"
WALK_END = "<!-- walkthrough end -->"
# Shown on a practice case that has no walkthrough, for labeling it on your own.
CHECKLIST = [
    "The request: note the request date.",
    "The patient.",
    "Conditions: note when the back pain began (the onset date).",
    "Visits, in date order.",
    "Procedures: count the weeks of any treatment.",
    "Imaging reports and Medications, if the case has them.",
    "Observations: the exam.",
    "The visit note, every paragraph.",
    "C1: go through the red-flag list. Where is each one written?",
    "C2: the three parts (four weeks of care in a structured entry, no response, a month of symptoms).",
    "C3: the two parts (surgery or an aggressive treatment considered, and the MRI would change the choice).",
    "C4: any earlier imaging of the lower back?",
    "Routing: the four questions, in order, stopping at the first yes.",
]


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


def load_walk(case_dir, v, ans):
    """The case's walkthrough, checked against the page and the worked answer, or None if it has none."""
    path = os.path.join(case_dir, "walkthrough.yaml")
    if not os.path.exists(path):
        return None
    w = yaml.safe_load(open(path))
    assert set(w) == {"intro", "steps"}, f"{path}: needs intro and steps"
    n = len(w["steps"])
    assert f"there are {n} steps" in w["intro"]["text"], f"{path}: the introduction must say there are {n} steps"
    ok, answered = set(all_ids(v)), set()
    for k, s in enumerate(w["steps"], 1):
        where = f"{path} step {k}"
        assert set(s) <= {"title", "highlight", "focus", "expect", "tick", "text"}, f"{where}: unknown field"
        assert not re.match(r"Step \d", s["title"]), f"{where}: the page numbers the steps; leave it out of the title"
        assert s["text"].strip(), f"{where}: no text"
        for x in s["highlight"] + s.get("tick", []):
            assert x in ok, f"{where}: {x} is not an id on the page"
        f = s.get("focus")
        if f is None:
            assert "expect" not in s and "tick" not in s, f"{where}: expect and tick need a focus"
            continue
        assert f in FORM_NAMES, f"{where}: focus {f}"
        answered.add(f)
        want = ans["routing"] if f == "routing" else ans["criteria"][f]["status"]
        assert s.get("expect") == want, f"{where}: tells you to click {s.get('expect')}, the worked answer says {want}"
        if f == "routing":
            assert "tick" not in s, f"{where}: routing has no evidence"
        else:
            want_ev = ans["criteria"][f]["evidence"]
            assert sorted(s.get("tick", [])) == sorted(want_ev), f"{where}: tick must be the worked evidence {want_ev}"
    assert answered == set(FORM_NAMES), f"{path}: must answer every criterion and the routing"
    return w


def walk_md(case, w):
    """The walkthrough written out, for the end of TRAINING.md."""
    out = ["## The walkthrough, in writing", "",
           f"These are the steps the guided walkthrough shows for {name_of(case)}, for reading ahead or printing. "
           "On the practice page, each step also highlights the part of the record it talks about.", ""]
    for k, s in enumerate(w["steps"], 1):
        out += [f"### Step {k}. {s['title']}", ""]
        look = ", ".join(f"`{x}`" for x in s["highlight"])
        form = f"the **{FORM_NAMES[s['focus']]}** block" if s.get("focus") else ""
        if look or form:
            out += [" ".join(p for p in ((f"**Look at:** {look}." if look else ""),
                                         (f"**In the form:** {form}." if form else "")) if p), ""]
        out += [s["text"].strip(), ""]
    return "\n".join(out)


def update_guide(written):
    """Put the written walkthrough between the marker lines in TRAINING.md, and return the guide's text."""
    text = open(GUIDE).read()
    assert text.count(WALK_START) == 1 and text.count(WALK_END) == 1, f"{GUIDE}: the walkthrough marker lines"
    i, j = text.index(WALK_START), text.index(WALK_END)
    start_end = text.index("\n", i) + 1
    assert start_end <= j, f"{GUIDE}: the walkthrough end marker must come after the start marker"
    new = text[:start_end] + (written + "\n" if written else "") + text[j:]
    if new != text:
        open(GUIDE, "w").write(new)
    return new


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
        if not line.strip() or line.startswith("<!--"):  # comment lines (the walkthrough markers) are not shown
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
:root{--hl:#fff1b3;--hlsoft:#fffbea;--hlline:#d9a90a}
@media (prefers-color-scheme: dark){:root{--hl:#463b12;--hlsoft:#2b2614;--hlline:#c9a227}}
.hl{background:var(--hl);box-shadow:0 0 0 2px var(--hlline);border-radius:6px;scroll-margin-top:84px}
ul.items li.hl,.para.hl,.card>p.hl{padding-left:6px;padding-right:6px}
.crit.hl{padding:10px 8px;background:var(--hlsoft)}.crit.hl .ev label{background:var(--card)}
.crit.hl .ev label.tick{border:2px solid var(--hlline);background:var(--hl);font-weight:600}
summary.tick{color:var(--fg);font-weight:600}
.walk{border:2px solid var(--accent);font-size:14px;padding-bottom:0}
.side .walk{position:sticky;top:0;z-index:3;max-height:52vh;overflow:auto;box-shadow:0 6px 14px rgba(0,0,0,.14)}
.walk h2{font-size:16px}.walk p{margin:7px 0}.walk li{margin:3px 0}.walk ul,.walk ol{padding-left:20px}
.walkpos{font-size:12px;color:var(--muted);margin:0 0 4px!important;text-transform:uppercase;letter-spacing:.04em}
.walkbtns{position:sticky;bottom:0;background:var(--card);display:flex;gap:8px;flex-wrap:wrap;padding:10px 0 12px;margin-top:6px;border-top:1px solid var(--line)}
.btn[disabled]{opacity:.4;cursor:default}
.wmore{margin-left:auto;align-self:center;font-size:12px;color:var(--muted)}
#checkout{scroll-margin-top:84px}
.turn ol{padding-left:20px;font-size:14px}.turn li{margin:3px 0}
@media (max-width:900px){.side .walk{position:fixed;left:8px;right:8px;bottom:8px;top:auto;max-height:46vh;z-index:9;margin:0}body.walking{padding-bottom:50vh}}
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
// The guided walkthrough. walk is {case, step}: step 0 is the introduction, 1 to N the steps. It is kept in this
// browser under its own name, so a closed page reopens on the same step.
const WALKS = __WALKS__;
const CHECKLIST_HTML = __CHECKLIST__;
const WKEY = "labeling-practice-walk-v1";
let walk = null, turnOpen = false;
try { walk = JSON.parse(localStorage.getItem(WKEY) || "null"); } catch (e) { walk = null; }
if (!walk || !WALKS[walk.case] || !(walk.step >= 0 && walk.step <= WALKS[walk.case].steps.length)) walk = null;
function saveWalk(){ try { if (walk) localStorage.setItem(WKEY, JSON.stringify(walk)); else localStorage.removeItem(WKEY); } catch (e) {} }
function walkHtml(c){
  const w = WALKS[c];
  if (walk && walk.case === c) {
    const n = w.steps.length, i = walk.step, s = i ? w.steps[i-1] : w.intro;
    let h = '<div class="card walk" id="walkcard"><p class="walkpos">Guided walkthrough, '+(i ? 'step '+i+' of '+n : 'introduction')+'</p>';
    h += '<h2>'+(i ? 'Step '+i+'. ' : '')+esc(s.title)+'</h2>'+s.html+'<div class="walkbtns">';
    h += '<button class="btn ghost" id="wback"'+(i ? '' : ' disabled')+'>Back</button>';
    h += i < n ? '<button class="btn" id="wnext">Next</button><button class="btn ghost" id="wexit">Exit walkthrough</button>'
               : '<button class="btn" id="wexit">Exit walkthrough</button>';
    return h+'<span class="wmore" id="wmore">More in this box, scroll down &#8595;</span></div></div>';
  }
  if (w) return '<div class="card"><h2>New to labeling?</h2><p>The guided walkthrough labels this case with you, one step at a time, in about 30 minutes. It highlights each part of the record as it explains it, and tells you what to click.</p><button class="btn" id="wstart">Start the guided walkthrough</button></div>';
  return '<div class="card turn"><h2>Your turn</h2><p>Label this case on your own, the way the walkthrough did. When the line under the form turns green, click <b>Check my answers</b>.</p><details id="turnlist"'+(turnOpen ? ' open' : '')+'><summary>Show the checklist</summary>'+CHECKLIST_HTML+'</details></div>';
}
function walkStep(){ return walk && walk.step && walk.case === CASES[cur].case ? WALKS[walk.case].steps[walk.step-1] : null; }
function moreHint(card){ const m = document.getElementById("wmore"); if (m) m.style.visibility = card.scrollTop + card.clientHeight < card.scrollHeight - 4 ? "visible" : "hidden"; }
function walkKeep(){ const card = document.getElementById("walkcard"); return card ? card.scrollTop : 0; }
function afterRender(keep){
  const card = document.getElementById("walkcard");
  document.body.classList.toggle("walking", !!card);
  if (card) { card.scrollTop = keep; card.onscroll = () => moreHint(card); moreHint(card); }
  const s = walkStep(); if (!s) return;
  document.querySelectorAll("#casecol code.id").forEach(el => { if (s.highlight.includes(el.textContent)) { const t = el.closest("li,p"); if (t) t.classList.add("hl"); } });
  const inp = s.focus && document.querySelector('#formcol input[name="'+s.focus+'"]'), box = inp && inp.closest(".crit");
  if (!box) return;
  box.classList.add("hl");
  const tick = s.tick || [];
  box.querySelectorAll(".ev input[type=checkbox]").forEach(cb => { if (tick.includes(cb.value)) cb.closest("label").classList.add("tick"); });
  const sum = box.querySelector("summary"); if (sum && tick.length) sum.classList.add("tick");
}
function scrollToStep(){
  const card = document.getElementById("walkcard"); if (!card) return;
  card.scrollTop = 0; moreHint(card);
  const side = document.getElementById("formcol"), hl = document.querySelector("#casecol .hl"), box = document.querySelector("#formcol .crit.hl");
  if (getComputedStyle(card).position === "fixed") {  // narrow screen: the step box sits at the bottom
    const t = box || hl; if (t) t.scrollIntoView({block: "start"}); else window.scrollTo(0, 0);
    return;
  }
  if (hl) hl.scrollIntoView({block: "start"}); else if (!walk.step) window.scrollTo(0, 0);
  side.scrollTop = box ? Math.max(0, side.scrollTop + box.getBoundingClientRect().top - side.getBoundingClientRect().top - card.offsetHeight - 12) : 0;
}
function goStep(i){ walk.step = i; saveWalk(); render(); scrollToStep(); }
function bindWalk(c){
  const on = (id, f) => { const el = document.getElementById(id); if (el) el.onclick = f; };
  on("wstart", () => { walk = {case: c, step: 0}; goStep(0); });
  on("wback", () => goStep(Math.max(0, walk.step - 1)));
  on("wnext", () => goStep(Math.min(WALKS[c].steps.length, walk.step + 1)));
  on("wexit", () => { walk = null; saveWalk(); render(); window.scrollTo(0, 0); document.getElementById("formcol").scrollTop = 0; });
  const d = document.getElementById("turnlist"); if (d) d.ontoggle = () => { turnOpen = d.open; };
}
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
function showCheckout(){  // below the step box when the walkthrough is open, else at the top
  const el=document.getElementById("checkout"), card=document.getElementById("walkcard"), side=document.getElementById("formcol");
  if(card && getComputedStyle(card).position!=="fixed") side.scrollTop += el.getBoundingClientRect().top - side.getBoundingClientRect().top - card.offsetHeight - 12;
  else el.scrollIntoView();
}
function bindCheck(c){
  const msg=document.getElementById("checkmsg");
  document.getElementById("check").onclick=()=>{
    if(!complete(c)){ msg.innerHTML='Finish every criterion and the routing first. <a href="#" id="anyway">Show the worked answer anyway</a>';
      document.getElementById("anyway").onclick=e=>{ e.preventDefault(); shown[c]=true; render(); showCheckout(); }; return; }
    shown[c]=true; render(); showCheckout(); };
  document.getElementById("clear").onclick=()=>{ delete store[c]; shown[c]=false; save(); render(); };
}
function openGuide(){ document.getElementById("guidebody").innerHTML=GUIDE_HTML; document.getElementById("guidedlg").style.display="block"; }
document.getElementById("showguide").onclick=openGuide;
document.getElementById("closeguide").onclick=()=>{ document.getElementById("guidedlg").style.display="none"; };
if(walk){ const k=CASES.findIndex(v=>v.case===walk.case); if(k>=0) cur=k; }
if(!walk && !CASES.some(v=>{ const r=store[v.case]; return r && (r.routing || CRIT.some(([k])=>r.criteria[k].status)); })) openGuide();
render();
if(walk) scrollToStep();
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
     'if(shown[c]) h+=checkHtml(c);\n  document.getElementById("formcol").innerHTML=walkHtml(c)+h; bindCheck(c); bindWalk(c);'),
    ("function render(){ renderNav(); renderCase(); renderForm(); }",
     "function render(){ const keep=walkKeep(); renderNav(); renderCase(); renderForm(); afterRender(keep); }"),
    ('document.getElementById("zip").onclick=()=>{', "const unusedDownload=()=>{  // the practice page has no download"),
    ('"Complete, but this browser is not saving it; download the labels before closing the page."',
     '"Complete, but this browser is not saving it."'),
    ("\nrender();\n</script>", "\n" + EXTRA_JS),
]


def main():
    views, answers, walks, written = [], {}, {}, []
    for d in sorted(glob.glob(PRACTICE_GLOB)):
        v = b.case_view(d)
        page = b.page_md(v).split("\n")
        assert page[0].startswith("# Case ")
        page[0] = f"# {name_of(v['case'])} (practice case, not part of the golden set)"
        open(os.path.join(d, "case_page.md"), "w").write("\n".join(page))
        views.append(v)
        answers[v["case"]] = load_answer(d, v)
        w = load_walk(d, v, answers[v["case"]])
        if w:
            walks[v["case"]] = {
                "intro": {"title": w["intro"]["title"], "html": md_to_html(w["intro"]["text"])},
                "steps": [{"title": s["title"], "html": md_to_html(s["text"]), "highlight": s["highlight"],
                           "focus": s.get("focus"), "tick": s.get("tick", [])} for s in w["steps"]]}
            written.append(walk_md(v["case"], w))
        print("wrote", os.path.join(d, "case_page.md"))
    assert views, "no practice cases found"
    assert walks, "no practice case has a walkthrough"
    guide = update_guide("\n".join(written))

    def js(x):  # JSON that cannot close the script element it sits in
        return json.dumps(x, ensure_ascii=False).replace("<", "\\u003c")

    head, body = b.policy_text()
    out = b.LABELING_TEMPLATE
    for old, new in CHANGES:
        assert out.count(old) == 1, f"labeling page changed; this text was not found exactly once: {old[:70]}"
        out = out.replace(old, new)
    for ph in ("__CASES__", "__POLICY_HEAD__", "__POLICY_BODY__", "__CRITERIA__", "__OUTPUTS__", "__LEGEND__",
               "__ANSWERS__", "__GUIDE_HTML__", "__NAMES__", "__WALKS__", "__CHECKLIST__"):
        assert out.count(ph) == 1, f"placeholder {ph} is not on the page exactly once"
    checklist = "<ol>" + "".join(f"<li>{inline(x)}</li>" for x in CHECKLIST) + "</ol>"
    out = (out.replace("__CASES__", js(views)).replace("__POLICY_HEAD__", js(head)).replace("__POLICY_BODY__", js(body))
           .replace("__CRITERIA__", js(b.criteria_text())).replace("__OUTPUTS__", js(b.outputs_text()))
           .replace("__LEGEND__", js(b.LEGEND)).replace("__ANSWERS__", js(answers))
           .replace("__GUIDE_HTML__", js(md_to_html(guide)))
           .replace("__NAMES__", js({v["case"]: name_of(v["case"]) for v in views}))
           .replace("__WALKS__", js(walks)).replace("__CHECKLIST__", js(checklist)))
    open(OUT, "w").write(out)
    print("wrote", OUT, f"({len(views)} practice cases)")


if __name__ == "__main__":
    main()
