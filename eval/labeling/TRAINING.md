# Labeling training

This training teaches you to label the 12 cases, starting from zero. You don't need any medical or insurance background. It takes about an hour and a half, and you can stop and come back at any point.

Nothing you do here is uploaded or counted, and none of the 12 real cases appears in it. The two practice cases were made up for this training and are not part of the 12.

## The plan

1. **Open the practice page** (Part 1, 5 minutes).
2. **Read the big picture:** what this project is and what your labels are for (Part 2, 10 minutes).
3. **Skim the word list,** so you know where to find a word later (Part 3, 10 minutes).
4. **Do the guided walkthrough:** label Practice A with step-by-step help (Part 4, 30 minutes).
5. **Label Practice B on your own,** then check your answers (Part 5, 20 minutes).
6. **Read the rules once more,** now that you've used them (Part 6, 15 minutes).
7. **Read the habits for the 12 real cases** (Part 7, 5 minutes).

By the end you will have labeled two complete cases and seen the reasoning behind every answer.

## Part 1. Open the practice page

**Programs:** GitHub Desktop, Finder, and Google Chrome.

1. Open **GitHub Desktop**. At the top left, **Current Repository** should say **prior-auth-review-agent**, and next to it **Current Branch** should say **main**.
2. Click **Fetch origin** at the top right. If the button changes to **Pull origin**, click it again. This downloads the newest version of the project to your Mac.
3. Open **Finder**, press **Cmd+Shift+G**, type `~/Projects/prior-auth-review-agent/eval/labeling` and press **Return**. This opens the folder that holds the labeling pages.
4. Right-click **training.html**, choose **Open With**, then **Google Chrome**.

**What you should see:** a page titled **Labeling Practice**. The first time, this guide opens on top of it; click **Close** to see the page, and the **Training guide** button at the top right brings the guide back at any time. At the top left are two buttons, **Practice A** and **Practice B**. At the top right, next to **Training guide**, is **Policy and criteria** (the official rules). The patient's record fills the left side of the page, and the answer form is on the right.

Make the Chrome window wide, so the record and the form sit side by side. Your practice answers are saved in Chrome automatically, and separately from your real labels, so nothing here can touch them.

## Part 2. The big picture

### The situation

Low back pain is very common, and most of it gets better on its own within a few weeks. An **MRI** is a detailed scan made with a strong magnet. An MRI of the **lumbar spine** (the lower back) is expensive, and early on it rarely changes what a doctor does.

So **Medicare**, the U.S. government's health insurance for people 65 and older and some younger people (for example, people with certain disabilities), has written rules for when it will pay for a lower-back MRI. Those rules are a **policy** called **LCD L34220**. "LCD" stands for Local Coverage Determination: the coverage rules for one region, here the region that includes California, Nevada, and Hawaii. Many people with Medicare are in **Medicare Advantage** plans, which are run by private insurance companies but must apply the same rules.

Before the scan is done, the doctor's office sends the plan a **prior authorization request**: in effect, "may we do this MRI, and will you pay for it?" Someone at the plan, often a nurse, reads the patient's record and checks it against the policy's rules.

### What this project builds

This project builds an AI tool that does a first pass of that check. For each request it can do one of three things:

- **Approve** it, when the record clearly meets the rules.
- **Request** a missing piece of documentation from the doctor's office, when one item would settle the question.
- **Route** it to a physician (a doctor) to decide, in every other case.

It can never say no. Only a person can deny a request.

### What your job is

To find out whether the tool gets things right, it needs an **answer key**, the way an exam needs one before it can be graded. You are writing that answer key. For each case you decide what the right answers are, and later the tool's answers are compared with yours.

You are **not** diagnosing anyone. You are reading a record and checking it against written rules. Careful reading matters far more than medical knowledge, and this training explains the medical words you'll need.

### What a case is

Each case is a **made-up patient's record**, built to look like a real electronic health record (the digital chart a clinic keeps). No real person is in it. Each case shows the request, the patient's diagnoses, visits, treatments, and exam findings, and the clinician's visit note.

### The five questions you answer for each case

For every case you answer the same five questions, in the form on the right side of the page:

1. **C1, red flag:** does the record show a warning sign of something serious?
2. **C2, conservative care:** has the patient tried at least four weeks of treatment, such as physical therapy, without getting better?
3. **C3, informs management:** would the MRI change what the doctor does next?
4. **C4, no duplicate imaging:** is this MRI something other than a repeat of a scan the patient already had?
5. **Routing:** given those four answers, should the case be approved, should a document be requested, or should it go to a physician?

For each of C1 to C4 you pick one of three answers (**supported**, **unsupported**, or **undeterminable**) and tick the parts of the record your answer is based on. The walkthrough in Part 4 shows you exactly how.

## Part 3. Words you'll see

You don't need to memorize these. Skim them now, and come back when a word stops you. You may also look up what a medical word means in a dictionary, or on **MedlinePlus** (medlineplus.gov, the U.S. National Library of Medicine's plain-language health site). Type just the word, never a sentence from a case. Never search for how to label a case, and never put any part of a case into an AI tool.

### The body and back pain

- **Lumbar spine:** the lower back. **Vertebrae** are the bones of the spine. **Discs** are the cushions between them. A **level** is one spot along the spine, named by the vertebrae there.
- **Lumbosacral junction:** where the lower back meets the pelvis.
- **Nerve root:** where a nerve leaves the spine. An irritated or pinched nerve root can cause pain, tingling, numbness, or weakness along that nerve, often down a leg.
- **Radiating pain:** pain that travels from the back down a leg. **Sciatica** is radiating pain down the back of the leg.
- **Radiculopathy:** a diagnosis meaning an irritated or pinched nerve root.
- **Spinal cord and spinal canal:** the spinal cord is the bundle of nerves running inside the spine; the canal is the tunnel it runs through. **Stenosis** means a narrowing of that canal.
- **Neurogenic claudication:** heaviness or pain in the legs when walking, caused by a narrowed spinal canal. It eases when the person sits or bends forward.
- **Herniated disc** (also called **herniated nucleus pulposus**): a disc that bulges out and can press on a nerve. **Degenerative disc disease:** wear and tear of the discs.
- **Bilateral:** on both sides. **Symmetric:** the same on both sides. **Supine:** lying flat on the back.
- **Flexion:** bending forward. **Extension:** bending backward.

### Exam words

- **Tenderness:** pain when an area is pressed.
- **Straight leg raise:** while the patient lies on their back, the examiner lifts one straightened leg. If that brings on the leg pain, the test is **positive**, which suggests an irritated nerve root. **Negative** means it didn't.
- **Strength 5/5:** muscle strength is graded from 0 (no movement) to 5 (normal). **Weakness** means a grade below 5.
- **Reflexes:** the automatic jerk when a tendon is tapped, at the knee (**patellar**) or the ankle (**Achilles**). **2+** is normal; **1+** is reduced; **0** is absent.
- **Sensation:** the ability to feel touch. **Sensory loss** means numbness.
- **Pulses:** the heartbeat felt in an artery. **Dorsalis pedis** is the pulse on the top of the foot.
- **Neurologic deficit:** a measurable problem with the nerves, such as weakness, a reduced reflex, or numbness. **Neurologically intact** or **without neurologic deficit** means none was found.

### The red-flag words

- **Trauma:** an injury. **Osteoporosis:** thinning bones that break easily. **Potentially osteoporotic:** someone whose bones may be thin.
- **Cancer** that is **metastatic** has spread from where it started to other parts of the body.
- **Bacterial infection:** an infection caused by bacteria. **Antibiotics** are the medicines that treat it. A **urinary tract infection** (UTI) is an infection of the bladder or the tubes that carry urine, usually caused by bacteria. The policy also says **septic disorder**, meaning a serious infection.
- **Immune suppression:** a weakened immune system, for example from long-term steroid pills, chemotherapy, or medicines taken after an organ transplant.
- **IV drug abuse:** injecting drugs into a vein.
- **Saddle anesthesia:** numbness in the area that would touch a saddle (the buttocks, inner thighs, and groin). **Perianal or perineal sensory loss:** numbness around the anus or between the legs.
- **Bladder dysfunction:** trouble controlling or emptying the bladder. **Laxity of the anal sphincter:** looseness of the muscle that keeps the bowel closed.

### Tests and treatments

- **MRI:** a detailed scan made with a strong magnet. **Contrast:** a dye injected so some things show up better; "without contrast" means no dye.
- **CT scan:** a detailed scan made with X-rays. **X-ray:** a simple picture of the bones.
- **Conservative care:** treatment short of injections or surgery, such as physical therapy, exercises, or pain medicine.
- **Physical therapy:** exercises and hands-on treatment with a physical therapist, usually over several weeks. A **home program** is exercises the patient does at home.
- **NSAID:** a common type of anti-inflammatory pain medicine, such as ibuprofen or naproxen. **Acetaminophen** (Tylenol) is another common pain medicine.
- **Epidural steroid injection:** a shot of anti-inflammatory medicine placed next to an irritated nerve in the spine.
- **Intervertebral joint injection:** an injection into one of the joints between two vertebrae. It is the policy's own example of an "aggressive treatment."
- **Decompression:** surgery that makes more room for squeezed nerves.
- **Pain management:** a clinic that specializes in treating pain, including with injections.
- **Urgent care:** a walk-in clinic for problems that need care the same day.
- **Work-up:** a set of tests to find out what is going on.

### Record words

- **Request:** the prior authorization request, shown at the top of each case. "Use: preauthorization" means the office is asking before the scan is done.
- **Conditions:** the patient's list of diagnoses. Each has an **onset date** (when it started). The codes in brackets, such as ICD-10-CM M54.16, are billing codes you can ignore.
- **Visits:** the patient's appointments, each with a one-line summary. **Ambulatory** means an office visit, not a hospital stay.
- **Procedures:** treatments or tests that were done, with their dates.
- **Imaging reports:** the written results of earlier scans or X-rays.
- **Medications:** medicines a clinician ordered, with their dates.
- **Observations:** findings recorded in the chart, such as an exam result or a weight.
- **Visit note:** the clinician's own write-up of the last visit, in numbered paragraphs (**note:p1**, **note:p2**, and so on).
- **Impression** or **assessment:** the clinician's summary of what is going on. **Plan:** what happens next.
- **Id:** the short blue label at the start of each item, such as `Procedure/practicea-pt-01`. You tick ids to show what your answer is based on.

A case shows a section only when it has something in it. A case with no Medications section simply has no medication orders.

### Labeling words

- **Criterion** (plural **criteria**): one of the four questions, C1 to C4.
- **Supported:** the record shows the criterion is met. **Unsupported:** the record shows it is not met. **Undeterminable:** the record doesn't let you decide either way, or it contradicts itself.
- **Evidence:** the ids your answer is based on.
- **Structured entry:** any item in the lists at the top of the record (Conditions, Visits, Procedures, Imaging reports, Medications, Observations), as opposed to the free-text visit note.
- **Contradiction:** two parts of the record saying opposite things about the same fact.
- **Routing:** the outcome for the whole case: approve, request, or route.

## Part 4. The guided walkthrough (Practice A)

This is where you learn by doing. The walkthrough labels Practice A with you, one step at a time.

1. Click **Close** on this guide.
2. Click **Practice A** at the top left, if it isn't already selected.
3. At the top of the right side, click **Start the guided walkthrough**.

A box appears at the top of the right side with the first step. At each step, the part of the record it talks about is **highlighted** in yellow on the left, and the page scrolls to it. When a step asks you to click something in the form, that part of the form is highlighted too, and so are the evidence boxes to tick. Use **Next** and **Back** to move between steps. If you close the page, it remembers which step you were on.

Go slowly. Read each highlighted part of the record yourself before you read the step's explanation. The goal isn't only to get Practice A right; it's to learn the order of looking, which you'll use on every case.

The same steps are written out at the end of this guide, under "The walkthrough, in writing," if you'd rather read them first or print them.

## Part 5. Your turn (Practice B)

Now label a case on your own.

1. Click **Practice B** at the top left. A **Your turn** box at the top of the right side has a checklist of the order to look in, if you want it.
2. Work through the case the way the walkthrough did: read the whole record from top to bottom, then answer C1, C2, C3, and C4, then the routing.
3. When the line under the form turns green, click **Check my answers**. The worked answer appears below your form, with the reasoning for each question.
4. Read every explanation, especially where your answer differs. A difference is the most useful part of practice, not a failure.

If you get stuck, use Part 6 below and the **Policy and criteria** panel, just as you will on the real cases. To try a case again, click **Clear this case**.

## Part 6. The rules, explained

This part restates the official rules in plain words. The official wording is in the **Policy and criteria** panel; if this guide and that panel ever seem to differ, the panel wins.

### The three answers, and evidence

- **Supported:** the record shows the criterion is met. You can point to where.
- **Unsupported:** the record shows the criterion is not met. You can point to that too, or the record plainly lacks what the criterion needs.
- **Undeterminable:** the record doesn't let you decide either way, or two parts of it contradict each other.

A good test for each criterion is to ask yourself: "What in the record shows this?" If you can point to it, the answer is supported or unsupported. If the record leaves the question open, or two parts disagree, the answer is undeterminable.

**Evidence** is the set of ids your answer is based on. Under each criterion, click **Evidence (0 selected)** and tick them. Leave evidence empty when your answer rests on something the record does **not** contain, for example no earlier scan for C4.

When your labels are compared with others', the answer (supported, unsupported, or undeterminable) matters most. Small differences in which ids people tick are normal and get talked through.

### Why the note alone isn't enough for C1 and C2

For C1 and C2, this project has a rule: the visit note alone is not enough. A red flag, or a course of conservative care, also has to show up in a **structured entry** (an item in one of the lists at the top of the record). The reason is that the tool can approve requests automatically, and the note is the easiest place for a claim to be overstated, so the project asks for a second source in the record before an approval rests on what the note says. For C3 and C4, the note counts on its own.

### C1. A red flag is present

A **red flag** is a warning sign that something more serious than ordinary back pain could be going on, so waiting a month would be wrong. The policy lists them. Here is the list exactly as the criteria give it, grouped under headings to make it easier to scan (the words in parentheses are plain explanations, not part of the rule):

- **Injury and bone:** major trauma; minor trauma in a potentially osteoporotic patient (a minor fall or knock in someone whose bones may be thin).
- **Cancer:** history of cancer.
- **Infection and the immune system:** fever; chills; recent bacterial infection; IV drug abuse; immune suppression.
- **Weight:** unexplained weight loss.
- **Pain pattern:** pain that worsens when supine (lying flat on the back) or at night.
- **Nerves and spinal cord:** saddle anesthesia; recent onset of bladder dysfunction; clinically significant or progressive neurologic deficit in the lower extremity (a nerve problem in the leg that is serious or getting worse); unexpected laxity of the anal sphincter; perianal or perineal sensory loss; clinically significant motor weakness; other nerve root compromise.

Anything not on the list is not a red flag for this criterion, however serious it sounds. High blood pressure and arthritis are common examples you'll see in the Conditions list.

**The nerve items, as this project reads them.** The criteria spell this out. C1 is supported by **objective** signs of nerve root or spinal cord trouble in the record (signs an examiner found or measured, not only what the patient feels):

- clinically significant or progressive weakness
- a reduced or absent reflex
- loss of feeling in a nerve root pattern
- new bladder or bowel trouble
- numbness in the saddle area or around the anus

Pain running down the leg, or a positive straight leg raise, does **not** count on its own. A case like that is judged under C2 instead.

**Where the red flag is written decides the answer:**

- **Supported** when a structured entry shows the red flag: a Condition, an Observation, a Procedure, an Imaging report, a medication order, or any other entry that is not the visit note. An Observation counts whether it holds a number, a code, or text.
- **Undeterminable** when the red flag appears **only in the note**, with nothing in the structured entries behind it, or when a structured entry **contradicts** it. In both situations, the criteria say **the case routes** to a physician.
- **Unsupported** when nothing on the list appears anywhere in the record, or what appears doesn't meet the list's words (for example, leg pain with a normal nerve exam).

A contradiction means two parts of the record say opposite things about the same fact. For example, if the note said "temperature 101" but the vital signs recorded at the same visit said 98.6, the structured entry would contradict the note.

**Step-by-step check for C1:**

1. Read the whole record first, every note paragraph included. Look for anything on the list.
2. If you find nothing on the list, C1 is **unsupported**. Evidence can stay empty, because the answer rests on what the record does not contain. If a particular exam is what settled it for you (for example, one showing that a leg finding falls short), you may tick it instead. Either is fine.
3. For a nerve finding, check it against the nerve reading above. Leg pain or a positive straight leg raise alone does not count.
4. For a red flag that is on the list, find where it is written. If it's in a structured entry and nothing contradicts it, C1 is **supported**; tick that entry.
5. If it's only in the note, or a structured entry contradicts it, C1 is **undeterminable**. Tick the note paragraph, and the contradicting entry if there is one.

**Words that carry a condition.** Some items include a qualifier: "unexplained" weight loss, "potentially osteoporotic," "recent" bacterial infection, "clinically significant," or "progressive." Read them literally, and check whether the record says enough to meet the words. If the record truly doesn't let you decide, that is what undeterminable is for.

### C2. Four weeks of conservative care that hasn't worked

The official wording: for a non-red-flag condition, the patient "has not responded to a reasonable trial of conservative management lasting at least four weeks," and the MRI is being considered after at least one month of symptoms.

So C2 has three parts, and all three must hold:

1. **Conservative care for at least four weeks, in a structured entry:** a therapy in Procedures, or a medication order in Medications.
2. **No response:** the latest visit or the note says the pain persists, is unchanged, or is worse.
3. **At least a month of symptoms** before the request. Compare the low back pain Condition's onset date with the request date at the top of the page.

**How to count four weeks.** Use the dates printed on the entry: a Procedure's "2026-06-15 to 2026-08-03," or a medication's "dosage period." Four weeks is 28 days. For example, June 1 to June 29 is exactly four weeks. A calendar makes this easy.

**Note-only care.** Conservative care that appears only in the note, with no therapy Procedure or medication order behind it, or that a structured entry contradicts, is **undeterminable**. Unlike C1, the criteria don't say this alone routes the case; the routing questions below decide that.

C2 always gets its own answer, even when C1 is supported. The criteria say the criterion an approval doesn't rest on "is still labeled with its status."

### C3. The MRI will change what happens next

The official wording: "a surgical intervention or other aggressive treatment (for example intervertebral joint injection) is under consideration, and the findings would affect treatment choices."

Two parts:

1. **Surgery or another aggressive treatment is under consideration.** The criteria's example is an intervertebral joint injection (an injection into a joint of the spine). Look at the latest visit and the note's assessment and plan, and read the policy's own wording in the **Policy and criteria** panel.
2. **The MRI's result would affect the treatment choice.** The record should say, in some form, how the result would change what happens next.

The note counts as evidence for C3 on its own.

### C4. Not a repeat of an earlier scan

The official wording: "The study is not a duplication of other imaging (such as a spinal CT) unless documentation supports the need for both, for example inconclusive findings on the prior study."

Look for earlier imaging of the lower back in Procedures, Imaging reports, and the note.

- **No earlier lower-back imaging anywhere:** supported, with **empty** evidence. The answer rests on what the record does not contain.
- **Earlier lower-back imaging exists:** ask whether the MRI would duplicate it (the criteria's example is a spinal CT). If it would, check whether the record documents the need for both, such as an inconclusive result on the earlier study, and label from what you find.

The note counts as evidence for C4 on its own.

### Routing the case

After the four criteria, choose one outcome. Ask these questions in order, and stop at the first "yes":

1. **Is there a red flag stated only in the note, or one the record contradicts?** Route. (The C1 rule.)
2. **Are C3 and C4 supported, and C1 or C2 supported with cited evidence?** Approve. A case needs a red flag **or** a failed four-week trial, not both. (C4's evidence can be empty when there's no earlier imaging; that still counts as supported.)
3. **Otherwise the case can't be approved. Does the record contradict itself on any criterion?** Route, even if a document could clear it up.
4. **Would one record item that the doctor's office could send settle the open question?** Request it, naming the criterion and the missing item. If no single document could make the case approvable, route.

These questions restate the criteria's own sentences: "A case is approvable when C3 and C4 hold and either C1 or C2 holds with cited evidence," and, when a case is not approvable, "request when one record element the provider could send would settle the question, naming the criterion and the element; route when the record contradicts itself on a criterion, even if a document could resolve it, or when the case could not be approved whatever such a document said."

**Filling in a request.** Click **request**. Two boxes appear. In the first, pick the criterion the gap belongs to (C1 to C4). In the second, type what is missing in a few plain words, then click anywhere outside the box so it saves.

## Part 7. Habits for the 12 real cases

- **Read the whole record before answering anything,** in the same order as the walkthrough: request, patient, Conditions, Visits, Procedures, Imaging reports, Medications, Observations, then the note, paragraph by paragraph.
- **For each answer, ask "What in the record shows this?"** Then tick those ids.
- **Approve only when C3 and C4 hold and you can point to the evidence** for whichever of C1 or C2 the approval rests on. That's the approve rule itself.
- **When the record truly doesn't let you decide,** use undeterminable. It's a real answer, not a failure.
- **Keep a short paper list** of case numbers that felt hard, with a sentence on why. Those are the first ones to look at when disagreements are settled.
- **Pace:** about 12 minutes a case, and three or four cases a sitting.
- **What you may use:** the labeling page, its **Policy and criteria** panel, a printed copy of the cases if you made one, this guide, and a dictionary or MedlinePlus for what a single word means. Never search for how to label a case, never put any part of a case into an AI tool, and don't ask anyone about a case until your labels are in.
- **You are not the last word.** Your labels, the third reader's (another AI model, Gemini, labeling the same cases on its own), and the answers locked in before labeling began are compared, and every disagreement is settled against the policy text. Hard calls are expected, and they're what the settling step is for.

Questions about the practice cases or the rules are welcome before you start the 12.

<!-- walkthrough start: written by eval/tools/build_training_page.py from data/practice/practice_a/walkthrough.yaml. Edit that file, not this section. -->
## The walkthrough, in writing

These are the steps the guided walkthrough shows for Practice A, for reading ahead or printing. On the practice page, each step also highlights the part of the record it talks about.

### Step 1. The request: what is being asked for

**Look at:** `Claim/practicea-claim`.

Every case starts with the **request**. A clinic is asking the patient's insurance plan to approve an **MRI of the lumbar spine**: a detailed scan of the lower back. "Without contrast" means no dye is injected for the scan. "Use: preauthorization" means the clinic is asking **before** the scan is done.

The long code (SNOMED CT 241648005) is a standard code for the test. You can ignore it.

**Write down the request date: August 19, 2026.** You'll use it to count how long the symptoms have lasted.

### Step 2. The patient

**Look at:** `Patient/8f48ea64-12eb-a55e-c747-42fd4dab5908`.

A 62-year-old woman. She is under 65, and some younger people have Medicare too, for example because of a disability; the record doesn't need to say why.

Read the age and sex, but they rarely decide anything by themselves. The long string of letters and numbers is just the patient's id in the record.

### Step 3. Conditions: the patient's list of diagnoses

**Look at:** `Condition/practicea-cond-01`.

**Conditions** is the patient's problem list: the diagnoses written in the chart. Here there is one: **low back pain with radiculopathy**. Radiculopathy means an irritated or pinched nerve root in the spine, which causes pain that travels down a leg. The code in brackets (ICD-10-CM M54.16) is a billing code for the diagnosis; you can ignore it.

Two things to note:

- The **onset date, June 8**, is when the symptoms began. It starts the clock for "at least a month of symptoms" in C2.
- A diagnosis is a name someone gave the problem. It is **not** an exam finding. Keep that in mind for C1 in Step 9.

### Step 4. Visits: the story in order

**Look at:** `Encounter/practicea-enc-01`, `Encounter/practicea-enc-02`, `Encounter/practicea-enc-03`.

**Visits** are the patient's appointments, with a one-line summary of each. Read them in date order. Together they tell the story:

- **June 9:** back pain and left leg pain for one day, with no injury or fall. She is sent to physical therapy and given exercises to do at home.
- **July 14:** the leg pain is unchanged.
- **August 14:** still unchanged after seven weeks of physical therapy. The plan is an **epidural steroid injection**: a shot of anti-inflammatory medicine placed next to the irritated nerve in the spine, given by a **pain management** clinic. The MRI is ordered to choose the **level**: the spot along the spine where the shot goes.

"Ambulatory" means an office visit, not a hospital stay. "Sciatica" is another word for pain running down the back of the leg.

### Step 5. Procedures: treatment that was done

**Look at:** `Procedure/practicea-pt-01`.

**Procedures** lists treatments that were carried out. Here: **physical therapy from June 15 to August 3, 12 sessions, completed.** Physical therapy is the kind of treatment C2 calls **conservative care**: treatment short of injections or surgery.

**Count the weeks.** Four weeks is 28 days. Four weeks after June 15 is July 13. August 3 is seven weeks after June 15. So the therapy lasted **seven weeks**, more than the four that C2 asks for.

Tip: a calendar on your phone makes counting weeks easy.

### Step 6. Medications: none here

**Look at:** `note:p2`.

This record has **no Medications section**, because no medicine was ordered. A case shows a section only when it has something in it, so a missing section just means there is nothing of that kind in the record. That's normal.

The note's second paragraph (highlighted) says she prefers not to take pain medicine, which explains it.

### Step 7. Observations: the exam, in plain words

**Look at:** `Observation/practicea-obs-01`.

**Observations** are findings recorded in the chart, such as an exam result or a weight. This one is the physical exam from August 14. Phrase by phrase:

- **Straight leg raise positive on the left at 50 degrees:** while she lay on her back, lifting her straightened left leg brought on the leg pain. That points to an irritated nerve root. On the right it was negative: no pain.
- **Strength 5/5:** muscle strength is graded from 0 to 5, and 5 is normal.
- **Patellar and Achilles reflexes 2+ and equal:** the knee and ankle reflexes. 2+ is normal. A reduced reflex would be 1+, and an absent one 0.
- **Sensation to light touch normal:** she feels a light touch normally on both legs and feet.

So the exam shows signs of an irritated nerve, but **no weakness, no reflex change, and no numbness**. That difference decides C1.

### Step 8. The visit note, paragraph by paragraph

**Look at:** `note:p1`, `note:p2`, `note:p3`, `note:p4`.

The **visit note** is the clinician's own write-up of the last visit, split into numbered paragraphs (note:p1, note:p2, and so on).

- **note:p1, the history.** Notice what the clinician asked about and ruled out: no injury or fall, no numbness, tingling, or weakness, no fever, chills, or weight loss, no history of cancer, and normal bladder and bowel function. These are red-flag questions.
- **note:p2, treatment so far:** therapy since June 15, and no change. 6/10 is a pain score, where 0 is no pain and 10 is the worst.
- **note:p3, the exam and the impression** (the clinician's summary): radiculopathy "without neurologic deficit," meaning no weakness, reflex change, or loss of feeling.
- **note:p4, the plan:** the injection, with the MRI to aim it.

You've now read the whole record. Time to answer the questions.

### Step 9. C1, red flag: go through the list

**Look at:** `note:p1`, `Observation/practicea-obs-01`, `Condition/practicea-cond-01`. **In the form:** the **C1 red flag** block.

A **red flag** is a warning sign of something more serious than ordinary back pain. The policy lists them; Part 6 of the Training guide groups the list, and **Policy and criteria** at the top right has the official wording. Go through the list group by group:

- **Injury and bone:** no injury or fall (note:p1).
- **Cancer:** "no history of cancer" (note:p1).
- **Infection and immune system:** no fever or chills, and nothing anywhere about an infection, IV drug use, or immune-suppressing medicine.
- **Weight:** no weight loss.
- **Pain pattern:** nothing about pain at night or when lying flat. Pain that is worse with sitting is not on the list.
- **Nerves:** the leg pain and the positive straight leg raise suggest an irritated nerve. But this project counts only objective signs: clinically significant or progressive weakness, a reduced or absent reflex, loss of feeling in a nerve root pattern, new bladder or bowel trouble, or numbness in the saddle area or around the anus. The exam shows none of them. The diagnosis "radiculopathy" in Conditions is a name, not one of those signs.

**Answer: unsupported.** In the highlighted block on the right, **C1 red flag**, click **unsupported**.

**Evidence:** you can leave it empty, because the answer rests on red flags the record does not contain. Or, if the exam is what settled it for you, click **Evidence (0 selected)** and tick **Observation/practicea-obs-01**. Either is fine.

### Step 10. C2, four weeks of conservative care that hasn't worked

**Look at:** `Procedure/practicea-pt-01`, `Encounter/practicea-enc-03`, `Condition/practicea-cond-01`. **In the form:** the **C2 conservative care, four weeks** block.

C2 has three parts. Check each one:

1. **At least four weeks of conservative care, in a structured entry** (an entry in one of the lists, not only the note): physical therapy for seven weeks, in Procedures. **Yes.**
2. **No response:** the August 14 visit says the leg pain is unchanged after the therapy. **Yes.**
3. **At least a month of symptoms before the request:** June 8 (the Condition's onset) to August 19 (the request) is about ten weeks. **Yes.**

**Answer: supported.** In the **C2 conservative care, four weeks** block, click **supported**. Then click **Evidence (0 selected)** and tick the two highlighted boxes: **Procedure/practicea-pt-01** (the therapy) and **Encounter/practicea-enc-03** (the visit that shows no improvement). Ticking note:p2 as well is fine.

### Step 11. C3, the MRI will change what happens next

**Look at:** `Encounter/practicea-enc-03`, `note:p4`. **In the form:** the **C3 informs management** block.

C3 has two parts: a surgery or other aggressive treatment is being considered, **and** the MRI's result would affect the choice.

- The plan is an **epidural steroid injection**, an injection into the spine like the criteria's own example (an intervertebral joint injection). **Yes.**
- The MRI is how the doctor will decide where to aim it. **Yes.**

**Answer: supported.** In the **C3 informs management** block, click **supported**, then open its Evidence and tick **Encounter/practicea-enc-03** and **note:p4**. For C3, the note counts as evidence on its own.

### Step 12. C4, not a repeat of an earlier scan

**In the form:** the **C4 no duplicate imaging** block.

Look for any earlier scan or X-ray of the lower back: an **Imaging reports** section, imaging in **Procedures**, or a mention in the note. There is none.

**Answer: supported, with no evidence ticked.** The answer rests on something the record does not contain, so evidence stays empty. In the **C4 no duplicate imaging** block, click **supported** and leave its Evidence alone.

### Step 13. Routing: the outcome for the whole case

**In the form:** the **Routing** block.

Now ask the routing questions in order, and stop at the first "yes":

1. **Is there a red flag stated only in the note, or one the record contradicts?** No.
2. **Are C3 and C4 supported, and C1 or C2 supported with evidence?** Yes: C2, C3, and C4 are all supported, and C2 has its evidence ticked.

**Answer: approve.** In the **Routing** block, click **approve**. A case needs a red flag **or** a failed four-week trial, not both, so C1 being unsupported doesn't matter here.

(Questions 3 and 4, about contradictions and requests, only come up when a case can't be approved. Part 6 of the Training guide explains them.)

### Step 14. Check your work

The line near the bottom of the form should now be green and say **Complete. Saved in this browser.** If it says "Not complete yet," look for a block with nothing clicked.

Click **Check my answers** under that line. The worked answer appears below the form and should match every choice you just made, with the reasoning written out.

That's one full case. Click **Exit walkthrough**, then click **Practice B** at the top left and label it **on your own**, the same way. When you're done, check your answers there too.

<!-- walkthrough end -->
