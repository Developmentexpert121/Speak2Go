/* Speak2Go COBE evaluation — frontend.

   Everything rendered below comes from the API; there is no static markup for
   results. Field names deliberately mirror the live Mongo schema (IDNumber,
   SemelMosad, StudentMakbila…) rather than the spec's invented names, so what
   an operator types here maps 1:1 onto what the platform actually stores. */

const $ = (sel) => document.querySelector(sel);

const state = {
  slots: [],          // blueprint slots
  files: {},          // question_id -> File
  fetched: {},        // question_id -> { localPath, label, duration, timeBand }
  questionTexts: {},  // question_id -> string
  levels: [],
  examId: null,
  poller: null,
  fetchEnabled: false,
};

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

const scoreClass = (v) => (v >= 70 ? "good" : v >= 50 ? "warn" : "bad");
const scoreColor = (v) => (v >= 70 ? "var(--good)" : v >= 50 ? "var(--warn)" : "var(--bad)");
// Points earned on a question are score% × its point value, so they carry
// fractions the raw scores do not. Two places show them; round in one.
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const mmss = (s) => {
  if (s == null) return "—";
  const t = Math.round(Number(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/* ── health + levels ─────────────────────────────────── */
async function loadHealth() {
  try {
    const h = await (await fetch("/api/health")).json();
    state.levels = h.levels || [];
    state.fetchEnabled = Boolean(h.recordingsFetch);

    const bits = [];
    bits.push(
      h.deepgramKey && h.openaiKey
        ? `<span class="ok">● API keys loaded</span> · ${esc(h.model)}`
        : `<span class="bad">● Missing API keys</span> — check .env`
    );
    bits.push(
      h.recordingsFetch
        ? `<span class="ok">● platform fetch on</span>`
        : `<span class="warn-t">● platform fetch off</span>`
    );
    $("#health").innerHTML = bits.join(" &nbsp;·&nbsp; ");

    renderLevelOptions();
  } catch {
    $("#health").innerHTML = `<span class="bad">● Server unreachable</span>`;
  }
}

/* The blocked-level path is kept even though nothing is blocked today (Boost
   moved to a separate project). It costs one attribute and means a level can
   be surfaced as unavailable-with-a-reason instead of vanishing silently. */
function renderLevelOptions() {
  const sel = $("#level");
  sel.innerHTML = state.levels
    .map(
      (l) =>
        `<option value="${esc(l.level)}" ${l.supported ? "" : "data-blocked=1"}>
           ${esc(l.label)} · CEFR ${esc(l.cefr)}${l.supported ? "" : "  (not available)"}
         </option>`
    )
    .join("");
  showLevelNotice();
}

function currentLevel() {
  return state.levels.find((l) => l.level === $("#level").value);
}

function showLevelNotice() {
  const l = currentLevel();
  $("#levelNotice").innerHTML =
    l && !l.supported
      ? `<div class="notice blocked"><strong>${esc(l.label)} cannot be graded.</strong> ${esc(
          l.blockedReason
        )}</div>`
      : "";
  $("#btnRun").disabled = Boolean(l && !l.supported);
}

/* ── student object (spec 3.2) ───────────────────────── */
function studentInput() {
  return {
    IDNumber: $("#idNumber").value.trim(),
    FirstName: $("#firstName").value.trim(),
    LastName: $("#lastName").value.trim(),
    StudentGrade: $("#studentGrade").value.trim(),
    StudentMakbila: $("#studentMakbila").value.trim(),
    SemelMosad: $("#semelMosad").value.trim(),
    schoolName: $("#schoolName").value.trim(),
  };
}

/* Preview the derived object so it is obvious the raw ID is not what gets
   stored — the operator can see the hash standing in for it. */
function renderStudentPreview() {
  const s = studentInput();
  const full = [s.FirstName, s.LastName].filter(Boolean).join(" ") || "—";
  const gc = s.StudentGrade && s.StudentMakbila ? `${s.StudentGrade}/${s.StudentMakbila}` : s.StudentGrade || "—";
  $("#studentPreview").innerHTML = `
    <div class="obj-title">Derived Student Object</div>
    <div class="obj-grid">
      <span>studentId</span><code>${s.IDNumber ? "sha256(salt + IDNumber) → 32 hex" : "— no ID entered"}</code>
      <span>fullName</span><code>${esc(full)}</code>
      <span>gradeClass</span><code>${esc(gc)}</code>
      <span>schoolName</span><code>${esc(s.schoolName || "—")}</code>
      <span>schoolId</span><code>${esc(s.SemelMosad || "—")}</code>
    </div>`;
}

/* ── blueprint / slots ───────────────────────────────── */
async function loadBlueprint() {
  showLevelNotice();
  const l = currentLevel();
  if (l && !l.supported) {
    $("#slots").innerHTML = `<div class="hint">No slots — this level has no rubric yet.</div>`;
    state.slots = [];
    return;
  }

  const res = await fetch(`/api/blueprint?level=${encodeURIComponent($("#level").value)}`);
  const bp = await res.json();
  if (!res.ok) {
    $("#slots").innerHTML = `<div class="err">${esc(bp.error)}</div>`;
    state.slots = [];
    return;
  }

  state.slots = bp.slots;
  state.questionTexts = {};
  for (const s of bp.slots) state.questionTexts[s.question_id] = s.question_text;
  if (!$("#partCTranscript").value.trim()) {
    $("#partCTranscript").value = bp.defaultPartCTranscript || "";
  }
  renderSlots();
}

function renderSlots() {
  $("#slots").innerHTML = state.slots
    .map((s) => {
      const file = state.files[s.question_id];
      const got = state.fetched[s.question_id];
      const filled = Boolean(file || got);

      let label = "";
      if (file) label = `${esc(file.name)} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
      else if (got) label = esc(got.label);

      // Spec §4.C time bands are only enforced on Part B. Because `duration` is
      // stored alongside the recording, we can warn about a penalty before
      // spending a Deepgram call to discover it.
      let warn = "";
      if (got && got.timeBand && s.part === "B" && got.timeBand.deductionPct > 0) {
        warn = `<div class="slot-warn">Part B time band <strong>${esc(
          got.timeBand.band
        )}</strong> → −${got.timeBand.deductionPct}% from all criteria</div>`;
      } else if (got && got.duration != null && got.duration < 20) {
        warn = `<div class="slot-warn">Under 0:20 → this section scores 0 (spec §4.C)</div>`;
      }

      return `
      <div class="slot ${filled ? "filled" : ""}">
        <div class="slot-top">
          <span class="qid">${esc(s.question_id)}</span>
          <span class="slot-desc">${esc(s.description)}</span>
          <span class="slot-pts">${s.points} pts</span>
          <span class="slot-actions">
            <button class="btn small" data-upload="${esc(s.question_id)}">Upload</button>
            <button class="btn small ghost" data-pick="${esc(s.question_id)}">Platform</button>
            ${filled ? `<button class="btn small ghost" data-clear="${esc(s.question_id)}">✕</button>` : ""}
          </span>
        </div>
        ${filled ? `<div class="slot-file"><span class="name">${label}</span></div>` : ""}
        ${warn}
        <details class="qtext">
          <summary>Question text</summary>
          <textarea rows="3" data-qtext="${esc(s.question_id)}">${esc(
        state.questionTexts[s.question_id] || ""
      )}</textarea>
        </details>
        <input type="file" accept="audio/*,video/*" data-input="${esc(s.question_id)}" />
      </div>`;
    })
    .join("");

  $("#slots").querySelectorAll("[data-upload]").forEach((b) =>
    b.addEventListener("click", () => $(`[data-input="${b.dataset.upload}"]`).click())
  );
  $("#slots").querySelectorAll("[data-input]").forEach((inp) =>
    inp.addEventListener("change", (e) => {
      const id = inp.dataset.input;
      if (e.target.files[0]) {
        state.files[id] = e.target.files[0];
        delete state.fetched[id];
        renderSlots();
      }
    })
  );
  $("#slots").querySelectorAll("[data-clear]").forEach((b) =>
    b.addEventListener("click", () => {
      delete state.files[b.dataset.clear];
      delete state.fetched[b.dataset.clear];
      renderSlots();
    })
  );
  $("#slots").querySelectorAll("[data-pick]").forEach((b) =>
    b.addEventListener("click", () => openPicker(b.dataset.pick))
  );
  $("#slots").querySelectorAll("[data-qtext]").forEach((ta) =>
    ta.addEventListener("input", () => {
      state.questionTexts[ta.dataset.qtext] = ta.value;
    })
  );
}

/* ── recording picker ────────────────────────────────── */
/* Grouped student -> lesson, matching how the data is stored:
   users.freeSpeechArray[], keyed by idDetection. */
let pickTarget = null;

async function openPicker(questionId) {
  pickTarget = questionId || null;
  $("#pickModal").classList.remove("hidden");
  $("#pickBody").textContent = "Loading…";

  try {
    const data = await (await fetch("/api/recordings")).json();

    $("#pickNotice").innerHTML = data.fetchEnabled
      ? `Recordings are read through the platform endpoint <code>${esc(
          data.endpoint
        )}</code>, which resolves the private S3 key after authorizing the caller.`
      : `<strong>Fetching is disabled.</strong> Audio lives in the private
         <code>s2g-recordings</code> bucket and is only readable through
         <code>${esc(data.endpoint)}</code>, which requires an authenticated token.
         Set <code>SPEAK2GO_API_URL</code> and <code>SPEAK2GO_API_TOKEN</code> in
         <code>.env</code> to enable it. The list below is the client's exported sample —
         you can see what exists, but not download it yet.`;

    if (!data.students.length) {
      $("#pickBody").innerHTML = `<div class="err">No recordings in db_reference/sample_recordings.json</div>`;
      return;
    }

    $("#pickBody").innerHTML = data.students
      .map(
        (st) => `
        <details class="student-group">
          <summary>
            <strong>${esc(st.userEmail)}</strong>
            <span class="q">${st.lessons.length} lesson${st.lessons.length === 1 ? "" : "s"}</span>
          </summary>
          ${st.lessons
            .map(
              (ls) => `
            <div class="lesson-h">Lesson ${esc(ls.lessonId)} · ${ls.recordingCount} recordings</div>
            ${ls.recordings.map((r) => recRow(st.userEmail, r, data.fetchEnabled)).join("")}`
            )
            .join("")}
        </details>`
      )
      .join("");

    wirePickButtons();
  } catch (err) {
    $("#pickBody").innerHTML = `<div class="err">${esc(err.message)}</div>`;
  }
}

function recRow(userEmail, r, enabled) {
  const band =
    r.timeBand && r.timeBand.deductionPct > 0
      ? `<span class="band bad">${esc(r.timeBand.band)} · −${r.timeBand.deductionPct}%</span>`
      : r.timeBand
      ? `<span class="band ok">${esc(r.timeBand.band)}</span>`
      : "";

  return `
  <div class="rec-row">
    <div class="grow">
      <div class="qtxt" title="${esc(r.questionText || "")}">${esc(
        r.questionText || "(no question text)"
      )}</div>
      <div class="q">
        ${mmss(r.duration)} ${band}
        · <span title="idDetection">${esc(String(r.idDetection || "").slice(0, 16))}…</span>
        · ${esc(String(r.recordTime || "").slice(0, 10))}
      </div>
    </div>
    <select data-target>
      ${state.slots
        .map(
          (s) =>
            `<option value="${esc(s.question_id)}" ${
              s.question_id === pickTarget ? "selected" : ""
            }>${esc(s.question_id)}</option>`
        )
        .join("")}
    </select>
    <button class="btn small" data-fetch
            data-email="${esc(userEmail)}" data-iddet="${esc(r.idDetection)}"
            data-dur="${r.duration ?? ""}"
            data-band='${esc(JSON.stringify(r.timeBand || null))}'
            ${enabled ? "" : "disabled title='Set SPEAK2GO_API_TOKEN to enable'"}>
      Fetch
    </button>
  </div>`;
}

function wirePickButtons() {
  $("#pickBody").querySelectorAll("[data-fetch]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const qid = btn.closest(".rec-row").querySelector("[data-target]").value;
      btn.disabled = true;
      btn.textContent = "Fetching…";
      try {
        const res = await fetch("/api/recordings/fetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userEmail: btn.dataset.email,
            idDetection: btn.dataset.iddet,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Fetch failed");

        const dur = btn.dataset.dur === "" ? null : Number(btn.dataset.dur);
        state.fetched[qid] = {
          localPath: data.localPath,
          label: `platform · ${mmss(dur)}`,
          duration: dur,
          timeBand: JSON.parse(btn.dataset.band || "null"),
        };
        delete state.files[qid];
        renderSlots();
        btn.textContent = "✓ Added";
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Fetch";
        alert(err.message);
      }
    })
  );
}

/* ── run ─────────────────────────────────────────────── */
async function runExam() {
  if (!Object.keys(state.files).length && !Object.keys(state.fetched).length) {
    alert("Upload at least one answer, or fetch one from the platform.");
    return;
  }

  $("#btnRun").disabled = true;
  $("#results").classList.add("hidden");
  $("#progressCard").classList.remove("hidden");
  setProgress(0, "Uploading…");

  const fd = new FormData();
  fd.append("level", $("#level").value);
  fd.append("student", JSON.stringify(studentInput()));
  fd.append("examName", $("#examName").value);
  fd.append("examDescription", $("#examDescription").value);
  if ($("#dateExecuted").value) {
    fd.append("dateExecuted", new Date($("#dateExecuted").value).toISOString());
  }
  fd.append("partCTranscript", $("#partCTranscript").value);
  fd.append("partCClipId", "ui_part_c_clip");
  fd.append(
    "questions",
    JSON.stringify(
      state.slots.map((s) => ({
        question_id: s.question_id,
        question_text: state.questionTexts[s.question_id] || "",
        localPath: state.fetched[s.question_id]?.localPath || null,
      }))
    )
  );
  for (const [qid, file] of Object.entries(state.files)) fd.append(`audio_${qid}`, file);

  try {
    const res = await fetch("/api/exams", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to start");
    state.examId = data.examId;
    poll();
  } catch (err) {
    $("#btnRun").disabled = false;
    $("#progressCard").classList.add("hidden");
    showError(err.message);
  }
}

function setProgress(pct, label) {
  $("#progressFill").style.width = `${pct}%`;
  $("#progressLabel").textContent = label;
}

function poll() {
  clearInterval(state.poller);
  state.poller = setInterval(async () => {
    try {
      const job = await (await fetch(`/api/exams/${state.examId}`)).json();
      const pct = job.total ? Math.round((job.completed / job.total) * 100) : 5;

      const stageText =
        {
          queued: "Queued…",
          starting: "Starting…",
          seeding_reference_material: "Seeding Part C reference material…",
          transcribing_and_scoring: `Transcribing & scoring ${job.currentQuestionId ?? ""}…`,
          question_done: `Finished ${job.currentQuestionId ?? ""}`,
          generating_recommendations: "Generating teacher recommendations…",
          rendering_reports: "Rendering HTML + PDF reports…",
          done: "Complete",
        }[job.stage] || job.stage;

      setProgress(
        job.status === "done" ? 100 : Math.max(pct, 5),
        `${stageText}  (${job.completed}/${job.total} questions)`
      );

      if (job.status === "done") {
        clearInterval(state.poller);
        $("#btnRun").disabled = false;
        setProgress(100, "Complete");
        renderResults(job);
      } else if (job.status === "error") {
        clearInterval(state.poller);
        $("#btnRun").disabled = false;
        $("#progressCard").classList.add("hidden");
        showError(job.error);
      }
    } catch {
      /* transient — keep polling */
    }
  }, 1500);
}

function showError(msg) {
  $("#results").classList.remove("hidden");
  $("#results").innerHTML = `<div class="card"><div class="err">${esc(msg)}</div></div>`;
}

/* ── results rendering (all dynamic) ─────────────────── */
function renderResults(job) {
  const exam = job.result;
  const report = job.report;
  const eo = job.examObject || {};
  const so = job.studentObject || {};
  const R = 58;
  const C = 2 * Math.PI * R;
  const pct = Math.max(0, Math.min(100, exam.overall_score));

  const hero = `
  <section class="card">
    <div class="score-hero">
      <div class="dial">
        <svg width="132" height="132">
          <!-- Track uses --line, not --panel-2: on the light theme the inset
               panel colour is nearly white and the unfilled arc vanished. -->
          <circle cx="66" cy="66" r="${R}" stroke="var(--line)" stroke-width="11" fill="none"/>
          <circle cx="66" cy="66" r="${R}" stroke="${scoreColor(pct)}" stroke-width="11" fill="none"
                  stroke-linecap="round" stroke-dasharray="${C}"
                  stroke-dashoffset="${C - (pct / 100) * C}"/>
        </svg>
        <div class="dial-val">${exam.overall_score}</div>
      </div>
      <div class="hero-meta">
        <h3>${esc(so.fullName || "Student")}</h3>
        <p>
          ${esc(eo.levelLabel || exam.level)} · CEFR ${esc(eo.cefrLevel || "—")} ·
          ${exam.points_earned} of ${exam.points_possible} points
        </p>
        <p class="hero-sub">
          ${esc(so.schoolName || "—")} · Semel ${esc(so.schoolId || "—")} · Class ${esc(
    so.gradeClass || "—"
  )}
        </p>
        <p style="margin-top:8px">
          <span class="pill ${scoreClass(pct)}">${
    pct >= 70 ? "Pass" : pct >= 50 ? "Borderline" : "Below standard"
  }</span>
          ${
            exam.unattempted_questions.length
              ? `<span class="pill bad" style="margin-left:6px">${exam.unattempted_questions.length} unattempted</span>`
              : ""
          }
        </p>
      </div>
      <div class="hero-actions">
        ${eo.reportHtmlUrl ? `<a class="btn small ghost" href="${esc(eo.reportHtmlUrl)}" target="_blank">Report HTML</a>` : ""}
        ${eo.reportPdfUrl ? `<a class="btn small ghost" href="${esc(eo.reportPdfUrl)}" target="_blank">Download PDF</a>` : ""}
        ${eo.reportDashboardUrl ? `<a class="btn small ghost" href="${esc(eo.reportDashboardUrl)}" target="_blank">Full dashboard</a>` : ""}
      </div>
    </div>
  </section>`;

  /* The two spec objects, shown as the module would hand them to a dashboard —
     this IS the deliverable, so it should be inspectable rather than implied. */
  const objects = `
  <section class="card">
    <div class="card-head">
      <h2>Spec objects</h2>
      <span class="spec-tag">§3.1 Exam · §3.2 Student</span>
    </div>
    <div class="obj-two">
      <div>
        <div class="obj-title">Exam Object</div>
        <div class="obj-grid">
          ${[
            ["examId", eo.examId],
            ["examLesson", `${eo.examLesson} — ${eo.examLessonSource || ""}`],
            ["name", eo.name],
            ["description", eo.description],
            ["level", eo.level],
            ["cefrLevel", eo.cefrLevel],
            ["dateExecuted", eo.dateExecuted],
            ["finalScore", eo.finalScore],
            ["reportHtmlUrl", eo.reportHtmlUrl],
            ["reportPdfUrl", eo.reportPdfUrl],
          ]
            .map(([k, v]) => `<span>${k}</span><code>${esc(v ?? "null")}</code>`)
            .join("")}
        </div>
      </div>
      <div>
        <div class="obj-title">Student Object</div>
        <div class="obj-grid">
          ${[
            ["studentId", so.studentId],
            ["fullName", so.fullName],
            ["gradeClass", so.gradeClass],
            ["schoolName", so.schoolName],
            ["schoolId", so.schoolId],
          ]
            .map(([k, v]) => `<span>${k}</span><code>${esc(v ?? "null")}</code>`)
            .join("")}
        </div>
        <p class="hint" style="margin-top:10px">
          <code>studentId</code> is a salted SHA-256 of <code>IDNumber</code>. The raw
          national ID is not stored, logged, or sent to the model.
        </p>
      </div>
    </div>
  </section>`;

  const questions = `
  <section class="card">
    <h2>Question breakdown</h2>
    <div style="display:grid;gap:12px">
      ${exam.question_results
        .map((q) => {
          const crit = (q.criterion_breakdown || [])
            .map(
              (c) => `
            <div class="crit-row">
              <span>${esc(c.criterion_name)}</span>
              <span class="bar"><i style="width:${c.criterion_score}%;background:${scoreColor(
                c.criterion_score
              )}"></i></span>
              <span>${c.criterion_score}</span>
            </div>`
            )
            .join("");

          const deds = (q.deductions || [])
            .map((d) => `<div class="ded-item">−${d.deductionPct}% · ${esc(d.reason)}</div>`)
            .join("");

          const m = q.audio_metrics || {};
          return `
          <div class="q-card">
            <div class="q-head">
              <span class="qid">${esc(q.question_id)}</span>
              <span class="grow">${esc(q.description)}</span>
              <span class="q-score" style="color:${scoreColor(q.final_question_score)}">
                ${q.final_question_score}<span class="q-of">/100</span>
              </span>
              <span class="slot-pts">${round2(
                (q.final_question_score / 100) * q.weight
              )} of ${q.weight} pts</span>
            </div>
            <div class="q-meta">
              raw ${q.raw_score} → final ${q.final_question_score} ·
              ${mmss(m.totalDurationSeconds)} · ${m.wpm ?? 0} wpm ·
              ${esc(m.fluencyLabel || "—")}
            </div>
            ${q.coverage_note ? `<div class="cov-note">${esc(q.coverage_note)}</div>` : ""}
            ${deds ? `<div class="ded">${deds}</div>` : ""}
            ${crit ? `<div class="crit">${crit}</div>` : ""}
            ${
              q.transcript
                ? `<div class="q-transcript">${esc(q.transcript)}</div>`
                : `<div class="q-transcript" style="color:var(--muted)">No transcript — no audio submitted.</div>`
            }
          </div>`;
        })
        .join("")}
    </div>
  </section>`;

  const dedTable = report.deductionsTable.length
    ? `
  <section class="card">
    <h2>Deductions applied</h2>
    <table>
      <thead><tr><th>Question</th><th>Reason</th><th>Deduction</th></tr></thead>
      <tbody>
        ${report.deductionsTable
          .map(
            (d) =>
              `<tr><td>${esc(d.questionId)}</td><td>${esc(d.reason)}</td><td>−${d.deductionPct}%</td></tr>`
          )
          .join("")}
      </tbody>
    </table>
    <p class="hint" style="margin:12px 0 0">
      Deductions do not stack — the largest applicable one is used per question.
    </p>
  </section>`
    : "";

  const recs = `
  <section class="card">
    <h2>Teacher recommendations</h2>
    <div class="recs">${esc(report.teacherRecommendations)}</div>
  </section>`;

  $("#results").innerHTML = hero + objects + questions + dedTable + recs;
  $("#results").classList.remove("hidden");
  $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ── boot ────────────────────────────────────────────── */
$("#btnRun").addEventListener("click", runExam);
$("#btnPickAll").addEventListener("click", () => openPicker(null));
$("#pickClose").addEventListener("click", () => $("#pickModal").classList.add("hidden"));
$("#level").addEventListener("change", loadBlueprint);
["#firstName", "#lastName", "#idNumber", "#studentGrade", "#studentMakbila", "#semelMosad", "#schoolName"].forEach(
  (sel) => $(sel).addEventListener("input", renderStudentPreview)
);

$("#dateExecuted").value = new Date().toISOString().slice(0, 10);
renderStudentPreview();
loadHealth().then(loadBlueprint);
