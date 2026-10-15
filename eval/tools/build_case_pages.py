#!/usr/bin/env python3
"""Build the readable case pages and the labeling page straight from the bundles.

Usage (from the repository root): python3 eval/tools/build_case_pages.py
Writes:
  data/golden/case_NN/case_page.md   one page per golden case, for reviewers, the owner, and the third reader
  eval/labeling/labeling.html        one self-contained page that shows every case and produces labels_blind.yaml files

Everything on a case page comes from that case's bundle.json, in the record's own words. The script adds only
section headings and the item ids that labels cite as evidence (for example Procedure/case01-pt-01, note:p2).
It adds no description of the case, no flags, and no design notes (Amendment 2). Shown for the patient: age on
the request date and sex. Name, identifiers, address, race, and ethnicity are left out because no criterion
uses them; the agent still receives the full bundle. Paired fairness duplicates get no page, because they
share their original's labels.
"""
import base64, glob, html, json, os, re
from datetime import date

CASE_GLOB = "data/golden/case_[0-9][0-9]"
LABELING_OUT = "eval/labeling/labeling.html"
POLICY = "data/policy/L34220.md"
EVAL_PLAN = "docs/EVAL_PLAN.md"
CHARTER = "docs/CHARTER.md"


def d10(s):
    return str(s)[:10] if s else ""


def text_of(cc):
    if not cc:
        return ""
    return (cc.get("text") or next((c.get("display") for c in cc.get("coding", []) if c.get("display")), "")
            or next((c.get("code") for c in cc.get("coding", []) if c.get("code")), ""))


def med_period(r):
    for di in r.get("dosageInstruction", []):
        bp = di.get("timing", {}).get("repeat", {}).get("boundsPeriod")
        if bp:
            return f"; dosage period {d10(bp['start'])} to {d10(bp['end'])}" if bp.get("end") else f"; dosage period from {d10(bp['start'])}"
    return ""


def age_on(birth, on):
    b, d = date.fromisoformat(birth), date.fromisoformat(on)
    return d.year - b.year - ((d.month, d.day) < (b.month, b.day))


def case_view(case_dir):
    """Return the case as plain data: header facts, sections of (id, date, text) items, and note paragraphs."""
    bundle = json.load(open(os.path.join(case_dir, "bundle.json")))
    res = [e["resource"] for e in bundle["entry"]]
    by = {}
    for r in res:
        by.setdefault(r["resourceType"], []).append(r)
    for kind in ("Claim", "Patient", "DocumentReference"):
        assert len(by.get(kind, [])) == 1, f"{case_dir}: expected exactly one {kind}"
    claim = by["Claim"][0]
    patient = by["Patient"][0]
    req = d10(claim["created"])
    item = claim["item"][0]["productOrService"]
    coding = item["coding"][0]
    view = {
        "case": os.path.basename(case_dir),
        "request": {"id": f"Claim/{claim['id']}", "date": req,
                    "text": f"{item.get('text')} (SNOMED CT {coding['code']} {coding['display']}); use: {claim['use']}; "
                            f"priority: {text_of(claim.get('priority'))}"},
        "patient": {"id": f"Patient/{patient['id']}",
                    "text": f"{age_on(patient['birthDate'], req)} years old on the request date; sex: {patient.get('gender')}"},
        "sections": [],
    }

    def section(title, items):
        items = sorted(items, key=lambda x: (x[1] or "", x[0]))
        if items:
            view["sections"].append({"title": title, "items": [{"id": i, "date": d, "text": t} for i, d, t in items]})

    section("Conditions", [
        (f"Condition/{r['id']}", d10(r.get("onsetDateTime")),
         f"{text_of(r.get('code'))}" + "".join(f" (ICD-10-CM {c['code']})" for c in r.get("code", {}).get("coding", [])
                                              if "icd-10" in c.get("system", ""))
         + f"; clinical status: {text_of(r.get('clinicalStatus'))}; onset {d10(r.get('onsetDateTime'))}")
        for r in by.get("Condition", [])])
    section("Visits", [
        (f"Encounter/{r['id']}", d10(r["period"]["start"]),
         f"{d10(r['period']['start'])} {text_of({'text': r['type'][0].get('text')}) if r.get('type') else ''}"
         f" ({r['class'].get('display', r['class'].get('code'))})"
         + (f": {r['reasonCode'][0]['text']}" if r.get("reasonCode") else ""))
        for r in by.get("Encounter", [])])

    def when(r):
        p = r.get("performedPeriod")
        if p:
            return d10(p["start"]), f"{d10(p['start'])} to {d10(p['end'])}" if p.get("end") else f"from {d10(p['start'])}"
        return d10(r.get("performedDateTime")), d10(r.get("performedDateTime"))

    section("Procedures", [
        (f"Procedure/{r['id']}", when(r)[0],
         f"{text_of(r.get('code'))}; {when(r)[1]}; status: {r.get('status')}"
         + "".join(f"; {n['text']}" for n in r.get("note", [])))
        for r in by.get("Procedure", [])])
    section("Imaging reports", [
        (f"DiagnosticReport/{r['id']}", d10(r.get("effectiveDateTime")),
         f"{text_of(r.get('code'))}, {d10(r.get('effectiveDateTime'))}: {r.get('conclusion', '')}")
        for r in by.get("DiagnosticReport", [])])
    section("Medications", [
        (f"MedicationRequest/{r['id']}", d10(r.get("authoredOn")),
         f"{text_of(r.get('medicationCodeableConcept'))}; ordered {d10(r.get('authoredOn'))}{med_period(r)}; status: {r.get('status')}")
        for r in by.get("MedicationRequest", [])])

    def obs_value(r):
        if "valueQuantity" in r:
            q = r["valueQuantity"]
            return f"{q['value']} {q.get('unit', '')}".strip()
        return r.get("valueString", "")

    section("Observations", [
        (f"Observation/{r['id']}", d10(r.get("effectiveDateTime")),
         f"{d10(r.get('effectiveDateTime'))} {text_of(r.get('code'))}: {obs_value(r)}")
        for r in by.get("Observation", [])])

    doc = by["DocumentReference"][0]
    note = base64.b64decode(doc["content"][0]["attachment"]["data"]).decode()
    paras = [p.strip() for p in re.split(r"\n\s*\n", note.strip()) if p.strip()]
    view["note"] = {"id": f"DocumentReference/{doc['id']}", "date": d10(doc.get("date")),
                    "paragraphs": [{"id": f"note:p{i}", "text": p} for i, p in enumerate(paras, 1)]}
    return view


def page_md(v):
    num = v["case"].split("_")[1]
    out = [f"# Case {num}", "",
           "Generated by `eval/tools/build_case_pages.py` from `bundle.json`. Ids in brackets are what labels cite as evidence.", "",
           f"**Request** [{v['request']['id']}]: {v['request']['text']}. Requested on {v['request']['date']}.", "",
           f"**Patient** [{v['patient']['id']}]: {v['patient']['text']}.", ""]
    for s in v["sections"]:
        out += [f"## {s['title']}", ""]
        out += [f"- [{i['id']}] {i['text']}" for i in s["items"]]
        out.append("")
    out += [f"## Visit note", "", f"[{v['note']['id']}], dated {v['note']['date']}. Paragraphs are numbered for citation.", ""]
    for p in v["note"]["paragraphs"]:
        out += [f"**[{p['id']}]** {p['text']}", ""]
    return "\n".join(out)


def policy_text():
    body = open(POLICY).read().split("\n---\n", 1)[1]
    head = open(POLICY).read().split("\n---\n", 1)[0]
    return head.strip(), body.strip()


# Planning sentences in the Criterion inventory that describe how the golden set was built, not how to judge a
# case. They are left out of what the readers see, so the readers are told the rule and nothing about the answers.
PLANNING_SENTENCES = [
    " This is a working summary for planning; the agent retrieves and cites the policy's own wording, and the list is to be verified against the current text before the first case is authored.",
    " The LCD's wording (\"no symptoms or signs suggesting nerve root disorder\") also allows a broader reading, so the golden set is built so that no expected routing depends on this choice (see Golden set composition).",
    " These two rules were written down on 2026-10-15, before any label existed; they state how the twelve cases were built.",
]


def criteria_text():
    """The criteria as the readers see them: EVAL_PLAN.md's Criterion inventory without its planning sentences."""
    plan = open(EVAL_PLAN).read()
    sec = plan.split("## Criterion inventory", 1)[1].split("\n## ", 1)[0]
    for sentence in PLANNING_SENTENCES:
        assert sec.count(sentence) == 1, f"planning sentence not found once in EVAL_PLAN.md: {sentence[:60]}"
        sec = sec.replace(sentence, "")
    return sec.strip()


def outputs_text():
    """The three permitted outputs, verbatim from the charter's authority statement."""
    charter = open(CHARTER).read()
    start = charter.index("The system may output exactly one of three results")
    end = charter.index("3. Route to physician review")
    end = charter.index("\n", end)
    return charter[start:end].strip()


# How statuses and evidence are written. The same words appear on the labeling page and in the third reader's prompt.
LEGEND = ("supported: the record shows the criterion is met. unsupported: the record shows the criterion is not met. "
          "undeterminable: the record does not allow a decision either way. Evidence: the ids on the case page; leave it "
          "empty when the status rests on something the record does not contain, for example no prior lumbar imaging.")

LABELING_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Golden Set Labeling</title>
<style>
:root{--bg:#fbfaf7;--fg:#1f1d1a;--muted:#6b665e;--line:#e2ddd3;--card:#ffffff;--accent:#2f5d8a;--accent-weak:#e8eef5;--ok:#2e6b3f;--warn:#9a5b13}
@media (prefers-color-scheme: dark){:root{--bg:#191816;--fg:#ece8e1;--muted:#a39d93;--line:#38342e;--card:#22201d;--accent:#8db4dc;--accent-weak:#25303b;--ok:#7fc495;--warn:#e0a35a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
header h1{font-size:16px;margin:0 12px 0 0}
nav{display:flex;flex-wrap:wrap;gap:6px}
nav button{border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:6px;padding:4px 9px;cursor:pointer;font:inherit;font-size:13px}
nav button.cur{border-color:var(--accent);background:var(--accent-weak)}
nav button.done::after{content:" \2713";color:var(--ok)}
.tools{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}
.btn{border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:6px;padding:5px 11px;cursor:pointer;font:inherit;font-size:13px}
.btn.ghost{background:transparent;color:var(--accent)}
main{max-width:1180px;margin:0 auto;padding:16px;display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:18px}
@media (max-width:900px){main{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:14px}
h2{font-size:18px;margin:0 0 8px}h3{font-size:14px;margin:14px 0 6px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
ul.items{list-style:none;padding:0;margin:0}ul.items li{padding:5px 0;border-top:1px solid var(--line)}ul.items li:first-child{border-top:0}
code.id{font-size:12px;color:var(--accent);background:var(--accent-weak);padding:1px 5px;border-radius:4px;white-space:nowrap}
.para{margin:8px 0}
.crit{border-top:1px solid var(--line);padding:10px 0}
.crit:first-of-type{border-top:0}
.crit .name{font-weight:600}
.opts{display:flex;flex-wrap:wrap;gap:10px;margin:6px 0}
.opts label{display:flex;gap:5px;align-items:center;font-size:14px}
details{margin-top:4px}summary{cursor:pointer;color:var(--muted);font-size:13px}
.ev{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.ev label{font-size:12px;border:1px solid var(--line);border-radius:5px;padding:2px 6px;display:flex;gap:4px;align-items:center}
.ev label.on{border-color:var(--accent);background:var(--accent-weak)}
textarea,input[type=text],select{width:100%;font:inherit;font-size:14px;padding:6px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
pre{white-space:pre-wrap;font-size:12px;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:8px;max-height:260px;overflow:auto}
.status{font-size:13px;color:var(--muted)}.status.ok{color:var(--ok)}.status.warn{color:var(--warn)}
.ref{font-size:13.5px}.ref p{margin:6px 0}
.side{position:sticky;top:64px;align-self:start;max-height:calc(100vh - 80px);overflow:auto}
@media (max-width:900px){.side{position:static;max-height:none}}
</style>
</head>
<body>
<header>
  <h1>Golden Set Labeling</h1>
  <nav id="nav"></nav>
  <div class="tools">
    <button class="btn ghost" id="showref">Policy and criteria</button>
    <button class="btn" id="zip">Download all labels (.zip)</button>
  </div>
</header>
<main>
  <section id="casecol"></section>
  <section class="side" id="formcol"></section>
</main>
<div id="refdlg" class="card" style="display:none;position:fixed;inset:60px 16px 16px 16px;z-index:10;overflow:auto;max-width:900px;margin:0 auto">
  <div style="display:flex;justify-content:space-between;align-items:center"><h2>Policy and criteria (reference)</h2><button class="btn ghost" id="closeref">Close</button></div>
  <div class="ref" id="refbody"></div>
</div>
<script>
const CASES = __CASES__;
const POLICY_HEAD = __POLICY_HEAD__;
const POLICY_BODY = __POLICY_BODY__;
const CRITERIA = __CRITERIA__;
const OUTPUTS = __OUTPUTS__;
const LEGEND = __LEGEND__;
const CRIT = [["C1_red_flag","C1 red flag"],["C2_conservative_4wk","C2 conservative care, four weeks"],["C3_informs_management","C3 informs management"],["C4_no_duplicate_imaging","C4 no duplicate imaging"]];
const STATUSES = ["supported","unsupported","undeterminable"];
const ROUTES = ["approve","request","route"];
const KEY = "golden-set-labels-v1";
let store = {}, storageOk = true;
try { store = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { store = {}; storageOk = false; }
function save(){ try { localStorage.setItem(KEY, JSON.stringify(store)); storageOk = true; } catch (e) { storageOk = false; } }
let cur = 0;
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function today(){ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function ids(v){ const out=[v.request.id, v.patient.id]; v.sections.forEach(s=>s.items.forEach(i=>out.push(i.id))); out.push(v.note.id); v.note.paragraphs.forEach(p=>out.push(p.id)); return out; }
function rec(c){ if(!store[c]) store[c]={criteria:{},routing:"",gap_criterion:"",gap_missing:"",labeled_on:""}; CRIT.forEach(([k])=>{ if(!store[c].criteria[k]) store[c].criteria[k]={status:"",evidence:[]}; }); return store[c]; }
// Saved evidence that no longer exists on the page (for example after a note is restyled) is dropped, not exported.
CASES.forEach(v=>{ const ok=new Set(ids(v)), r=rec(v.case); CRIT.forEach(([k])=>{ r.criteria[k].evidence=r.criteria[k].evidence.filter(x=>ok.has(x)); }); });
function complete(c){ const r=rec(c); if(!r.routing) return false; for(const [k] of CRIT){ if(!r.criteria[k].status) return false; } if(r.routing==="request" && (!r.gap_criterion || !r.gap_missing.trim())) return false; return true; }
function yq(s){ return '"' + String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"') + '"'; }
function yaml(c){
  const r=rec(c); const lines=[];
  lines.push("# Blind labels for one case (Amendment 2): your answers before seeing any other reader's. Never edited after upload.");
  lines.push("# status is supported, unsupported, or undeterminable. evidence lists resource ids (for example Procedure/case01-pt-01) or note paragraphs (note:p2).");
  lines.push("# expected_routing is approve, request, or route. named_gap is null, or {criterion: C2, missing: what is missing}.");
  lines.push("case_id: "+c);
  lines.push("labeled_on: "+(r.labeled_on||today()));
  lines.push("criteria:");
  CRIT.forEach(([k])=>{ const x=r.criteria[k]; lines.push("  "+(k+":").padEnd(25)+"{status: "+(x.status||"")+", evidence: ["+x.evidence.join(", ")+"]}"); });
  lines.push("expected_routing:"+(r.routing?" "+r.routing:""));
  if(r.routing==="request" && r.gap_criterion) lines.push("named_gap: {criterion: "+r.gap_criterion+", missing: "+yq(r.gap_missing.trim())+"}"); else lines.push("named_gap: null");
  return lines.join("\n")+"\n";
}
function renderNav(){
  const nav=document.getElementById("nav"); nav.innerHTML="";
  CASES.forEach((v,i)=>{ const b=document.createElement("button"); b.textContent=v.case.replace("case_","Case "); b.className=(i===cur?"cur ":"")+(complete(v.case)?"done":""); b.onclick=()=>{cur=i;render();window.scrollTo(0,0);}; nav.appendChild(b); });
}
function renderCase(){
  const v=CASES[cur]; let h='<div class="card"><h2>'+esc(v.case.replace("case_","Case "))+'</h2>';
  h+='<p><code class="id">'+esc(v.request.id)+'</code> '+esc(v.request.text)+'. Requested on '+esc(v.request.date)+'.</p>';
  h+='<p><code class="id">'+esc(v.patient.id)+'</code> '+esc(v.patient.text)+'.</p></div>';
  v.sections.forEach(s=>{ h+='<div class="card"><h3>'+esc(s.title)+'</h3><ul class="items">'; s.items.forEach(i=>{ h+='<li><code class="id">'+esc(i.id)+'</code> '+esc(i.text)+'</li>'; }); h+='</ul></div>'; });
  h+='<div class="card"><h3>Visit note</h3><p class="status"><code class="id">'+esc(v.note.id)+'</code> dated '+esc(v.note.date)+'</p>';
  v.note.paragraphs.forEach(p=>{ h+='<p class="para"><code class="id">'+esc(p.id)+'</code> '+esc(p.text)+'</p>'; });
  h+='</div>'; document.getElementById("casecol").innerHTML=h;
}
function renderForm(){
  const v=CASES[cur], c=v.case, r=rec(c), all=ids(v); let h='<div class="card"><h2>Your labels, '+esc(c.replace("case_","case "))+'</h2>';
  h+='<p class="status">'+esc(LEGEND)+'</p>';
  CRIT.forEach(([k,label])=>{ const x=r.criteria[k];
    h+='<div class="crit"><div class="name">'+esc(label)+'</div><div class="opts">';
    STATUSES.forEach(s=>{ h+='<label><input type="radio" name="'+k+'" value="'+s+'"'+(x.status===s?" checked":"")+'> '+s+'</label>'; });
    h+='</div><details'+(x.evidence.length?" open":"")+'><summary>Evidence ('+x.evidence.length+' selected)</summary><div class="ev">';
    all.forEach(id=>{ const on=x.evidence.includes(id); h+='<label class="'+(on?"on":"")+'"><input type="checkbox" data-crit="'+k+'" value="'+esc(id)+'"'+(on?" checked":"")+'>'+esc(id)+'</label>'; });
    h+='</div></details></div>'; });
  h+='<div class="crit"><div class="name">Routing</div><div class="opts">';
  ROUTES.forEach(s=>{ h+='<label><input type="radio" name="routing" value="'+s+'"'+(r.routing===s?" checked":"")+'> '+s+'</label>'; });
  h+='</div><div id="gapbox" style="display:'+(r.routing==="request"?"block":"none")+'"><p class="status">For a documentation request: which criterion, and what is missing.</p><select id="gapc"><option value="">Criterion</option>'+["C1","C2","C3","C4"].map(g=>'<option'+(r.gap_criterion===g?" selected":"")+'>'+g+'</option>').join("")+'</select><div style="height:6px"></div><input type="text" id="gapm" placeholder="What is missing" value="'+esc(r.gap_missing)+'"></div></div>';
  h+='<p class="status '+(complete(c)?"ok":"warn")+'">'+(complete(c)?(storageOk?"Complete. Saved in this browser.":"Complete, but this browser is not saving it; download the labels before closing the page."):"Not complete yet. Every criterion needs a status, and a request needs its gap."+(storageOk?"":" This browser is not saving your work."))+'</p>';
  h+='<details><summary>Preview labels_blind.yaml</summary><pre>'+esc(yaml(c))+'</pre></details>';
  h+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn ghost" id="prev">Previous case</button><button class="btn ghost" id="next">Next case</button></div></div>';
  document.getElementById("formcol").innerHTML=h;
  document.querySelectorAll('#formcol input[type=radio]').forEach(el=>el.onchange=()=>{ if(el.name==="routing"){ r.routing=el.value; if(el.value!=="request"){r.gap_criterion="";r.gap_missing="";} } else { r.criteria[el.name].status=el.value; } r.labeled_on=today(); save(); render(); });
  document.querySelectorAll('#formcol input[type=checkbox]').forEach(el=>el.onchange=()=>{ const x=r.criteria[el.dataset.crit]; const i=x.evidence.indexOf(el.value); if(el.checked&&i<0) x.evidence.push(el.value); if(!el.checked&&i>=0) x.evidence.splice(i,1); x.evidence.sort((a,b)=>all.indexOf(a)-all.indexOf(b)); r.labeled_on=today(); save(); render(); });
  const gc=document.getElementById("gapc"), gm=document.getElementById("gapm");
  if(gc) gc.onchange=()=>{ r.gap_criterion=gc.value; save(); renderNav(); };
  if(gm) gm.onchange=()=>{ r.gap_missing=gm.value; save(); render(); };
  document.getElementById("prev").onclick=()=>{ cur=(cur+CASES.length-1)%CASES.length; render(); window.scrollTo(0,0); };
  document.getElementById("next").onclick=()=>{ cur=(cur+1)%CASES.length; render(); window.scrollTo(0,0); };
}
function render(){ renderNav(); renderCase(); renderForm(); }
// Minimal zip writer (stored, no compression), so the page works offline with no libraries.
const CRC=(()=>{ const t=new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; t[n]=c>>>0; } return t; })();
function crc32(b){ let c=0xFFFFFFFF; for(let i=0;i<b.length;i++) c=CRC[(c^b[i])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
function zip(files){
  const enc=new TextEncoder(), parts=[], central=[]; let off=0;
  const u16=n=>[n&255,(n>>>8)&255], u32=n=>[n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];
  files.forEach(f=>{ const name=enc.encode(f.name), data=enc.encode(f.text), crc=crc32(data);
    const local=new Uint8Array([...u32(0x04034b50),...u16(20),...u16(0),...u16(0),...u16(0),...u16(0x21),...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),...u16(0)]);
    parts.push(local,name,data);
    central.push(new Uint8Array([...u32(0x02014b50),...u16(20),...u16(20),...u16(0),...u16(0),...u16(0),...u16(0x21),...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(off)]),name);
    off+=local.length+name.length+data.length; });
  const csize=central.reduce((a,b)=>a+b.length,0);
  const end=new Uint8Array([...u32(0x06054b50),...u16(0),...u16(0),...u16(files.length),...u16(files.length),...u32(csize),...u32(off),...u16(0)]);
  return new Blob([...parts,...central,end],{type:"application/zip"});
}
document.getElementById("zip").onclick=()=>{
  const missing=CASES.filter(v=>!complete(v.case)).map(v=>v.case.replace("case_",""));
  if(missing.length && !confirm("Not complete yet: cases "+missing.join(", ")+". Download anyway?")) return;
  const files=CASES.map(v=>({name:"data/golden/"+v.case+"/labels_blind.yaml", text:yaml(v.case)}));
  const a=document.createElement("a"); a.href=URL.createObjectURL(zip(files)); a.download="labels_blind.zip"; document.body.appendChild(a); a.click(); a.remove();
};
function refHtml(){
  const md=s=>esc(s).replace(/\*\*(.+?)\*\*/g,"<b>$1</b>").split(/\n\s*\n/).map(p=>"<p>"+p.replace(/\n\* /g,"<br>&bull; ").replace(/^\* /,"&bull; ").replace(/\n/g,"<br>")+"</p>").join("");
  return "<h3>Criteria (EVAL_PLAN.md, Criterion inventory)</h3>"+md(CRITERIA)+"<h3>Routing (CHARTER.md, authority statement)</h3>"+md(OUTPUTS)+"<h3>Policy text, LCD L34220</h3><p class='status'>"+esc(POLICY_HEAD).replace(/\n/g,"<br>")+"</p>"+md(POLICY_BODY);
}
document.getElementById("showref").onclick=()=>{ document.getElementById("refbody").innerHTML=refHtml(); document.getElementById("refdlg").style.display="block"; };
document.getElementById("closeref").onclick=()=>{ document.getElementById("refdlg").style.display="none"; };
render();
</script>
</body>
</html>
"""


def main():
    views = []
    for d in sorted(glob.glob(CASE_GLOB)):
        v = case_view(d)
        open(os.path.join(d, "case_page.md"), "w").write(page_md(v))
        views.append(v)
        print("wrote", os.path.join(d, "case_page.md"))
    head, body = policy_text()
    def js(x):  # JSON that cannot close the script element it sits in
        return json.dumps(x, ensure_ascii=False).replace("<", "\\u003c")
    out = (LABELING_TEMPLATE.replace("__CASES__", js(views))
           .replace("__POLICY_HEAD__", js(head)).replace("__POLICY_BODY__", js(body))
           .replace("__CRITERIA__", js(criteria_text())).replace("__OUTPUTS__", js(outputs_text()))
           .replace("__LEGEND__", js(LEGEND)))
    os.makedirs(os.path.dirname(LABELING_OUT), exist_ok=True)
    open(LABELING_OUT, "w").write(out)
    print("wrote", LABELING_OUT, f"({len(views)} cases)")


if __name__ == "__main__":
    main()
